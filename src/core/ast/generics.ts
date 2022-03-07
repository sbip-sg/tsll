/**
 * This module helps to store generic types which have not been visited
 * due to its lacking knowledge of real type parameters. Once all the type parameters are well defined,
 * type references can be replaced with them while a generic type is being visited, which
 * was originally defined with merely these references.
 */
import llvm from "@lungchen/llvm-node";
import { TypeUndefinedError } from "../../common/error";
import { Scope } from "../../common/scope";
import ts from "typescript";
import { Visitor } from "./visitor";

/* Helper class to save generic declarations and instantiate them with specific types later */
export class Generics {
    private declarationMap: Map<string, ts.Declaration>;
    private typeParameterMaps: Map<string, llvm.Type>[];
    private defaultTypeMaps: Map<string, llvm.Type>[];
    private declaredNames: Set<string>;

    constructor(private visitor: Visitor) {
        this.declarationMap = new Map();
        this.typeParameterMaps = [];
        this.defaultTypeMaps = [];
        this.declaredNames = new Set();
    }

    /**
     * Find out if a declaration exists.
     * @param name Name of the declaration
     * @returns 
     */
    public hasDeclaration(name: string) {
        const declaration = this.declarationMap.get(name);
        return declaration !== undefined; 
    }

    /**
     * Check if a type name is well-defined.
     * @param name Name of type
     * @returns 
     */
    public hasDeclared(name: string) {
        return this.declaredNames.has(name);
    }

    /**
     * Save a declaration with its name.
     * @param name Name of the declaration
     * @param declaration 
     */
    public saveDeclaration(name: string, declaration: ts.Declaration) {
        this.declarationMap.set(name, declaration);
    }

    /**
     * Visit a declaration previously saved in a pool of generics with well-defined type parameters.
     * @param typeName Name of the declaration
     * @param types Well-defined types
     * @param scope Current scope
     * @returns 
     */
    public createSpecificDeclaration(typeName: ts.Identifier, types: llvm.Type[], scope: Scope) {
        const name = this.visitor.visitIdentifier(typeName, scope);
        // Make sure that declared name does exist.
        const prevDeclaration = this.declarationMap.get(name);
        const reDeclarations = scope.getDeclaration(typeName);
        if (prevDeclaration === undefined && reDeclarations === undefined) throw new TypeUndefinedError();
        
        // Select one of the declarations which are the same
        let declaration: ts.Declaration;
        if (prevDeclaration !== undefined) {
            declaration = prevDeclaration;
        } else if (reDeclarations !== undefined) {
            declaration = reDeclarations[0];
        } else {
            throw new TypeUndefinedError();
        }

        const structType = this.visitor.visitDeclaration(declaration, scope, types);
        if (structType === undefined) throw new TypeUndefinedError();
        const wholeName = Generics.constructWholeName(name, types);
        this.declaredNames.add(wholeName);
        return structType;
    }

    /**
     * Add a map of type parameters to well-defined types.
     * @param typeParameterMap 
     */
    public addTypeParameters(typeParameterMap: Map<string, llvm.Type>) {
        this.typeParameterMaps.push(typeParameterMap);
    }

    /**
     * Add a map of type parameters to default well-defined types.
     * @param defaultTypeMap 
     */
    public addDefaultTypes(defaultTypeMap: Map<string, llvm.Type>) {
        this.defaultTypeMaps.push(defaultTypeMap);
    }

    /**
     * Remove a map of type parameters to well-defined types.
     */
    public removeTypeParameters() {
        this.typeParameterMaps.pop();
    }

    /**
     * Remove a map of type parameters to default well-defined types.
     */
    public removeDefaultTypes() {
        this.defaultTypeMaps.pop();
    }

    /**
     * Find the well-defined type of a type name
     * @param name Name of type parameter
     * @returns 
     */
    public getTypeByName(name: string) {

        if (this.typeParameterMaps.length > 0) {
            const type = this.typeParameterMaps[this.typeParameterMaps.length - 1].get(name);
            if (type !== undefined) return type;
        }

        if (this.defaultTypeMaps.length > 0) {
            return this.defaultTypeMaps[this.defaultTypeMaps.length - 1].get(name);
        }

        return undefined;
    }

    /**
     * Produce a whole type name with the name of a declaration and the names of well-defined types.
     * @param name Name of declaration
     * @param types Well-defined types
     * @returns 
     */
    public static constructWholeName(name: string, types: llvm.Type[]) {
        let wholeName = name;
        types.every(type => {
            wholeName = wholeName.concat('_');
            // Resolve the type information from the pointer type
            if (type.isPointerTy()) type = type.elementType;

            if (type.isStructTy()) {
                if (type.name !== undefined) wholeName = wholeName.concat(`${type.name}`);    
            } else {
                wholeName = wholeName.concat(`${type.toString()}`);
            }
        });
        return wholeName;
    }
}