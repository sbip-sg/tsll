import { isString } from "../types";

describe('Type assertion', () => {
    it('should return true for String', () => {
        let str = 'I am a string.'
        expect(isString(str)).toBeTruthy();
    });
});