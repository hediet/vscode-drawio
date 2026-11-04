/**
 * The conversion of the colours of a deck between TeX files of `\definecolor` lines and the setting
 * `drawioSlides.colors` of its `.vscode/settings.json`.
 *
 * The setting is the one place of the colours of a deck: the editor and the build read it, and VS
 * Code shows a swatch and its colour picker beside each value. A TeX file is for a paper, or for a
 * deck that kept its colours in one.
 *
 * The import writes the colours of every `\definecolor` of the files, in their order and in any
 * model that `texDefinitions.ts` converts, into `drawioSlides.colors` as `#RRGGBB`. The comment
 * lines before a definition become `//` lines before its colour, and a comment after a definition
 * on its line becomes a comment after its colour. The import replaces the value of that one key in
 * the text of the settings file, or adds the key, and keeps every other key and comment. It stops
 * before it writes on a definition that the setting cannot hold, such as a name with a hyphen.
 *
 * The export writes the colours of the setting as `\definecolor{<name>}{HTML}{<RRGGBB>}` lines,
 * with the comments of the setting as `%` lines, after a first line that names the export and the
 * settings file. The import leaves that first line out, so the two convert back and forth.
 *
 * Yujun Huang grants an additional permission for this file under section 7 of the GNU General
 * Public License, version 3, in LICENSE-EXCEPTION.md of Draw.io Slides.
 */
import * as fs from "fs";
import * as path from "path";
import { DeckError } from "./deckError";
import { COLOR_NAME, COLOR_VALUE } from "./deckColours";
import { COLOURS, DECK_SETTINGS } from "./deckSettings";
import {
	CommentedMember,
	CommentedObject,
	JsonWithCommentsError,
	objectLayout,
	readCommentedObject,
	withMemberObject,
} from "./jsonWithComments";
import {
	colourLines,
	GENERATED_MARK,
	readColourFileText,
} from "./texDefinitions";

/** What a conversion wrote, in one line, and the warnings of the reading of its sources. */
export interface ConversionResult {
	readonly line: string;
	readonly warnings: readonly string[];
}

export function settingsFile(project: string): string {
	return path.join(path.resolve(project), DECK_SETTINGS);
}

/** The colours of the TeX files, in order. Raises `DeckError` on a name that two files define. */
export function coloursFromTex(files: readonly string[]): {
	colours: CommentedObject;
	warnings: string[];
} {
	const members = new Array<CommentedMember>();
	const warnings = new Array<string>();
	let closing: readonly (string | null)[] = [];
	for (const file of files) {
		const read = readColourFileText(file, fs.readFileSync(file, "utf8"));
		warnings.push(...read.warnings);
		const known = new Set(members.map((member) => member.key));
		const repeated = [
			...new Set(read.colours.members.map((member) => member.key)),
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
		const [first, ...rest] = read.colours.members;
		if (members.length > 0 && first !== undefined) {
			members.push(
				{ ...first, comments: [...closing, null, ...first.comments] },
				...rest
			);
		} else {
			members.push(...read.colours.members);
		}
		closing = read.colours.closingComments;
	}
	return { colours: { members, closingComments: closing }, warnings };
}

/** Writes the colours of the TeX files into `drawioSlides.colors` of the deck. */
export function importColoursFromTex(
	project: string,
	files: readonly string[]
): ConversionResult {
	const { colours, warnings } = coloursFromTex(files);
	const target = settingsFile(project);
	const text = fs.existsSync(target)
		? fs.readFileSync(target, "utf8")
		: "{\n}\n";
	let written: string;
	try {
		written = withMemberObject(text, COLOURS, colours);
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
		line: `${colours.members.length} colours of ${files.join(
			", "
		)} written into ${COLOURS} of ${target}`,
		warnings,
	};
}

/**
 * The colours of `drawioSlides.colors` of the text of a settings file, with their comments.
 * Raises `DeckError` on an entry that is no colour.
 */
export function settingColours(target: string, text: string): CommentedObject {
	let colours: CommentedObject;
	try {
		const span = objectLayout(text).values.get(COLOURS);
		if (span === undefined) {
			throw new DeckError(`${target} holds no ${COLOURS}`);
		}
		colours = readCommentedObject(text, span[0], span[1]);
	} catch (error) {
		if (error instanceof JsonWithCommentsError) {
			throw new DeckError(
				`${target} does not read as JSON with comments: ${error.message}`
			);
		}
		throw error;
	}
	const problems = colours.members
		.filter(
			(member) =>
				!COLOR_NAME.test(member.key) ||
				typeof member.value !== "string" ||
				!COLOR_VALUE.test(member.value)
		)
		.map((member) => `${member.key}: ${JSON.stringify(member.value)}`);
	if (problems.length > 0) {
		throw new DeckError(
			`${COLOURS} of ${target} holds entries that are no name of letters and digits with a value #RRGGBB:\n  ${problems.join(
				"\n  "
			)}`
		);
	}
	return colours;
}

/** The text of a TeX file of the colours of a settings file, which `file` is the path of. */
export function colourFileText(
	colours: CommentedObject,
	source: string,
	file: string
): string {
	const relative = path.relative(path.dirname(path.resolve(file)), source);
	return `% ${GENERATED_MARK} from ${COLOURS} of ${relative}.\n${colourLines(
		colours
	)}`;
}

/** Writes the colours of `drawioSlides.colors` of the deck into a TeX file. */
export function exportColoursToTex(
	project: string,
	file: string
): ConversionResult {
	const source = settingsFile(project);
	if (!fs.existsSync(source)) {
		throw new DeckError(`${source} does not exist`);
	}
	const colours = settingColours(source, fs.readFileSync(source, "utf8"));
	fs.writeFileSync(file, colourFileText(colours, source, file), "utf8");
	return {
		line: `${colours.members.length} colours of ${COLOURS} of ${source} written into ${file}`,
		warnings: [],
	};
}
