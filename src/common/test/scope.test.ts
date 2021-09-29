import llvm from '@lungchen/llvm-node';
import { Scope } from '../scope';

describe('Scope ', () => {
    let scope: Scope;
    let context: llvm.LLVMContext;

    beforeEach(() => {
        context = new llvm.LLVMContext();
        scope = new Scope();
    });

    it('sets a name with its corresponding value in the current scope', () => {
        let value = llvm.ConstantInt.getFalse(context);
        scope.set('testname', value);
        expect(scope.get('testname')).toBe(value);
    });

    it('gets the value given a name', () => {
        let value = llvm.ConstantInt.getTrue(context);
        scope.set('testname', value);
        let spy = jest.spyOn(scope, 'get');
        expect(scope.get('testname')).toBe(value);
        expect(spy).toHaveReturned();
    });

    it('enters the next scope with a specific function', () => {
        let fnType = llvm.FunctionType.get(llvm.Type.getInt64Ty(context), false);
        let fn = llvm.Function.create(fnType, llvm.LinkageTypes.ExternalLinkage);
        scope.enter('newScope', fn);
        expect(scope.getCurrentFunction()).toBe(fn);
    });

    it('enters the next non-function scope', () => {
        let scopeName = 'justScope';
        scope.enter(scopeName);
        expect(scope.getCurrentScopeName()).toBe(scopeName);
    });

    it('leaves the current scope with a specific function', () => {
        let fnType = llvm.FunctionType.get(llvm.Type.getInt64Ty(context), false);
        let fn = llvm.Function.create(fnType, llvm.LinkageTypes.ExternalLinkage);
        scope.enter('newScope', fn);
        expect(scope.getCurrentFunction()).toBe(fn);
        scope.leave(fn);
        expect(scope.getCurrentFunction()).toBeUndefined();
    });

    it('leaves the current non-function scope', () => {
        let scopeName = 'justScope';
        scope.enter(scopeName);
        expect(scope.getCurrentScopeName()).toBe(scopeName);
        scope.leave();
        expect(scope.getCurrentScopeName()).toBeUndefined();
    });

    it('sets the next type in the current scope', () => {
        let type = llvm.Type.getInt32Ty(context);
        scope.setNextType(type);
        expect(scope.getNextType()).toBe(type);
    })

    it('gets the next type in the current scope', () => {
        let type = llvm.Type.getInt32Ty(context);
        scope.setNextType(type);
        expect(scope.getNextType()).toBeDefined();
    });

    it('should return true', () => {
        expect(scope.isModuleScope()).toBeTruthy();
    });

    it('sets default values for a function', () => {
        let spy = jest.spyOn(scope, 'setDefaultValues');
        scope.setDefaultValues('functionName', new Map());
        expect(spy).toHaveReturned();
    });

    it('gets default values according to a function name', () => {
        scope.setDefaultValues('functionName', new Map());
        expect(scope.getDefaultValues('functionName')).toBeDefined();
    });

});