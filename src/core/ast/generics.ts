import llvm from "@lungchen/llvm-node";
import { TypeUndefinedError } from "../../common/error";
import { Scope } from "../../common/scope";
import ts from "typescript";
import { Visitor } from "./visitor";

/* Helper class to save generic declarations and instantiate them with specific types later */
export class Generics {
    private declarationMap: Map<string, ts.ClassDeclaration | ts.FunctionDeclaration>;
    private typeParameterMap: Map<string, llvm.Type>;
    private declaredNames: Set<string>;

    constructor(private visitor: Visitor) {
        this.declarationMap = new Map();
        this.typeParameterMap = new Map();
        this.declaredNames = new Set();
    }

    public hasDeclaration(name: string) {
        const declaration = this.declarationMap.get(name);
        return declaration !== undefined; 
    }

    public hasDeclared(name: string) {
        return this.declaredNames.has(name);
    }

    public saveDeclaration(name: string, declaration: ts.ClassDeclaration | ts.FunctionDeclaration) {
        this.declarationMap.set(name, declaration);
    }

    public createSpecificDeclaration(name: string, types: llvm.Type[], scope: Scope) {
        // Make sure that declared name does exist.
        const declaration = this.declarationMap.get(name);
        if (declaration === undefined) throw new TypeUndefinedError();
        let structType: llvm.StructType | undefined;
        if (ts.isClassDeclaration(declaration)) structType = this.visitor.visitClassDeclaration(declaration, scope, types);
        if (structType === undefined) throw new TypeUndefinedError();
        const wholeName = Generics.constructWholeName(name, types);
        this.declaredNames.add(wholeName);
        return structType;
    }

    public replaceTypeParameters(typeParameterMap: Map<string, llvm.Type>) {
        this.typeParameterMap = typeParameterMap;
    }

    public getTypeByName(name: string) {
        const type = this.typeParameterMap.get(name);
        if (type === undefined) throw new TypeUndefinedError();
        return type;
    }

    public static constructWholeName(name: string, types: llvm.Type[]) {
        let wholeName = name;
        types.every(type => wholeName = wholeName.concat(`_${type.toString()}`));
        return wholeName;
    }
}