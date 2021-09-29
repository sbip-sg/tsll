class TestClass {
    private testPulbicMember: string;
    private testPrivateMember: number;

    constructor(intro: string) {
        this.testPulbicMember = intro;
    }

    public testPrivateMemberFunction(a: number): number {
        this.testPrivateMember = a;
        return this.testPrivateMember;
    }

    public testPrivateInPublic(): number {
        return this.testPrivateMemberFunction(100);
    }
}

const d = new TestClass('sayyesorno');
d.testPrivateMemberFunction(30);

// let b = new xyz.School();
// let c = xyz.one;