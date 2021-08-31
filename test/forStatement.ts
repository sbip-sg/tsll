function loop(): number {

    for (let a = 0; a < 10; a++) {
        let b = 1;
        if (b === a) {
            break;
        } else if (a >= b) {
            
        } else {
            return a;
        }
        continue;
    }
    return 19;
}