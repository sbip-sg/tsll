import ts from 'typescript';
import { SyntaxNotSupportedError, InstantiateError, VariableUndefinedError } from '../../common/error';
import { Builder } from '../ir/builder';
import { isBasicBlock, isGlobalVariable, isValue, Type, Value, BasicBlock, isAllocaInst } from '../ir/types';
import { Scope } from '../../common/scope';
import { isString, FunctionLikeDeclaration, Property } from '../../common/types';

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

        // Currently we do not allow untyped variable declarations. We may ease this restriction in the future.
        if (variableDeclaration.type === undefined) throw new SyntaxNotSupportedError();
        if (ts.isArrayTypeNode(variableDeclaration.type)) {
            let type = this.visitArrayTypeNode(variableDeclaration.type);
            scope.setNextType(type);
        } else {
            let type = this.visitTypeNode(variableDeclaration.type)
            scope.setNextType(type);
        }

        let visited = this.visitExpression(variableDeclaration.initializer, scope);

        // TODO: We could do type checking between visited type and declared type.
        if (isString(visited)) {
            let visitedValue = scope.get(visited);
            let newAlloca = this.builder.buildAlloca(visitedValue.type, undefined, name);
            this.builder.buildStore(visitedValue, newAlloca);
            scope.set(name, newAlloca);
            return newAlloca;
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

    public visitArrayTypeNode(arrayTypeNode: ts.ArrayTypeNode) {
        return this.visitTypeNode(arrayTypeNode.elementType);
    }

    public visitIfStatement(ifStatement: ts.IfStatement, scope: Scope) {

        let currentFunction = scope.getCurrentFunction();
        let currentBlock = this.builder.getCurrentBlock();
        if (currentBlock === undefined) throw new SyntaxNotSupportedError();
        let endBlock = this.builder.buildBasicBlock(currentFunction, 'end');

        while (1) {

            let nextStatement = ifStatement.elseStatement;
            let visited = this.visitExpression(ifStatement.expression, scope);
            let condition = this.resolveNameDefinition(visited, scope);

            // elseBlock name defaults to "else"
            let elseBlockName = 'else';
            if (nextStatement !== undefined && ts.isIfStatement(nextStatement)) {
                elseBlockName = 'elseif';
            }

            let thenBlock = this.builder.buildBasicBlock(currentFunction, 'then');
            let elseBlock = this.builder.buildBasicBlock(currentFunction, elseBlockName);
            this.builder.buildConditionBranch(condition, thenBlock, elseBlock);

            // Set the insertion point from 'then' basicBlock
            this.builder.setCurrentBlock(thenBlock);
            scope.enter('Then');

            let thenVal = this.visitStatement(ifStatement.thenStatement, scope);
            // It means one of the statements is a return statement inside the block
            if (isValue(thenVal)) {
                this.builder.buildReturn(thenVal);
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
        this.visitFunctionLikeDeclaration(functionDeclaration, scope);
    }

    public visitFunctionLikeDeclaration(functionLikeDeclaration: FunctionLikeDeclaration, scope: Scope) {

        if (functionLikeDeclaration.name === undefined || !ts.isIdentifier(functionLikeDeclaration.name)) throw new SyntaxNotSupportedError();
        if (functionLikeDeclaration.type === undefined) throw new SyntaxNotSupportedError();
        
        let returnType = this.visitTypeNode(functionLikeDeclaration.type);
        let functionName = functionLikeDeclaration.name.text;
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
            let parameterType = this.visitTypeNode(parameter.type);
            parameterTypes.push(parameterType);
        }

        let currentScopeName = scope.getCurrentScopeName();
        scope.setDefaultValues(`${currentScopeName}${functionName}`, defaultValues);

        let fn = this.builder.buildFunction(`${currentScopeName}${functionName}`, returnType, parameterTypes, parameterNames);
        scope.enter(functionName, fn);
        
        // In the current scope, initialize the parameter names of a function with the arguments received from a caller
        for (let i = 0; i < parameterNames.length; i++) {
            let newAlloca = this.builder.buildAlloca(parameterTypes[i]);
            this.builder.buildStore(fn.getArguments()[i], newAlloca);
            scope.set(parameterNames[i], newAlloca);
        }

        let returnValue: Value | undefined;
        if (functionLikeDeclaration.body !== undefined) returnValue = this.visitBlock(functionLikeDeclaration.body, scope);
        this.builder.buildReturn(returnValue);

        this.builder.verifyFunction(fn);

        // Return to the last scope
        scope.leave(fn);

        let currentFunction = scope.getCurrentFunction();
        let currentBlock = currentFunction.getEntryBlock();
        if (!isBasicBlock(currentBlock)) throw new SyntaxNotSupportedError();
        this.builder.setCurrentBlock(currentBlock);

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

            let value = this.resolveNameDefinition(expressionValue, scope);

            values.push(value);
        }

        let defaultValues = scope.getDefaultValues(name);

        return this.builder.buildFunctionCall(name, values, defaultValues);
    }

    public visitBlock(block: ts.Block, scope: Scope) {
        // Capture the return value of the return statement
        let returnValue: Value | undefined;
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
    }

    public visitImportDeclaration(importDeclaration: ts.ImportDeclaration, scope: Scope) {
        let importClause = importDeclaration.importClause;
        
        // TODO: Construct a list of mappings between importName and moduleName
        let moduleSpecifier = importDeclaration.moduleSpecifier;
        if (!isString(moduleSpecifier)) throw new SyntaxNotSupportedError();


    }

    public visitImportClause(importClause: ts.ImportClause, scope: Scope) {

    }

    public visitReturnStatement(returnStatement: ts.ReturnStatement, scope: Scope) {

        if (returnStatement.expression === undefined) return;
        
        let returnValue = this.visitExpression(returnStatement.expression, scope);
        if (isString(returnValue)) {
            let allocaValue = scope.get(returnValue);
            return this.builder.buildLoad(allocaValue);
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
        if (ts.isObjectLiteralExpression(expression)) return this.visitObjectLiteralExpression(expression, scope);
        if (ts.isPropertyAccessExpression(expression)) return this.visitPropertyAccessExpression(expression, scope);
        // if (ts.isElementAccessExpression(expression)) return this.visitElementAccessExpression(expression, scope);
        if (ts.isNewExpression(expression)) return this.visitNewExpression(expression, scope);
        if (ts.isArrayLiteralExpression(expression)) return this.visitArrayLiteralExpression(expression, scope);
        throw new SyntaxNotSupportedError();
    }

    public visitArrayLiteralExpression(arrayLiteralExpression: ts.ArrayLiteralExpression, scope: Scope) {

        let elementType = scope.getNextType();
        let arrayLen = arrayLiteralExpression.elements.length;

        // Allocate memory space of a specific size
        let arrayType = this.builder.buildArrayType(elementType, arrayLen);
        let allocaValue = this.builder.buildAlloca(arrayType, 0);

        // Store each value into the allocated array of memory
        for (let i = 0; i < arrayLen; i++) {
            let visited = this.visitExpression(arrayLiteralExpression.elements[i], scope);
            let value = this.resolveNameDefinition(visited , scope);
            let firstValue = this.builder.buildInteger(0, 64);
            let secondValue =this.builder.buildInteger(i, 64);
            let ptrValue = this.builder.buildAccessPtr(allocaValue, firstValue, secondValue);
            this.builder.buildStore(value, ptrValue);
        }

        return allocaValue;
    }

    public visitFunctionExpression(functionExpression: ts.FunctionExpression, scope: Scope) {
        return this.visitFunctionLikeDeclaration(functionExpression, scope);
    }

    public visitNewExpression(newExpression: ts.NewExpression, scope: Scope) {
        let visited = this.visitExpression(newExpression.expression, scope);
        
        let structType = this.builder.getStructType(visited as string);

        let allocaValue = this.builder.buildAlloca(structType, undefined, structType.name);

        let defaultValues = scope.getDefaultValues(`${structType.name}_Constructor`);


        // TODO: Match the parameters of a constructor with the arguments given for class instantiation
        if (newExpression.arguments === undefined) {
            this.builder.buildFunctionCall(`${structType.name}_Constructor`, [], defaultValues);
        
        } else {

            // First argument of any member function calls is always a pointer to a struct type
            // In this case, we are creating a class instance using the new operator, and calling an appropriate constructor
            let values: Value[] = [allocaValue];
            for (let argument of newExpression.arguments) {
                let visitedArg = this.visitExpression(argument, scope);
                let value = this.resolveNameDefinition(visitedArg, scope);
                values.push(value);
            }

            this.builder.buildFunctionCall(`${structType.name}_Constructor`, values, defaultValues);
        }

        return allocaValue;
    }

    public visitObjectLiteralExpression(objectLiteralExpression: ts.ObjectLiteralExpression, scope: Scope) {

        // Collect pairs of key and value from an object
        let keyArray: string[] = [];
        let valueArray: Value[] = [];
        for (let property of objectLiteralExpression.properties) {
            if (ts.isPropertyAssignment(property)) {
                // If a property does not have a name or initializer, then it is grammatically wrong.
                if (property.name === undefined || property.initializer === undefined) throw new SyntaxNotSupportedError();
                let key = this.visitPropertyName(property.name, scope);
                let visited = this.visitExpression(property.initializer, scope)
                let value = this.resolveNameDefinition(visited, scope);
                keyArray.push(key);
                valueArray.push(value);
            }
            if (ts.isShorthandPropertyAssignment(property)) {
                let key = this.visitIdentifier(property.name, scope);
                let value = this.resolveNameDefinition(key, scope);
                keyArray.push(key);
                valueArray.push(value);
            }
        }

        // Create a data structure regarding the structure of Object and types that it holds
        let keyValueStructTypeArray: Type[] = [];
        for (let i = 0; i < keyArray.length; i++) {
            // The length of the string type includes a terminator.
            let keyType = this.builder.buildStringType(keyArray[i].length + 1);
            let valueType = valueArray[i].type;
            let keyValueStructType = this.builder.buildStructType('');
            keyValueStructType.setBody([keyType, valueType]);
            keyValueStructTypeArray.push(keyValueStructType);
        }

        // Allocate memory space and place corresponding data appropriately
        let objectStructType = this.builder.buildStructType('');
        objectStructType.setBody(keyValueStructTypeArray);
        let objectStructAlloca = this.builder.buildAlloca(objectStructType);
        for (let i = 0; i < keyArray.length; i++) {
            const first = this.builder.buildInteger(0, 32);
            const second = this.builder.buildInteger(i, 32);
            const keyThird = this.builder.buildInteger(0, 32);
            const valueThird = this.builder.buildInteger(1, 32);
            const keyPtr = this.builder.buildAccessPtr(objectStructAlloca, first, second, keyThird);
            const valuePtr = this.builder.buildAccessPtr(objectStructAlloca, first, second, valueThird);
            const key = this.builder.buildString(keyArray[i]);
            this.builder.buildStore(key, keyPtr);
            this.builder.buildStore(valueArray[i], valuePtr);
        }

        return objectStructAlloca;
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
                let eqAlloca = scope.get(visitedLeft as string);
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
        // Find the name and value
        let allocaValue = this.resolveNameDefinition(visited, scope);
        if (!allocaValue.type.isStructTy() || !isString(allocaValue.type.name)) throw new SyntaxNotSupportedError();
        
        // Find the index of a specific name defined in the structure
        let idx = scope.indexInStruct(allocaValue.type.name, propertyAccessExpression.name.text);
        let firstValue = this.builder.buildInteger(0, 32);
        let secondValue = this.builder.buildInteger(idx, 32);
        return this.builder.buildAccessPtr(allocaValue, firstValue, secondValue);
    }

    public visitElementAccessExpression(elementAccessExpression: ts.ElementAccessExpression, scope: Scope) {
        throw new Error('Method not implemented.');
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

    public visitTypeNode(typeNode: ts.TypeNode) {
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
            default:
                throw new SyntaxNotSupportedError();
        }
    }

    public visitClassDeclaration(classDeclaration: ts.ClassDeclaration, scope: Scope) {
        if (classDeclaration.name === undefined) throw new SyntaxNotSupportedError();
        let className = classDeclaration.name.text;
        
        scope.enter(className);

        let propertyDeclarations: ts.PropertyDeclaration[] = [];
        let methodDeclarations: ts.MethodDeclaration[] = [];
        let constructorDeclarations: ts.ConstructorDeclaration[] = [];
        for (let member of classDeclaration.members) {
            if (ts.isPropertyDeclaration(member)) propertyDeclarations.push(member);
            if (ts.isMethodDeclaration(member)) methodDeclarations.push(member);
            if (ts.isConstructorDeclaration(member)) constructorDeclarations.push(member);
        }

        let propertyTypes: Type[] = [];
        for (let propertyDeclaration of propertyDeclarations) {
            let property = this.visitPropertyDeclaration(propertyDeclaration, scope);
            propertyTypes.push(property.propertyType);
        }

        // Build a struct type with the class name
        this.builder.buildStructType(className);
        // Inser property types into the struct type created above 
        this.builder.insertPropertyType(className, ...propertyTypes);

        for (let constructorDeclaration of constructorDeclarations) {
            this.visitConstructorDeclaration(constructorDeclaration, scope);
        }

        // If no construtors are provided, create a default constructor
        if (constructorDeclarations.length === 0) {
            this.builder.buildConstructor(className, []);
            this.builder.buildReturn();
        }

        // Define all the class methods excluding constructors
        for (let methodDeclaration of methodDeclarations) {
            this.visitMethodDeclaration(methodDeclaration, scope);
        }

        scope.leave();
    }

    public visitPropertyDeclaration(propertyDeclaration: ts.PropertyDeclaration, scope: Scope) {

        if (propertyDeclaration.type === undefined) throw new SyntaxNotSupportedError();
        let propertyName = this.visitPropertyName(propertyDeclaration.name, scope);
        let propertyType = this.visitTypeNode(propertyDeclaration.type);

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
        throw new SyntaxNotSupportedError();
    }

    public visitMethodDeclaration(methodDeclaration: ts.MethodDeclaration, scope: Scope) {

        if (methodDeclaration.type === undefined) throw new SyntaxNotSupportedError();
        let methodName = this.visitPropertyName(methodDeclaration.name, scope);
        let returnType = this.visitTypeNode(methodDeclaration.type);
        let currentScopeName = scope.getCurrentScopeName();
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
            let parameterType = this.visitTypeNode(parameter.type);
            parameterTypes.push(parameterType);
        }

        let fn = this.builder.buildClassMethod(`${currentScopeName}_${methodName}`, returnType, parameterTypes);
        // Use the function name appropriately modified by LLVM
        scope.setDefaultValues(fn.name, defaultValues);
        // Change to a new scope
        scope.enter(methodName, fn);

        let returnValue: Value | undefined;
        if (methodDeclaration.body !== undefined) returnValue = this.visitBlock(methodDeclaration.body, scope);
        this.builder.buildReturn(returnValue);
        this.builder.verifyFunction(fn);

        // Return to the last scope
        scope.leave(fn);
        let currentFunction = scope.getCurrentFunction();
        let currentBlock = currentFunction.getEntryBlock();
        if (!isBasicBlock(currentBlock)) throw new SyntaxNotSupportedError();
        this.builder.setCurrentBlock(currentBlock);
    }

    public visitConstructorDeclaration(constructorDeclaration: ts.ConstructorDeclaration, scope: Scope) {
        
        let currentScopeName = scope.getCurrentScopeName();
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

            if (parameter.type === undefined) throw new SyntaxNotSupportedError();
            let parameterType = this.visitTypeNode(parameter.type);
            parameterTypes.push(parameterType);
        }

        let fn = this.builder.buildConstructor(`${currentScopeName}_Constructor`, parameterTypes);
        // Use the function name appropriately modified by LLVM
        scope.setDefaultValues(fn.name, defaultValues);
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
        
        let loopBlock = this.builder.buildBasicBlock(currentFunction, 'loop');

        this.builder.buildBranch(loopBlock);
        this.builder.setCurrentBlock(loopBlock);

        let phi = this.builder.buildPHINode(values, [entryBlock]);
        let returnValue = this.visitStatement(forStatement.statement, scope);

        let endBlock: BasicBlock | undefined;
        if (returnValue !== undefined) {
            endBlock = this.builder.buildBasicBlock(currentFunction, 'end');
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
            this.builder.setCurrentBlock(endBlock);
            this.builder.buildReturn(returnValue);
        }

        scope.leave();
        // Return back to the previous insertion block before the loop
        this.builder.setCurrentBlock(entryBlock);
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
        } else if (isValue(visited)) {
            return visited;
        } else {
            throw new SyntaxNotSupportedError();
        }
    }
}

