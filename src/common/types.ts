import { Type, Value } from "llvm-node";
import ts from "typescript";

export function isString(val: any): val is string {
    return typeof val === 'string';
}

export function isStringArray(val: any): val is Array<string> {
    return val instanceof Array && val.every(elem => typeof elem === 'string');
}

export function isBreak(val: any): val is Break {
    return val instanceof Break;
}

export function isContinue(val: any): val is Continue {
    return val instanceof Continue;
}

export type FunctionLikeDeclaration = ts.FunctionDeclaration | ts.FunctionExpression | ts.MethodDeclaration;

export type Unallocated = {
};

export type Property = {
    propertyName: string;
    propertyType: Type;
    propertyValue?: Value;
}

export class Break {

}
export class Continue {

}