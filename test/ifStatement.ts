
function testIf(b: number): number {
    b = 2;
    let a: number = 3;
    if (a >= b) {
        b = 1;
        a = 4;
        return a;
    } else if (b < a) {
        b = 1;
        a = 4;
    } else {
        return 10;
    }

    b += b;
    
    return 20;
}
