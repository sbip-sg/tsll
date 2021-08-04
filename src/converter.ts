import ts from 'typescript';
import { readFileSync } from 'fs';
import { Visitor } from './core/ast/visitor';
import { Builder } from './core/ir/builder';
import { Scope } from './common/scope';

// TODO: Decide the name of this function
export function convert(files: string[]) {
    
    for (let file of files) {
        let srcFile: ts.SourceFile = ts.createSourceFile(file, readFileSync(file).toString(), ts.ScriptTarget.ES5)

        // TODO: Before we convert source code to IR, semantic analysis is performed on this source file

        let builder = new Builder(file);
        let scope = new Scope();
        let visitor = Visitor.getVisitor(builder);

        visitor.visitSourceFile(srcFile, scope);
        builder.printIR();
    }
}