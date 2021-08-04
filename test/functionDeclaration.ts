function testA(a: number): number {
    a += 1;
    return a;
}

function testB(b: number): number {
    let c = b + 1;
    return c;
}

function testC(c: number, d: number): number {
    let e = c + 1;
    return e + d + c;
}

let testVar = 10;

let ger = testB(testVar);