export class InstantiateError extends Error {
    constructor(message?: string) {
        super(`Error instantiating class; ${message}`);
    }
}

export class FunctionUndefinedError extends Error {
    constructor(message?: string) {
        super(`Function undefined; ${message}`);
    }
}

export class VariableUndefinedError extends Error {
    constructor(message?: string) {
        super(`Variable undefined; ${message}`);
    }
}

export class SyntaxNotSupportedError extends Error {
    constructor(message?: string) {
        super(`Syntax not supported: ${message}`);
    }
}