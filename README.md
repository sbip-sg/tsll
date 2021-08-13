## What is Tslah?
Tslah is a TypeScript frontend written in TypeScript for LLVM IR generation. For now, this work is mainly used for blockchain smart contract verification. Before we transpile Node.js code in Typescript into Javascript artifacts, Tslah combined with other backend analysis tools provides a powerful framework to search for vulnerabilities and security issues as smart contract developers would not realize while writing such smart contracts.

#### **Design idea**
Tslah extracts information on Abstract Syntax Tree (AST) generated with [Typescript Compiler API](https://github.com/Microsoft/TypeScript/wiki/Using-the-Compiler-API) by visiting each node, and create instructions accordingly with [LLVM Typescript bindings](https://github.com/MichaReiser/llvm-node) to achieve the final IR generation.
## Install

Work in progress
## Development
For those who would like to develop this project together, please check out below.

#### **Prerequisite**
Follow the steps to build the source code in [LLVM project](https://github.com/llvm/llvm-project). I highly recommend using the build tool [Ninja](https://ninja-build.org/) as it is fast and simple. Below are a few first steps you could start from.

1. Clone the LLVM project repository
`git clone https://github.com/llvm/llvm-project.git`
2. Choose a tag to checkout into a branch by running `git tag -l` and `git checkout tags/<tag>`
3. `cd llvm-project` and generate Ninja build metadata by running `cmake -S llvm -B build -G ninja`
4. `ninja` to start building your LLVM version

Note that we use LLVM 11.0.0 (llvmorg-11.0.0) to convert Typescript to LLVM Intermediate Representation in this project so you might want to build this LLVM version for compatibility purposes.

After it is successfully built, the final step is to run the following simple command to download all the dependencies, and you are good to contribute.

`npm install `

## Code Style
This project is developed generally with [Typescript style guide](https://google.github.io/styleguide/tsguide.html) to attain better maintainability and readability.
## References
A list of resources regarding LLVM and Typescript Compiler API documentation is provided below so that you can get started with this project to contribute if you will.
- https://github.com/microsoft/TypeScript/blob/d8e830d132a464ec63fd122ec50b1bb1781d16b7/doc/spec-ARCHIVED.md
- https://releases.llvm.org/11.0.0/docs/LangRef.html