import ts from 'typescript';
import { Visitor } from './core/ast/visitor';
import { Builder } from './core/ir/builder';
import { Scope } from './common/scope';

export function convert(files: string[], emitIR: boolean, bitcodeOutput?: string) {
    
    let program = ts.createProgram(files, {
        target: ts.ScriptTarget.ES5
    })

    for (let file of files) {
        let srcFile = program.getSourceFile(file);
        if (srcFile === undefined) continue;
        let names = file.trim().split('/');
        let moduleId = names[names.length - 1];
        let builder = new Builder(moduleId);
        let scope = new Scope();
        let visitor = Visitor.getVisitor(builder);

        visitor.visitSourceFile(srcFile, scope);
        if (emitIR) builder.printIR();
        if (bitcodeOutput !== undefined) builder.toBitcodeFile(bitcodeOutput);
    }
}