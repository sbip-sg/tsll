class PrevClass {
    protected seeWhat: number;
    public testOverride(what: number): void {
        this.seeWhat = what;
    }
}

class NowClass extends PrevClass {
    public testPulbicMember: string;
    private testPrivateMember: number;

    constructor(intro: string) {
        super();
        this.testPulbicMember = intro;
    }

    public testPrivateMemberFunction(a: number): number {
        this.testPrivateMember = a;
        return this.testPrivateMember;
    }

    public testPrivateInPublic(): number {
        return this.testPrivateMemberFunction(100) + this.seeWhat;
    }

    // Override
    public testOverride(what: number): number {
        return this.testPrivateMember + what;
    }
}

const yourClass = new NowClass('sayyesorno');
yourClass.testPrivateMemberFunction(30);