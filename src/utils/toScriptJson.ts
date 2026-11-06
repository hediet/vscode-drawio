// U+2028 and U+2029, which end a line in JavaScript before ES2019
const LINE_SEPARATORS = new RegExp(
	"[" + String.fromCharCode(0x2028) + String.fromCharCode(0x2029) + "]",
	"g"
);

/**
 * JSON for a value in an inline script or JSON script element: `<` is escaped
 * so that no value can end the element, and the line separators so that the
 * JSON is also a valid JavaScript literal in older engines.
 */
export function toScriptJson(value: unknown): string {
	return JSON.stringify(value)
		.replace(/</g, "\\u003c")
		.replace(LINE_SEPARATORS, (c) => "\\u" + c.charCodeAt(0).toString(16));
}
