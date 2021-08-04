import { Builder } from '../builder';

test('create builder', () => {
    expect(new Builder('test')).toBeInstanceOf(Builder);
});

let builder: Builder;

beforeEach(() => {
    builder = new Builder('test');
});

test('builder builds structure', () => {
    let llvm = jest.requireMock('llvm');
    expect(builder.buildStruct('testStruct')).toBeInstanceOf(llvm.Value);
});