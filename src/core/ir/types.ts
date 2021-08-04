import { Value, AllocaInst, ConstantFP, GlobalVariable, Type, Function, BasicBlock, CallInst } from "llvm-node";

// Re-export these classes
export { Value, AllocaInst, ConstantFP, GlobalVariable, Type, Function, BasicBlock };

export function isValue(val: any): val is Value {
    return val instanceof Value;
}

export function isType(val: any): val is Type {
    return val instanceof Type;
}

export function isCallInst(val: any): val is CallInst {
    return val instanceof CallInst;
}

export function isAllocaInst(val: any): val is AllocaInst {
    return val instanceof AllocaInst;
}

export function isGlobalVariable(val: Value): val is GlobalVariable {
    return val instanceof GlobalVariable;
}

export function isConstantFP(val: Value): val is ConstantFP {
    return val instanceof ConstantFP;
}

export function isBasicBlock(val: any): val is BasicBlock {
    return val instanceof BasicBlock;
}