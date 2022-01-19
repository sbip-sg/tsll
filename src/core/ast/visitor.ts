import ts from 'typescript';
import { SyntaxNotSupportedError, InstantiateError, VariableUndefinedError, TypeUndefinedError, TypeMismatchError } from '../../common/error';
import { Builder } from '../ir/builder';
import { isBasicBlock, isGlobalVariable, isValue, Type, Value, isAllocaInst, isFunction, isConstantInt, isPointerType } from '../ir/types';
import { Scope } from '../../common/scope';
import { isString, FunctionLikeDeclaration, Property, isStringArray, isBreak, isContinue, Break, Continue } from '../../common/types';
import llvm, { ArrayType, BasicBlock, CallInst, ConstantInt, DILocalScope, StructType } from '@lungchen/llvm-node';
import { Generics } from './generics';
import { Debugger } from '../ir/debugger';

export class Visitor {
    private builder: Builder;
    private debugger: Debugger;
    private static visitor: Visitor;
    private static generics: Generics;


    private constructor(_builder: Builder, _debugger: Debugger) {
        this.builder = _builder;
        this.debugger = _debugger;
    }

    public static getVisitor(_builder?: Builder, _debugger?: Debugger): Visitor {

        if (_builder !== undefined && _debugger !== undefined) {
            if (this.visitor === undefined) this.visitor = new Visitor(_builder, _debugger);
            this.generics = new Generics(this.visitor);
        } else {
            if (this.visitor === undefined) throw new InstantiateError();
        }

        return this.visitor;
    }

    public visitSourceFile(sourceFile: ts.SourceFile, scope: Scope) {
        // Create main function as the entry point
        let entryFunctionName = 'main';
        if (!scope.has(entryFunctionName)) {
            let entryFunction = this.builder.buildFunction(entryFunctionName, this.builder.buildVoidType(), [], []);
            // const diSubprogram = this.debugger.buildFunctionDbgInfo(sourceFile, entryFunction);
            // entryFunction.setSubprogram(diSubprogram);
            scope.set(entryFunction.name, entryFunction);
            scope.enter('', entryFunction);
        }

        for (let statement of sourceFile.statements) {
            this.visitStatement(statement, scope);
        }

        this.builder.buildReturn();
        this.builder.verifyModule();
    }

    public visitVariableStatement(variableStatement: ts.VariableStatement, scope: Scope) {
        this.visitVariableDeclarationList(variableStatement.declarationList, scope);
    }

    public visitVariableDeclarationList(variableDeclarationList: ts.VariableDeclarationList, scope: Scope) {
        let values: (Value | string)[] = [];
        for (let variableDeclaration of variableDeclarationList.declarations) {
            let declarationValue = this.visitVariableDeclaration(variableDeclaration, scope);
            values.push(declarationValue);
        }
        return values;
    }

    public visitVariableDeclaration(variableDeclaration: ts.VariableDeclaration, scope: Scope) {

        // Retrieve identifier names
        let name = this.visitBindingName(variableDeclaration.name, scope);
        let type = this.visitTypeNode(variableDeclaration.type, scope);

        this.builder.setType(name, type);

        /**
         * By default, a value of type is built if no initializer is provided.
         */
        let visited: llvm.Value | string;
        if (variableDeclaration.initializer === undefined) {
            if (type.isPointerTy()) type = type.elementType;
            visited = this.builder.buildAlloca(type);
        } else {
            visited = this.visitExpression(variableDeclaration.initializer, scope);
        }

        // TODO: We could do type checking between visited type and declared type.
        if (isString(visited)) {
            let visitedValue = scope.get(visited);
            let newAlloca = this.builder.buildAlloca(visitedValue.type, undefined, name);
            this.builder.buildStore(visitedValue, newAlloca);
            scope.set(name, newAlloca);
            const currentBlock = this.builder.getCurrentBlock();
            const diLocalScope = this.debugger.getCurrentDIScope();
            // this.debugger.buildVariableDbgInfo(variableDeclaration, newAlloca, diLocalScope, currentBlock);
            return newAlloca;
        }

        if (isFunction(visited)) {
            visited.name = name;
            scope.set(name, visited);
            return visited;
        }

        if (isAllocaInst(visited)) {
            // Rename the value
            visited.name = name;
            scope.set(name, visited);
            return visited;
        }

        if (scope.isModuleScope()) {
            let moduleVal = this.builder.buildGlobalVariable(visited, name);
            scope.set(name, moduleVal);
            return moduleVal;
        }

        if (isValue(visited)) {
            let newAlloca = this.builder.buildAlloca(visited.type, undefined, name);
            scope.set(name, newAlloca);
            return visited;
        }

        throw new SyntaxNotSupportedError();
    }

    public visitUnionType(unionTypeNode: ts.UnionTypeNode, scope: Scope) {

        let largestType = this.builder.buildVoidType();
        let largestSize: number = 0;
        for (const typeNode of unionTypeNode.types) {
            const newLargestType = this.visitTypeNode(typeNode, scope);
            const newLargestSize = newLargestType.getPrimitiveSizeInBits();
            if (newLargestSize > largestSize) {
                largestSize = newLargestSize;
                largestType = newLargestType; 
            }
        }

        const structType = this.builder.buildStructType('');

        structType.setBody([largestType]);
        return structType;
    }

    public visitArrayType(arrayTypeNode: ts.ArrayTypeNode, scope: Scope) {
        return this.builder.buildOpaquePtrType();
    }

    public visitIfStatement(ifStatement: ts.IfStatement, scope: Scope) {

        let currentFunction = scope.getCurrentFunction();
        let currentBlock = this.builder.getCurrentBlock();
        if (currentBlock === undefined) throw new SyntaxNotSupportedError();
        let endBlock = this.builder.buildBasicBlock(currentFunction, 'if.end');

        while (1) {

            let nextStatement = ifStatement.elseStatement;
            let visited = this.visitExpression(ifStatement.expression, scope);
            let condition = this.resolveNameDefinition(visited, scope);

            // elseBlock name defaults to "else"
            let elseBlockName = 'if.else';
            if (nextStatement !== undefined && ts.isIfStatement(nextStatement)) {
                elseBlockName = 'if.elseif';
            }

            let thenBlock = this.builder.buildBasicBlock(currentFunction, 'if.then');
            let elseBlock = this.builder.buildBasicBlock(currentFunction, elseBlockName);
            this.builder.buildConditionBranch(condition, thenBlock, elseBlock);

            // Set the insertion point from 'then' basicBlock
            this.builder.setCurrentBlock(thenBlock);
            scope.enter('Then');

            let thenVal = this.visitStatement(ifStatement.thenStatement, scope);
            // It means one of the statements is a return statement inside the block
            if (isValue(thenVal)) {
                this.builder.buildReturn(thenVal);
            } else if (isBreak(thenVal)) {
                this.builder.buildBranch(this.builder.getLoopEndBlock());
            } else if (isContinue(thenVal)) {
                this.builder.buildBranch(this.builder.getLoopNextBlock())
            } else {
                this.builder.buildBranch(endBlock);
            }

            scope.leave();

            this.builder.setCurrentBlock(elseBlock);
            // No more statement to visit
            if (nextStatement === undefined) {
                this.builder.buildBranch(endBlock);
                break;
            }

            // Check whether there are still else-if blocks
            if (!ts.isIfStatement(nextStatement)) {
                scope.enter('Else/IfElse');
                
                let elseVal = this.visitStatement(nextStatement, scope);
                if (isValue(elseVal)) {
                    this.builder.buildReturn(elseVal);
                } else if (isBreak(thenVal)) {
                    this.builder.buildBranch(this.builder.getLoopEndBlock());
                } else if (isContinue(thenVal)) {
                    this.builder.buildBranch(this.builder.getLoopNextBlock())
                } else {
                    this.builder.buildBranch(endBlock);
                }

                scope.leave();

                break;
            } else {
                ifStatement = nextStatement;
            }

        }

        this.builder.setCurrentBlock(endBlock);

    }

    

    public visitBindingName(bindingName: ts.BindingName, scope: Scope) {
        if (ts.isIdentifier(bindingName)) return this.visitIdentifier(bindingName, scope);
        // if (ts.isObjectBindingPattern(bindingName)) return this.visitObjectBindingPattern(bindingName, scope);
        // if (ts.isArrayBindingPattern(bindingName)) return this.visitArrayBindingPattern(bindingName, scope);
        throw new SyntaxNotSupportedError();
    }

    public visitObjectBindingPattern(objectBindingPattern: ts.ObjectBindingPattern, scope: Scope) {
        throw new SyntaxNotSupportedError();
    }

    public visitArrayBindingPattern(arrayBindingPattern: ts.ArrayBindingPattern, scope: Scope) {
        throw new SyntaxNotSupportedError();
    }

    public visitFunctionDeclaration(functionDeclaration: ts.FunctionDeclaration, scope: Scope) {
        const fn = this.visitFunctionLikeDeclaration(functionDeclaration, scope);
        // this.debugger.buildFunctionDbgInfo(function, )
        scope.set(fn.name, fn);
    }

    public visitFunctionLikeDeclaration(functionLikeDeclaration: FunctionLikeDeclaration, scope: Scope) {
        const lastFunction = scope.getCurrentFunction();
        const modifiers = functionLikeDeclaration.modifiers;

        if (functionLikeDeclaration.name !== undefined && !ts.isIdentifier(functionLikeDeclaration.name)) throw new SyntaxNotSupportedError();
        if (functionLikeDeclaration.type === undefined) throw new SyntaxNotSupportedError();

        let returnType = this.visitTypeNode(functionLikeDeclaration.type, scope);
        let functionName = functionLikeDeclaration.name?.text || 'noname';
        let parameterTypes: Type[] = [];
        let parameterNames: string[] = [];
        let defaultValues = new Map<string, Value>();

        for (let parameter of functionLikeDeclaration.parameters) {

            let parameterName = this.visitBindingName(parameter.name, scope);
            parameterNames.push(parameterName);
            
            if (parameter.initializer !== undefined) {
                let visited = this.visitExpression(parameter.initializer, scope);
                let parameterValue = this.resolveNameDefinition(visited, scope);
                defaultValues.set(parameterName, parameterValue);
            }

            if (parameter.type === undefined) throw new SyntaxNotSupportedError();
            let parameterType = this.visitTypeNode(parameter.type, scope);
            parameterTypes.push(parameterType);
        }

        const currentScopeName = scope.getCurrentScopeName();
        scope.setDefaultValues(`${currentScopeName}${functionName}`, defaultValues);

        const fn = this.builder.buildFunction(`${functionName}`, returnType, parameterTypes, parameterNames);
        scope.enter(functionName, fn);

        let modifierIdx = 0;
        let coroId: CallInst | undefined;
        let coroHandler: CallInst | undefined;
        while (modifiers !== undefined && modifierIdx < modifiers.length) {
            // For now, only one kind of modifier is recognized.
            switch (modifiers[modifierIdx].kind) {
                case ts.SyntaxKind.AsyncKeyword:
                    const alignment = this.builder.buildInteger(0, 32);
                    const nullPtr = this.builder.buildNullPtr();
                    coroId = this.builder.buildFunctionCall('llvm.coro.id', [alignment, nullPtr, nullPtr, nullPtr]);
                    const coroFrame = this.builder.buildFunctionCall('llvm.coro.frame', []);
                    coroHandler = this.builder.buildFunctionCall('llvm.coro.begin', [coroId, coroFrame]);
            }
            ++modifierIdx;
        }

        // For future reference
        if (coroHandler !== undefined) scope.set('coro.handler', coroHandler);

        // In the current scope, initialize the parameter names of a function with the arguments received from a caller
        for (let i = 0; i < parameterNames.length; i++) {
            let newAlloca = this.builder.buildAlloca(parameterTypes[i]);
            this.builder.buildStore(fn.getArguments()[i], newAlloca);
            scope.set(parameterNames[i], newAlloca);
        }

        let returnValue: Value | Break | Continue | undefined;
        if (functionLikeDeclaration.body !== undefined) returnValue = this.visitBlock(functionLikeDeclaration.body, scope);
        if (returnValue === undefined || isValue(returnValue)) {
            // Determine whether a suspended coroutine is at its final point.
            if (coroHandler !== undefined) this.builder.buildFunctionCall('llvm.coro.destroy', [coroHandler]);
            this.builder.buildReturn(returnValue);
        }

        this.builder.verifyFunction(fn);

        // Return to the last scope
        scope.leave(fn);

        const entryBlock = lastFunction.getEntryBlock();
        if (!isBasicBlock(entryBlock)) throw new SyntaxNotSupportedError();
        this.builder.setCurrentBlock(entryBlock);
        return fn;

    }

