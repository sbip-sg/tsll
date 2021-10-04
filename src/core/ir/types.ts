import { Value, AllocaInst, ConstantFP, GlobalVariable, Type, Function, BasicBlock, CallInst, Constant, ConstantInt } from "@lungchen/llvm-node";

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

export function isFunction(val: any): val is Function {
    return val instanceof Function;
}

export function isGlobalVariable(val: any): val is GlobalVariable {
    return val instanceof GlobalVariable;
}

export function isConstantFP(val: any): val is ConstantFP {
    return val instanceof ConstantFP;
}

export function isConstant(val: any): val is Constant {
    return val instanceof Constant;
}

export function isConstantInt(val: any): val is ConstantInt {
    return val instanceof ConstantInt;
}

export function isBasicBlock(val: any): val is BasicBlock {
    return val instanceof BasicBlock;
}