import { Scope } from '../../../common/scope';
import { Builder } from '../../ir/builder';
import { Visitor } from '../visitor';

describe('Visitor ', () => {

    let builder: Builder;
    let visitor: Visitor;
    let scope: Scope;

    beforeEach(() => {
        builder = new Builder('test');
        visitor = Visitor.getVisitor(builder);
        scope = new Scope();
    });

    it('returns visitor singleton instance', () => {
        expect(Visitor.getVisitor(builder)).toBeInstanceOf(Visitor);
    });

    // it('visitor visits class declaration and returns Value', () => {
    //     jest.spyOn
    //     let a = visitor.visitClassDeclaration(scope);
    //     expect(a).toHaveReturned
    // });
});