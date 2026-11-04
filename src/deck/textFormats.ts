/**
 * The forms of text that the files of a built deck take: the entities of XML and HTML, the lines
 * of a text, JSON with every character outside printable ASCII escaped, and numbers rounded and
 * printed in one fixed way, so that two builds of one deck write the same bytes.
 */
import * as fs from "fs";

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
};
const ENTITY = /&(?:#[xX]([0-9a-fA-F]+)|#([0-9]+)|([A-Za-z][A-Za-z0-9]*));/g;

/**
 * The text with each character reference and each entity of XML, and `&nbsp;`, read as its
 * character. Another named entity stays as written.
 */
export function unescapeHtml(text: string): string {
	if (!text.includes("&")) {
		return text;
	}
	return text.replace(
		ENTITY,
		(entity, hexadecimal: string, decimal: string, name: string) => {
			if (name !== undefined) {
				return Object.prototype.hasOwnProperty.call(
					NAMED_ENTITIES,
					name
				)
					? NAMED_ENTITIES[name]
					: entity;
			}
			const code = parseInt(
				hexadecimal ?? decimal,
				hexadecimal ? 16 : 10
			);
			return code > 0 && code <= 0x10ffff
				? String.fromCodePoint(code)
				: "�";
		}
	);
}

/**
 * The text of a file of UTF-8 with each line break `\r\n` and `\r` read as `\n`, as Python reads
 * a file opened as text.
 */
export function readTextFile(file: string): string {
	return fs.readFileSync(file, "utf8").replace(/\r\n?/g, "\n");
}

/** The text with `&`, `<`, `>`, `"` and `'` written as references, for an attribute of XML. */
export function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#x27;");
}

const LINE_BREAK = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/;

/** The lines of a text, without their line breaks and without an empty line after the last break. */
export function splitLines(text: string): string[] {
	const lines = text.split(LINE_BREAK);
	return lines.length > 0 && lines[lines.length - 1] === ""
		? lines.slice(0, -1)
		: lines;
}

/** The text without the white space at its end. */
export function trimEnd(text: string): string {
	return text.replace(/\s+$/, "");
}

/** A text with every character outside printable ASCII written as `\uXXXX`. */
function withAsciiEscapes(json: string): string {
	return json.replace(
		/[\u007f-￿]/g,
		(character) =>
			"\\u" + character.charCodeAt(0).toString(16).padStart(4, "0")
	);
}

/**
 * A number that JSON writes as a float, with a point or an exponent, such as `960.0`, as Python
 * writes a `float`. A plain number of JavaScript is written as JSON writes it, such as `960`.
 */
export class JsonFloat {
	constructor(public readonly value: number) {}
}

/**
 * A value as JSON with every character outside printable ASCII escaped. A `Map` is written as an
 * object, with its members in the order of the map. With an indent, each member and each item is
 * on a line of its own, and without one, a comma is followed by a space and so is the colon of a
 * member.
 */
export function jsonText(value: unknown, indent?: number): string {
	return withAsciiEscapes(serializeJson(value, indent, 0, SPACED));
}

/**
 * A value as JSON with every character outside printable ASCII escaped, on one line, without a
 * space after a comma or a colon.
 */
export function compactJsonText(value: unknown): string {
	return withAsciiEscapes(serializeJson(value, undefined, 0, COMPACT));
}

/** The text between two members or items, and between the key of a member and its value. */
interface JsonSeparators {
	readonly item: string;
	readonly key: string;
}

const SPACED: JsonSeparators = { item: ", ", key: ": " };
const COMPACT: JsonSeparators = { item: ",", key: ":" };

function serializeJson(
	value: unknown,
	indent: number | undefined,
	level: number,
	separators: JsonSeparators
): string {
	if (value instanceof JsonFloat) {
		return floatText(value.value);
	}
	const members: [string | undefined, unknown][] | undefined =
		value instanceof Map
			? [...value].map(([key, member]) => [String(key), member])
			: Array.isArray(value)
			? value.map((item) => [undefined, item])
			: typeof value === "object" && value !== null
			? Object.entries(value).filter(
					([_key, member]) => member !== undefined
			  )
			: undefined;
	if (members === undefined) {
		return JSON.stringify(value) ?? "null";
	}
	const [open, close] = Array.isArray(value) ? ["[", "]"] : ["{", "}"];
	if (members.length === 0) {
		return open + close;
	}
	const written = members.map(
		([key, member]) =>
			(key === undefined ? "" : JSON.stringify(key) + separators.key) +
			serializeJson(member, indent, level + 1, separators)
	);
	if (indent === undefined) {
		return open + written.join(separators.item) + close;
	}
	const inner = "\n" + " ".repeat(indent * (level + 1));
	return (
		open +
		inner +
		written.join("," + inner) +
		"\n" +
		" ".repeat(indent * level) +
		close
	);
}

/** A number rounded to the nearest integer, a half to the even neighbour. */
export function roundHalfToEven(value: number): number {
	const floor = Math.floor(value);
	const fraction = value - floor;
	if (fraction > 0.5) {
		return floor + 1;
	}
	if (fraction < 0.5) {
		return floor;
	}
	return floor % 2 === 0 ? floor : floor + 1;
}

/**
 * The shortest text that reads back as the number, in fixed notation with at least one digit
 * after the point for an exponent from -4 to 15, and as `<digits>e<sign><two digits or more>`
 * otherwise, such as `960.0`, `0.0001` and `1e+16`.
 */
export function floatText(value: number): string {
	if (Number.isNaN(value)) {
		return "nan";
	}
	if (!Number.isFinite(value)) {
		return value > 0 ? "inf" : "-inf";
	}
	const [mantissa, exponentText] = value.toExponential().split("e");
	const exponent = parseInt(exponentText, 10);
	const sign = mantissa.startsWith("-") ? "-" : "";
	const digits = mantissa.replace("-", "").replace(".", "");
	if (exponent < -4 || exponent >= 16) {
		const fraction = digits.slice(1);
		const magnitude = Math.abs(exponent).toString().padStart(2, "0");
		return `${sign}${digits[0]}${fraction ? "." + fraction : ""}e${
			exponent < 0 ? "-" : "+"
		}${magnitude}`;
	}
	if (exponent < 0) {
		return `${sign}0.${"0".repeat(-exponent - 1)}${digits}`;
	}
	const whole = digits.slice(0, exponent + 1).padEnd(exponent + 1, "0");
	const fraction = digits.slice(exponent + 1);
	return `${sign}${whole}.${fraction || "0"}`;
}

/**
 * A path written for an address: every byte of its UTF-8 outside the letters and digits of
 * ASCII, `_`, `.`, `-`, `~` and `/` as `%XX`, as Python's `urllib.parse.quote` writes it.
 */
export function quoteUrlPath(text: string): string {
	return [...Buffer.from(text, "utf8")]
		.map((byte) => {
			const character = String.fromCharCode(byte);
			return /[A-Za-z0-9_.\-~/]/.test(character)
				? character
				: "%" + byte.toString(16).toUpperCase().padStart(2, "0");
		})
		.join("");
}

/**
 * The text with each run of `%XX` read as UTF-8, a byte that is no part of a character read as
 * `�`, and a `%` that starts no `%XX` kept, as Python's `urllib.parse.unquote` reads it.
 */
export function unquoteUrl(text: string): string {
	return text.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) =>
		Buffer.from(
			run
				.split("%")
				.slice(1)
				.map((hexadecimal) => parseInt(hexadecimal, 16))
		).toString("utf8")
	);
}
