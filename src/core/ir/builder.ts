/**
 * The main purpose of Builder is to wrap the functionality served by LLVM, being a bit abstract.
 * This wrapper will help with maintainability and reliability whenever major changes of LLVM API may
 * cause broken code. In general, it uses IRBuilder and other utility functions
 * to build up IR instructions.
 */
import llvm, { CallInst, ConstantInt, PointerType, StructType } from '@lungchen/llvm-node';
import { FunctionUndefinedError, SyntaxNotSupportedError, TypeUndefinedError } from "../../common/error";
import { Generics } from '../ast/generics';
import { Type, Value, BasicBlock, isConstant } from "./types";

export class Builder {

    private llvmContext: llvm.LLVMContext;
    private llvmModule: llvm.Module;
    private llvmBuilder: llvm.IRBuilder;
    private loopEndBlock: llvm.BasicBlock | undefined;
    private loopNextBlock: llvm.BasicBlock | undefined;
    private lastStructType: llvm.StructType | undefined;
    private structMap: Map<string, llvm.StructType>;
    private typeMap: Map<string, llvm.Type>;
    private functionMap: Map<string, llvm.Function>;
    private structElementNamesMap: Map<string, Array<string>>;
    private namedFunctionMap: Map<string, Set<llvm.Function>>;
    private inheritanceMap: Map<string, llvm.StructType>;

    constructor(moduleId: string) {
        this.llvmContext = new llvm.LLVMContext();
        this.llvmModule = new llvm.Module(moduleId, this.llvmContext);
        this.llvmBuilder = new llvm.IRBuilder(this.llvmContext);
        this.structMap = new Map();
        this.structElementNamesMap = new Map();
        this.typeMap = new Map();
        this.functionMap = new Map();
        this.namedFunctionMap = new Map();
        this.inheritanceMap = new Map();
    }

    public getModule() {
        return this.llvmModule;
    }

    public getContext() {
        return this.llvmContext;
    }

    public buildGlobalVariable(val: Value, name?: string) {
        if (!isConstant(val)) throw new SyntaxNotSupportedError();
        let globalVar = new llvm.GlobalVariable(this.llvmModule, val.type, false, llvm.LinkageTypes.ExternalLinkage, val, name);
        return globalVar;
    }

    public buildAlloca(type: Type, size: number = 1, name?: string) {
        let sizeValue = this.buildInteger(size, 32);
        return this.llvmBuilder.createAlloca(type, sizeValue, name);
    }

    public buildStore(val: Value, alloca: Value) {
        return this.llvmBuilder.createStore(val, alloca);
    }

    public buildLoad(alloca: Value, name?: string) {
        return this.llvmBuilder.createLoad(alloca, name);
    }

    public buildNumber(num: number) {
        return llvm.ConstantFP.get(this.llvmContext, num);
    }

    public buildString(str: string) {
        return this.llvmBuilder.createGlobalStringPtr(str);
    }

    public buildNot(val: Value, name?: string) {
        return this.llvmBuilder.createNot(val, name);
    }

    public buildAnd(lhs: Value, rhs: Value, name?: string) {
        return this.llvmBuilder.createAnd(lhs, rhs, name);
    }

    public buildOr(lhs: Value, rhs: Value, name?: string) {
        return this.llvmBuilder.createOr(lhs, rhs, name);
    }

    public buildXor(lhs: Value, rhs: Value, name?: string) {
        return this.llvmBuilder.createXor(lhs, rhs, name);
    }

    public buildBoolean(trueOrFalse: boolean) {
        if (trueOrFalse) {
            return llvm.ConstantInt.getTrue(this.llvmContext);
        } else {
            return llvm.ConstantInt.getFalse(this.llvmContext);
        }
    }

    public buildReturn(val?: Value): Value {
        if (val === undefined) return this.llvmBuilder.createRetVoid();
        return this.llvmBuilder.createRet(val);
    }

    public buildVoidType(): Type {
        return llvm.Type.getVoidTy(this.llvmContext);
    }

    public buildNumberType(): Type {
        return llvm.Type.getDoubleTy(this.llvmContext);
    }

    public buildInt32Type(): Type {
        return llvm.Type.getInt32Ty(this.llvmContext);
    }

