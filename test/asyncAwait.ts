function setIncrement(inc: number): number {
    return inc + 1;
}

async function accessLedger(): Promise<void> {
    return;
}

async function accessAsync(): Promise<void> {
   await accessLedger();
   await accessLedger();
   setIncrement(10);
   return;
}