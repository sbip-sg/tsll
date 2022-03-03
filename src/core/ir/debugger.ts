/**
 * The main purpose of Debugger is to wrap the functionality served by LLVM, being a bit abstract.
 * This wrapper will help with maintainability and reliability whenever major changes of LLVM API may
 * cause broken code. In general, it uses DIBuilder to build up debug information metadata and attach the debug
 * info to the target IR instruction.
 */
import llvm, { DIFlags, DILocalScope, DIType, LLVMContext, StructType } from '@lungchen/llvm-node';
import ts from 'typescript';
import { SyntaxNotSupportedError, TypeMismatchError, TypeUndefinedError } from '../../common/error';
import { Builder } from './builder';
import { isBasicBlock } from './types';

export class Debugger {
    private builder: llvm.DIBuilder;
    private file: llvm.DIFile;
    private srcFile: ts.SourceFile;
    private compileUnit: llvm.DICompileUnit;
    private doubleType: llvm.DIBasicType | undefined;
    private booleanType: llvm.DIBasicType | undefined;
    private int32Type: llvm.DIBasicType | undefined;
    private int8Type: llvm.DIBasicType | undefined;
    private typeMap: Map<string, llvm.DIType>; 
    private scopes: llvm.DIScope[];
    private context: LLVMContext;
    private irBuilder: Builder;

    constructor(srcFile: ts.SourceFile, irBuilder: Builder) {
        const module = irBuilder.getModule();
        this.irBuilder = irBuilder;
        this.context = irBuilder.getContext();
        this.builder = new llvm.DIBuilder(module, true);
        this.srcFile = srcFile;
        this.file = this.builder.createFile(`${this.srcFile.fileName}.dbg`, '.');
        // For now, lang number is randomly chosen.
        this.compileUnit = this.builder.createCompileUnit(36, this.file, "tsll", false, "", 0);
        // The root scope is of DICompileUnit.
        this.scopes = [this.compileUnit];
        this.typeMap = new Map();
    }
    
    /**
     * Find the location of a node in Typescript source code
     * @param node 
     * @returns 
     */
    public getLocation(node: ts.Node) {
        const pos = node.getStart(this.srcFile);
        return this.srcFile.getLineAndCharacterOfPosition(pos);
    }

    public buildFunctionDbgInfo(func: llvm.Function, allocas?: llvm.AllocaInst[], declaration?: ts.FunctionLikeDeclaration | ts.MethodSignature) {
        let line = 0;
        let column = 0;
        if (declaration !== undefined) {
            const location = this.getLocation(declaration);
            line = location.line;
            column = location.character;
        }

        const args = func.getArguments();
        const entryBlock = func.getEntryBlock();

        let elements: DIType[] = [];
        for (const arg of args) {
            const diType = this.getDIType(arg.type);
            elements.push(diType);
        }

        // The first element type is function return type;
        const diType = this.getDIReturnType(func.type);
        elements.unshift(diType);

        const metadata = this.builder.getOrCreateTypeArray(elements);
        const subroutineType = this.builder.createSubroutineType(metadata);
        const subprogram = this.builder.createFunction(this.compileUnit, func.name, func.name, this.file, line, subroutineType, line);
        this.scopes.push(subprogram);
        const diLocation = llvm.DILocation.get(subprogram.getContext(), line, column, subprogram);

        let argIdx = 0;
        for (const arg of args) {
            const diType = this.getDIType(arg.type);
            const diLocalVar = this.builder.createParameterVariable(subprogram, arg.name, argIdx, this.file, line, diType);
            const diExpression = this.builder.createExpression();
            if (allocas !== undefined && isBasicBlock(entryBlock)) this.builder.insertDeclare(allocas[argIdx], diLocalVar, diExpression, diLocation, entryBlock);
            argIdx++;
        }

        return subprogram;
    }

    public buildVariableDbgInfo(node: ts.Node, value: llvm.Value, diScope: llvm.DIScope, currentBlock: llvm.BasicBlock) {

        const diExpression = this.builder.createExpression();
        const line = this.getLocation(node).line;
        const column = this.getLocation(node).character;
        const diType = this.getDIType(value.type);
        const diLocalVar = this.builder.createAutoVariable(diScope as llvm.DILocalScope, value.name, this.file, line, diType);
        const diLocation = llvm.DILocation.get(diScope.getContext(), line, column, diScope as llvm.DILocalScope);
        this.builder.insertDeclare(value, diLocalVar, diExpression, diLocation, currentBlock);
    }

    public getCurrentDIScope() {
        return this.scopes[this.scopes.length - 1];
    }

