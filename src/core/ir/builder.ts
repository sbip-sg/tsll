import llvm from 'llvm-node';
import { DuplicateError, FunctionUndefinedError, SyntaxNotSupportedError, TypeUndefinedError, VariableUndefinedError } from "../../common/error";
import { Type, Value, BasicBlock, isConstant } from "./types";

export class Builder {

    private llvmContext: llvm.LLVMContext;
    private llvmModule: llvm.Module;
    private llvmBuilder: llvm.IRBuilder;

    constructor(moduleId: string) {
        this.llvmContext = new llvm.LLVMContext();
        this.llvmModule = new llvm.Module(moduleId, this.llvmContext);
        this.llvmBuilder = new llvm.IRBuilder(this.llvmContext);
    }

    public buildGlobalVariable(val: Value, name?: string) {
        if (!isConstant(val)) throw new SyntaxNotSupportedError();
        let globalVar = new llvm.GlobalVariable(this.llvmModule, val.type, false, llvm.LinkageTypes.ExternalLinkage, val, name);
        return globalVar;
    }

    public buildAlloca(type: Type, name?: string) {
        return this.llvmBuilder.createAlloca(type, undefined, name);
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
        return llvm.ConstantDataArray.getString(this.llvmContext, str);
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

    public buildStringType(): Type {
        return llvm.ArrayType.get(llvm.Type.getInt8Ty(this.llvmContext), 2);
    }

    public buildFunctionCall(name: string, parameters: Value[], defaultValues: Map<string, Value>) {
        let fn = this.llvmModule.getFunction(name);

        if (fn === undefined) throw new FunctionUndefinedError();

        // The following checks if parameter types match argument types as defined for a function
        let args = fn.getArguments();
        let anyType = this.buildAnyType();
        for (let i = 0; i < args.length; i++) {
            if (i >= parameters.length) {
                let defaultValue = defaultValues.get(args[i].name);
                if (defaultValue === undefined) throw new FunctionUndefinedError();
                parameters.push(defaultValue);
                continue;
            }
            if (!args[i].type.equals(parameters[i].type) && !args[i].type.equals(anyType)) throw new FunctionUndefinedError();
        }

        

        return this.llvmBuilder.createCall(fn.type.elementType, fn, parameters);
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

        return fn;
    }

    public verifyFunction(fn: llvm.Function) {
        llvm.verifyFunction(fn);
    }

    public verifyModule() {
        llvm.verifyModule(this.llvmModule);
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

    public buildBasicBlock(parent: llvm.Function, name?: string) {
        if (name === undefined) {
            return llvm.BasicBlock.create(this.llvmContext, '', parent);
        } else {
            return llvm.BasicBlock.create(this.llvmContext, name, parent);
        }
    }

    public setCurrentBlock(basicBlock: BasicBlock) {
        this.llvmBuilder.setInsertionPoint(basicBlock);
    }

    public getCurrentBlock() {
        return this.llvmBuilder.getInsertBlock();
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
        if (this.llvmModule.getTypeByName(name) !== null) throw new DuplicateError();
        return llvm.StructType.create(this.llvmContext, name);
    }

    public insertPropertyType(name: string, ...types: Type[]) {
        let structType = this.llvmModule.getTypeByName(name);
        if (structType === null) throw new TypeUndefinedError();
        structType.setBody(types);
    }

    public getStructType(name: string) {
        let structType = this.llvmModule.getTypeByName(name);
        if (structType === null) throw new TypeUndefinedError();
        return structType;
    }

    public buildConstructor(name: string, paramTypes: Type[]) {
        let structType = this.llvmModule.getTypeByName(name);
        if (structType === null) throw new SyntaxNotSupportedError();
        let ptrType = llvm.PointerType.get(structType, 0);
        paramTypes.unshift(ptrType);
        let functionType = llvm.FunctionType.get(structType, paramTypes, true);
        let fn = llvm.Function.create(functionType, llvm.LinkageTypes.ExternalLinkage, name, this.llvmModule);

        let functionBlock = this.buildBasicBlock(fn);
        this.setCurrentBlock(functionBlock);

        fn.getArguments()[0].name = 'this';

        return fn;
    }

    public buildClassMethod(name: string, returnType: Type, paramTypes: Type[]) {
        let structType = this.llvmModule.getTypeByName(name);
        if (structType === null) throw new SyntaxNotSupportedError();
        let ptrType = llvm.PointerType.get(structType, 0);
        paramTypes.unshift(ptrType);
        let methodType = llvm.FunctionType.get(returnType, paramTypes, true);
        let method = llvm.Function.create(methodType, llvm.LinkageTypes.ExternalLinkage, name, this.llvmModule);

        let methodBlock = this.buildBasicBlock(method);
        this.setCurrentBlock(methodBlock);

        method.getArguments()[0].name = 'this';

        return method;
    }

    public buildAccessPtr(ptr: Value, ...values: Value[]) {
        return this.llvmBuilder.createInBoundsGEP(ptr, values);
    }

    public buildInteger(num: number, numBits: number) {
        return llvm.ConstantInt.get(this.llvmContext, num, numBits);
    }

    public buildArrayType(type: Type, size: number) {
        let arrayType = llvm.ArrayType.get(type, size);
        return arrayType;
    }

    public buildUndefined() {
        return llvm.UndefValue.get(llvm.Type.getInt1Ty(this.llvmContext));
    }

    public buildBooleanType() {
        return llvm.Type.getInt1Ty(this.llvmContext);
    }

    public buildAnyType() {
        return llvm.StructType.create(this.llvmContext);
    }

    public buildAny() {
        return llvm.ConstantStruct.get(llvm.StructType.create(this.llvmContext), []);
    }

    public printIR() {
        console.log(this.llvmModule.print());
    }

    public toBitcodeFile(filename: string) {
        llvm.writeBitcodeToFile(this.llvmModule, filename);
    }
}
