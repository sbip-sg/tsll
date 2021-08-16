import { DuplicateError, VariableUndefinedError } from "../error";

describe('Error', () => {
    it('creates error for duplicates', () => {
        let err = new DuplicateError();
        expect(err.message.length).toBeGreaterThan(0);
    });

    it('creates error for undefined variables', () => {
        let err = new VariableUndefinedError();
        expect(err.message.length).toBeGreaterThan(0);
    })
});