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
        super(`Syntax not supported; ${message}`);
    }
}

export class DuplicateError extends Error {
    constructor(message?: string) {
        super(`Duplicate definition; ${message}`);
    }
}

export class TypeUndefinedError extends Error {
    constructor(message?: string) {
        super(`Type undefined; ${message}`);
    }
}

export class TypeMismatchError extends Error {
    constructor(message?: string) {
        super(`Type undefined; ${message}`);
    }
}