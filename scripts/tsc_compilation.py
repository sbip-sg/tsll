#!/usr/bin/env python3

# This script is a modified version of sbip-sg/discover/check-assertions.py

import argparse
import multiprocessing
import os
import subprocess

def parse_args():
    parser = argparse.ArgumentParser(description='Run benchmark')
    parser.add_argument('dir_path',
                        help='Path to benchmark directory')
    parser.add_argument('--outDir',
                        dest='output_dir', default='js_dir',
                        help='Output Javascript files to a specified directory')
    args = parser.parse_args()
    return args

def get_filepaths(basepath):
    filepaths = []
    # Append all files in a directory to a list
    for entry in os.listdir(basepath):
        filepath = os.path.join(basepath, entry)
        if os.path.isfile(filepath):
            filepaths.append(filepath)
    return filepaths

def run_task(program, *args):
    process = subprocess.run([program, *args], capture_output=True)
    print('Task run completed')
    return process

def main():
    print('Start compiling...')
    args = parse_args()

    pool = multiprocessing.Pool()

    output_dir = args.output_dir

    # Get all the paths to the test targets
    ts_filepaths = get_filepaths(args.dir_path)

    results = []
    # Compile these programs with tsc compiler
    for filepath in ts_filepaths:
        result = pool.apply_async(run_task, ['npx','tsc', '--outDir', output_dir, filepath])
        results.append(result)

    # Wait for all the compilation processes to complete
    for result in results:
        result.wait()

    print('Compilation process completed!!!')

if __name__ == '__main__':
    main()
