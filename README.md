[![Actions Status](https://github.com/sbip-sg/tsll/workflows/CI/badge.svg)](https://github.com/sbip-sg/tsll/actions)
[![npm version](https://badge.fury.io/js/tsll.svg)](https://badge.fury.io/js/tsll)
## What is tsll?
Tsll is a Typescript compiler frontend for LLVM IR generation. Our goal of this work is to verify blockchain smart contracts through the generated IR. Before we transpile Node.js code in Typescript into Javascript artifacts, tsll combined with other backend analysis tools could provide a powerful framework to search for vulnerabilities and security issues as smart contract developers would not realize while writing such smart contracts.

#### **Design idea**
Tsll extracts information on Abstract Syntax Tree (AST) generated with [Typescript Compiler API](https://github.com/Microsoft/TypeScript/wiki/Using-the-Compiler-API) by visiting each node, and create instructions accordingly with [LLVM Typescript bindings](https://github.com/sbip-sg/llvm-node) to achieve the final IR generation.

For more detail, go to [wiki pages](https://github.com/sbip-sg/tsll/wiki)

## **Prerequisite**
Follow the steps to build the source code in [LLVM project](https://github.com/llvm/llvm-project). I highly recommend using the build tool [Ninja](https://ninja-build.org/) as it is fast and simple. Below are a few steps you could start from.

1. Clone the LLVM project repository and enter the project  directory via
`git clone https://github.com/llvm/llvm-project.git` and
`cd llvm-project`
2. Choose a tag from the list and check out into a branch by running `git tag -l` and `git checkout tags/<tag>` (Replace `<tag>` for with your tag choice)
3. Generate Ninja build files with `cmake -S llvm -B build -G Ninja`
4. `cmake --build build` to start building your LLVM from the Ninja build files (This may take a while)

Note that we use LLVM 13.0.0 to convert Typescript to LLVM Intermediate Representation in this project so you might want to build this LLVM version for compatibility purposes.

## Install
```
npm install tsll
```
## Usage
tsll can be run as a command as you normally would. Just type the following command to see more options on your favorite terminal.
```
tsll -h
```
## Development
For those who would like to develop this project together, please check out below.

`git clone` this repo, and make sure you have already installed LLVM before `npm i`.

## Code Style
This project is developed generally with [Typescript style guide](https://google.github.io/styleguide/tsguide.html) to attain better maintainability and readability.

## Project Structure
All of the code is located in the **src** directory. Under **src/core** are the core components **Visitor**, **Builder**, and **Debugger** included. These three pillars are combined with the common utilites under **src/common** for Tsll to work as a compiler frontend. **src/cli.ts** and **src/converter.ts** are basically the entry point to the compiler.

## References
A list of resources regarding LLVM and Typescript Compiler API documentation is provided below so that you can get started with this project to contribute if you will.
- https://github.com/microsoft/TypeScript/blob/d8e830d132a464ec63fd122ec50b1bb1781d16b7/doc/spec-ARCHIVED.md
- https://releases.llvm.org/11.0.0/docs/LangRef.html
- https://ts-ast-viewer.com/#
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference
- https://github.com/emlai/ts-llvm

## Disclaimer
By using this project, you agree that we as SBIP developers of tsll have no legal obligations in any form to your usage.
