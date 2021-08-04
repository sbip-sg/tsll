import { VariableUndefinedError } from "./error";
import { Value, Function } from "../core/ir/types";

export class Scope {
    private scopeNameArray: string[];
    private functionArray: Function[];
    private nameTable: Map<string, Value>;
    private tableArray: Map<string, Value>[];

    constructor() {
        this.scopeNameArray = [];
        this.functionArray = [];
        this.tableArray = [new Map()];
        this.nameTable = this.tableArray[this.tableArray.length - 1];
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
    /**
     * Return whether the current scope is of the whole module if not at a function or class level
     */
    public isModuleScope() {
        return this.tableArray.length === 1;
    }
}