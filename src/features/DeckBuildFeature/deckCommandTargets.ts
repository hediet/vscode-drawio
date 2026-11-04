import * as fs from "fs";
import * as path from "path";
import { BuildProgress, LanguageIssue } from "../../deck/buildEvents";
import { DIAGRAM, PACKAGE } from "../../deck/deckFiles";
import { escapeHtml } from "../../deck/textFormats";

/**
 * The folder of the deck that holds a path: the nearest folder at or above the path that holds
 * `package.json`, up to `top`, the workspace folder of the path, when given. Undefined when no
 * such folder holds the file.
 */
export function deckFolderAbove(
	start: string,
	top: string | undefined
): string | undefined {
	const folder = path.resolve(start);
	if (fs.existsSync(path.join(folder, PACKAGE))) {
		return folder;
	}
	const parent = path.dirname(folder);
	const isTop =
		parent === folder ||
		(top !== undefined && folder === path.resolve(top));
	return isTop ? undefined : deckFolderAbove(parent, top);
}

/** A place in the text of a file, by its line and its character from 0, as an editor counts them. */
export interface TextPlace {
	readonly line: number;
	readonly character: number;
	readonly length: number;
}

function placeAt(text: string, offset: number, length: number): TextPlace {
	const before = text.slice(0, offset);
	const lineStart = before.lastIndexOf("\n") + 1;
	return {
		line: before.split("\n").length - 1,
		character: offset - lineStart,
		length,
	};
}

/**
 * The place of a cell in the text of a slide file: the attribute `id` of the cell inside the page
 * at the position, or else the start of the page, or else the start of the file.
 */
export function cellPlace(
	text: string,
	pagePosition: number,
	cellId: string
): TextPlace {
	const pages = [...text.matchAll(new RegExp(DIAGRAM.source, "g"))];
	const page = pages[pagePosition];
	if (page === undefined || page.index === undefined) {
		return placeAt(text, 0, 0);
	}
	// The search starts after the tag of the page, whose own id may equal that of the cell, and
	// the space before id keeps an attribute such as pageId out.
	const attribute = ` id="${escapeHtml(cellId)}"`;
	const inPage = page[0].indexOf(attribute, page[0].indexOf(">"));
	return inPage === -1
		? placeAt(text, page.index, "<diagram".length)
		: placeAt(text, page.index + inPage + 1, attribute.length - 1);
}

/** The text of a problem of the language check, with the slide, the page and the cell it is on. */
export function issueText(issue: LanguageIssue): string {
	const kind = issue.isSpelling ? "Spelling" : "Grammar or style";
	const fixes =
		issue.fixes.join(", ") === ""
			? ""
			: ` Suggestions: ${issue.fixes.join(", ")}.`;
	const others =
		issue.otherSlides > 0
			? ` and ${issue.otherSlides} other slide${
					issue.otherSlides > 1 ? "s" : ""
			  }`
			: "";
	return `${kind}: ${issue.message}${fixes} In "${issue.context}", on slide ${issue.slide}${others}, page ${issue.pageName}, cell ${issue.cellId}.`;
}

/** The progress of a step as a message of a notification, such as `export of the pages 3/81`. */
export function progressText(progress: BuildProgress): string {
	return progress.total > 1
		? `${progress.step} ${progress.done}/${progress.total}`
		: progress.step;
}
