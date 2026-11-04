/**
 * The TeX definitions a draw.io page needs before MathJax can typeset its formulas, and the
 * `\definecolor` lines of TeX files of colors.
 *
 * draw.io's MathJax knows no color by the name a deck gives it and lacks a few commands of LaTeX
 * packages, so a page carries the definitions in a label of its own. The colors of a deck are
 * the setting `drawioSlides.colors`, and this module writes the definitions a text uses in the
 * model RGB, which the MathJax of draw.io reads, as the editor gives them to MathJax. The commands
 * that MathJax lacks are the lines of `drawio-custom-plugins/slides/mathjax-commands.tex`.
 *
 * The module also reads the `\definecolor` lines of a TeX file, in the models `rgb`, `RGB`,
 * `HTML`, `gray`, `Gray`, `cmy` and `cmyk`, converted as the package xcolor converts them:
 *
 *     readCommentedColors("% The greens.\n\\definecolor{green}{rgb}{0.0, 0.5, 0.0}")
 *
 * gives the member `green` with the value `#008000` and the comment `The greens.`, which
 * `colorLines` writes back as
 *
 *     % The greens.
 *     \definecolor{green}{HTML}{008000}
 *
 * Yujun Huang grants an additional permission for this file under section 7 of the GNU General
 * Public License, version 3, in LICENSE-EXCEPTION.md of Draw.io Slides.
 */
import { DeckError } from "./deckError";
import { COLOR_NAME } from "./deckColors";
import {
	CommentedMember,
	CommentedObject,
	withoutTrailingBlanks,
} from "./jsonWithComments";
import { roundHalfToEven, splitLines, trimEnd } from "./textFormats";

const COMMAND_LINE = /^\\def\\([A-Za-z]+)\{(.*)\}\s*$/;
const DEFINE_COLOR =
	/\\definecolor\s*\{([^}]*)\}\s*\{([^}]*)\}\s*\{([^}]*)\}/g;
/** A comment of TeX starts at a `%` that no backslash escapes. */
const TEX_COMMENT = /(?<!\\)%/;
const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
/**
 * The start of the comment on the first line of a file of colors that the export to TeX writes,
 * which the import leaves out, so that the file converts back without it.
 */
export const GENERATED_MARK =
	"Written by the command Export Colors to TeX of Draw.io Slides";
/** The marks of the files of colors that earlier exports wrote, which the import leaves out as well. */
const EARLIER_GENERATED_MARKS = [
	"Written by tools/draw-io/color-settings.py to-tex",
];

/**
 * One `\definecolor` of a TeX text: the name, the color as `#rrggbb`, or undefined for a model
 * or values that this module does not read, and the model.
 */
export interface ColorDefinition {
	readonly name: string;
	readonly value: string | undefined;
	readonly model: string;
}

/**
 * The colors of a TeX text, as members of `drawioSlides.colors` with the comment lines before
 * each, the definitions that the setting cannot hold, and the numbers of the lines of other TeX.
 */
export interface CommentedColors {
	readonly colors: CommentedObject;
	readonly problems: readonly string[];
	readonly otherLines: readonly number[];
}

function parseNumber(text: string): number | undefined {
	return DECIMAL.test(text) ? Number(text) : undefined;
}

/**
 * The red, green and blue between 0 and 1 of a color of the models `rgb`, `RGB`, `gray`,
 * `Gray`, `cmy` and `cmyk`, converted as the package xcolor converts them, or undefined.
 */
export function toRedGreenBlue(
	model: string,
	values: string
): [number, number, number] | undefined {
	const parsed = values
		.replace(/ /g, "")
		.split(",")
		.filter((value) => value !== "")
		.map(parseNumber);
	if (parsed.some((value) => value === undefined)) {
		return undefined;
	}
	const numbers = parsed as number[];
	if (
		(model === "rgb" || model === "RGB" || model === "cmy") &&
		numbers.length === 3
	) {
		const scale = model === "RGB" ? 255 : 1;
		const [red, green, blue] = numbers.map((number) => number / scale);
		return model === "cmy"
			? [1 - red, 1 - green, 1 - blue]
			: [red, green, blue];
	}
	if ((model === "gray" || model === "Gray") && numbers.length === 1) {
		const grey = numbers[0] / (model === "Gray" ? 15 : 1);
		return [grey, grey, grey];
	}
	if (model === "cmyk" && numbers.length === 4) {
		const black = numbers[3];
		const [cyan, magenta, yellow] = numbers.map(
			(ink) => 1 - Math.min(1, ink + black)
		);
		return [cyan, magenta, yellow];
	}
	return undefined;
}