    public buildStringType(size: number): Type {
        return llvm.Type.getInt8PtrTy(this.llvmContext);
    }

    public buildOpaquePtrType(): PointerType {
        return llvm.PointerType.get(this.llvmContext, 0);
    }

    public buildOpaqueType(): StructType {
        return llvm.StructType.get(this.llvmContext, []);
    }

    public setFunction(name: string, func: llvm.Function) {
        this.functionMap.set(name, func);
    }

    public hasFunction(name: string) {
        return this.getFunction(name) !== undefined || this.functionMap.has(name);
    }

    public getIntrinsic(name: string) {
        // Make sure the name starts with the correct intrinsic prefix
        if (!name.startsWith('llvm.')) return undefined;
        const intrinsicId = llvm.Function.lookupIntrinsicID(name);
        if (intrinsicId === 0) return undefined;
        return llvm.Intrinsic.getDeclaration(this.llvmModule, intrinsicId);
    }

    public buildFunctionCall(name: string, parameters: Value[], defaultValues?: Map<string, Value>) {
        let fn = this.getFunction(name);
        let intrinsicFn = this.getIntrinsic(name);
        if (fn === undefined) fn = intrinsicFn;
        if (fn === undefined) throw new FunctionUndefinedError();

        // The following checks if parameter types match argument types as defined for a function
        let args = fn.getArguments();
        // let anyType = this.buildAnyType();
        for (let i = 1; defaultValues !== undefined && i < args.length; i++) {
            if (i >= parameters.length) {
                let defaultValue = defaultValues.get(args[i].name);
                if (defaultValue === undefined) throw new FunctionUndefinedError();
                parameters.push(defaultValue);
                continue;
            }
            // if (!args[i].type.equals(parameters[i].type) && !args[i].type.equals(anyType)) throw new FunctionUndefinedError();
        }

        return this.llvmBuilder.createCall(fn.type.elementType, fn, parameters);
    }

    public buildFunctionType(returnType: Type, argTypes: Type[]) {
        const fnType = llvm.FunctionType.get(returnType, argTypes, false);
        return fnType;
    }

    public buildFunction(name: string, returnType: Type, argTypes: Type[], argNames: string[]) {
        let fnType = llvm.FunctionType.get(returnType, argTypes, true);
        let fn = llvm.Function.create(fnType, llvm.LinkageTypes.ExternalLinkage, name, this.llvmModule);

        let entryBlock = llvm.BasicBlock.create(this.llvmContext, '', fn);

        this.llvmBuilder.setInsertionPoint(entryBlock);

        let i = 0
        for (let arg of fn.getArguments()) {
            arg.name = argNames[i];
            ++i;
        }

        this.addNamedFunction(name, fn);

        return fn;
    }

    public buildVirtualFunctionPtr(returnType: Type, argTypes: Type[]) {
        let fnType = llvm.FunctionType.get(returnType, argTypes, true);
        return llvm.PointerType.get(fnType, 0);
    }

    public verifyFunction(fn: llvm.Function) {
        // llvm.verifyFunction(fn);
    }

    public verifyModule() {
        // llvm.verifyModule(this.llvmModule);
    }

    public buildIntAdd(lhs: Value, rhs: Value, name?: string) {
        return this.llvmBuilder.createAdd(lhs, rhs, name);
    }

    public buildAdd(lhs: Value, rhs: Value, name?: string) {
        return this.llvmBuilder.createFAdd(lhs, rhs, name);
    }

    public buildSub(lhs: Value, rhs: Value, name?: string) {
        return this.llvmBuilder.createFSub(lhs, rhs, name);
    }

    public buildMul(lhs: Value, rhs: Value, name?: string) {
        return this.llvmBuilder.createFMul(lhs, rhs, name);
    }

    public buildDiv(lhs: Value, rhs: Value, name?: string) {
        return this.llvmBuilder.createFDiv(lhs, rhs, name);
    }

    public buildNotEqualTo(lhs: Value, rhs: Value) {
        return this.llvmBuilder.createFCmpONE(lhs, rhs);
    }

    public buildEqualTo(lhs: Value, rhs: Value) {
        return this.llvmBuilder.createFCmpOEQ(lhs, rhs);
    }

