import llvm from '@lungchen/llvm-node';
import ts from 'typescript';

export class Debugger {
    private builder: llvm.DIBuilder;
    private file: llvm.DIFile;
    private srcFile: ts.SourceFile;
    private compileUnit: llvm.DICompileUnit;
    private doubleType: llvm.DIBasicType | undefined;
    private booleanType: llvm.DIBasicType | undefined;
    private int32Type: llvm.DIBasicType | undefined;
    private stringType: llvm.DIStringType | undefined;
    private scopes: llvm.DIScope[];

    constructor(srcFile: ts.SourceFile, module: llvm.Module) {
        this.builder = new llvm.DIBuilder(module, true, undefined);
        this.srcFile = srcFile;
        this.file = this.builder.createFile(`${this.srcFile.fileName}.dbg`, '.');
        // For now, lang number is randomly chosen.
        this.compileUnit = this.builder.createCompileUnit(0x0003, this.file, "tsll", false, "", 0);
        // The root scope is of DICompileUnit.
        this.scopes = [this.compileUnit];
    }

    public getLocation(node: ts.Node) {
        const pos = node.getStart(this.srcFile);
        return this.srcFile.getLineAndCharacterOfPosition(pos);
    }

    public buildFunctionDbgInfo(node: ts.Node) {
        const location = this.getLocation(node);
        const elements = [this.getDoubleType()];
        const metadata = this.builder.getOrCreateTypeArray(elements);
        const subroutineType = this.builder.createSubroutineType(metadata);
        const subprogram = this.builder.createFunction(this.compileUnit, node.getText(this.srcFile), '', this.file, location.line, subroutineType, location.line);
        this.scopes.push(subprogram);
        return subprogram;
    }

    public buildVariableDbgInfo(node: ts.Node, value: llvm.Value, diLocalScope: llvm.DILocalScope, currentBlock: llvm.BasicBlock) {

        const diExpression = this.builder.createExpression([]);
        const line = this.getLocation(node).line;
        const column = this.getLocation(node).character;
        const context = value.getContext();
        const diLocalVar = this.builder.createAutoVariable(diLocalScope, value.name, this.file, line, this.getDoubleType());
        const diLocation = llvm.DILocation.get(context, line, column, diLocalScope)
        this.builder.insertDeclare(value, diLocalVar, diExpression, diLocation, currentBlock);
    }

    public getCurrentDIScope() {
        return this.scopes[this.scopes.length - 1];
    }

    public getDoubleType() {
        if (this.doubleType === undefined) {
            this.doubleType = this.builder.createBasicType("DOUBLE", 64, llvm.dwarf.DW_ATE_float);
        }
        return this.doubleType;
    }

    public getBooleanType() {
        if (this.booleanType === undefined) {
            this.booleanType = this.builder.createBasicType("BOOLEAN", 1, llvm.dwarf.DW_ATE_boolean);
        }
        return this.booleanType;
    }

    public getInt32Type() {
        if (this.int32Type === undefined) {
            this.int32Type = this.builder.createBasicType("INT32", 32, llvm.dwarf.DW_ATE_signed);
        }
        return this.int32Type;
    }
}