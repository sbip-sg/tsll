import ts from 'typescript';
import { Visitor } from './core/ast/visitor';
import { Builder } from './core/ir/builder';
import { Scope } from './common/scope';

export function convert(files: string[], emitIR: boolean, bitcodeOutput?: string) {

    const program = ts.createProgram(files, {
        target: ts.ScriptTarget.ES5
    });

    // Make sure all the declared dependencies have been analysed before our main source files.
    // const fileSet = new Set(files);
    // for (const srcFile of program.getSourceFiles()) {
    //     if (!fileSet.has(srcFile.fileName)) 
    // }

    const diagnostics = ts.getPreEmitDiagnostics(program);
    // Print out diagnostic messages
    for (const diagnosis of diagnostics) {
        console.log(diagnosis.messageText.toString());
    }

    if (diagnostics.length > 0) return;

    for (let file of files) {
        let srcFile = program.getSourceFile(file);
        if (srcFile === undefined) continue;
        let names = file.trim().split('/');
        let moduleId = names[names.length - 1];
        let builder = new Builder(moduleId);
        let scope = new Scope(program);
        let visitor = Visitor.getVisitor(builder);

        visitor.visitSourceFile(srcFile, scope);
        if (emitIR) builder.printIR();
        if (bitcodeOutput !== undefined) builder.toBitcodeFile(bitcodeOutput);
    }
}