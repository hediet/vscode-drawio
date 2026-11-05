/**
 * The conversion of the colors of a deck between TeX files of `\definecolor` lines and the setting
 * `drawSlidesCode.colors` of its `.vscode/settings.json`.
 *
 * The setting is the one place of the colors of a deck: the editor and the build read it, and VS
 * Code shows a swatch and its color picker beside each value. A TeX file is for a paper, or for a
 * deck that kept its colors in one.
 *
 * The import writes the colors of every `\definecolor` of the files, in their order and in any
 * model that `texDefinitions.ts` converts, into `drawSlidesCode.colors` as `#RRGGBB`. The comment
 * lines before a definition become `//` lines before its color, and a comment after a definition
 * on its line becomes a comment after its color. The import replaces the value of that one key in
 * the text of the settings file, or adds the key, and keeps every other key and comment. It stops
 * before it writes on a definition that the setting cannot hold, such as a name with a hyphen.
 *
 * The export writes the colors of the setting as `\definecolor{<name>}{HTML}{<RRGGBB>}` lines,
 * with the comments of the setting as `%` lines, after a first line that names the export and the
 * settings file. The import leaves that first line out, so the two convert back and forth.
 *
 * Yujun Huang grants an additional permission for this file under section 7 of the GNU General
 * Public License, version 3, in LICENSE-EXCEPTION.md of DrawSlidesCode.
 */
import * as fs from "fs";
import * as path from "path";
import { DeckError } from "./deckError";
import { COLOR_NAME, COLOR_VALUE } from "./deckColors";
import { COLORS, DECK_SETTINGS } from "./deckSettings";
import {
	CommentedMember,
	CommentedObject,
	JsonWithCommentsError,
	objectLayout,
	readCommentedObject,
	withMemberObject,
} from "./jsonWithComments";
import {
	colorLines,
	GENERATED_MARK,
	readColorFileText,
} from "./texDefinitions";

/** What a conversion wrote, in one line, and the warnings of the reading of its sources. */
export interface ConversionResult {
	readonly line: string;
	readonly warnings: readonly string[];
}

export function settingsFile(project: string): string {
	return path.join(path.resolve(project), DECK_SETTINGS);
}

/** The colors of the TeX files, in order. Raises `DeckError` on a name that two files define. */
export function colorsFromTex(files: readonly string[]): {
	colors: CommentedObject;
	warnings: string[];
} {
	const members = new Array<CommentedMember>();
	const warnings = new Array<string>();
	let closing: readonly (string | null)[] = [];
	for (const file of files) {
		const read = readColorFileText(file, fs.readFileSync(file, "utf8"));
		warnings.push(...read.warnings);
		const known = new Set(members.map((member) => member.key));
		const repeated = [
			...new Set(read.colors.members.map((member) => member.key)),
		]
			.filter((key) => known.has(key))
			.sort();
		if (repeated.length > 0) {
			throw new DeckError(
				`${file} defines ${repeated.join(
					", "
				)}, which an earlier file defines already`
			);
		}
		const [first, ...rest] = read.colors.members;
		if (members.length > 0 && first !== undefined) {
			members.push(
				{ ...first, comments: [...closing, null, ...first.comments] },
				...rest
			);
		} else {
			members.push(...read.colors.members);
		}
		closing = read.colors.closingComments;
	}
	return { colors: { members, closingComments: closing }, warnings };
}

/** Writes the colors of the TeX files into `drawSlidesCode.colors` of the deck. */
export function importColorsFromTex(
	project: string,
	files: readonly string[]
): ConversionResult {
	const { colors, warnings } = colorsFromTex(files);
	const target = settingsFile(project);
	const text = fs.existsSync(target)
		? fs.readFileSync(target, "utf8")
		: "{\n}\n";
	let written: string;
	try {
		written = withMemberObject(text, COLORS, colors);
	} catch (error) {
		if (
			error instanceof JsonWithCommentsError ||
			error instanceof SyntaxError
		) {
			throw new DeckError(
				`${target} does not read as JSON with comments: ${error.message}`
			);
		}
		throw error;
	}
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.writeFileSync(target, written, "utf8");
	return {
		line: `${colors.members.length} colors of ${files.join(
			", "
		)} written into ${COLORS} of ${target}`,
		warnings,
	};
}

/**
 * The colors of `drawSlidesCode.colors` of the text of a settings file, with their comments.
 * Raises `DeckError` on an entry that is no color.
 */
export function settingColors(target: string, text: string): CommentedObject {
	let colors: CommentedObject;
	try {
		const span = objectLayout(text).values.get(COLORS);
		if (span === undefined) {
			throw new DeckError(`${target} holds no ${COLORS}`);
		}
		colors = readCommentedObject(text, span[0], span[1]);
	} catch (error) {
		if (error instanceof JsonWithCommentsError) {
			throw new DeckError(
				`${target} does not read as JSON with comments: ${error.message}`
			);
		}
		throw error;
	}
	const problems = colors.members
		.filter(
			(member) =>
				!COLOR_NAME.test(member.key) ||
				typeof member.value !== "string" ||
				!COLOR_VALUE.test(member.value)
		)
		.map((member) => `${member.key}: ${JSON.stringify(member.value)}`);
	if (problems.length > 0) {
		throw new DeckError(
			`${COLORS} of ${target} holds entries that are no name of letters and digits with a value #RRGGBB:\n  ${problems.join(
				"\n  "
			)}`
		);
	}
	return colors;
}

/** The text of a TeX file of the colors of a settings file, which `file` is the path of. */
export function colorFileText(
	colors: CommentedObject,
	source: string,
	file: string
): string {
	const relative = path.relative(path.dirname(path.resolve(file)), source);
	return `% ${GENERATED_MARK} from ${COLORS} of ${relative}.\n${colorLines(
		colors
	)}`;
}

/** Writes the colors of `drawSlidesCode.colors` of the deck into a TeX file. */
export function exportColorsToTex(
	project: string,
	file: string
): ConversionResult {
	const source = settingsFile(project);
	if (!fs.existsSync(source)) {
		throw new DeckError(`${source} does not exist`);
	}
	const colors = settingColors(source, fs.readFileSync(source, "utf8"));
	fs.writeFileSync(file, colorFileText(colors, source, file), "utf8");
	return {
		line: `${colors.members.length} colors of ${COLORS} of ${source} written into ${file}`,
		warnings: [],
	};
}