/** A color of one of the models of `\definecolor` as `#rrggbb`, or undefined. */
export function colorValue(model: string, values: string): string | undefined {
	if (model === "HTML") {
		const digits = values.trim().toLowerCase();
		return /^[0-9a-f]{6}$/.test(digits) ? "#" + digits : undefined;
	}
	const channels = toRedGreenBlue(model, values);
	if (channels === undefined) {
		return undefined;
	}
	return (
		"#" +
		channels
			.map((channel) =>
				Math.max(0, Math.min(255, roundHalfToEven(channel * 255)))
					.toString(16)
					.padStart(2, "0")
			)
			.join("")
	);
}

function definitionMatches(text: string): RegExpExecArray[] {
	const pattern = new RegExp(DEFINE_COLOR.source, "g");
	const found = new Array<RegExpExecArray>();
	for (
		let match = pattern.exec(text);
		match !== null;
		match = pattern.exec(text)
	) {
		found.push(match);
	}
	return found;
}

/** Every `\definecolor` of a TeX text, in the order of the text. */
export function readDefinitions(text: string): ColorDefinition[] {
	return definitionMatches(text).map(([_whole, name, model, values]) => ({
		name,
		value: colorValue(model.trim(), values),
		model: model.trim(),
	}));
}

/** A warning for each definition of a file of colors that this module cannot read. */
export function unreadDefinitionWarnings(
	file: string,
	definitions: readonly ColorDefinition[]
): string[] {
	return definitions
		.filter((definition) => definition.value === undefined)
		.map(
			(definition) =>
				`${file} defines ${definition.name} in the model ${definition.model} with values that are not converted, so the color is left out`
		);
}

/** The TeX of a line and its comment, without the `%` and the space after it, or undefined. */
function splitComment(line: string): {
	tex: string;
	comment: string | undefined;
} {
	const found = TEX_COMMENT.exec(line);
	if (found === null) {
		return { tex: line, comment: undefined };
	}
	const comment = line.slice(found.index + 1);
	return {
		tex: line.slice(0, found.index),
		comment: comment.startsWith(" ") ? comment.slice(1) : comment,
	};
}

function isGeneratedMark(comment: string): boolean {
	return [GENERATED_MARK, ...EARLIER_GENERATED_MARKS].some((mark) =>
		comment.startsWith(mark)
	);
}

/**
 * The colors of every `\definecolor` of a TeX text, in its order, each as `#RRGGBB` in capitals
 * with the comment lines between it and the definition before it, `null` for a blank line among
 * them, and the comment after it on its line.
 *
 * A definition in a model or with values that this module does not convert, a name that is not
 * letters and digits that start with a letter, and a second definition of a name are problems.
 * A line that holds TeX other than definitions is left out and listed by its number.
 */