    public buildLessThan(lhs: Value, rhs: Value) {
        return this.llvmBuilder.createFCmpOLT(lhs, rhs);
    }

    public buildGreaterThen(lhs: Value, rhs: Value) {
        return this.llvmBuilder.createFCmpOGT(lhs, rhs);
    }

    public buildLessThanEqualTo(lhs: Value, rhs: Value) {
        return this.llvmBuilder.createFCmpOLE(lhs, rhs);
    }

    public buildGreaterThanEqualTo(lhs: Value, rhs: Value) {
        return this.llvmBuilder.createFCmpOGE(lhs, rhs);
    }

    public buildBasicBlock(parent?: llvm.Function, name?: string) {
        return llvm.BasicBlock.create(this.llvmContext, name, parent);
    }

    public buildSwitch(onVal: Value, defaultDest: BasicBlock, caseValues?: ConstantInt[], caseDests?: BasicBlock[]) {
        const numCases = caseValues?.length || 0;
        const switchInst = this.llvmBuilder.createSwitch(onVal, defaultDest, numCases);
        if (caseValues === undefined || caseDests === undefined) return;
        for (let i = 0; i < numCases; i++) {
            switchInst.addCase(caseValues[i], caseDests[i]);
        }
    }

    public setCurrentBlock(basicBlock: BasicBlock) {
        this.llvmBuilder.setInsertionPoint(basicBlock);
    }

    public getCurrentBlock() {
        let block = this.llvmBuilder.getInsertBlock();
        if (block === undefined) throw new SyntaxNotSupportedError();
        return block;
    }

    public setLoopEndBlock(block: BasicBlock) {
        this.loopEndBlock = block;
    }

    public setLoopNextBlock(block: BasicBlock) {
        this.loopNextBlock = block;
    }

    public getLoopEndBlock() {
        if (this.loopEndBlock === undefined) throw new SyntaxNotSupportedError();
        return this.loopEndBlock;
    }

    public getLoopNextBlock() {
        if (this.loopNextBlock === undefined) throw new SyntaxNotSupportedError();
        return this.loopNextBlock;
    }

    public buildConditionBranch(ifCondition: Value, thenBasicBlock: BasicBlock, elseBasicBlock: BasicBlock) {
        return this.llvmBuilder.createCondBr(ifCondition, thenBasicBlock, elseBasicBlock);
    }

    public buildBranch(basicBlock: BasicBlock) {
        return this.llvmBuilder.createBr(basicBlock);
    }

    public buildPHINode(values: Value[], basicBlocks: BasicBlock[]) {
        if (values.length !== basicBlocks.length) throw new SyntaxNotSupportedError();
        let phi = this.llvmBuilder.createPhi(values[0].type, basicBlocks.length);
        for (let i = 0; i < basicBlocks.length; i++) {
            phi.addIncoming(values[i], basicBlocks[i]);
        }
        return phi;
    }

    public buildStructType(name: string) {
        let structType = this.llvmModule.getTypeByName(name);
        if (structType !== null) {
            // For future reference
            this.lastStructType = structType;
        } else {
            this.lastStructType = llvm.StructType.create(this.llvmContext, name);
        }

        return this.lastStructType;
    }

    public buildPointerType(type: Type) {
        return llvm.PointerType.get(type, 0);
    }

    public insertPropertyType(name: string, ...types: Type[]) {
        let structType = this.llvmModule.getTypeByName(name);
        if (structType === null) throw new TypeUndefinedError();
        structType.setBody(types);
        this.lastStructType = structType;
    }

    public insertProperty(structType: StructType, types: Type[], names: string[]) {
        structType.setBody(types);
        
        for (const name of names) {
            this.structMap.set(`${structType.name}_${name}`, structType);
            this.structElementNamesMap.set(`${structType.name}_${name}`, names);
        }

        this.structElementNamesMap.set(structType.name as string, names);
        this.lastStructType = structType;
    }

    public setProperty(structType: llvm.StructType, types: Type[], names: string[]) {
        structType.setBody(types);
        this.lastStructType = structType;
    }

    public getStructType(name: string, types?: Type[]) {
        const structType = this.llvmModule.getTypeByName(name);
        if (structType !== null) return structType;
        throw new TypeUndefinedError();
    }

