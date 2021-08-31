function closeConnection(): number {

    let n = 20;
    let i = 0;

    while (i < n) {
        if (n === i) {
            i++;
        } else {
            return n;
        }
        return n + i;
    }

    return 20;

}