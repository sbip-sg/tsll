interface NewHire {
    onboard(): void;
    quit(): boolean;
    work(numHours: number): void;
    experience: number;
}

class NewEmployee implements NewHire {
    onboard(): NewHire {
        return new NewEmployee();
    }

    quit(): boolean {
        return false;
    }

    work(numHours: number): void {
        
    }

    public experience: number
}

const a = new NewEmployee()