    public visitExpressionStatement(expressionStatement: ts.ExpressionStatement, scope: Scope) {
        this.visitExpression(expressionStatement.expression, scope);
    }

    public visitCallExpression(callExpression: ts.CallExpression, scope: Scope) {

        /**
         * Identify if the callee is a method of class, interface, and whatnot
         */
        const declaration = scope.getDeclaration(callExpression.expression);
        if (declaration !== undefined) this.visitDeclaration(declaration, scope);

        const name = this.visitExpression(callExpression.expression, scope);
        if (!isString(name)) throw new SyntaxNotSupportedError();

        scope.setIsMethod(false);

        let values: Value[] = [];
        let types: llvm.Type[] = [];
        for (let argument of callExpression.arguments) {
            let visited = this.visitExpression(argument, scope);
            let value = this.resolveNameDefinition(visited, scope);
            values.push(value);
            types.push(value.type)
        }


        let defaultValues: Map<string, Value> | undefined;
        try {
            let thisValue = scope.get('this');
            const baseClassName = scope.getBaseClassName();
            if (baseClassName !== undefined) {
                const baseStructType = this.builder.getStructType(baseClassName);
                const baseStructPtrType = this.builder.buildPointerType(baseStructType);
                thisValue = this.builder.buildBitcast(thisValue, baseStructPtrType);
                scope.resetBaseClassName();
            }
            values.unshift(thisValue);
            defaultValues = scope.getDefaultValues(name);
        } catch (err) {
            // err msg here is not important
        }

        return this.builder.buildFunctionCall(name, values, defaultValues);
    }

    public visitBlock(block: ts.Block, scope: Scope) {
        // Capture the return value of the return statement
        let returnValue: Value | Continue | Break | undefined;
        for (let statement of block.statements) {
            returnValue = this.visitStatement(statement, scope);
        }
        return returnValue;
    }

    public visitStatement(statement: ts.Statement, scope: Scope) {
        // Only the return statement returns its Value for future reference
        if (ts.isVariableStatement(statement)) this.visitVariableStatement(statement, scope);
        if (ts.isExpressionStatement(statement)) this.visitExpressionStatement(statement, scope);
        if (ts.isFunctionDeclaration(statement)) this.visitFunctionDeclaration(statement, scope);
        if (ts.isClassDeclaration(statement)) this.visitClassDeclaration(statement, scope);
        if (ts.isIfStatement(statement)) this.visitIfStatement(statement, scope);
        if (ts.isForStatement(statement)) this.visitForStatement(statement, scope);
        if (ts.isConstructorDeclaration(statement)) this.visitConstructorDeclaration(statement, scope);
        if (ts.isBlock(statement)) return this.visitBlock(statement, scope);
        if (ts.isReturnStatement(statement)) return this.visitReturnStatement(statement, scope);
        if (ts.isImportDeclaration(statement)) this.visitImportDeclaration(statement, scope);
        if (ts.isInterfaceDeclaration(statement)) this.visitInterfaceDeclaration(statement, scope);
        if (ts.isExportDeclaration(statement)) this.visitExportDeclaration(statement, scope);
        if (ts.isWhileStatement(statement)) this.visitWhileStatement(statement, scope);
        if (ts.isForInStatement(statement)) this.visitForInStatement(statement, scope);
        if (ts.isForOfStatement(statement)) this.visitForOfStatement(statement, scope);
        if (ts.isDoStatement(statement)) this.visitDoStatement(statement, scope);
        if (ts.isContinueStatement(statement)) return this.visitContinueStatement(statement, scope);
        if (ts.isBreakStatement(statement)) return this.visitBreakStatement(statement, scope);
        if (ts.isSwitchStatement(statement)) this.visitSwitchStatement(statement, scope);
        if (ts.isTryStatement(statement)) this.visitTryStatement(statement, scope);
        if (ts.isThrowStatement(statement)) this.visitThrowStatement(statement, scope);
        if (ts.isEnumDeclaration(statement)) this.visitEnumDeclaration(statement, scope);
        if (ts.isTypeAliasDeclaration(statement)) this.visitTypeAliasDeclaration(statement, scope);
    }

    public visitTryStatement(tryStatement: ts.TryStatement, scope: Scope) {

        const currentFunction = scope.getCurrentFunction();
        const unwindDest = this.builder.buildBasicBlock(currentFunction, 'unwinding');
        const resumeDest = this.builder.buildBasicBlock(currentFunction, 'resumption');
        const finalDest = this.builder.buildBasicBlock(currentFunction, 'finally');
        let normalDest: BasicBlock | undefined;
        for (const statement of tryStatement.tryBlock.statements) {
            if (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression)) {
                const callExpression = statement.expression;
                const name = this.visitExpression(callExpression.expression, scope);
                if (!isString(name)) throw new SyntaxNotSupportedError();
                const fn = this.builder.getFunction(name);
                if (fn === undefined) throw new TypeUndefinedError();
                let args: Value[] = [];

                for (const argument of callExpression.arguments) {
                    const visited = this.visitExpression(argument, scope);
                    const arg = this.resolveNameDefinition(visited, scope);
                    args.push(arg);
                }

                if (normalDest !== undefined) this.builder.buildBranch(finalDest);

                normalDest = this.builder.buildBasicBlock(currentFunction, 'normal');
                this.builder.buildInvoke(fn.type.elementType, fn, args, normalDest, unwindDest);
                this.builder.setCurrentBlock(normalDest);
            } else {
                this.visitStatement(statement, scope);
            }
        }

        if (normalDest !== undefined) this.builder.buildBranch(finalDest);

        const catchClause = tryStatement.catchClause;
        const finallyBlock = tryStatement.finallyBlock;
        let landingPad: llvm.LandingPadInst | undefined;
        if (catchClause !== undefined) {
            this.builder.setCurrentBlock(unwindDest);
            landingPad = this.builder.buildLandingPad(this.builder.buildIntType(8));
            if (catchClause.variableDeclaration !== undefined) {
                const visitedVar = this.visitVariableDeclaration(catchClause.variableDeclaration, scope);
            }

            const returnValue = this.visitBlock(catchClause.block, scope);
            if (returnValue !== undefined && isValue(returnValue)) {
                this.builder.buildReturn(returnValue);
            } else {
                this.builder.buildBranch(resumeDest);
            }
        } else {
            this.builder.buildBranch(finalDest);
        }

        if (landingPad !== undefined) {
            this.builder.setCurrentBlock(resumeDest);
            this.builder.buildResume(landingPad);
        }

        this.builder.setCurrentBlock(finalDest);

