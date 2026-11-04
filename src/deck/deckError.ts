/**
 * A deck that the build or the set-up refuses, such as a section file without its section
 * number, with the reason as a sentence that names the file and the value at fault.
 */
export class DeckError extends Error {
	public readonly name = "DeckError";
}

/**
 * The reason of a failure as one text: the messages of the errors that an `AggregateError` holds,
 * joined by `; `, such as the two failed connections of `localhost` to `::1` and `127.0.0.1`, and
 * otherwise the message of the error, or its `code` when its message is empty. The shapes are
 * tested by their fields, because the library of the compiler, ES6, knows no `AggregateError`.
 */
export function failureText(error: unknown): string {
	if (typeof error !== "object" || error === null) {
		return String(error);
	}
	const { errors, message, code } = error as {
		errors?: unknown;
		message?: unknown;
		code?: unknown;
	};
	if (Array.isArray(errors) && errors.length > 0) {
		return errors.map(failureText).join("; ");
	}
	if (typeof message === "string" && message !== "") {
		return message;
	}
	if (typeof code === "string" && code !== "") {
		return code;
	}
	return String(error);
}
