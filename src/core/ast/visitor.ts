import ts from 'typescript';
import { SyntaxNotSupportedError, InstantiateError, VariableUndefinedError } from '../../common/error';
import { Builder } from '../ir/builder';
import { isBasicBlock, isGlobalVariable, isValue, Type, Value, BasicBlock } from '../ir/types';
import { Scope } from '../../common/scope';
import { isString, FunctionLikeDeclaration } from '../../common/types'

export class Visitor {

    private builder: Builder;
    private static visitor: Visitor;


    private constructor(builder: Builder) {
        this.builder = builder;
    }

    public static getVisitor(builder?: Builder): Visitor {

        if (builder !== undefined) {
            if (this.visitor === undefined) this.visitor = new Visitor(builder);
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
            scope.set(entryFunction.name, entryFunction);
            scope.enter('Main', entryFunction);
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
        let values: Value[] = [];
        for (let variableDeclaration of variableDeclarationList.declarations) {
            let declarationValue = this.visitVariableDeclaration(variableDeclaration, scope);
            values.push(declarationValue);
        }
        return values;
    }

    public visitVariableDeclaration(variableDeclaration: ts.VariableDeclaration, scope: Scope) {

        // Retrieve identifier names
        let name = this.visitBindingName(variableDeclaration.name, scope);
        
        if (variableDeclaration.initializer === undefined) {
            let anyValue = this.builder.buildAny();
            scope.set(name, anyValue);
            return anyValue;
        }

        let currentFunction = scope.getCurrentFunction();
        let expressionValue = this.visitExpression(variableDeclaration.initializer, scope);

        if (isString(expressionValue)) {
            let allocaValue = scope.get(expressionValue);
            let loadValue = this.builder.buildLoad(expressionValue, allocaValue);
            allocaValue = this.builder.buildAlloca(name, loadValue, currentFunction);
            this.builder.buildStore(loadValue, allocaValue);
            return loadValue;
        }

        if (scope.isModuleScope()) {
            let moduleVal = this.builder.buildGlobalVariable(name, expressionValue);
            scope.set(name, moduleVal);
        } else {
            let allocaValue = this.builder.buildAlloca(name, expressionValue, currentFunction);
            this.builder.buildStore(expressionValue, allocaValue);
            scope.set(name, allocaValue);
        }

        return expressionValue;
    }

    public visitIfStatement(ifStatement: ts.IfStatement, scope: Scope) {

        let condition = this.visitExpression(ifStatement.expression, scope);

        if (!isValue(condition)) throw new SyntaxNotSupportedError();

        let currentFunction = scope.getCurrentFunction();

        // Create all the basic blocks at once
        let thenBlock = this.builder.buildBasicBlock('then', currentFunction);
        let elseBlock = this.builder.buildBasicBlock('else', currentFunction);
        let endBlock = this.builder.buildBasicBlock('end', currentFunction);

        this.builder.buildConditionBranch(condition, thenBlock, elseBlock);

        let values: Value[] = [];
        let blocks: BasicBlock[] = [];
        // Set an insertion point from 'then' basicblock
        this.builder.setEntryBlock(thenBlock);
        scope.enter('If');
        let thenVal = this.visitStatement(ifStatement.thenStatement, scope);
        this.builder.buildBranch(endBlock);
        scope.leave();
        if (isValue(thenVal)) {
            blocks.push(thenBlock);
            values.push(thenVal);
        }
        
        if (ifStatement.elseStatement !== undefined) {
            scope.enter('Else');
            this.builder.setEntryBlock(elseBlock);
            let elseVal = this.visitStatement(ifStatement.elseStatement, scope);
            this.builder.buildBranch(endBlock);
            scope.leave();
            if (isValue(elseVal)) {
                blocks.push(elseBlock);
                values.push(elseVal);
            }
        }

        this.builder.setEntryBlock(endBlock);
        if (values.length > 0) {
            let ph = this.builder.buildPHINode(values, blocks);
            this.builder.buildReturn(ph);
        }
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
        this.visitFunctionLikeDeclaration(functionDeclaration, scope);
    }

    public visitFunctionLikeDeclaration(functionLikeDeclaration: FunctionLikeDeclaration, scope: Scope) {

        let functionName: string;
        let returnType: Type;

        if (functionLikeDeclaration.name === undefined || !ts.isIdentifier(functionLikeDeclaration.name)) throw new SyntaxNotSupportedError();
        functionName = functionLikeDeclaration.name.text;

        returnType = this.visitTypeNode(functionLikeDeclaration.type);

        let parameterTypes: Type[] = [];
        let parameterNames: string[] = [];
        let initializedNames: string[] = [];
        let initializedValues: Value[] = [];

        for (let parameter of functionLikeDeclaration.parameters) {

            let parameterName: string;
            if (parameter.name !== undefined) {
                parameterName = this.visitBindingName(parameter.name, scope) as string;
                parameterNames.push(parameterName);
            } else {
                throw new SyntaxNotSupportedError();
            }
            
            if (parameter.initializer !== undefined) {
                let val = this.visitExpression(parameter.initializer, scope) as Value;
                initializedNames.push(parameterName);
                initializedValues.push(val);
            }
            
            parameterTypes.push(this.visitTypeNode(parameter.type));
        }

        let currentScopeName = scope.getCurrentScopeName();
        let fn = this.builder.buildFunction(`${currentScopeName}_${functionName}`, returnType, parameterTypes, parameterNames);
        scope.enter(functionName, fn);

        for (let i = 0; i < parameterNames.length; i++) {
            let allocaValue = this.builder.buildAlloca(parameterNames[i], fn.getArguments()[i], fn);
            scope.set(parameterNames[i], allocaValue);
        }

        for (let i = 0; i < parameterNames.length; i++) {
            let allocaValue = scope.get(parameterNames[i]);
            this.builder.buildStore(fn.getArguments()[i], allocaValue);
        }

        // Initialize the parameters with the given arguments
        for (let i = 0; i < initializedNames.length; i++) {
            let allocaValue = scope.get(initializedNames[i]);
            this.builder.buildStore(initializedValues[i], allocaValue);
        }

        let returnValue: Value | undefined;
        if (functionLikeDeclaration.body !== undefined) returnValue = this.visitBlock(functionLikeDeclaration.body, scope);
        this.builder.buildReturn(returnValue);

        this.builder.verifyFunction(fn);

        // Return to the last scope
        scope.leave(fn);
        let currentFunction = scope.getCurrentFunction();
        let entryBlock = currentFunction.getEntryBlock();
        if (!isBasicBlock(entryBlock)) throw new SyntaxNotSupportedError();
        this.builder.setEntryBlock(entryBlock);

        return fn;
    }

    public visitExpressionStatement(expressionStatement: ts.ExpressionStatement, scope: Scope) {
        this.visitExpression(expressionStatement.expression, scope);
    }

    public visitCallExpression(callExpression: ts.CallExpression, scope: Scope) {

        let name = this.visitExpression(callExpression.expression, scope) as string;

        let values: Value[] = [];

        for (let argument of callExpression.arguments) {
            let expressionValue = this.visitExpression(argument, scope);

            let value: Value;
            if (isString(expressionValue)) {
                let allocaValue = scope.get(expressionValue);
                value = this.builder.buildLoad(expressionValue, allocaValue);
            } else {
                value = expressionValue;
            }

            values.push(value);
        }

        return this.builder.buildFunctionCall(name, values);
    }

    public visitBlock(block: ts.Block, scope: Scope) {
        scope.enter('Block');
        // Capture the return value of the return statement
        let returnValue: Value | undefined;
        for (let statement of block.statements) {
            returnValue = this.visitStatement(statement, scope);
        }
        scope.leave();
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
        if (ts.isBlock(statement)) this.visitBlock(statement, scope);
        if (ts.isReturnStatement(statement)) return this.visitReturnStatement(statement, scope);
    }

    public visitReturnStatement(returnStatement: ts.ReturnStatement, scope: Scope) {

        if (returnStatement.expression === undefined) return;
        
        let returnValue = this.visitExpression(returnStatement.expression, scope);
        if (isString(returnValue)) {
            let allocaValue = scope.get(returnValue);
            return this.builder.buildLoad(returnValue, allocaValue);
        } else {
            return returnValue;
        }

    }

    public visitExpression(expression: ts.Expression, scope: Scope) {
        // if (ts.isPostfixUnaryExpression(expression)) return this.visitPostfixUnaryExpression(expression, scope);
        // if (ts.isPrefixUnaryExpression(expression)) return this.visitPrefixUnaryExpression(expression, scope);
        if (ts.isFunctionExpression(expression)) return this.visitFunctionExpression(expression, scope);
        if (ts.isCallExpression(expression)) return this.visitCallExpression(expression, scope);
        if (ts.isIdentifier(expression)) return this.visitIdentifier(expression, scope);
        if (ts.isStringLiteral(expression)) return this.visitStringLiteral(expression, scope);
        if (ts.isNumericLiteral(expression)) return this.visitNumericLiteral(expression, scope);
        if (ts.isBinaryExpression(expression)) return this.visitBinaryExpression(expression, scope);
        // if (ts.isObjectLiteralExpression(expression)) return this.visitObjectLiteralExpression(expression, scope);
        if (ts.isPropertyAccessExpression(expression)) return this.visitPropertyAccessExpression(expression, scope);
        // if (ts.isNewExpression(expression)) return this.visitNewExpression(expression, scope);
        throw new SyntaxNotSupportedError();
    }

    public visitFunctionExpression(functionExpression: ts.FunctionExpression, scope: Scope) {
        return this.visitFunctionLikeDeclaration(functionExpression, scope);
    }

    public visitNewExpression(newExpression: ts.NewExpression, scope: Scope) {
        throw new SyntaxNotSupportedError();
    }

    public visitObjectLiteralExpression(objectLiteralExpression: ts.ObjectLiteralExpression, scope: Scope) {
        throw new SyntaxNotSupportedError();
    }

    public visitPostfixUnaryExpression(postfixUnaryExpression: ts.PostfixUnaryExpression, scope: Scope) {
        throw new SyntaxNotSupportedError();
    }

    public visitPrefixUnaryExpression(prefixUnaryExpression: ts.PrefixUnaryExpression, scope: Scope) {
        throw new SyntaxNotSupportedError();
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
                let val = this.builder.buildAdd(lhs, rhs);
                // visitedLeft has been type asserted
                let allocaA = scope.get(visitedLeft as string);
                this.builder.buildStore(val, allocaA);
                return val;
            case ts.SyntaxKind.PlusToken:
                return this.builder.buildAdd(lhs, rhs);
            case ts.SyntaxKind.MinusToken:
                return this.builder.buildSub(lhs, rhs);
            case ts.SyntaxKind.EqualsToken:
                // visitedLeft has been type asserted
                let allocaB = scope.get(visitedLeft as string);
                this.builder.buildStore(rhs, allocaB);
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

        let propertyValues: Value[] = [];

        while (ts.isPropertyAccessExpression(propertyAccessExpression.expression)) {
            let propertyName = this.visitPropertyName(propertyAccessExpression.expression.name, scope);
            let value = scope.get(propertyName);
            propertyValues.push(value);
        }

        let currentMethod = scope.getCurrentFunction();
        let propertyPtr = this.builder.buildPropertyPtr(currentMethod, propertyValues);
        return this.builder.buildLoad('', propertyPtr);
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

    public visitTypeNode(typeNode?: ts.TypeNode) {

        if (typeNode === undefined) return this.builder.buildVoidType();

        switch (typeNode.kind) {
            case ts.SyntaxKind.NumberKeyword:
                return this.builder.buildNumberType();
            case ts.SyntaxKind.VoidKeyword:
                return this.builder.buildVoidType();
            case ts.SyntaxKind.StringKeyword:
                return this.builder.buildStringType();
            case ts.SyntaxKind.BooleanKeyword:
                return this.builder.buildBooleanType();
            case ts.SyntaxKind.AnyKeyword:
                return this.builder.buildAnyType();
            default:
                throw new SyntaxNotSupportedError();
        }
    }

    public visitClassDeclaration(classDeclaration: ts.ClassDeclaration, scope: Scope) {
        if (classDeclaration.name === undefined) throw new SyntaxNotSupportedError();
        let className = classDeclaration.name.text;
        
        scope.enter(className);

        let memberTypes: Type[] = [];
        let memberMethods: ts.MethodDeclaration[] = [];
        let constructor: ts.ConstructorDeclaration | undefined;
        for (let member of classDeclaration.members) {
            if (ts.isPropertyDeclaration(member)) {
                let memberType = this.visitPropertyDeclaration(member, scope);
                memberTypes.push(memberType);
            } else if (ts.isConstructorDeclaration(member)) {
                constructor = member;
            } else if (ts.isMethodDeclaration(member)) {
                memberMethods.push(member);
            } else {
                throw new SyntaxNotSupportedError();
            }
        }

        // Build a struct type with the class name and its members
        this.builder.buildStructType(className, memberTypes);

        if (constructor === undefined) {
            let method = this.builder.buildDefaultConstructor(className);
            let methodBlock = this.builder.buildBasicBlock('', method);
            this.builder.setEntryBlock(methodBlock)
            this.builder.buildReturn();
        } else {
            this.visitConstructorDeclaration(constructor, scope);
        }

        // Define all the member functions
        for (let method of memberMethods) {
            this.visitMethodDeclaration(method, scope);
        }
        scope.leave();
    }

    public visitPropertyDeclaration(propertyDeclaration: ts.PropertyDeclaration, scope: Scope) {

        let propertyName = this.visitPropertyName(propertyDeclaration.name, scope);
        let propertyType = this.visitTypeNode(propertyDeclaration.type);

        if (propertyDeclaration.initializer !== undefined) {
            let currentFunction = scope.getCurrentFunction();
            let expressionValue = this.visitExpression(propertyDeclaration.initializer, scope);
            let allocaValue = this.builder.buildAlloca(propertyName, expressionValue as Value, currentFunction);
            this.builder.buildStore(expressionValue as Value, allocaValue);
        } else {
            this.builder.buildAny();
        }

        return propertyType;
    }

    public visitPropertyName(propertyName: ts.PropertyName, scope: Scope) {
        if (ts.isIdentifier(propertyName)) return this.visitIdentifier(propertyName, scope);
        throw new SyntaxNotSupportedError();
    }

    public visitMethodDeclaration(methodDeclaration: ts.MethodDeclaration, scope: Scope) {
        this.visitFunctionLikeDeclaration(methodDeclaration, scope);
    }

    public visitConstructorDeclaration(constructorDeclaration: ts.ConstructorDeclaration, scope: Scope) {
        if (constructorDeclaration.modifiers !== undefined) {
            for (let modifier of constructorDeclaration.modifiers) {
            }
        }
        // this.builder.buildConstructor();
    }

    public visitForStatement(forStatement: ts.ForStatement, scope: Scope) {
        scope.enter('For');

        let values: Value[] = [];
        if (forStatement.initializer !== undefined) {
            if (ts.isVariableDeclarationList(forStatement.initializer)) {
                values = this.visitVariableDeclarationList(forStatement.initializer, scope);
            } else {
                // TODO: Give justification why it is Value
                let val = this.visitExpression(forStatement.initializer, scope) as Value;
                values = [val];
            }
        }

        let currentFunction = scope.getCurrentFunction();

        let entryBlock = currentFunction.getEntryBlock();
        if (!isBasicBlock(entryBlock)) throw new SyntaxNotSupportedError();
        
        let loopBlock = this.builder.buildBasicBlock('loop', currentFunction);

        this.builder.buildBranch(loopBlock);
        this.builder.setEntryBlock(loopBlock);

        let phi = this.builder.buildPHINode(values, [entryBlock]);
        let returnValue = this.visitStatement(forStatement.statement, scope);

        let endBlock: BasicBlock | undefined;
        if (returnValue !== undefined) {
            endBlock = this.builder.buildBasicBlock('end', currentFunction);
        }

        if (forStatement.incrementor !== undefined) {
            // TODO: Give justification why it is Value
            let increment = this.visitExpression(forStatement.incrementor, scope) as Value;
            phi.addIncoming(increment, loopBlock);
        }

        // The following handles infinite loops if the condition is not provided
        let condition: Value | undefined;
        if (forStatement.condition !== undefined) {
            condition = this.visitExpression(forStatement.condition, scope) as Value | undefined;
        }

        if (condition !== undefined && endBlock !== undefined) {
            this.builder.buildConditionBranch(condition, loopBlock, endBlock);
        } else {
            this.builder.buildBranch(loopBlock);
        }

        if (returnValue !== undefined && endBlock !== undefined) {
            this.builder.setEntryBlock(endBlock);
            this.builder.buildReturn(returnValue);
        }

        scope.leave();
        // Return back to the previous insertion block before the loop
        this.builder.setEntryBlock(entryBlock);
    }

    public visitForOfStatement(forOfStatement: ts.ForOfStatement, scope: Scope) {
        throw new SyntaxNotSupportedError();
    }

    public visitForInStatement(forInStatement: ts.ForInStatement, scope: Scope) {
        throw new SyntaxNotSupportedError();
    }

    public visitWhileStatement(whileStatement: ts.WhileStatement, scope: Scope) {
        throw new SyntaxNotSupportedError();
    }

    private resolveVariableDefinition(visited: Value | string | void | Type, scope: Scope) {
        if (isString(visited) && scope.has(visited)) {
            let alloca = scope.get(visited);
            if (!isGlobalVariable(alloca)) {
                return this.builder.buildLoad(visited, alloca);
            } else if (isGlobalVariable(alloca) && alloca.initializer !== undefined) {
                return alloca.initializer;
            } else {
                throw new VariableUndefinedError();
            }
        } else if (isValue(visited)) {
            return visited;
        } else {
            throw new SyntaxNotSupportedError();
        }
    }
}