    public hasStructType(name: string) {
        const structType = this.llvmModule.getTypeByName(name);
        if (structType !== null) return true;
        return false;
    }

    public getLastStructType() {
        if (this.lastStructType === undefined) throw new TypeUndefinedError();
        return this.lastStructType;
    }

    public setType(name: string, type: llvm.Type) {
        this.typeMap.set(name, type);
    }

    /**
     * Retrieve a Type among all the types declared/defined including StructType
     * @param name 
     * @returns 
     */
    public getType(name: string) {
        try {
            return this.getStructType(name);
        } catch (err) {
            const type = this.typeMap.get(name);
            if (type === undefined) throw new TypeUndefinedError();
            return type;
        }
    }

    public getElementNamesInStruct(structType: StructType) {
        if (structType.name === undefined) throw new SyntaxNotSupportedError();
        const names = this.structElementNamesMap.get(structType.name);
        if (names === undefined) throw new TypeUndefinedError();
        return names;
    }

    public findIndexInStruct(structType: StructType, elementName: string) {
        if (structType.name === undefined) structType = this.structMap.get(`Object_${elementName}`) as StructType;
        if (structType.name === undefined) return -1;
        const indices = this.structElementNamesMap.get(structType.name);
        if (indices === undefined) return -1;
        return indices.indexOf(elementName);
    }

    public buildConstructor(name: string, paramTypes: Type[], paramNames: string[]) {
        let functionType = llvm.FunctionType.get(this.buildVoidType(), paramTypes, true);
        let fn = llvm.Function.create(functionType, llvm.LinkageTypes.ExternalLinkage, name, this.llvmModule);

        let functionBlock = this.buildBasicBlock(fn);
        this.setCurrentBlock(functionBlock);

        const args = fn.getArguments();

        for (let i = 0; i < paramNames.length; i++) {
            args[i].name = paramNames[i];
        }

        this.addNamedFunction(name, fn);

        return fn;
    }

    public buildFunctionDeclaration(name: string, returnType: Type, paramTypes: Type[], paramNames: string[]) {
        const methodType = llvm.FunctionType.get(returnType, paramTypes, true);
        const fn = llvm.Function.create(methodType, llvm.LinkageTypes.ExternalLinkage, name, this.llvmModule);
        const args = fn.getArguments();

        for (let i = 0; i < paramNames.length; i++) {
            args[i].name = paramNames[i];
        }

        this.addNamedFunction(name, fn);

        return fn;
    }

    public buildClassMethod(name: string, returnType: Type, paramTypes: Type[], paramNames: string[]) {
        let methodType = llvm.FunctionType.get(returnType, paramTypes, true);
        let method = llvm.Function.create(methodType, llvm.LinkageTypes.ExternalLinkage, name, this.llvmModule);

        let methodBlock = this.buildBasicBlock(method);
        this.setCurrentBlock(methodBlock);

        const args = method.getArguments();
        let i = 0;
        do {
            args[i].name = paramNames[i];
            ++i;
        } while (i < paramNames.length);

        this.addNamedFunction(name, method);

        return method;
    }

    public buildBitcast(fromValue: Value, toType: Type) {
        return this.llvmBuilder.createBitCast(fromValue, toType);
    }

    public buildAccessPtr(ptr: Value, ...values: Value[]) {
        return this.llvmBuilder.createInBoundsGEP(ptr, values);
    }

    public buildInsertValue(ptr: Value, value: Value, ...indices: number[]) {
        return this.llvmBuilder.createInsertValue(ptr, value, indices);
    }

    public buildIntCast(value: Value, numBits: number) {
        return this.llvmBuilder.createIntCast(value, llvm.Type.getIntNTy(this.llvmContext, numBits), true);
    }

    public buildInteger(num: number, numBits: number) {
        return llvm.ConstantInt.get(this.llvmContext, num, numBits);
    }

    public buildArrayType(type: Type, size: number) {
        if (type.isStructTy()) type = type;
        // Build an array type with the element type
        const arrayTypeName = `Array`;
        if (this.hasStructType(arrayTypeName)) {
            return this.getStructType(arrayTypeName);
        }

        const types = [this.buildNumberType(), llvm.ArrayType.get(type, size)];
        const names = ['length', 'elements'];
        const arrayType = this.buildStructType(arrayTypeName);
        this.insertProperty(arrayType, types, names);
        return arrayType;
    }

