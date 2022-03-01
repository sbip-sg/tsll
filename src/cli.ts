#!/usr/bin/env node
import yargs from 'yargs/yargs';
import { convert } from './converter';
import fs from 'fs';
// Provide command line options
const options = {
    'emitIR': {
        describe: 'Emit LLVM Intermediate Representation to standard output',
        requiresArg: false,
        boolean: true,
        default: true,
        require: false
    },
    'emitBitcode': {
        describe: 'Emit LLVM Bitcode to a specific file',
        requiresArg: false,
        string: true,
        default: 'llvm.bc',
        require: false
    }
};
// Extract arguments given the options
// Version refers to the version inside package.json
const argv = yargs(process.argv.slice(2)).options(options).help().string('_').check(argv => {
    const filePaths = argv._;
    if (filePaths.length === 0) throw new Error('At least one file should be provided.');
    const allExist = filePaths.every((filePath) => fs.existsSync(filePath as string));
    if (!allExist) throw new Error('Filepath does not exist.');
}).fail(msg => {
    console.log(msg);
    process.exit();
}).parseSync();
// convert a list of input files to IR or Bitcode file
convert(argv._ as string[], argv.emitIR, argv.emitBitcode);

