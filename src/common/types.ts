import { Type, Value } from "llvm-node";
import ts from "typescript";

export function isString(val: any): val is string {
    return typeof val === 'string';
}

export type FunctionLikeDeclaration = ts.FunctionDeclaration | ts.FunctionExpression | ts.MethodDeclaration;

export type Unallocated = {
};

export type Property = {
    propertyName: string;
    propertyType: Type;
    propertyValue?: Value;
}