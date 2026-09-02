// Only errors constructed from validated client input may be returned verbatim.
export class InputError extends Error {
    constructor(message: string) {
        super(message)
        this.name = "InputError"
    }
}