    public leaveCurrentDIScope() {
        // It would be undefined behavior if the compile unit was removed.
        if (this.scopes.length > 2) this.scopes.pop();
    }

    public getDoubleType() {
        if (this.doubleType === undefined) {
            this.doubleType = this.builder.createBasicType("DOUBLE", 64, llvm.dwarf.DW_ATE_float);
        }
        return this.doubleType;
    }

    public getBooleanType() {
        if (this.booleanType === undefined) {
            this.booleanType = this.builder.createBasicType("BOOLEAN", 1, llvm.dwarf.DW_ATE_boolean);
        }
        return this.booleanType;
    }

    public getInt32Type() {
        if (this.int32Type === undefined) {
            this.int32Type = this.builder.createBasicType("INT32", 32, llvm.dwarf.DW_ATE_signed);
        }
        return this.int32Type;
    }

    public getInt8Type() {
        if (this.int8Type === undefined) {
            this.int8Type = this.builder.createBasicType("INT8", 8, llvm.dwarf.DW_ATE_signed_char);
        }
        return this.int8Type;
    }

    public getVoidType() {
        let typeName = 'void';
        let type = this.typeMap.get(typeName);
        if (type === undefined) {
            type = this.builder.createUnspecifiedType(typeName);
            this.typeMap.set(typeName, type);
        }
        return type;
    }

    public getStructType(type: llvm.StructType) {
        if (type.name === undefined) throw new TypeUndefinedError('Type name undefined');
        const structType = this.typeMap.get(type.name);
        if (structType === undefined) return this.getOpaqueType();
        return structType;
    }

    public getOpaqueType() {
        let typeName = 'Opaque';
        let type = this.typeMap.get(typeName);
        if (type === undefined) {
            type = this.builder.createUnspecifiedType(typeName);
            this.typeMap.set(typeName, type);
        }
        return type;
    }

    public getFunctionType() {
        let typeName = 'Function';
        let type = this.typeMap.get(typeName);
        if (type === undefined) {
            type = this.builder.createUnspecifiedType(typeName);
            this.typeMap.set(typeName, type);
        }
        return type;
    }

    public getPointerType() {
        let typeName = 'Pointer';
        let type = this.typeMap.get(typeName);
        if (type === undefined) {
            type = this.builder.createUnspecifiedType(typeName);
            this.typeMap.set(typeName, type);
        }
        return type;
    }

    public buildStructDbgInfo(node: ts.Node, structType: llvm.StructType) {
        const location = this.getLocation(node);

        let derivedFrom: llvm.DIType | undefined;
        let elements: llvm.DIType[] = [];
        let size = 0;
        for (let i = 0; i < structType.numElements; i++) {
            let elementType = structType.getElementType(i);
            size += elementType.getPrimitiveSizeInBits();
            const diType = this.getDIType(elementType);
            elements.push(diType);

            // The first element type could be a pointer type to an inherited struct type.
            if (i === 0
                && (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node))
                && node.heritageClauses !== undefined) {
                    derivedFrom = diType;
            }
        }

        if (derivedFrom === undefined) derivedFrom = this.builder.createUnspecifiedType('no_inheritance');

        const diNodeArray = this.builder.getOrCreateArray(elements);
        const diCompositeType = this.builder.createStructType(
            this.getCurrentDIScope(),
            structType.name || 'Unknown struct type name',
            this.file,
            location.line,
            size, // Not sure if this value is correct
            size, // Not sure if this value is correct
            llvm.DINode.DIFlags.FlagAccessibility,
            derivedFrom,
            diNodeArray
        );

        if (structType.name === undefined) throw new SyntaxNotSupportedError('Name of struct type undefined');
        this.typeMap.set(structType.name, diCompositeType);
        return diCompositeType;
    }

    public getDIReturnType(type: llvm.Type) {
        if (type.isFunctionTy()) type = type.returnType;
        return this.getDIType(type);
    }

    public getDIType(type: llvm.Type) {
        if (type.isPointerTy()) return this.getPointerType();
        if (type.isDoubleTy()) return this.getDoubleType();
        if (type.isIntegerTy(8)) return this.getInt8Type();
        if (type.isStructTy()) return this.getStructType(type);
        if (type.isVoidTy()) return this.getVoidType();
        if (type.isIntegerTy(1)) return this.getBooleanType();
        if (type.isArrayTy()) return this.getOpaqueType();
        if (type.isFunctionTy()) return this.getFunctionType();
        return this.getOpaqueType();
    }

    public finalizeDI() {
        this.builder.finalize();
    }

    public finalizeSubprogram(subprogram: llvm.DISubprogram) {
        this.builder.finalizeSubprogram(subprogram);
    }
}