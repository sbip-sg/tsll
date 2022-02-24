import ts from 'typescript';
import { Visitor } from './core/ast/visitor';
import { Builder } from './core/ir/builder';
import { Debugger } from './core/ir/debugger';
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

    for (const file of files) {
        const srcFile = program.getSourceFile(file);
        if (srcFile === undefined) continue;
        const names = file.trim().split('/');
        const moduleId = names[names.length - 1];
        const irBuilder = new Builder(moduleId);
        const irDebugger = new Debugger(srcFile, irBuilder);
        let scope = new Scope(program);
        let visitor = Visitor.getVisitor(irBuilder, irDebugger);

        visitor.visitSourceFile(srcFile, scope);
        if (emitIR) irBuilder.printIR();
        // if (bitcodeOutput !== undefined) irBuilder.toBitcodeFile(bitcodeOutput);
    }
}