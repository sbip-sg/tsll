import { Scope } from '../../../common/scope';
import { Builder } from '../../ir/builder';
import { Visitor } from '../visitor';

test('visitor returns visitor instance', () => {
    let builder = new Builder('test');
    expect(Visitor.getVisitor(builder)).toBeInstanceOf(Visitor);
});

let builder: Builder;
let visitor: Visitor;
let scope: Scope;

beforeEach(() => {
    builder = new Builder('test');
    visitor = Visitor.getVisitor(builder);
    scope = new Scope();
});

test('visitor visits class declaration and returns Value', () => {
    let ts = jest.requireMock('typescript');
    expect(visitor.visitClassDeclaration(ts.statement, scope)).toBeDefined();
});