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

    public hasDeclaration(name: string) {
        const declaration = this.declarationMap.get(name);
        return declaration !== undefined; 
    }

    public hasDeclared(name: string) {
        return this.declaredNames.has(name);
    }

    public saveDeclaration(name: string, declaration: ts.Declaration) {
        this.declarationMap.set(name, declaration);
    }

    public createSpecificDeclaration(typeName: ts.Identifier, types: llvm.Type[], scope: Scope) {
        const name = this.visitor.visitIdentifier(typeName, scope);
        // Make sure that declared name does exist.
        const prevDeclaration = this.declarationMap.get(name);
        const reDeclaration = scope.getDeclaration(typeName);
        if (prevDeclaration === undefined && reDeclaration === undefined) throw new TypeUndefinedError();
        
        // Select one of the declarations which are the same
        let declaration: ts.Declaration;
        if (prevDeclaration !== undefined) {
            declaration = prevDeclaration;
        } else if (reDeclaration !== undefined) {
            declaration = reDeclaration;
        } else {
            throw new TypeUndefinedError();
        }

        const structType = this.visitor.visitDeclaration(declaration, scope, types);
        if (structType === undefined) throw new TypeUndefinedError();
        const wholeName = Generics.constructWholeName(name, types);
        this.declaredNames.add(wholeName);
        return structType;
    }

    public addTypeParameters(typeParameterMap: Map<string, llvm.Type>) {
        this.typeParameterMaps.push(typeParameterMap);
    }

    public addDefaultTypes(defaultTypeMap: Map<string, llvm.Type>) {
        this.defaultTypeMaps.push(defaultTypeMap);
    }

    public removeTypeParameters() {
        this.typeParameterMaps.pop();
    }

    public removeDefaultTypes() {
        this.defaultTypeMaps.pop();
    }

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