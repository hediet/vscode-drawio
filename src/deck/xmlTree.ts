/**
 * The elements of a page of draw.io, read from its text and written back.
 *
 * The reading keeps what a page holds: the elements, their attributes in the order of the text,
 * and the text between them, with every reference of XML read as its character. It leaves out the
 * comments and the processing instructions, ends every line with a line feed, and reads a tab or
 * a line break written as such inside an attribute as a space, as a parser of XML does.
 *
 * The writing gives an element without content as `<name attribute="value" />`, writes `&`, `<`
 * and `>` as references in text, and also `"`, a tab, a line feed and a carriage return in an
 * attribute, as `&#09;`, `&#10;` and `&#13;` for the last three. A page that is read and written
 * back thus keeps its content, and two builds write it with the same bytes.
 */
import { DeckError } from "./deckError";

export interface XmlElement {
	readonly tag: string;
	/** The attributes in the order of the text, each a name and its value. */
	readonly attributes: readonly (readonly [string, string])[];
	/** The text before the first child, or undefined for none. */
	readonly text: string | undefined;
	/** The text after the end of the element and before the next tag, or undefined for none. */
	readonly tail: string | undefined;
	readonly children: readonly XmlElement[];
}

/** An element as the reader builds it, before it is handed out as an `XmlElement`. */
interface ElementUnderConstruction {
	readonly tag: string;
	readonly attributes: [string, string][];
	text: string | undefined;
	tail: string | undefined;
	readonly children: ElementUnderConstruction[];
}

const NAME = /[A-Za-z_:][-A-Za-z0-9_:.·À-￿]*/y;
const SPACE = /[ \t\n\r]*/y;
const PREDEFINED: Readonly<Record<string, string>> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
};

/** The value of an attribute of the element, or undefined. */
export function attribute(
	element: XmlElement,
	name: string
): string | undefined {
	return element.attributes.find(([key]) => key === name)?.[1];
}

/** The attributes of the element as an object. */
export function attributeObject(element: XmlElement): Record<string, string> {
	return element.attributes.reduce(
		(object, [key, value]) => ({ ...object, [key]: value }),
		{} as Record<string, string>
	);
}

/** The element with the attribute set, in its place when the element has it, or else last. */
export function withAttribute(
	element: XmlElement,
	name: string,
	value: string
): XmlElement {
	const has = element.attributes.some(([key]) => key === name);
	return {
		...element,
		attributes: has
			? element.attributes.map(
					([key, old]) => [key, key === name ? value : old] as const
			  )
			: [...element.attributes, [name, value] as const],
	};
}

/** The element with one of its children replaced. */
export function withChildReplaced(
	element: XmlElement,
	old: XmlElement,
	replacement: XmlElement
): XmlElement {
	return {
		...element,
		children: element.children.map((found) =>
			found === old ? replacement : found
		),
	};
}

/** The first child of the element with the tag, or undefined. */
export function child(
	element: XmlElement,
	tag: string
): XmlElement | undefined {
	return element.children.find((found) => found.tag === tag);
}

/** The element at the end of a path of tags, each the first child of that tag, or undefined. */
export function descendant(
	element: XmlElement,
	tags: readonly string[]
): XmlElement | undefined {
	return tags.reduce<XmlElement | undefined>(
		(found, tag) => (found === undefined ? undefined : child(found, tag)),
		element
	);
}

/** Reads the text of one element, which may be preceded and followed by comments and white space. */
export function parseXml(source: string): XmlElement {
	return new XmlReader(source.replace(/\r\n?/g, "\n")).readDocument();
}

class XmlReader {
	private index = 0;

	constructor(private readonly text: string) {}

	public readDocument(): XmlElement {
		this.skipMisc();
		if (!this.text.startsWith("<", this.index)) {
			this.fail("the text holds no element");
		}
		const root = this.readElement();
		this.skipMisc();
		if (this.index < this.text.length) {
			this.fail("the text goes on after its element");
		}
		return root;
	}

	private fail(reason: string): never {
		throw new DeckError(`${reason}, at character ${this.index}`);
	}

	private skipMisc(): void {
		for (;;) {
			this.skipSpace();
			if (this.text.startsWith("<?", this.index)) {
				this.skipPast("?>");
			} else if (this.text.startsWith("<!--", this.index)) {
				this.skipPast("-->");
			} else if (this.text.startsWith("<!DOCTYPE", this.index)) {
				this.fail("a document type declaration is not read");
			} else {
				return;
			}
		}
	}

	private skipSpace(): void {
		SPACE.lastIndex = this.index;
		SPACE.exec(this.text);
		this.index = SPACE.lastIndex;
	}

	private skipPast(end: string): string {
		const found = this.text.indexOf(end, this.index);
		if (found < 0) {
			this.fail(`${end} is missing`);
		}
		const skipped = this.text.slice(this.index, found);
		this.index = found + end.length;
		return skipped;
	}

