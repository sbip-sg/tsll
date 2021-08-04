import ts from "typescript";

export function isString(val: any): val is string{
    return typeof val === 'string';
}

export type FunctionLikeDeclaration = ts.FunctionDeclaration | ts.FunctionExpression | ts.MethodDeclaration;