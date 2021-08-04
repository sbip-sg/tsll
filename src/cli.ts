// import yargs from 'yargs/yargs';
import { convert } from './converter';

// TODO: Accept options to generate LLVM IR in different formats. For now we assume there are no options passed in.
// const argv = yargs(process.argv.slice(2)).parse();

/**
 * Invoke `convert` with entry files
 */
convert(process.argv.slice(2));