	private readName(): string {
		NAME.lastIndex = this.index;
		const match = NAME.exec(this.text);
		if (match === null) {
			this.fail("a name is missing");
		}
		this.index = NAME.lastIndex;
		return match[0];
	}

	private readElement(): ElementUnderConstruction {
		this.index += 1;
		const tag = this.readName();
		const element: ElementUnderConstruction = {
			tag,
			attributes: [],
			text: undefined,
			tail: undefined,
			children: [],
		};
		for (;;) {
			const before = this.index;
			this.skipSpace();
			if (this.text.startsWith("/>", this.index)) {
				this.index += 2;
				return element;
			}
			if (this.text.startsWith(">", this.index)) {
				this.index += 1;
				break;
			}
			if (this.index === before) {
				this.fail(`the tag ${tag} lacks a space before an attribute`);
			}
			const name = this.readName();
			this.skipSpace();
			if (!this.text.startsWith("=", this.index)) {
				this.fail(`the attribute ${name} has no value`);
			}
			this.index += 1;
			this.skipSpace();
			const quote = this.text[this.index];
			if (quote !== '"' && quote !== "'") {
				this.fail(`the value of the attribute ${name} has no quote`);
			}
			this.index += 1;
			const raw = this.skipPast(quote);
			if (raw.includes("<")) {
				this.fail(`the value of the attribute ${name} holds <`);
			}
			if (element.attributes.some(([key]) => key === name)) {
				this.fail(`the tag ${tag} holds the attribute ${name} twice`);
			}
			element.attributes.push([
				name,
				this.readReferences(raw.replace(/[\t\n]/g, " ")),
			]);
		}
		this.readContent(element);
		return element;
	}

	/** Reads the children and the text of an element up to its end tag. */
	private readContent(element: ElementUnderConstruction): void {
		let data = "";
		let last: ElementUnderConstruction | undefined;
		const flush = () => {
			if (data === "") {
				return;
			}
			if (last === undefined) {
				element.text = data;
			} else {
				last.tail = data;
			}
			data = "";
		};
		for (;;) {
			const next = this.text.indexOf("<", this.index);
			if (next < 0) {
				this.fail(`the element ${element.tag} does not end`);
			}
			data += this.readReferences(this.text.slice(this.index, next));
			this.index = next;
			if (this.text.startsWith("</", this.index)) {
				this.index += 2;
				const name = this.readName();
				if (name !== element.tag) {
					this.fail(
						`the element ${element.tag} ends with the tag of ${name}`
					);
				}
				this.skipSpace();
				if (!this.text.startsWith(">", this.index)) {
					this.fail(`the end tag of ${name} does not close`);
				}
				this.index += 1;
				flush();
				return;
			}
			if (this.text.startsWith("<!--", this.index)) {
				this.index += 4;
				this.skipPast("-->");
			} else if (this.text.startsWith("<![CDATA[", this.index)) {
				this.index += 9;
				data += this.skipPast("]]>");
			} else if (this.text.startsWith("<?", this.index)) {
				this.skipPast("?>");
			} else {
				flush();
				last = this.readElement();
				element.children.push(last);
			}
		}
	}

	private readReferences(raw: string): string {
		if (!raw.includes("&")) {
			return raw;
		}
		return raw.replace(/&([^;&]*);?/g, (whole, reference: string) => {
			if (!whole.endsWith(";")) {
				this.fail(`the reference ${whole} does not end with ;`);
			}
			if (reference.startsWith("#x")) {
				return String.fromCodePoint(parseInt(reference.slice(2), 16));
			}
			if (reference.startsWith("#")) {
				return String.fromCodePoint(parseInt(reference.slice(1), 10));
			}
			if (!Object.prototype.hasOwnProperty.call(PREDEFINED, reference)) {
				this.fail(`the entity ${whole} is not defined`);
			}
			return PREDEFINED[reference];
		});
	}
}

function escapeText(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function escapeAttribute(text: string): string {
	return escapeText(text)
		.replace(/"/g, "&quot;")
		.replace(/\r/g, "&#13;")
		.replace(/\n/g, "&#10;")
		.replace(/\t/g, "&#09;");
}

/** The text of an element and of its children, without its own tail. */
export function serializeXml(element: XmlElement): string {
	const parts = new Array<string>();
	writeElement(element, parts, false);
	return parts.join("");
}

function writeElement(
	element: XmlElement,
	parts: string[],
	withTail: boolean
): void {
	parts.push("<", element.tag);
	for (const [name, value] of element.attributes) {
		parts.push(" ", name, '="', escapeAttribute(value), '"');
	}
	if (element.text || element.children.length > 0) {
		parts.push(">");
		if (element.text) {
			parts.push(escapeText(element.text));
		}
		for (const found of element.children) {
			writeElement(found, parts, true);
		}
		parts.push("</", element.tag, ">");
	} else {
		parts.push(" />");
	}
	if (withTail && element.tail) {
		parts.push(escapeText(element.tail));
	}
}
