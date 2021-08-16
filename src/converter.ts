import ts from 'typescript';
import { Visitor } from './core/ast/visitor';
import { Builder } from './core/ir/builder';
import { Scope } from './common/scope';

export function convert(files: string[]) {
    
    let program = ts.createProgram(files, {
        target: ts.ScriptTarget.ES5
    })

    for (let file of files) {
        let srcFile = program.getSourceFile(file);
        if (srcFile === undefined) continue;

        let builder = new Builder(file);
        let scope = new Scope();
        let visitor = Visitor.getVisitor(builder);

        visitor.visitSourceFile(srcFile, scope);
        builder.printIR();
    }
}