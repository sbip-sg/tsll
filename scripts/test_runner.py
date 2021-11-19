#!/usr/bin/env python3

# This script is a modified version of sbip-sg/discover/check-assertions.py

import argparse
import multiprocessing
import os
import re
import subprocess

def parse_args():
    parser = argparse.ArgumentParser(description='Run benchmark')
    parser.add_argument('--jsDir',
                        dest='js_dir', default='js_dir',
                        help='Path to Javascript file directory')
    parser.add_argument('--llDir',
                        dest='ll_dir', default='ll_dir',
                        help='Path to LLVM Bitcode file directory')
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

def inverse_fmt(fmt, fmted_str):

    reg_keys = '{([^{}:]+)[^{}]*}'
    reg_fmts = '{[^{}:]+[^{}]*}'
    pat_keys = re.compile(reg_keys)
    pat_fmts = re.compile(reg_fmts)

    keys = pat_keys.findall(fmt)
    lmts = pat_fmts.split(fmt)
    temp = fmted_str
    values = []
    for lmt in lmts:
        if not len(lmt) == 0:
            value,temp = temp.split(lmt, 1)
            if len(value) > 0:
                values.append(value)
    if len(temp) > 0:
        values.append(temp)
    return dict(zip(keys, values))

def run_task(program, *args):
    process = subprocess.run([program, *args], capture_output=True)
    print('Task run completed')
    return process

def main():
    args = parse_args()

    pool = multiprocessing.Pool()

    js_dir = args.js_dir
    ll_dir = args.ll_dir

    if not (os.path.exists(js_dir) and os.path.exists(ll_dir)): return
    js_filepaths = get_filepaths(js_dir)
    ll_filepaths = get_filepaths(ll_dir)

    js_results = []
    ll_results = []

    # Run and store the results
    for filepath in js_filepaths:
        result = pool.apply_async(run_task, ['node', filepath])
        js_results.append(result)

    for filepath in ll_filepaths:
        result = pool.apply_async(run_task, ['lli', filepath])
        ll_results.append(result)
    
    # Wait for all the source code to be interpreted
    for result in js_results:
        result.wait()

    for result in ll_results:
        result.wait()

    # TODO: Compare the output of tsc-compiled code with that of tsll-compiled code

    # Remove test artifacts
    subprocess.run(['rm', '-rf', js_dir, ll_dir])

if __name__ == '__main__':
    main()