export function readCommentedColors(text: string): CommentedColors {
	const members = new Array<CommentedMember>();
	const problems = new Array<string>();
	const otherLines = new Array<number>();
	let pending = new Array<string | null>();
	splitLines(text).forEach((line, lineIndex) => {
		const number = lineIndex + 1;
		const { tex, comment } = splitComment(line);
		const definitions = definitionMatches(tex);
		const holdsOtherTex = tex.replace(DEFINE_COLOR, "").trim() !== "";
		if (definitions.length === 0) {
			if (holdsOtherTex) {
				otherLines.push(number);
			} else if (
				comment !== undefined &&
				!(number === 1 && isGeneratedMark(comment))
			) {
				pending.push(trimEnd(comment));
			} else if (
				comment === undefined &&
				(members.length > 0 || pending.length > 0) &&
				(pending.length === 0 || pending[pending.length - 1] !== null)
			) {
				pending.push(null);
			}
			return;
		}
		if (holdsOtherTex) {
			otherLines.push(number);
		}
		definitions.forEach((found, position) => {
			const [name, model, values] = found
				.slice(1)
				.map((part) => part.trim());
			const value = colorValue(model, values);
			if (value === undefined) {
				problems.push(
					`line ${number} defines ${name} in the model ${model} with values that are not converted`
				);
				return;
			}
			if (!COLOR_NAME.test(name)) {
				problems.push(
					`line ${number} defines ${JSON.stringify(
						name
					)}, which is not letters and digits that start with a letter`
				);
				return;
			}
			if (members.some((member) => member.key === name)) {
				problems.push(`line ${number} defines ${name} a second time`);
				return;
			}
			const isLast = position === definitions.length - 1;
			members.push({
				key: name,
				value: value.toUpperCase(),
				comments: pending,
				trailing:
					isLast && comment !== undefined
						? trimEnd(comment)
						: undefined,
			});
			pending = [];
		});
	});
	return {
		colors: { members, closingComments: withoutTrailingBlanks(pending) },
		problems,
		otherLines,
	};
}

/** The colors of a TeX file read by `readCommentedColors`, and a warning for the lines of other TeX. */
export interface ColorFile {
	readonly colors: CommentedObject;
	readonly warnings: readonly string[];
}

/**
 * The colors of the text of a TeX file, with their comments. Raises `DeckError` on a problem of
 * `readCommentedColors`.
 */
export function readColorFileText(file: string, text: string): ColorFile {
	const read = readCommentedColors(text);
	if (read.problems.length > 0) {
		throw new DeckError(
			`${file} holds colors that drawioSlides.colors cannot hold:\n  ${read.problems.join(
				"\n  "
			)}`
		);
	}
	return {
		colors: read.colors,
		warnings:
			read.otherLines.length > 0
				? [
						`the lines ${read.otherLines.join(
							", "
						)} of ${file} hold TeX other than \\definecolor, which is left out`,
				  ]
				: [],
	};
}

/**
 * The colors as `\definecolor` lines in the model HTML, each comment of a member before it as a
 * `%` line, and a trailing comment after its definition.
 */
export function colorLines(colors: CommentedObject): string {
	const comment = (line: string | null | undefined): string =>
		line === null || line === undefined ? "" : line ? "% " + line : "%";
	const lines = new Array<string>();
	for (const member of colors.members) {
		lines.push(...member.comments.map(comment));
		const definition = `\\definecolor{${member.key}}{HTML}{${String(
			member.value
		)
			.slice(1)
			.toUpperCase()}}`;
		lines.push(
			member.trailing === undefined
				? definition
				: definition + " " + comment(member.trailing)
		);
	}
	lines.push(...colors.closingComments.map(comment));
	return lines.map((line) => line + "\n").join("");
}

/** The definition of a color `#RRGGBB` in the model `RGB`, which the MathJax of draw.io reads. */
export function colorDefinition(name: string, value: string): string {
	const [red, green, blue] = [1, 3, 5].map((start) =>
		parseInt(value.slice(start, start + 2), 16)
	);
	return `\\definecolor{${name}}{RGB}{${red},${green},${blue}}`;
}

/** The lines of `mathjax-commands.tex` other than blank lines and comments, each one `\def`. */
export function mathCommandLines(text: string): string[] {
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "" && !line.startsWith("%"));
}

/**
 * The commands that MathJax lacks, name to body, from the text of `mathjax-commands.tex`, whose
 * lines other than comments are each one `\def` of one command. Raises `DeckError` on another line.
 */
export function readMissingCommands(
	file: string,
	text: string
): Map<string, string> {
	return new Map(
		mathCommandLines(text).map((line): [string, string] => {
			const match = COMMAND_LINE.exec(line);
			if (match === null) {
				throw new DeckError(
					`${file} holds ${JSON.stringify(
						line
					)}, which is no \\def of one command`
				);
			}
			return [match[1], match[2]];
		})
	);
}

/** The definition of a command that MathJax lacks. */
export function commandDefinition(name: string, body: string): string {
	return `\\def\\${name}{${body}}`;
}
