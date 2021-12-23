import { FunctionUndefinedError, SyntaxNotSupportedError, TypeUndefinedError, VariableUndefinedError } from "./error";
import { Value, Function, Type } from "../core/ir/types";
import ts from "typescript";

export class Scope {
    private scopeNameArray: string[];
    private functionArray: Function[];
    private nameTable: Map<string, Value>;
    private tableArray: Map<string, Value>[];
    private defaultMap: Map<string, Map<string, Value>>;
    private structMap: Map<string, Array<string>>;
    private nextType: Type | undefined;
    private program: ts.Program | undefined;
    private baseClassName: string | undefined;

    constructor(program?: ts.Program) {
        this.program = program;
        this.scopeNameArray = [];
        this.functionArray = [];
        this.tableArray = [new Map()];
        this.nameTable = this.tableArray[this.tableArray.length - 1];
        this.defaultMap = new Map();
        this.structMap = new Map();
    }
    /**
     * Return a function related to the current scope
     */
    public getCurrentFunction() {
        return this.functionArray[this.functionArray.length - 1];
    }
    /**
     * Set a key-value pair of name and value
     */
    public set(name: string, val: Value) {
        this.nameTable.set(name, val);
    }
    /**
     * Get a pair according to the given name if found. Otherwise, it throws an error
     */
    public get(name: string) {
        if (this.nameTable.has(name)) {
            return this.nameTable.get(name) as Value;
        } else {
            throw new VariableUndefinedError();
        }
    }
    /**
     * Check the existence of a name
     */
    public has(name: string) {
        return this.nameTable.has(name);
    }
    /**
     * Enter a new scope with all the names of the upper level
     */
    public enter(scopeName: string, enteredFunction?: Function) {
        // Clone all the entries from the existing nameTable
        let newTable = new Map();
        for (let [name, value] of this.nameTable.entries()) {
            newTable.set(name, value);
        }
        this.scopeNameArray.push(scopeName);
        this.tableArray.push(newTable);
        this.nameTable = this.tableArray[this.tableArray.length - 1];
        if (enteredFunction !== undefined) this.functionArray.push(enteredFunction);
    }
    /**
     * Leave the current scope if not at the top-level
     */
    public leave(leavedFunction?: Function) {
        if (this.tableArray.length === 1) return;
        this.scopeNameArray.pop();
        this.tableArray.pop();
        this.nameTable = this.tableArray[this.tableArray.length - 1];
        if (leavedFunction !== undefined) this.functionArray.pop();
    }
    /**
     * Return a scope name provided on entering the scope
     */
    public getCurrentScopeName() {
        return this.scopeNameArray[this.scopeNameArray.length - 1];
    }
    public setDefaultValues(name: string, defaultValues: Map<string, Value>) {
        this.defaultMap.set(name, defaultValues);
    }
    public getDefaultValues(name: string) {
        let defaultValues = this.defaultMap.get(name);
        if (defaultValues === undefined) throw new FunctionUndefinedError();
        return defaultValues;
    }
    /**
     * Return whether the current scope is of the whole module if not at a function or class level
     */
    public isModuleScope() {
        return this.tableArray.length === 1;
    }

    public getNextType() {
        if (this.nextType === undefined) throw new SyntaxNotSupportedError();
        return this.nextType;
    }
    public setNextType(type: Type) {
        this.nextType = type;
    }

    /**
     * Access declarations from the type checker of this program
     */
    public getDeclaration(node: ts.Node) {
        if (this.program !== undefined) {
            const typeChecker = this.program.getTypeChecker();
            let symbol = typeChecker.getSymbolAtLocation(node);
            // Get the original symbol with the alias if the members of the alias do not exist
            let aliasedSymbol: ts.Symbol | undefined;
            if (symbol !== undefined && symbol.members === undefined && symbol.valueDeclaration === undefined) {
                aliasedSymbol = typeChecker.getAliasedSymbol(symbol);
            }
            if (aliasedSymbol !== undefined) symbol = aliasedSymbol;
            if (symbol !== undefined && symbol.declarations !== undefined) return symbol.declarations[0];
        }
        return undefined;
    }

    /**
     * Access return type of a method or function
     */
    public getReturnType(declaration: ts.SignatureDeclaration) {
        if (this.program !== undefined) {
            const typeChecker = this.program.getTypeChecker();
            const signature = typeChecker.getSignatureFromDeclaration(declaration);
            if (signature !== undefined) return typeChecker.getReturnTypeOfSignature(signature);
        }
        return undefined;
    }

    /**
     * Define the name of a base class
     * @param name 
     */
    public resetBaseClassName(name?: string) {
        this.baseClassName = name;
    }

    /**
     * Return the name of a base class if it was defined; otherwise, it returns undefined
     */
    public getBaseClassName() {
        return this.baseClassName;
    }
}