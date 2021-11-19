#!/usr/bin/env node
import * as fs from 'fs';
import yargs from 'yargs/yargs';
import { convert } from './converter';
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
    },
    'outDir': {
        describe: 'Output bitcode file to a specific directory',
        requiresArg: false,
        string: true,
        default: 'll_dir',
        require: false
    }
};
// Extract arguments given the options
// Version refers to the version inside package.json
const argv = yargs(process.argv.slice(2)).options(options).help().string('_').check(argv => {
    const filePaths = argv._;
    if (filePaths.length === 0) throw new Error('At least one file should be provided.');
    return true;
}).parseSync();

// Create output directory
if (!fs.existsSync(argv.outDir)) fs.mkdirSync(argv.outDir);

// convert a list of input files to IR or Bitcode file
convert(argv._ as string[], argv.emitIR, argv.outDir + '/' + argv.emitBitcode);

