enum Personality {
    Shy,
    Easygoing,
    Conservative,
    Arrogant
}

class Person {
    // New people are arrogant straight after graduation
    public personality: Personality = Personality.Arrogant;
}

let newHire = new Person();

switch (newHire.personality) {
    case Personality.Shy:
        newHire.personality = Personality.Conservative;
    case Personality.Arrogant:
        newHire.personality = Personality.Easygoing;
    default:
        newHire.personality = Personality.Shy;
        break;
}