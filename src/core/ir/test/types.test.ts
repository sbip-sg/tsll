import llvm from "@lungchen/llvm-node";
import { isAllocaInst, isBasicBlock, isCallInst, isConstant, isConstantFP, isGlobalVariable, isType, isValue } from "../types";

describe('Type assertion', () => {

    let context: llvm.LLVMContext;
    let builder: llvm.IRBuilder;
    let module: llvm.Module;
    
    beforeAll(() => {
        context = new llvm.LLVMContext();
        builder = new llvm.IRBuilder(context);
        module = new llvm.Module('test', context);
    });

    it('should be true for Value', () => {
        let boolValue = llvm.ConstantInt.getTrue(context);
        expect(isValue(boolValue)).toBeTruthy();
        expect(boolValue).toBeInstanceOf(llvm.Value);
    });

    it('should be true for Type', () => {
        let type = llvm.Type.getDoubleTy(context);
        expect(isType(type)).toBeTruthy();
        expect(type).toBeInstanceOf(llvm.Type);
    });

    it('should be true for BasicBlock', () => {
        let bb = llvm.BasicBlock.create(context);
        expect(isBasicBlock(bb)).toBeTruthy();
        expect(bb).toBeInstanceOf(llvm.BasicBlock);
    });

    it('should be true for GlobalVariable', () => {
        let gv = new llvm.GlobalVariable(module, llvm.Type.getInt32Ty(context), true, llvm.LinkageTypes.ExternalLinkage);
        expect(isGlobalVariable(gv)).toBeTruthy();
        expect(gv).toBeInstanceOf(llvm.GlobalVariable);
    });

    it('should be true for AllocaInst', () => {
        let allocaInst = undefined;
        expect(isAllocaInst(allocaInst)).toBeFalsy()
    })

    it('should be true for ConstantFP', () => {
        let constant = llvm.ConstantFP.get(context, 66);
        expect(isConstantFP(constant)).toBeTruthy();
        expect(constant).toBeInstanceOf(llvm.ConstantFP);
    });

    it('should be true for Constant', () => {
        let constant = llvm.ConstantInt.getFalse(context);
        expect(isConstant(constant)).toBeTruthy();
        expect(constant).toBeInstanceOf(llvm.Constant);
    })

    it('should be true for CallInst', () => {
        builder = new llvm.IRBuilder(context);
        let fnType = llvm.FunctionType.get(llvm.Type.getVoidTy(context), false);
        let fn = llvm.Function.create(fnType, llvm.LinkageTypes.ExternalLinkage);
        let callInst = builder.createCall(fnType, fn, []);
        expect(isCallInst(callInst)).toBeTruthy();
        expect(callInst).toBeInstanceOf(llvm.CallInst);
    });
});