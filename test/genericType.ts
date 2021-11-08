class AnotherClass<T> {
    private testPrivateMember: T;

    constructor(intro: T) {
        this.testPrivateMember = intro;
    }

    public testPrivateInPublic(): T {
        return this.testPrivateMember;
    }
}

class GenericClass<T> {
    private testPrivateMember: T;

    constructor(intro: T) {
        this.testPrivateMember = intro;
    }

    public testPrivateInPublic(): T {
        return this.testPrivateMember;
    }
}

let typicalGeneric = new GenericClass<number>(100);
let boolGeneric = new AnotherClass<string>('errc');
let nestedGeneric = new AnotherClass<AnotherClass<string>>(boolGeneric);