        if (finallyBlock !== undefined) this.visitBlock(finallyBlock, scope);


    }

    public visitThrowStatement(throwStatement: ts.ThrowStatement, scope: Scope) {
        const visited = this.visitExpression(throwStatement.expression, scope);

    }

    public visitSwitchStatement(switchStatement: ts.SwitchStatement, scope: Scope) {
        const currentFunction = scope.getCurrentFunction();
        const currentBlock = currentFunction.getEntryBlock();
        if (currentBlock === null) throw new SyntaxNotSupportedError();
        const visited = this.visitExpression(switchStatement.expression, scope);
        const onVal = this.resolveVariableDefinition(visited, scope);
        const defaultDest = this.builder.buildBasicBlock(currentFunction);
        const finalDest = this.builder.buildBasicBlock(currentFunction);
        let caseDests: BasicBlock[] = [];
        let caseValues: ConstantInt[] = [];
        for (const clause of switchStatement.caseBlock.clauses) {
            this.builder.setCurrentBlock(currentBlock);
            if (ts.isCaseClause(clause)) {
                const caseDest = this.builder.buildBasicBlock(currentFunction);
                const visited = this.visitExpression(clause.expression, scope);
                let caseValue = this.resolveVariableDefinition(visited, scope);
                caseDests.push(caseDest);
                caseValues.push(caseValue as ConstantInt);
                this.builder.setCurrentBlock(caseDest);
            } else if (ts.isDefaultClause(clause)) {
                this.builder.setCurrentBlock(defaultDest);
            } else {
                throw new SyntaxNotSupportedError();
            }

            for (const statement of clause.statements) {
                this.visitStatement(statement, scope);
            }

            this.builder.buildBranch(finalDest);
        }

        this.builder.setCurrentBlock(currentBlock);        
        this.builder.buildSwitch(onVal, defaultDest, caseValues, caseDests);
        this.builder.setCurrentBlock(finalDest);
    }

    public visitCaseClause(clause: ts.CaseClause, scope: Scope) {
        throw new SyntaxNotSupportedError();
    }

    public visitDefaultClause(clause: ts.DefaultClause, scope: Scope) {
        throw new SyntaxNotSupportedError();
    }

    public visitInterfaceDeclaration(interfaceDeclaration: ts.InterfaceDeclaration, scope: Scope, specificTypes?: Type[]) {
        let interfaceName = interfaceDeclaration.name.text;

        if (interfaceDeclaration.typeParameters !== undefined && specificTypes === undefined) {
            Visitor.generics.saveDeclaration(interfaceName, interfaceDeclaration);
            return;
        }

        scope.addNamespace(interfaceName);

        // Change the interface name to be more specific
        if (specificTypes !== undefined) {
            // Construct a whole name from the interface name and the names of specific types
            interfaceName = Generics.constructWholeName(interfaceName, specificTypes);
        }

        if (this.builder.hasStructType(interfaceName)) return this.builder.getStructType(interfaceName);

        const structType = this.builder.buildStructType(interfaceName);
        const aliasName = scope.getCurrentScopeName();
        this.builder.setType(aliasName, structType);

        // Build mappings of type parameters to specific types
        const typeParameterMap = new Map<string, llvm.Type>();
        const defaultTypeMap = new Map<string, llvm.Type>();
        if (interfaceDeclaration.typeParameters !== undefined && specificTypes !== undefined) {
            const typeParameters = interfaceDeclaration.typeParameters;
            for (let i = 0; i < typeParameters.length; i++) {
                const typeParameterName = typeParameters[i].name.text;
                const typeParameterDefault = typeParameters[i].default;
                typeParameterMap.set(typeParameterName, specificTypes[i]);
                if (typeParameterDefault !== undefined) {
                    const defaultType = this.visitTypeNode(typeParameterDefault, scope);
                    defaultTypeMap.set(typeParameterName, defaultType);
                }
            }
        }

        Visitor.generics.addTypeParameters(typeParameterMap);
        Visitor.generics.addDefaultTypes(defaultTypeMap);

        const heritageClauses = interfaceDeclaration.heritageClauses;
        if (heritageClauses !== undefined) {
            for (const heritageClause of heritageClauses) {
                for (const type of heritageClause.types) {
                    this.visitTypeNode(type, scope);
                }
            }
        }

        let elementTypes: Type[] = [];
        let elementNames: string[] = [];
        for (const member of interfaceDeclaration.members) {
            if (ts.isMethodSignature(member)) {
                if (member.type === undefined) throw new SyntaxNotSupportedError();

                const propertyName = this.visitPropertyName(member.name, scope);

                if (member.typeParameters !== undefined && !Visitor.generics.hasDeclaration(`${interfaceName}_${propertyName}`)) {
                    Visitor.generics.saveDeclaration(`${interfaceName}_${propertyName}`, member);
                    continue;
                }

                let returnType = this.visitTypeNode(member.type, scope);
                let parameterTypes: Type[] = [];
                let parameterNames: string[] = [];
                for (let parameter of member.parameters) {
                    if (parameter.type === undefined) throw new SyntaxNotSupportedError();
                    let parameterName = this.visitBindingName(parameter.name, scope);
                    let parameterType = this.visitTypeNode(parameter.type, scope);
                    parameterNames.push(parameterName);
                    parameterTypes.push(parameterType);
                }

                this.builder.buildFunctionDeclaration(`${interfaceName}_${propertyName}`, returnType, parameterTypes, parameterNames);
            }

            if (ts.isPropertySignature(member)) {
                if (member.type === undefined) throw new SyntaxNotSupportedError();
                let propertyName = this.visitPropertyName(member.name, scope);
                let propertyType = this.visitTypeNode(member.type, scope);
                this.builder.setType(`${interfaceName}_${propertyName}`, propertyType);
                elementTypes.push(propertyType);
                elementNames.push(propertyName);
            }

            if (ts.isIndexSignatureDeclaration(member)) {
                
            }
        }

        Visitor.generics.removeTypeParameters();
        Visitor.generics.removeDefaultTypes();

        scope.removeNamespace();

        this.builder.insertProperty(structType, elementTypes, elementNames);
        return structType;
    }


    public visitExportDeclaration(exportDeclaration: ts.ExportDeclaration, scope: Scope) {
        let exportClause = exportDeclaration.exportClause;
        if (exportClause === undefined) return;
        if (ts.isNamedExports(exportClause)) {
            for (let element of exportClause.elements) {
                if (element.propertyName !== undefined) {
                    // scope.storeExportedIdentifier(element.name.text, element.propertyName.text);
                } else {
                    // scope.storeExportedIdentifier(element.name.text, element.name.text);
                }
            }
        }
    }

    public visitImportDeclaration(importDeclaration: ts.ImportDeclaration, scope: Scope) {
        // moduleSpecifier should be a string; otherwise it is a grammatical error.
        const moduleSpecifier = importDeclaration.moduleSpecifier;
        if (!ts.isStringLiteral(moduleSpecifier)) throw new SyntaxNotSupportedError();
        
        /**
         * TODO: This name is used for naming declarations imported from the module.
         */
        const moduleName = moduleSpecifier.text;
        
        const importClause = importDeclaration.importClause;
        // Simply return since only side effects will occur without importing anything.
        if (importClause === undefined) return;

        const name = importClause.name;
        if (name !== undefined) {
            const declaration = scope.getDeclaration(name);
            if (declaration !== undefined) this.visitDeclaration(declaration, scope);
        }

        const namedBindings = importClause.namedBindings;
        if (namedBindings !== undefined) {
            if (ts.isNamedImports(namedBindings)) {
                for (const element of namedBindings.elements) {
                    const declaration = scope.getDeclaration(element.name);
                    if (declaration !== undefined) this.visitDeclaration(declaration, scope);
                }
            }

            if (ts.isNamespaceImport(namedBindings)) {
                // scope.storeImportedNamespace(moduleSpecifier, namedBindings.name.text);
            }
        }
    }

    public visitEnumDeclaration(enumDeclaration: ts.EnumDeclaration, scope: Scope) {
        const enumName = this.visitIdentifier(enumDeclaration.name, scope);

        let increment = 0;
        for (const member of enumDeclaration.members) {
            const propertyName = this.visitPropertyName(member.name, scope);
            const wholeName = `${enumName}_${propertyName}`;
            const initializer = member.initializer;
            let propertyValue: Value;
            if (initializer !== undefined) {
                // An initializer does not contain a string
                propertyValue = this.visitExpression(initializer, scope) as Value;
                // Assign a new increment
                if (ts.isNumericLiteral(initializer)) {
                    increment = parseInt(initializer.text);
                    propertyValue = this.builder.buildInteger(increment, 32);
                }
            } else {
                propertyValue = this.builder.buildInteger(increment, 32);
            }

            ++increment;

            const alloca = this.builder.buildAlloca(this.builder.buildIntType(32));
            this.builder.buildStore(propertyValue, alloca);
            scope.set(wholeName, alloca);
        }

        const enumType = this.builder.buildInt32Type();
        this.builder.setType(enumName, enumType);
        return enumType;
    }

    public visitBreakStatement(breakOrContinueStatement: ts.BreakOrContinueStatement, scope: Scope) {
        return new Break();
    }

    public visitContinueStatement(breakOrContinueStatement: ts.BreakOrContinueStatement, scope: Scope) {
        return new Continue();
    }

    public visitReturnStatement(returnStatement: ts.ReturnStatement, scope: Scope) {

        if (returnStatement.expression === undefined) return;
        
        let returnValue = this.visitExpression(returnStatement.expression, scope);
        if (isString(returnValue)) {
            returnValue = scope.get(returnValue);
        }
        
        let returnType = returnValue.type
        if (returnType.isPointerTy() && (returnType.elementType.isDoubleTy() || returnType.elementType.isIntegerTy())) {
            return this.builder.buildLoad(returnValue);
        } else {
            return returnValue;
        }

    }

    public visitDeclaration(declaration: ts.Declaration, scope: Scope, specificTypes?: llvm.Type[]) {
        if (ts.isClassDeclaration(declaration)) return this.visitClassDeclaration(declaration, scope, specificTypes);
        if (ts.isFunctionDeclaration(declaration)) this.visitFunctionDeclaration(declaration, scope);
        if (ts.isVariableDeclaration(declaration)) this.visitVariableDeclaration(declaration, scope);
        if (ts.isInterfaceDeclaration(declaration)) return this.visitInterfaceDeclaration(declaration, scope, specificTypes);
        if (ts.isEnumDeclaration(declaration)) this.visitEnumDeclaration(declaration, scope);
        if (ts.isTypeAliasDeclaration(declaration)) return this.visitTypeAliasDeclaration(declaration, scope, specificTypes);
        if (ts.isMethodSignature(declaration)) this.visitMethodSignature(declaration, scope, specificTypes);
    }

    public visitExpression(expression: ts.Expression, scope: Scope): string | Value {
        if (ts.isPostfixUnaryExpression(expression)) return this.visitPostfixUnaryExpression(expression, scope);
        if (ts.isPrefixUnaryExpression(expression)) return this.visitPrefixUnaryExpression(expression, scope);
        if (ts.isFunctionExpression(expression)) return this.visitFunctionExpression(expression, scope);
        if (ts.isCallExpression(expression)) return this.visitCallExpression(expression, scope);
        if (ts.isIdentifier(expression)) return this.visitIdentifier(expression, scope);
        if (ts.isStringLiteral(expression)) return this.visitStringLiteral(expression, scope);
        if (ts.isNumericLiteral(expression)) return this.visitNumericLiteral(expression, scope);
        if (ts.isBinaryExpression(expression)) return this.visitBinaryExpression(expression, scope);
        if (ts.isObjectLiteralExpression(expression)) return this.visitObjectLiteralExpression(expression, scope);
        if (ts.isPropertyAccessExpression(expression)) return this.visitPropertyAccessExpression(expression, scope);
        if (ts.isElementAccessExpression(expression)) return this.visitElementAccessExpression(expression, scope);
        if (ts.isNewExpression(expression)) return this.visitNewExpression(expression, scope);
        if (ts.isArrayLiteralExpression(expression)) return this.visitArrayLiteralExpression(expression, scope);
        if (ts.isParenthesizedExpression(expression)) return this.visitParenthesizedExpression(expression, scope);
        if (ts.isToken(expression)) return this.visitToken(expression, scope);
        if (ts.isAwaitExpression(expression)) return this.visitAwaitExpression(expression, scope);
        throw new SyntaxNotSupportedError();
    }

    public visitMethodSignature(methodSignature: ts.MethodSignature, scope: Scope, specificTypes?: llvm.Type[]) {
        scope.setIsMethod(true);
        // let methodName = this.visitPropertyName(methodSignature.name, scope);
        
        // if (methodSignature.typeParameters !== undefined && specificTypes === undefined) {
        //     Visitor.generics.saveDeclaration(methodName, methodSignature);
        //     return;
        // }

        // // Change the method name to be more specific
        // if (specificTypes !== undefined) {
        //     // Construct a whole name with the original name and each type's name
        //     methodName = Generics.constructWholeName(methodName, specificTypes);
        // }

        // // Build mappings of type parameters to specific types
        // const typeParameterMap = new Map<string, llvm.Type>();
        // const defaultTypeMap = new Map<string, llvm.Type>();
        // if (methodSignature.typeParameters !== undefined && specificTypes !== undefined) {
        //     const typeParameters = methodSignature.typeParameters;
        //     for (let i = 0; i < typeParameters.length; i++) {
        //         const typeParameterName = typeParameters[i].name.text;
        //         const typeParameterDefault = typeParameters[i].default;
        //         typeParameterMap.set(typeParameterName, specificTypes[i]);
        //         if (typeParameterDefault !== undefined) {
        //             const defaultType = this.visitTypeNode(typeParameterDefault, scope);
        //             defaultTypeMap.set(typeParameterName, defaultType);
        //         }
        //     }
        // }

        // Visitor.generics.addTypeParameters(typeParameterMap);
        // Visitor.generics.addDefaultTypes(defaultTypeMap);

        // let returnType = this.visitTypeNode(methodSignature.type, scope);
        // if (returnType.isPointerTy()) returnType = this.builder.buildPointerType(returnType);
        // let className = scope.getCurrentScopeName();
        // let parameterTypes: Type[] = [];
        // let parameterNames: string[] = [];
        // let defaultValues = new Map<string, Value>();

        // for (const parameter of methodSignature.parameters) {

        //     const parameterName = this.visitBindingName(parameter.name, scope);
        //     parameterNames.push(parameterName);
            
        //     if (parameter.initializer !== undefined) {
        //         let visited = this.visitExpression(parameter.initializer, scope);
        //         let value = this.resolveNameDefinition(visited, scope);
        //         defaultValues.set(parameterName, value);
        //     }

        //     if (parameter.type === undefined) throw new SyntaxNotSupportedError();
        //     let parameterType = this.visitTypeNode(parameter.type, scope);
        //     parameterTypes.push(parameterType);
        // }

        // parameterNames.unshift('this');
        // const structType = this.builder.getStructType(className);
        // let ptrType = llvm.PointerType.get(structType, 0);
        // parameterTypes.unshift(ptrType);

        // let fn = this.builder.buildFunctionDeclaration(`${className}_${methodName}`, returnType, parameterTypes, parameterNames);

        // Visitor.generics.removeTypeParameters();
        // Visitor.generics.removeDefaultTypes();

        // this.builder.verifyFunction(fn);
        // return fn;
    }

    public visitTypeAliasDeclaration(typeAliasDeclaration: ts.TypeAliasDeclaration, scope: Scope, specificTypes?: llvm.Type[]) {
        let typeAliasName = this.visitIdentifier(typeAliasDeclaration.name, scope);

        // If a type alias declaration is of generic type, save the declaration for later instantiation
        // when specific type information is provided.
        if (typeAliasDeclaration.typeParameters !== undefined && specificTypes === undefined) {
            Visitor.generics.saveDeclaration(typeAliasName, typeAliasDeclaration);
            return;
        }

        // Change the type alias name to be more specific
        if (specificTypes !== undefined) {
            // Construct a whole name from the original type alias name and each type's name
            typeAliasName = Generics.constructWholeName(typeAliasName, specificTypes);
        }

        // Build mappings of type parameters to specific types
        const typeParameterMap = new Map<string, llvm.Type>();
        const defaultTypeMap = new Map<string, llvm.Type>();
        if (typeAliasDeclaration.typeParameters !== undefined && specificTypes !== undefined) {
            const typeParameters = typeAliasDeclaration.typeParameters;
            for (let i = 0; i < typeParameters.length; i++) {
                const typeParameterName = typeParameters[i].name.text;
                const typeParameterDefault = typeParameters[i].default;
                typeParameterMap.set(typeParameterName, specificTypes[i]);
                if (typeParameterDefault !== undefined) {
                    const defaultType = this.visitTypeNode(typeParameterDefault, scope);
                    defaultTypeMap.set(typeParameterName, defaultType);
                }
            }
        }

        Visitor.generics.addTypeParameters(typeParameterMap);
        Visitor.generics.addDefaultTypes(defaultTypeMap);

        // Create a struct in advance and populate with element types and names later
        const typeNode = typeAliasDeclaration.type;
        let type: llvm.StructType;
        if (ts.isIndexedAccessTypeNode(typeNode)) {
            this.builder.buildStructType(typeAliasName);
            this.visitTypeNode(typeNode, scope);
            type = this.builder.getStructType(typeAliasName);
        } else {
            const structType = this.builder.buildStructType(typeAliasName);
            type = this.visitTypeNode(typeNode, scope) as llvm.StructType;
            structType.setBody([type]);
            // Build a relationiship between the name and the type
            this.builder.setType(typeAliasName, structType);
        }

        Visitor.generics.removeTypeParameters();
        Visitor.generics.removeDefaultTypes();

        return type;
    }

    public visitAwaitExpression(awaitExpression: ts.AwaitExpression, scope: Scope) {
        const currentScopeName = scope.getCurrentScopeName();
        const currentFunction = scope.getCurrentFunction();
        const lastBlock = this.builder.getCurrentBlock();

        const coroHandler = scope.get('coro.handler');

        // With 'llvm.coro.save' and 'llvm.coro.suspend', the current coroutine resumes once asyncFn is finished.
        const coroSave = this.builder.buildFunctionCall('llvm.coro.save', [coroHandler]);
        scope.set('coro.save', coroSave);
        const returnValue = this.visitExpression(awaitExpression.expression, scope);

        // Make sure the returned asyncFn is a Value.
        if (!isValue(returnValue)) throw new TypeMismatchError();


        const boolConstant = this.builder.buildBoolean(false);
        const coroSuspend = this.builder.buildFunctionCall('llvm.coro.suspend', [coroSave, boolConstant]);
        const nextBlock = this.builder.buildBasicBlock(currentFunction);
        const suspendBlock = this.builder.buildBasicBlock(currentFunction);
        this.builder.setCurrentBlock(suspendBlock);
        this.builder.buildFunctionCall('llvm.coro.end', [coroHandler, boolConstant]);
        this.builder.buildReturn();
        const cleanupBlock = this.builder.buildBasicBlock(currentFunction);
        this.builder.setCurrentBlock(cleanupBlock);
        this.builder.buildFunctionCall('llvm.coro.free', [coroSave, coroHandler]);
        this.builder.buildBranch(suspendBlock);

        const constant0 = this.builder.buildInteger(0, 8);
        const constant1 = this.builder.buildInteger(1, 8);
        const caseValues = [constant0, constant1];
        const caseDests = [nextBlock, cleanupBlock];


        this.builder.setCurrentBlock(lastBlock);
        this.builder.buildSwitch(coroSuspend, suspendBlock, caseValues, caseDests);
        this.builder.setCurrentBlock(nextBlock);

        return returnValue;
    }

    public visitToken(token: ts.Expression, scope: Scope) {
        switch (token.kind) {
            case ts.SyntaxKind.TrueKeyword:
                return this.builder.buildBoolean(true);
            case ts.SyntaxKind.FalseKeyword:
                return this.builder.buildBoolean(false);
            case ts.SyntaxKind.ThisKeyword:
                return 'this';
            case ts.SyntaxKind.SuperKeyword:
                // Return the constructor's name with the name of the base class
                return `${scope.getBaseClassName()}_Constructor`;
            default:
                throw new SyntaxNotSupportedError();
        }
    }

    public visitParenthesizedExpression(parenthesizedExpression: ts.ParenthesizedExpression, scope: Scope) {
        return this.visitExpression(parenthesizedExpression.expression, scope);
    }

    public visitArrayLiteralExpression(arrayLiteralExpression: ts.ArrayLiteralExpression, scope: Scope) {

        const arrayLen = arrayLiteralExpression.elements.length;
        const arrayType = this.builder.buildArrayType(this.builder.buildOpaqueType(), arrayLen);
        const arrayAlloca = this.builder.buildAlloca(arrayType);

        /**
         * Insert property 'length' of the array
         */

        const value = this.builder.buildNumber(arrayLen);
        const offset1 = this.builder.buildInteger(0, 32);
        const offset2 = this.builder.buildInteger(0, 32);
        const ptr = this.builder.buildAccessPtr(arrayAlloca, offset1, offset2);
        this.builder.buildStore(value, ptr);

        /**
         * Create and insert the value of each element into the allocated array
         */
        for (let i = 0; i < arrayLen; i++) {
            const visited = this.visitExpression(arrayLiteralExpression.elements[i], scope);
            const value = this.resolveNameDefinition(visited , scope)
            const offset1 = this.builder.buildInteger(0, 32);
            const offset2 = this.builder.buildInteger(1, 32);
            const offset3 = this.builder.buildInteger(i, 64);
            const ptrType = this.builder.buildPointerType(value.type);
            const ptr = this.builder.buildBitcast(this.builder.buildAccessPtr(arrayAlloca, offset1, offset2, offset3), ptrType);
            this.builder.buildStore(value, ptr);
        }

        return arrayAlloca;
    }

    public visitFunctionExpression(functionExpression: ts.FunctionExpression, scope: Scope) {
        return this.visitFunctionLikeDeclaration(functionExpression, scope);
    }

    public visitEntityName(entityName: ts.EntityName) {
        // TODO: REMOVE THE FOLLOWING SCOPE LATER.
        const scope = new Scope();
        if (ts.isIdentifier(entityName)) return this.visitIdentifier(entityName, scope);
        throw new SyntaxNotSupportedError();
    }

    public visitExpressionWithTypeArguments(expressionWithTypeArguments: ts.ExpressionWithTypeArguments, scope: Scope) {
        if (scope === undefined) throw new SyntaxNotSupportedError();
        
        const expression = expressionWithTypeArguments.expression;

        let typeName: ts.Identifier;
        if (ts.isPropertyAccessExpression(expression)) {
            typeName = expression.name as ts.Identifier;
        } else if (ts.isIdentifier(expression)) {
            typeName = expression;
        } else {
            throw new SyntaxNotSupportedError();
        }

        const typeArguments = expressionWithTypeArguments.typeArguments;
        try {
            return this.builder.getStructType(typeName.text);
        } catch (err) {
            return  this.resolveType(scope, typeName, typeArguments);
        }
    }

    public visitQualifiedName(qualifiedName: ts.QualifiedName, scope: Scope) {
        if (!ts.isIdentifier(qualifiedName.left) || !ts.isIdentifier(qualifiedName.right)) throw new SyntaxNotSupportedError();
        const leftName = this.visitIdentifier(qualifiedName.left, scope);
        const rightName = this.visitIdentifier(qualifiedName.right, scope);
        
        const declaration = scope.getDeclaration(qualifiedName);
        if (declaration === undefined) throw new TypeUndefinedError();
        this.visitDeclaration(declaration, scope);

        const type = this.builder.getType(rightName);
        this.builder.setType(`${leftName}_${rightName}`, type);
        return type;
    }

    public visitTypeReference(typeReference: ts.TypeReferenceNode, scope: Scope) {

        const typeName = typeReference.typeName;
        
        if (ts.isQualifiedName(typeName)) {
            return this.visitQualifiedName(typeName, scope);
        }
        
        if (ts.isIdentifier(typeName)) {
            const typeArguments = typeReference.typeArguments;
            return this.resolveType(scope, typeName, typeArguments);
        }

        throw new SyntaxNotSupportedError();
    }

    public resolveType(scope: Scope, typeName: ts.Identifier, typeArgs?: ts.NodeArray<ts.TypeNode>) {
        const name = this.visitIdentifier(typeName, scope);
        let type: Type | undefined;
        if (typeArgs === undefined) {
            try {
                type = this.builder.getType(name);
            } catch (err) {
                try {
                    // if (type === undefined) type = this.builder.buildInt32Type();
                    // If the name cannot be found, then include the missing declaration of the type.
                    const declaration = scope.getDeclaration(typeName);
                    if (declaration === undefined) throw new SyntaxNotSupportedError();
                    scope.enter(name);
                    this.visitDeclaration(declaration, scope);
                    type = this.builder.getType(name);
                    scope.leave();
                } catch (err) {
                    type = Visitor.generics.getTypeByName(name);
                    if (type === undefined) throw new TypeUndefinedError();
                }
            }
        } else {
            // TODO change typename to wholename
            const types = typeArgs.map(typeArg => this.visitTypeNode(typeArg, scope)) as Type[];
            if (scope === undefined) throw new SyntaxNotSupportedError();
            
            // Construct a whole name from typeName and types
            const wholeName = Generics.constructWholeName(name, types);
            if (Visitor.generics.hasDeclared(wholeName)) {
                type = this.builder.getStructType(wholeName);
            } else {
                type = Visitor.generics.createSpecificDeclaration(typeName, types, scope);
            }
        }
        if (type.isStructTy()) {
            return this.builder.buildPointerType(type);
        } else {
            return type;
        }

    }

    public visitNewExpression(newExpression: ts.NewExpression, scope: Scope) {
        const name = this.visitExpression(newExpression.expression, scope);
        if (!isString(name)) throw new TypeMismatchError();

        let structType: StructType | undefined;
        const typeArguments = newExpression.typeArguments;
        if (typeArguments !== undefined) {
            const types = typeArguments.map(typeArgument => this.visitTypeNode(typeArgument, scope)) as Type[];
            // Specify the name of a generic type and its specific types
            structType = Visitor.generics.createSpecificDeclaration(newExpression.expression as ts.Identifier, types, scope);
        } else {
            structType = this.builder.getStructType(name);
        }

        const allocaValue = this.builder.buildAlloca(structType, undefined, structType.name);

            // TODO: Match the parameters of a constructor with the arguments given for class instantiation
            if (newExpression.arguments === undefined || newExpression.arguments.length === 0) {
                this.builder.buildFunctionCall(`${structType.name}_Constructor`, [allocaValue]);
            } else {
                const defaultValues = scope.getDefaultValues(`${structType.name}_Constructor`);
                // First argument of any member function calls is always a pointer to a struct type
                // In this case, we are creating a class instance using the new operator, and calling an appropriate constructor
                let values: Value[] = [allocaValue];
                for (const argument of newExpression.arguments) {
                    let argVisited = this.visitExpression(argument, scope);
                    let value = this.resolveNameDefinition(argVisited, scope);
                    values.push(value);
                }

                this.builder.buildFunctionCall(`${structType.name}_Constructor`, values, defaultValues);
            }

        return allocaValue;
    }

    public visitObjectLiteralExpression(objectLiteralExpression: ts.ObjectLiteralExpression, scope: Scope) {

        // Collect key-value pairs from an object
        let keyArray: string[] = [];
        let valueArray: Value[] = [];
        let typeArray: Type[] = [];
        for (let property of objectLiteralExpression.properties) {
            if (ts.isPropertyAssignment(property)) {
                // If a property does not have a name or initializer, then it is grammatically wrong.
                if (property.name === undefined || property.initializer === undefined) throw new SyntaxNotSupportedError();
                let key = this.visitPropertyName(property.name, scope);
                let visited = this.visitExpression(property.initializer, scope)
                let value = this.resolveNameDefinition(visited, scope);
                keyArray.push(key);
                valueArray.push(value);
                typeArray.push(value.type);
            }
            if (ts.isShorthandPropertyAssignment(property)) {
                let key = this.visitIdentifier(property.name, scope);
                let value = this.resolveNameDefinition(key, scope);
                keyArray.push(key);
                valueArray.push(value);
                typeArray.push(value.type);
            }
        }

        const objectStructType = this.builder.buildStructType('Object');
        this.builder.insertProperty(objectStructType, typeArray, keyArray);
        const objectStructAlloca = this.builder.buildAlloca(objectStructType);
        for (let i = 0; i < keyArray.length; i++) {
            const offset1 = this.builder.buildInteger(0, 32);
            const offset2 = this.builder.buildInteger(i, 32);
            const valuePtr = this.builder.buildAccessPtr(objectStructAlloca, offset1, offset2);
            this.builder.buildStore(valueArray[i], valuePtr);
        }
        // Create a data structure regarding the structure of Object and types that it holds
        // let keyValueStructTypeArray: Type[] = [];
        // for (let i = 0; i < keyArray.length; i++) {
        //     // The length of the string type includes a terminator.
        //     let keyType = this.builder.buildStringType(keyArray[i].length + 1);
        //     let valueType = valueArray[i].type;
        //     let keyValueStructType = this.builder.buildStructType('keyValueStruct');
        //     keyValueStructType.setBody([keyType, valueType]);
        //     keyValueStructTypeArray.push(keyValueStructType);
        // }

        // // Allocate memory space and place corresponding data appropriately
        // let objectStructType = this.builder.buildStructType('Object_Literal');
        // objectStructType.setBody(keyValueStructTypeArray);
        // let objectStructAlloca = this.builder.buildAlloca(objectStructType);
        // for (let i = 0; i < keyArray.length; i++) {
        //     const first = this.builder.buildInteger(0, 32);
        //     const second = this.builder.buildInteger(i, 32);
        //     const keyThird = this.builder.buildInteger(0, 32);
        //     const valueThird = this.builder.buildInteger(1, 32);
        //     const keyPtr = this.builder.buildAccessPtr(objectStructAlloca, first, second, keyThird);
        //     const valuePtr = this.builder.buildAccessPtr(objectStructAlloca, first, second, valueThird);
        //     const key = this.builder.buildString(keyArray[i]);
        //     this.builder.buildStore(key, keyPtr);
        //     this.builder.buildStore(valueArray[i], valuePtr);
        // }

        return objectStructAlloca;
    }

    public visitPostfixUnaryExpression(postfixUnaryExpression: ts.PostfixUnaryExpression, scope: Scope) {
        let visited = this.visitExpression(postfixUnaryExpression.operand, scope);
        // Only variables are allowed in this expression.
        if (!isString(visited)) throw new SyntaxNotSupportedError();
        let value = this.resolveVariableDefinition(visited, scope);
        let operator = postfixUnaryExpression.operator;
        let constant = this.builder.buildNumber(1);

        switch (operator) {
            case ts.SyntaxKind.PlusPlusToken:
                let plusValue = this.builder.buildAdd(value, constant);
                let plusAlloca = scope.get(visited);
                this.builder.buildStore(plusValue, plusAlloca);
                break;
            case ts.SyntaxKind.MinusMinusToken:
                let subValue = this.builder.buildSub(value, constant);
                let subAlloca = scope.get(visited);
                this.builder.buildStore(subValue, subAlloca);
                break;
            default:
                throw new SyntaxNotSupportedError();
        }

        return value;
    }

    public visitPrefixUnaryExpression(prefixUnaryExpression: ts.PrefixUnaryExpression, scope: Scope) {
        let visited = this.visitExpression(prefixUnaryExpression.operand, scope);
        // Only variables are allowed in this expression.
        if (!isString(visited)) throw new SyntaxNotSupportedError();
        let value = this.resolveVariableDefinition(visited, scope);
        let operator = prefixUnaryExpression.operator;
        let constant = this.builder.buildNumber(1);

        switch (operator) {
            case ts.SyntaxKind.PlusPlusToken:
                value = this.builder.buildAdd(value, constant);
                let plusAlloca = scope.get(visited);
                this.builder.buildStore(value, plusAlloca);
                break;
            case ts.SyntaxKind.MinusMinusToken:
                value = this.builder.buildSub(value, constant);
                let subAlloca = scope.get(visited);
                this.builder.buildStore(value, subAlloca);
                break;
            case ts.SyntaxKind.ExclamationToken:
                value = this.builder.buildNot(value);
                let notAlloca = scope.get(visited);
                this.builder.buildStore(value, notAlloca);
                break;
            case ts.SyntaxKind.PlusToken:
            case ts.SyntaxKind.MinusToken:
            case ts.SyntaxKind.TildeToken:
            default:
                throw new SyntaxNotSupportedError();
        }

        return value;
    }

    public visitBinaryExpression(binaryExpression: ts.BinaryExpression, scope: Scope) {

        let visitedLeft = this.visitExpression(binaryExpression.left, scope);
        let visitedRight = this.visitExpression(binaryExpression.right, scope);

        let operator = binaryExpression.operatorToken.kind;

        let lhs = this.resolveVariableDefinition(visitedLeft, scope);
        let rhs = this.resolveVariableDefinition(visitedRight, scope);

        switch (operator) {
            case ts.SyntaxKind.AsteriskToken:
                return this.builder.buildMul(lhs, rhs);
            case ts.SyntaxKind.SlashToken:
                return this.builder.buildDiv(lhs, rhs);
            case ts.SyntaxKind.PlusEqualsToken:
                let added = this.builder.buildAdd(lhs, rhs);
                // visitedLeft has been type asserted
                let addedAlloca = scope.get(visitedLeft as string);
                this.builder.buildStore(added, addedAlloca);
                return added;
            case ts.SyntaxKind.MinusEqualsToken:
                let subbed = this.builder.buildSub(lhs, rhs);
                // visitedLeft has been type asserted
                let subbedAlloca = scope.get(visitedLeft as string);
                this.builder.buildStore(subbed, subbedAlloca);
                return subbed;
            case ts.SyntaxKind.PlusToken:
                return this.builder.buildAdd(lhs, rhs);
            case ts.SyntaxKind.MinusToken:
                return this.builder.buildSub(lhs, rhs);
            case ts.SyntaxKind.EqualsToken:
                // visitedLeft has been type asserted
                let eqAlloca: Value;
                if (isString(visitedLeft)) {
                    eqAlloca = scope.get(visitedLeft);
                } else {
                    eqAlloca = visitedLeft;
                }
                this.builder.buildStore(rhs, eqAlloca);
                return rhs;
            case ts.SyntaxKind.EqualsEqualsToken:
            case ts.SyntaxKind.EqualsEqualsEqualsToken:
                return this.builder.buildEqualTo(lhs, rhs);
            case ts.SyntaxKind.LessThanToken:
                return this.builder.buildLessThan(lhs, rhs);
            case ts.SyntaxKind.LessThanEqualsToken:
                return this.builder.buildLessThanEqualTo(lhs, rhs);
            case ts.SyntaxKind.GreaterThanEqualsToken:
                return this.builder.buildGreaterThanEqualTo(lhs, rhs);
            case ts.SyntaxKind.ExclamationEqualsToken:
            case ts.SyntaxKind.ExclamationEqualsEqualsToken:
                return this.builder.buildNotEqualTo(lhs, rhs);
            default:
                throw new SyntaxNotSupportedError();
        }

    }

    public visitPropertyAccessExpression(propertyAccessExpression: ts.PropertyAccessExpression, scope: Scope) {

        let visited = this.visitExpression(propertyAccessExpression.expression, scope);

        const isMethod = scope.checkMethod();

        if (isMethod) {
            if (!isString(visited)) throw new SyntaxNotSupportedError();

            if (!scope.has(visited)) {
                const declaration = scope.getDeclaration(propertyAccessExpression.expression);
                if (declaration === undefined) throw new TypeUndefinedError();
                this.visitDeclaration(declaration, scope);
            }

            let type = this.builder.getType(visited);
            if (type.isPointerTy()) type = type.elementType;
            if (type.isStructTy()) return `${type.name}_${propertyAccessExpression.name.text}`;
            return `${type.toString()}_${propertyAccessExpression.name.text}`;
        }

        let offset1: llvm.Value | undefined;

        // visited could be either a pointer to a struct or a string identifier
        // If the identifier is not found in the current scope, it is possible that the identifier is not complete yet.
        if (isString(visited)) {
            if (!scope.has(visited)) {
                const declaration = scope.getDeclaration(propertyAccessExpression.expression);
                if (declaration === undefined) throw new TypeUndefinedError();
                this.visitDeclaration(declaration, scope);
            }
            if (!scope.has(visited)) return `${visited}_${propertyAccessExpression.name.text}`;
            visited = scope.get(visited);
            offset1 = this.builder.buildInteger(0, 32);
        }

        let structType = this.resolveValueType(visited);

        if (!structType.isStructTy()) throw new SyntaxNotSupportedError();

        // Find the index of a specific name defined in the struct
        const idx = this.builder.findIndexInStruct(structType, propertyAccessExpression.name.text);
        // Cannot find an index, meaning that it could be a method name
        if (idx === -1) return `${structType.name}_${propertyAccessExpression.name.text}`;
        const offset2 = this.builder.buildInteger(idx, 32);
        if (offset1 === undefined) return this.builder.buildAccessPtr(visited, offset2);
        return this.builder.buildAccessPtr(visited, offset1, offset2);

    }

    public visitElementAccessExpression(elementAccessExpression: ts.ElementAccessExpression, scope: Scope) {
        let visited = this.visitExpression(elementAccessExpression.expression, scope);

        if (!isString(visited) || !scope.has(visited)) throw new SyntaxNotSupportedError();
        visited = scope.get(visited);

        const visitedType = this.resolveValueType(visited);

        if (visitedType.isStructTy() && visitedType.name?.startsWith('Array')) {
            const argumentExpression = elementAccessExpression.argumentExpression;
            let argument = this.visitExpression(argumentExpression, scope);
            
            if (isString(argument) && argument !== 'i') {
                const idx = parseInt(argument);
                argument = this.builder.buildInteger(idx, 64);
            }
            
            if (isString(argument) && argument === 'i') {
                const alloca = scope.get('i');
                argument = this.builder.buildLoad(alloca);
                argument = this.builder.buildBitcast(argument, this.builder.buildIntType(64));
            }

            const offset1 = this.builder.buildInteger(0, 32);
            const offset2 = this.builder.buildInteger(1, 32);
            return this.builder.buildAccessPtr(visited, offset1, offset2, argument);
        }
        
        if (visitedType.isStructTy() && visitedType.name !== undefined) {
            // Find the index of a name defined in the struct
            const argumentExpression = elementAccessExpression.argumentExpression;
            let argument = this.visitExpression(argumentExpression, scope);
            
            if (isString(argument)) {
                const idx = this.builder.findIndexInStruct(visitedType, argument);
                if (idx === -1) throw new SyntaxNotSupportedError();
                argument = this.builder.buildInteger(idx, 32);
            }

            const offset1 = this.builder.buildInteger(0, 32);
            return this.builder.buildAccessPtr(visited, offset1, argument);
        }

        throw new SyntaxNotSupportedError();
    }

    public visitIdentifier(identifier: ts.Identifier, scope: Scope) {
        return identifier.text;
    }

    public visitStringLiteral(stringLiteral: ts.StringLiteral, scope: Scope) {
        let str = stringLiteral.text;
        return this.builder.buildString(str);
    }

    public visitNumericLiteral(numericLiteral: ts.NumericLiteral, scope: Scope) {
        let num = parseFloat(numericLiteral.text);
        return this.builder.buildNumber(num);
    }

    public visitTypeOperator(typeOperatorNode: ts.TypeOperatorNode, scope: Scope): Type {
        switch (typeOperatorNode.operator) {
            case ts.SyntaxKind.KeyOfKeyword:
                return this.visitTypeNode(typeOperatorNode.type, scope);
            default:
                throw new SyntaxNotSupportedError();
        }
    }

    public visitIndexedAccessType(indexedAccessType: ts.IndexedAccessTypeNode, scope: Scope) {
        let objectType = this.visitTypeNode(indexedAccessType.objectType, scope);
        if (!objectType.isPointerTy()) throw new SyntaxNotSupportedError();
        objectType = objectType.elementType;
        
        if (!objectType.isStructTy() || objectType.name === undefined) throw new SyntaxNotSupportedError();

        let indexType = this.visitIndexType(indexedAccessType.indexType, scope);
        let typeNames: string[];
        if (indexType.isPointerTy()) indexType = indexType.elementType;
        if (!indexType.isStructTy()) throw new SyntaxNotSupportedError();
        typeNames = this.builder.getElementNamesInStruct(indexType);

        // Collect the types from objectType based on the keys from indexType
        const types: llvm.Type[] = []
        for (const typeName of typeNames) {
            const idx = this.builder.findIndexInStruct(objectType, typeName);
            const type = objectType.getElementType(idx);
            types.push(type);
        }

        // Return a type according to the number of types found in objectType
        if (isString(indexType)) {
            return types[0];
        } else {
            // Find the largest size of element type
            let numBits = 0;
            let largestType: llvm.Type = types[0];
            for (const type of types) {
                const newNumBits = type.getPrimitiveSizeInBits();
                if (newNumBits > numBits) {
                    numBits = newNumBits;
                    largestType = type;
                }
            }
            const structType = this.builder.getLastStructType();
            structType.setBody([largestType]);
            return structType;
        }
    }


    public visitIndexType(typeNode: ts.TypeNode, scope: Scope) {
        switch (typeNode.kind) {
            case ts.SyntaxKind.TypeOperator:
                return this.visitTypeOperator(typeNode as ts.TypeOperatorNode, scope);
            case ts.SyntaxKind.LiteralType:
                return this.visitLiteralType(typeNode as ts.LiteralTypeNode);
            default:
                throw new SyntaxNotSupportedError();
        }
    }

    public visitLiteralType(literalType: ts.LiteralTypeNode) {
        const literal = literalType.literal;
        if (ts.isStringLiteral(literal) || ts.isNumericLiteral(literal)) return this.builder.buildStringType(10);
        if (literal.kind === ts.SyntaxKind.NullKeyword) return this.builder.buildStructType('null');
        if (literal.kind === ts.SyntaxKind.BooleanKeyword) return this.builder.buildBooleanType();
        if (literal.kind === ts.SyntaxKind.TrueKeyword) return this.builder.buildStructType('true');
        if (literal.kind === ts.SyntaxKind.FalseKeyword) return this.builder.buildStructType('false');
        throw new SyntaxNotSupportedError('Invalid literal type');
    }

    public visitTypeLiteral(typeLiteral: ts.TypeLiteralNode, scope: Scope) {
        const structType = this.builder.buildStructType('');
        const propertyNames: string[] = [];
        const propertyTypes: llvm.Type[] = [];
        for (const member of typeLiteral.members) {
            const { propertyName, propertyType } = this.visitPropertySignature(member as ts.PropertySignature, scope);
            propertyNames.push(propertyName);
            propertyTypes.push(propertyType);
        }

        this.builder.setProperty(structType, propertyTypes, propertyNames);
        return structType;
    }

    public visitPropertySignature(propertySignature: ts.PropertySignature, scope: Scope) {
        const propertyName = this.visitPropertyName(propertySignature.name, scope);
        // When the type of a property is undefined, then the type name of the property is the property name.
        let propertyType: llvm.Type;
        if (propertySignature.type === undefined) {
            propertyType = this.builder.getStructType(propertyName);
        } else {
            propertyType = this.visitTypeNode(propertySignature.type, scope);
        }
        return { propertyName, propertyType };
    }

    public visitFunctionType(functionTypeNode: ts.FunctionTypeNode, scope: Scope) {
        const parameterNames: string[] = [];
        const parameterTypes: llvm.Type[] = [];
        for (const parameter of functionTypeNode.parameters) {
            const parameterName = this.visitBindingName(parameter.name, scope);
            const parameterType = this.visitTypeNode(parameter.type, scope);
            parameterNames.push(parameterName);
            parameterTypes.push(parameterType);
        }

        const returnType = this.visitTypeNode(functionTypeNode.type, scope) as Type;

        return this.builder.buildFunctionType(returnType, parameterTypes);
    }

    public visitIntersectionType(intersectionTypeNode: ts.IntersectionTypeNode, scope: Scope) {

        // Collect LLVM Type for each typeNode
        const types: llvm.Type[] = [];
        for (const typeNode of intersectionTypeNode.types) {
            const type = this.visitTypeNode(typeNode, scope);
            types.push(type);
        }

        const typeSet = new Set<llvm.Type>();

        for (const type of types) {
            if (type.isPointerTy()) {
                const ptrElementType = type.elementType;
                if (ptrElementType.isStructTy()) {
                    for (let i = 0; i < ptrElementType.numElements; i++) {
                        const structElementType = ptrElementType.getElementType(i);
                        typeSet.add(structElementType);
                    }
                }
            } else {
                throw new SyntaxNotSupportedError();
            }
        }

        const typeArray = Array.from(typeSet);
        const structType = this.builder.buildStructType('');
        structType.setBody(typeArray);
        return structType;
    }

    public visitTypeNode(typeNode?: ts.TypeNode, scope?: Scope) {
        if (scope === undefined) throw new SyntaxNotSupportedError();
        if (typeNode === undefined) return this.builder.buildAnyType();
        switch (typeNode.kind) {
            case ts.SyntaxKind.NumberKeyword:
                return this.builder.buildNumberType();
            case ts.SyntaxKind.VoidKeyword:
                return this.builder.buildVoidType();
            case ts.SyntaxKind.StringKeyword:
                return this.builder.buildStringType(2);
            case ts.SyntaxKind.BooleanKeyword:
                return this.builder.buildBooleanType();
            case ts.SyntaxKind.ObjectKeyword:
                return this.builder.buildStructType('');
            case ts.SyntaxKind.AnyKeyword:
                return this.builder.buildAnyType();
            case ts.SyntaxKind.TypeReference:
                return this.visitTypeReference(typeNode as ts.TypeReferenceNode, scope);
            case ts.SyntaxKind.ExpressionWithTypeArguments:
                return this.visitExpressionWithTypeArguments(typeNode as ts.ExpressionWithTypeArguments, scope);
            case ts.SyntaxKind.TypeLiteral:
                return this.visitTypeLiteral(typeNode as ts.TypeLiteralNode, scope);
            case ts.SyntaxKind.FunctionType:
                return this.visitFunctionType(typeNode as ts.FunctionTypeNode, scope);
            case ts.SyntaxKind.ArrayType:
                return this.visitArrayType(typeNode as ts.ArrayTypeNode, scope);
            case ts.SyntaxKind.IndexedAccessType:
                return this.visitIndexedAccessType(typeNode as ts.IndexedAccessTypeNode, scope);
            case ts.SyntaxKind.TypeOperator:
                return this.visitTypeOperator(typeNode as ts.TypeOperatorNode, scope);
            case ts.SyntaxKind.ThisType:
                return this.builder.getLastStructType();
            case ts.SyntaxKind.UnknownKeyword:
                return this.builder.buildPointerType(this.builder.buildVoidType());
            case ts.SyntaxKind.UnionType:
                return this.visitUnionType(typeNode as ts.UnionTypeNode, scope);
            case ts.SyntaxKind.UndefinedKeyword:
                return this.builder.buildStructType('undefined');
            case ts.SyntaxKind.TypePredicate:
                return this.builder.buildBooleanType();
            case ts.SyntaxKind.IntersectionType:
                return this.visitIntersectionType(typeNode as ts.IntersectionTypeNode, scope);
            case ts.SyntaxKind.RestType:
                return this.visitRestType(typeNode as ts.RestTypeNode, scope);
            case ts.SyntaxKind.TupleType:
                return this.visitTupleType(typeNode as ts.TupleTypeNode, scope);
            case ts.SyntaxKind.LiteralType:
                return this.visitLiteralType(typeNode as ts.LiteralTypeNode);
            case ts.SyntaxKind.SymbolKeyword:
                return this.builder.buildStructType('symbol');
            case ts.SyntaxKind.ParenthesizedType:
                return this.visitParenthesizedType(typeNode as ts.ParenthesizedTypeNode, scope);
            case ts.SyntaxKind.NullKeyword:
                return this.builder.buildStructType('null');
            case ts.SyntaxKind.BigIntKeyword:
                return this.builder.buildStructType('bigint');
            case ts.SyntaxKind.ObjectKeyword:
                return this.builder.buildStructType('object');
            default:
                return this.builder.buildOpaquePtrType();
        }
    }

    public visitParenthesizedType(parenthesizedTypeNode: ts.ParenthesizedTypeNode, scope: Scope) {
        const type = this.visitTypeNode(parenthesizedTypeNode.type, scope) as Type;
        return type;
    }

    public visitRestType(restTypeNode: ts.RestTypeNode, scope: Scope) {
        const elementType = this.visitTypeNode(restTypeNode.type, scope) as Type;
        return this.builder.buildPointerType(elementType);
    }

    public visitTupleType(tupleTypeNode: ts.TupleTypeNode, scope: Scope) {
        // Collect LLVM Type for each element of a tuple
        const elementTypes: llvm.Type[] = [];
        for (const element of tupleTypeNode.elements) {
            const elementType = this.visitTypeNode(element, scope);
            elementTypes.push(elementType);
        }

        const names = elementTypes.map(type => {
            if (type.isPointerTy()) type = type.elementType;
            if (type.isStructTy()) return type.name;
            return type.toString();
        });

        let wholeName = '';
        
        names.every(name => wholeName = wholeName.concat(`${name}`));

        wholeName = `[${wholeName}]`;

        const structType = this.builder.buildStructType(wholeName);

        structType.setBody(elementTypes);

        return structType;
    }

    public visitClassDeclaration(classDeclaration: ts.ClassDeclaration, scope: Scope, specificTypes?: Type[]) {
        
        const currentFunction = scope.getCurrentFunction();
        const currentBlock = currentFunction.getEntryBlock();
        if (!isBasicBlock(currentBlock)) throw new SyntaxNotSupportedError();
        
        
        if (classDeclaration.name === undefined) throw new SyntaxNotSupportedError();
        let className = classDeclaration.name.text;

        scope.addNamespace(className);

        // If the class declaration is of generic type, save the declaration for later instantiation when specific type information is provided.
        if (classDeclaration.typeParameters !== undefined && specificTypes === undefined) {
            Visitor.generics.saveDeclaration(className, classDeclaration);
            return;
        }

        // Change the class name to a more specific class name
        if (specificTypes !== undefined) {
            // Construct a whole name from typeName and types
            className = Generics.constructWholeName(className, specificTypes);
        }

        if (this.builder.hasStructType(className)) return this.builder.getStructType(className);

        // Build a struct type with the class name
        const structType = this.builder.buildStructType(className);
        const aliasName = scope.getCurrentScopeName();
        this.builder.setType(aliasName, structType);

        // Dispatch a variety of properties of the class
        let propertyDeclarations: ts.PropertyDeclaration[] = [];
        let methodDeclarations: ts.MethodDeclaration[] = [];
        let constructorDeclarations: ts.ConstructorDeclaration[] = [];
        for (let member of classDeclaration.members) {
            if (ts.isPropertyDeclaration(member)) propertyDeclarations.push(member);
            if (ts.isMethodDeclaration(member)) methodDeclarations.push(member);
            if (ts.isConstructorDeclaration(member)) constructorDeclarations.push(member);
        }

        // Build mappings of type parameters to specific types
        const typeParameterMap = new Map<string, llvm.Type>();
        const defaultTypeMap = new Map<string, llvm.Type>();
        if (classDeclaration.typeParameters !== undefined && specificTypes !== undefined) {
            const typeParameters = classDeclaration.typeParameters;
            for (let i = 0; i < typeParameters.length; i++) {
                const typeParameterName = typeParameters[i].name.text;
                const typeParameterDefault = typeParameters[i].default;
                typeParameterMap.set(typeParameterName, specificTypes[i]);

                if (typeParameterDefault !== undefined) {
                    const defaultType = this.visitTypeNode(typeParameterDefault, scope);
                    defaultTypeMap.set(typeParameterName, defaultType);
                }
            }
        }

        Visitor.generics.addTypeParameters(typeParameterMap);
        Visitor.generics.addDefaultTypes(defaultTypeMap);

        const inheritedTypes: llvm.Type[] = [];
        const inheritedNames: string[] = [];
        const heritageClauses = classDeclaration.heritageClauses;
        if (heritageClauses !== undefined) {
            for (const heritageClause of heritageClauses) {
                for (const type of heritageClause.types) {
                    if (heritageClause.token === ts.SyntaxKind.ExtendsKeyword) {
                        let inheritedType = this.visitTypeNode(type, scope);
                        if (inheritedType.isPointerTy()) inheritedType = inheritedType.elementType;
                        if (inheritedType.isStructTy()) {
                            scope.resetBaseClassName(inheritedType.name);
                            const inheritedPtrType = this.builder.buildPointerType(inheritedType)
                            inheritedTypes.push(inheritedPtrType);
                            if (inheritedType.name !== undefined) inheritedNames.push(inheritedType.name);
                        }
                    }
                }
            }
        }

        scope.enter(className);

        // Construct the information about each class property
        let properties: Property[] = [];
        let propertyTypes: llvm.Type[] = [];
        let propertyNames: string[] = [];
        for (let propertyDeclaration of propertyDeclarations) {
            const property = this.visitPropertyDeclaration(propertyDeclaration, scope);
            properties.push(property);

            const propertyType = property.propertyType as Type;
            this.builder.setType(`${className}_${property.propertyName}`, propertyType);
            propertyTypes.push(propertyType);
            propertyNames.push(property.propertyName);
        }

        // Combine element types from inheritance and that of property
        propertyTypes = [...inheritedTypes, ...propertyTypes];
        propertyNames = [...inheritedNames, ...propertyNames];

        // Insert property types into the struct type created above
        this.builder.insertProperty(structType, propertyTypes, propertyNames);

        for (const constructorDeclaration of constructorDeclarations) {
            this.visitConstructorDeclaration(constructorDeclaration, scope);
        }

        // If no construtors are provided, create a default constructor
        if (constructorDeclarations.length === 0) {
            const thisPtr = this.builder.buildPointerType(structType);
            this.builder.buildConstructor(`${className}_Constructor`, [thisPtr], ['this']);
            this.builder.buildReturn();
        }

        // Define all the class methods excluding constructors
        for (let methodDeclaration of methodDeclarations) {
            this.visitMethodDeclaration(methodDeclaration, scope);
        }

        scope.leave();

        Visitor.generics.removeTypeParameters();
        Visitor.generics.removeDefaultTypes();

        scope.removeNamespace();
        
        this.builder.setCurrentBlock(currentBlock);

        return structType;
    }

    public visitPropertyDeclaration(propertyDeclaration: ts.PropertyDeclaration, scope: Scope) {

        if (propertyDeclaration.type === undefined) throw new SyntaxNotSupportedError();
        let propertyName = this.visitPropertyName(propertyDeclaration.name, scope);
        const propertyType = this.visitTypeNode(propertyDeclaration.type, scope);

        let property: Property = {
            propertyName,
            propertyType
        }

        if (propertyDeclaration.initializer !== undefined) {
            let visited = this.visitExpression(propertyDeclaration.initializer, scope);
            // Look for the name in the current scope
            property.propertyValue = this.resolveNameDefinition(visited, scope);
        }

        return property;
    }

    public visitPropertyName(propertyName: ts.PropertyName, scope: Scope) {
        if (ts.isIdentifier(propertyName)) return propertyName.text;
        if (ts.isStringLiteral(propertyName)) return propertyName.text;
        if (ts.isNumericLiteral(propertyName)) return propertyName.text;
        if (ts.isComputedPropertyName(propertyName)) return this.visitComputedPropertyName(propertyName, scope);
        throw new SyntaxNotSupportedError();
    }

    public visitComputedPropertyName(computedPropertyName: ts.ComputedPropertyName, scope: Scope) {
        return this.visitExpression(computedPropertyName.expression, scope) as string;
    }

    public visitMethodDeclaration(methodDeclaration: ts.MethodDeclaration, scope: Scope, specificTypes?: Type[]) {

        // if (methodDeclaration.type === undefined) throw new SyntaxNotSupportedError();
        let methodName = this.visitPropertyName(methodDeclaration.name, scope);

        if (methodDeclaration.typeParameters !== undefined && specificTypes === undefined) {
            Visitor.generics.saveDeclaration(methodName, methodDeclaration);
            return;
        }

        // Change the method name to be more specific
        if (specificTypes !== undefined) {
            // Construct a whole name from the method name and the names of specific types
            methodName = Generics.constructWholeName(methodName, specificTypes);
        }

        let returnType = this.visitTypeNode(methodDeclaration.type, scope);
        if (returnType.isPointerTy()) returnType = this.builder.buildPointerType(returnType);
        let className = scope.getCurrentScopeName();
        let parameterTypes: Type[] = [];
        let parameterNames: string[] = [];
        let defaultValues = new Map<string, Value>();

        for (let parameter of methodDeclaration.parameters) {

            let parameterName = this.visitBindingName(parameter.name, scope);
            parameterNames.push(parameterName);
            
            if (parameter.initializer !== undefined) {
                let visited = this.visitExpression(parameter.initializer, scope);
                let value = this.resolveNameDefinition(visited, scope);
                defaultValues.set(parameterName, value);
            }

            if (parameter.type === undefined) throw new SyntaxNotSupportedError();
            let parameterType = this.visitTypeNode(parameter.type, scope);
            parameterTypes.push(parameterType);
        }


        parameterNames.unshift('this');
        const structType = this.builder.getStructType(className);
        let ptrType = llvm.PointerType.get(structType, 0);
        parameterTypes.unshift(ptrType);

        let fn: llvm.Function;
        if (methodDeclaration.body !== undefined) {
            fn = this.builder.buildClassMethod(`${className}_${methodName}`, returnType, parameterTypes, parameterNames);
            
            // Use the function name appropriately modified by LLVM
            scope.setDefaultValues(fn.name, defaultValues);
            // Change to a new scope
            scope.enter(methodName, fn);
            
            // In the current scope, initialize the parameter names of a function with the arguments received from a caller
            for (let i = 0; i < parameterNames.length; i++) {
                let arg = fn.getArguments()[i];
                let newAlloca = this.builder.buildAlloca(arg.type);
                this.builder.buildStore(arg, newAlloca);
                scope.set(parameterNames[i], newAlloca);
                this.builder.setType(parameterNames[i], arg.type);
            }

            const modifiers = methodDeclaration.modifiers;

            let modifierIdx = 0;
            let coroId: CallInst | undefined;
            let coroHandler: CallInst | undefined;
            while (modifiers !== undefined && modifierIdx < modifiers.length) {
                // For now, only one kind of modifier is recognized.
                switch (modifiers[modifierIdx].kind) {
                    case ts.SyntaxKind.AsyncKeyword:
                        const alignment = this.builder.buildInteger(0, 32);
                        const nullPtr = this.builder.buildNullPtr();
                        coroId = this.builder.buildFunctionCall('llvm.coro.id', [alignment, nullPtr, nullPtr, nullPtr]);
                        const coroFrame = this.builder.buildFunctionCall('llvm.coro.frame', []);
                        coroHandler = this.builder.buildFunctionCall('llvm.coro.begin', [coroId, coroFrame]);
                }
                ++modifierIdx;
            }
    
            // For future reference
            if (coroHandler !== undefined) scope.set('coro.handler', coroHandler);

            let returnValue: Value | Break | Continue | undefined;
            if (methodDeclaration.body !== undefined) {
                returnValue = this.visitBlock(methodDeclaration.body, scope);
                if (returnValue === undefined || isValue(returnValue)) {
                    // Determine whether a suspended coroutine is at its final point.
                    if (coroHandler !== undefined) this.builder.buildFunctionCall('llvm.coro.destroy', [coroHandler]);
                    this.builder.buildReturn(returnValue);
                }
            }

            // Return to the last scope
            scope.leave(fn);
            let currentFunction = scope.getCurrentFunction();
            let currentBlock = currentFunction.getEntryBlock();
            if (!isBasicBlock(currentBlock)) throw new SyntaxNotSupportedError();
            this.builder.setCurrentBlock(currentBlock);

        } else {
            fn = this.builder.buildFunctionDeclaration(`${className}_${methodName}`, returnType, parameterTypes, parameterNames);
        }

        this.builder.verifyFunction(fn);
        return fn;
    }

    public visitConstructorDeclaration(constructorDeclaration: ts.ConstructorDeclaration, scope: Scope) {
        
        let className = scope.getCurrentScopeName();
        let parameterTypes: Type[] = [];
        let parameterNames: string[] = [];
        let defaultValues = new Map<string, Value>();

        for (let parameter of constructorDeclaration.parameters) {

            let parameterName = this.visitBindingName(parameter.name, scope);
            parameterNames.push(parameterName);
            
            if (parameter.initializer !== undefined) {
                let visited = this.visitExpression(parameter.initializer, scope);
                let value = this.resolveNameDefinition(visited, scope);
                defaultValues.set(parameterName, value);
            }

            let parameterType = this.visitTypeNode(parameter.type, scope);
            parameterTypes.push(parameterType);
        }

        const structType = this.builder.getStructType(className);
        let ptrType = llvm.PointerType.get(structType, 0);
        parameterTypes.unshift(ptrType);
        parameterNames.unshift('this');
        let fn = this.builder.buildConstructor(`${className}_Constructor`, parameterTypes, parameterNames);
        // In the current scope, initialize the parameter names of a function with the arguments received from a caller
        for (let i = 0; i < parameterNames.length; i++) {
            let arg = fn.getArguments()[i];
            if (arg.type.isDoubleTy() || arg.type.isIntegerTy()) {
                let newAlloca = this.builder.buildAlloca(arg.type);
                this.builder.buildStore(arg, newAlloca);
                scope.set(parameterNames[i], newAlloca);
            } else {
                scope.set(parameterNames[i], arg);
            }
        }

        // Use the function name appropriately modified by LLVM
        scope.setDefaultValues(`${className}_Constructor`, defaultValues);
        // Change to a new scope
        scope.enter('Constructor', fn);

        if (constructorDeclaration.body !== undefined) this.visitBlock(constructorDeclaration.body, scope);
        this.builder.buildReturn()
        this.builder.verifyFunction(fn);

        // Return to the last scope
        scope.leave(fn);
        let currentFunction = scope.getCurrentFunction();
        let currentBlock = currentFunction.getEntryBlock();
        if (!isBasicBlock(currentBlock)) throw new SyntaxNotSupportedError();
        this.builder.setCurrentBlock(currentBlock);

    }

    public visitForStatement(forStatement: ts.ForStatement, scope: Scope) {
        scope.enter('For');
        let currentFunction = scope.getCurrentFunction();
        let entryBlock = currentFunction.getEntryBlock();
        if (!isBasicBlock(entryBlock)) throw new SyntaxNotSupportedError();

        if (forStatement.initializer !== undefined) {
            if (ts.isVariableDeclarationList(forStatement.initializer)) {
                this.visitVariableDeclarationList(forStatement.initializer, scope);
            } else {
                this.visitExpression(forStatement.initializer, scope);
            }
        }
        
        let condBlock = this.builder.buildBasicBlock(currentFunction, 'for.cond');
        let bodyBlock = this.builder.buildBasicBlock(currentFunction, 'for.body');
        let incBlock = this.builder.buildBasicBlock(currentFunction, 'for.inc');
        let endBlock = this.builder.buildBasicBlock(currentFunction, 'for.end');

        this.builder.setLoopNextBlock(incBlock);
        this.builder.setLoopEndBlock(endBlock);

        this.builder.setCurrentBlock(entryBlock);
        this.builder.buildBranch(condBlock);


        // ============= condition basic block =============
        this.builder.setCurrentBlock(condBlock);
        let condition: Value | undefined;
        if (forStatement.condition !== undefined) {
            let visited = this.visitExpression(forStatement.condition, scope);
            condition = this.resolveNameDefinition(visited, scope);
        }
        // The following snippet handles infinite loops if a condition is not provided.
        if (condition !== undefined) {
            this.builder.buildConditionBranch(condition, bodyBlock, endBlock);
        } else {
            this.builder.buildBranch(bodyBlock);
        }
        // ============= Body Basic Block =============
        this.builder.setCurrentBlock(bodyBlock);
        let returnValue = this.visitStatement(forStatement.statement, scope);
        if (returnValue !== undefined && isValue(returnValue)) {
            this.builder.buildReturn(returnValue);
        } else if (returnValue === undefined || isContinue(returnValue)) {
            this.builder.buildBranch(incBlock);
        } else {
            this.builder.buildBranch(endBlock);
        }
        // ============= Increment Basic Block =============
        this.builder.setCurrentBlock(incBlock);
        if (forStatement.incrementor !== undefined) {
            this.visitExpression(forStatement.incrementor, scope);
        }
        this.builder.buildBranch(bodyBlock);
        // ============= End Basic Block =============
        this.builder.setCurrentBlock(endBlock);

        scope.leave();
    }

    public visitForOfStatement(forOfStatement: ts.ForOfStatement, scope: Scope) {
        scope.enter('for-of');
        let currentFunction = scope.getCurrentFunction();
        let entryBlock = currentFunction.getEntryBlock();
        if (!isBasicBlock(entryBlock)) throw new SyntaxNotSupportedError();
        
        let visited = this.visitExpression(forOfStatement.expression, scope);
        let arrayAlloca = this.resolveNameDefinition(visited, scope);
        let arrayValue = this.builder.buildLoad(arrayAlloca);
        if (!arrayValue.type.isArrayTy) throw new SyntaxNotSupportedError();
        let numOfElements = (arrayValue.type as llvm.ArrayType).numElements;
        if (!ts.isVariableDeclarationList(forOfStatement.initializer)) throw new SyntaxNotSupportedError();
        let variableList = this.visitVariableDeclarationList(forOfStatement.initializer, scope);
        if (!isStringArray(variableList)) throw new SyntaxNotSupportedError(); 

        let condBlock = this.builder.buildBasicBlock(currentFunction, 'forof.cond');
        let bodyBlock = this.builder.buildBasicBlock(currentFunction, 'forof.body');
        let incBlock = this.builder.buildBasicBlock(currentFunction, 'forof.inc');
        let endBlock = this.builder.buildBasicBlock(currentFunction, 'forof.end');

        this.builder.setLoopNextBlock(incBlock);
        this.builder.setLoopEndBlock(endBlock);
        
        this.builder.setCurrentBlock(entryBlock);
        let idxValue = this.builder.buildInteger(0, 32);
        let idxAlloca = this.builder.buildAlloca(idxValue.type);
        this.builder.buildStore(idxValue, idxAlloca);
        this.builder.buildBranch(condBlock);

        // ============ Condition Basic Block ===========
        this.builder.setCurrentBlock(condBlock);
        let lhs = this.builder.convertIntegerToNumber(this.builder.buildLoad(idxAlloca));
        let rhs = this.builder.buildNumber(numOfElements);
        let condition = this.builder.buildLessThan(lhs, rhs);
        this.builder.buildConditionBranch(condition, bodyBlock, endBlock);
        // ============ Body Basic Block ===========
        this.builder.setCurrentBlock(bodyBlock);
        const offset = this.builder.buildLoad(idxAlloca);
        const ptr = this.builder.buildAccessPtr(arrayAlloca, offset);
        scope.set(variableList[0], ptr);

        const returnValue = this.visitStatement(forOfStatement.statement, scope);
        if (returnValue !== undefined && isValue(returnValue)) {
            this.builder.buildReturn(returnValue);
        } else if (returnValue === undefined || isContinue(returnValue)) {
            this.builder.buildBranch(incBlock);
        } else {
            this.builder.buildBranch(endBlock);
        }
        // ============ Increment Basic Block ===========
        this.builder.setCurrentBlock(incBlock);
        let newLhs = this.builder.buildLoad(idxAlloca);
        let newRhs = this.builder.buildInteger(1, 32);
        let newIdxValue = this.builder.buildIntAdd(newLhs, newRhs);
        this.builder.buildStore(newIdxValue, idxAlloca);
        this.builder.buildBranch(condBlock);
        // ============ End Basic Block ============
        this.builder.setCurrentBlock(endBlock);

        scope.leave();
    }

    public visitForInStatement(forInStatement: ts.ForInStatement, scope: Scope) {
        scope.enter('for-In');
        let currentFunction = scope.getCurrentFunction();
        let entryBlock = currentFunction.getEntryBlock();
        if (!isBasicBlock(entryBlock)) throw new SyntaxNotSupportedError();

        let visited = this.visitExpression(forInStatement.expression, scope);
        let structAlloca = this.resolveNameDefinition(visited, scope);
        let structValue = this.builder.buildLoad(structAlloca);
        let structType = structValue.type;
        if (!structType.isStructTy()) throw new SyntaxNotSupportedError();
        let numOfElements = structType.numElements;
        if (!ts.isVariableDeclarationList(forInStatement.initializer)) throw new SyntaxNotSupportedError();
        let variableList = this.visitVariableDeclarationList(forInStatement.initializer, scope);
        if (!isString(variableList[0])) throw new SyntaxNotSupportedError(); 
        let variableName = variableList[0];

        let condBlock = this.builder.buildBasicBlock(currentFunction, 'forin.cond');
        let bodyBlock = this.builder.buildBasicBlock(currentFunction, 'forin.body');
        let incBlock = this.builder.buildBasicBlock(currentFunction, 'forin.inc');
        let endBlock = this.builder.buildBasicBlock(currentFunction, 'forin.end');
        
        this.builder.setLoopNextBlock(incBlock);
        this.builder.setLoopEndBlock(endBlock);

        this.builder.setCurrentBlock(entryBlock);
        let idxValue = this.builder.buildInteger(0, 32);
        let idxAlloca = this.builder.buildAlloca(idxValue.type);
        this.builder.buildStore(idxValue, idxAlloca);
        this.builder.buildBranch(condBlock);

        // ============ Condition Basic Block ===========
        this.builder.setCurrentBlock(condBlock);
        let lhs = this.builder.convertIntegerToNumber(this.builder.buildLoad(idxAlloca));
        let rhs = this.builder.buildNumber(numOfElements);
        let condition = this.builder.buildLessThan(lhs, rhs);
        this.builder.buildConditionBranch(condition, bodyBlock, endBlock);
        // ============ Body Basic Block ===========
        this.builder.setCurrentBlock(bodyBlock);
        const first = this.builder.buildLoad(idxAlloca);
        const second = this.builder.buildInteger(0, 32);
        const keyPtr = this.builder.buildAccessPtr(structAlloca, first, second);
        scope.set(variableName, keyPtr);
        const returnValue = this.visitStatement(forInStatement.statement, scope);
        if (returnValue !== undefined && isValue(returnValue)) {
            this.builder.buildReturn(returnValue);
        } else if (returnValue === undefined || isContinue(returnValue)) {
            this.builder.buildBranch(incBlock);
        } else {
            this.builder.buildBranch(endBlock);
        }
        // ============ Increment Basic Block ===========
        this.builder.setCurrentBlock(incBlock);
        let newLhs = this.builder.buildLoad(idxAlloca);
        let newRhs = this.builder.buildInteger(1, 32);
        let newIdxValue = this.builder.buildIntAdd(newLhs, newRhs);
        this.builder.buildStore(newIdxValue, idxAlloca);
        this.builder.buildBranch(condBlock);
        // ============ End Basic Block ============
        this.builder.setCurrentBlock(endBlock);

        scope.leave();
    }

    public visitWhileStatement(whileStatement: ts.WhileStatement, scope: Scope) {
        scope.enter('While');
        let currentFunction = scope.getCurrentFunction();
        let entryBlock = currentFunction.getEntryBlock();
        if (!isBasicBlock(entryBlock)) throw new SyntaxNotSupportedError();

        let condBlock = this.builder.buildBasicBlock(currentFunction, 'while.cond');
        let bodyBlock = this.builder.buildBasicBlock(currentFunction, 'while.body');
        let endBlock = this.builder.buildBasicBlock(currentFunction, 'while.end');
        
        this.builder.setLoopNextBlock(condBlock);
        this.builder.setLoopEndBlock(endBlock);

        this.builder.setCurrentBlock(entryBlock);
        this.builder.buildBranch(condBlock);

        // ============ Condition Basic Block ===========
        this.builder.setCurrentBlock(condBlock);
        let visited = this.visitExpression(whileStatement.expression, scope);
        let condition = this.resolveNameDefinition(visited, scope);
        this.builder.buildConditionBranch(condition, bodyBlock, endBlock);
        // ============= Body Basic Block ===============
        this.builder.setCurrentBlock(bodyBlock);
        let returnValue = this.visitStatement(whileStatement.statement, scope);
        if (returnValue !== undefined && isValue(returnValue)) {
            this.builder.buildReturn(returnValue);
        } else if (returnValue === undefined || isContinue(returnValue)) {
            this.builder.buildBranch(condBlock);
        } else {
            this.builder.buildBranch(endBlock);
        }
        // ============== End basic Block ===============
        this.builder.setCurrentBlock(endBlock);

        scope.leave();
    }

    public visitDoStatement(doStatement: ts.DoStatement, scope: Scope) {
        scope.enter('Do');
        
        let currentFunction = scope.getCurrentFunction();
        let entryBlock = currentFunction.getEntryBlock();
        if (!isBasicBlock(entryBlock)) throw new SyntaxNotSupportedError();

        let condBlock = this.builder.buildBasicBlock(currentFunction, 'do.cond');
        let bodyBlock = this.builder.buildBasicBlock(currentFunction, 'do.body');
        let endBlock = this.builder.buildBasicBlock(currentFunction, 'do.end');

        this.builder.setLoopNextBlock(condBlock);
        this.builder.setLoopEndBlock(endBlock);

        this.builder.setCurrentBlock(entryBlock);
        this.builder.buildBranch(bodyBlock);

        // ============ Condition Basic Block ===========
        this.builder.setCurrentBlock(condBlock);
        let visited = this.visitExpression(doStatement.expression, scope);
        let condition = this.resolveNameDefinition(visited, scope);
        this.builder.buildConditionBranch(condition, bodyBlock, endBlock);
        // ============= Body Basic Block ===============
        this.builder.setCurrentBlock(bodyBlock);
        let returnValue = this.visitStatement(doStatement.statement, scope);
        if (returnValue !== undefined && isValue(returnValue)) {
            this.builder.buildReturn(returnValue);
        } else if (returnValue === undefined || isContinue(returnValue)) {
            this.builder.buildBranch(condBlock);
        } else {
            this.builder.buildBranch(endBlock);
        }
        // ============== End basic Block ===============
        this.builder.setCurrentBlock(endBlock);

        scope.leave();
    }

    private resolveNameDefinition(visited: Value | string, scope: Scope) {
        if (isString(visited) && scope.has(visited)) return scope.get(visited);
        if (isValue(visited)) return visited;
        throw new VariableUndefinedError();
    }

    private resolveVariableDefinition(visited: Value | string, scope: Scope) {
        if (isString(visited) && scope.has(visited)) {
            let value = scope.get(visited);
            if (isAllocaInst(value)) return this.builder.buildLoad(value);
            if (isGlobalVariable(value) && value.initializer !== undefined) return value.initializer;
            return value;
        } else if (isValue(visited) && isPointerType(visited.type)) {
            return this.builder.buildLoad(visited);
        } else if (isValue(visited)) {
            return visited;
        } else {
            throw new SyntaxNotSupportedError();
        }
    }

    private resolveValueType(val: llvm.Value) {
        let type = val.type;
        while (type.isPointerTy()) type = type.elementType;
        return type;
    }

    private resolveTypeName(type: llvm.Type) {
        if (type.isStructTy()) return type.name;
        return type.toString();
    }

    private resolveValue(val: llvm.Value) {
        while (isAllocaInst(val)) {
            val = this.builder.buildLoad(val);
        }
        return val;
    }
}