    public buildUndefined() {
        return llvm.UndefValue.get(llvm.Type.getInt1Ty(this.llvmContext));
    }

    public buildBooleanType() {
        return llvm.Type.getInt1Ty(this.llvmContext);
    }

    public buildAnyType() {
        const voidType = llvm.Type.getVoidTy(this.llvmContext);
        return llvm.PointerType.get(voidType, 0);
    }

    public buildAny() {
        return llvm.ConstantStruct.get(llvm.StructType.create(this.llvmContext), []);
    }

    public buildLandingPad(type: llvm.Type) {
        const ptrType = this.buildPointerType(type);
        return this.llvmBuilder.createLandingPad(ptrType, 1);
    }

    public buildIntType(numBits: number) {
        return llvm.Type.getIntNTy(this.llvmContext, numBits);
    }

    public buildInvoke(calleeType: llvm.FunctionType, callee: llvm.Value, args: llvm.Value[], normalDest: llvm.BasicBlock, unwindDest: llvm.BasicBlock) {
        return this.llvmBuilder.createInvoke(calleeType, callee, normalDest, unwindDest, args);
    }

    public buildResume(value: llvm.Value) {
        return this.llvmBuilder.createResume(value);
    }

    public buildInt8PtrType() {
        return llvm.Type.getInt8PtrTy(this.llvmContext);
    }

    public buildNullPtr() {
        return llvm.ConstantPointerNull.get(llvm.Type.getInt8PtrTy(this.llvmContext));
    }

    public getFunction(name: string) {
        // const namedFucntionSet = this.namedFunctionMap.get(name);
        // if (namedFucntionSet === undefined) return undefined;
        // for (const namedFunction of namedFucntionSet) {
        //     const parameters = namedFunction.getArguments();
        //     const numParameters = parameters.length;
        //     // for (let i = 0; i < numParameters; i++) {
        //     //     const strA = parameters[i].type.toString();
        //     //     const strB = paramTypes[i].
        //     //     if (strA !== strB && strA !== 'void**') break;
        //     // }
        //     return namedFunction;
        // }
        return this.llvmModule.getFunction(name) || this.functionMap.get(name);
    }

    public convertIntegerToNumber(value: Value) {
        return this.llvmBuilder.createSIToFP(value, llvm.Type.getDoubleTy(this.llvmContext));
    }

    public convertNumberToInteger(value: Value) {
        return this.llvmBuilder.createFPToSI(value, llvm.Type.getInt32Ty(this.llvmContext));
    }

    public printIR() {
        console.log(this.llvmModule.print());
    }

    public toBitcodeFile(filename: string) {
        llvm.writeBitcodeToFile(this.llvmModule, filename);
    }

    public resolveTypeName(type: llvm.Type) {
        let typeName;
        if (type.isStructTy()) {
            typeName = type.name;
        } else {
            typeName = type.toString();
        }

        if (typeName === undefined) typeName = type.toString();

        return typeName;
    }

    public setCurrentDebugLocation(dl: llvm.DILocation) {
        this.llvmBuilder.setCurrentDebugLocation(dl);
    }

    public generateStructName(names: string[]) {
        let structName = '';
        for (let i = 0; i < names.length; i++) {
            structName += names[i];
            if (i < names.length - 1) structName += '_';
        }
        return structName;
    }

    public generateFunctionName(name: string, paramTypes: llvm.Type[]) {
        let functionName = name;
        for (const paramType of paramTypes) {
            functionName += '_' + this.resolveTypeName(paramType);
        }
        return functionName;
    }

    private addNamedFunction(name: string, fn: llvm.Function) {
        if (!this.namedFunctionMap.has(name)) this.namedFunctionMap.set(name, new Set());
        const functionSet = this.namedFunctionMap.get(name);
        if (functionSet !== undefined) functionSet.add(fn);
    }

    public buildInheritance(subType: llvm.StructType, superType: llvm.StructType) {
        if (subType.name !== undefined) this.inheritanceMap.set(subType.name, superType);
    }

    public getInheritedType(subType: llvm.StructType) {
        return subType.name !== undefined ? this.inheritanceMap.get(subType.name) : undefined;
    }
}
