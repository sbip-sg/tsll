class TestClass {
    private testPulbicMember: string;
    // private testPrivateMember: number;

    // public testPulbicMemberFunction() {
    //     return this.testPrivateMember;
    // }

    constructor(intro: string) {
        // this.testPulbicMember = intro;
    }

    public testPrivateMemberFunction(a: number): void {
        // this.testPulbicMember;
    }

    // public testPrivateInPublic() {
    //     return this.testPrivateMemberFunction();
    // }
}

let a = new TestClass('yo ho there you are');
// a.testPrivateMemberFunction(30);