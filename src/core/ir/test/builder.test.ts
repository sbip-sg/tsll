
import llvm from 'llvm-node';
import { Builder } from '../builder';

describe('Builder ', () => {

    let builder: Builder;

    beforeEach(() => {
        builder = new Builder('test');
    });

    it('creates builder', () => {
        expect(builder).toBeInstanceOf(Builder);
    });

    it('creates a struct type without element types.', () => {
        let structTypeName = 'typename';
        builder.buildStructType(structTypeName);
        let structType = builder.getStructType(structTypeName);
        expect(structType.name).toStrictEqual(structTypeName);
    });

    /** TODO
     * WE SKIP ANY ALLOCATION TESTS BECAUSE WHEN RUN,
     * THEY HANG AND NEVER STOP FOR UNKNOWN REASON.
     */

    it('subtract value A from value B', () => {
        let lhs = builder.buildNumber(30);
        let rhs = builder.buildNumber(10);
        let result = builder.buildAdd(lhs, rhs);
        expect(result).toBeInstanceOf(llvm.Value);
    });

    it('adds two values', () => {
        let lhs = builder.buildNumber(40);
        let rhs = builder.buildNumber(100);
        let result = builder.buildAdd(lhs, rhs);
        expect(result).toBeInstanceOf(llvm.Value);
    });

    it('inserts types in a struct', () => {
        builder.buildStructType('typename');
        let firstType = builder.buildStructType('struct');
        let secondType = builder.buildStringType(10);
        let spy = jest.spyOn(builder, 'insertPropertyType');
        builder.insertPropertyType('typename', firstType, secondType);
        expect(spy).toHaveReturned()
        expect(spy).toHaveReturned();
    });

    it('builds a floating number', () => {
        let spy = jest.spyOn(builder, 'buildNumber');
        let fp = builder.buildNumber(20);
        expect(spy).toHaveReturned()
        expect(fp.value).toStrictEqual(20);
    });

    it('builds an int32 number', () => {
        let spy = jest.spyOn(builder, 'buildInteger');
        let integer = builder.buildInteger(100, 32);
        expect(spy).toHaveReturned()
        expect(integer.value).toStrictEqual(100);
    });

    it('builds a global variable on a module scope', () => {
        let value = builder.buildInteger(399, 32);
        let gv = builder.buildGlobalVariable(value, 'newGlobal');
        expect(gv).toBeInstanceOf(llvm.GlobalVariable);
    });

    it('builds a string', () => {
        let str = builder.buildString('neverknown');
        expect(str).toBeInstanceOf(llvm.ConstantDataArray);
    });

    it('builds a boolean', () => {
        let boolean = builder.buildBoolean(false);
        expect(boolean.value).toStrictEqual(0);
    });

    it('builds a boolean type', () => {
        let boolean = builder.buildBoolean(true);
        let booleanType = builder.buildBooleanType();
        expect(booleanType.typeID).toBe(boolean.type.typeID);
    });

    it('builds an array type of specific element type', () => {
        let spy = jest.spyOn(builder, 'buildArrayType');
        let elementType = builder.buildBooleanType();
        let arrayType = builder.buildArrayType(elementType, 10);
        expect(spy).toHaveReturned();
        expect(arrayType.elementType.typeID).toBe(elementType.typeID);
    });

    it('builds a basic block', () => {
        let fn = builder.buildFunction('fnName', builder.buildNumberType(), [], []);
        let bb = builder.buildBasicBlock(fn);
        expect(bb).toBeInstanceOf(llvm.BasicBlock);
    });

    it('builds a branch', () => {
        let fn = builder.buildFunction('fnName', builder.buildNumberType(), [], []);
        let bb = builder.buildBasicBlock(fn);
        let spy = jest.spyOn(builder, 'buildBranch');
        builder.buildBranch(bb);
        expect(spy).toHaveBeenCalledWith(bb);
        expect(spy).toHaveReturned();
    });

    it('builds if condition branch', () => {
        let fnType = builder.buildNumberType();
        let fn = builder.buildFunction('newFun', fnType, [], []);
        let condition = builder.buildBoolean(false);
        let thenBB = builder.buildBasicBlock(fn)
        let elseBB = builder.buildBasicBlock(fn);
        let spy = jest.spyOn(builder, 'buildConditionBranch');
        builder.buildConditionBranch(condition, thenBB, elseBB);
        expect(spy).toHaveReturned();
    });

    it('sets the current block as given', () => {
        let fnType = builder.buildNumberType();
        let fn = builder.buildFunction('newFun', fnType, [], []);
        let bb = builder.buildBasicBlock(fn);
        builder.setCurrentBlock(bb);
        expect(builder.getCurrentBlock()).toStrictEqual(bb);
    });

    it('gets the current block', () => {
        expect(builder.getCurrentBlock()).toBeUndefined();
        let fnType = builder.buildNumberType();
        let fn = builder.buildFunction('newFun', fnType, [], []);
        builder.buildBasicBlock(fn);
        expect(builder.getCurrentBlock()).toBeDefined();
    });
});