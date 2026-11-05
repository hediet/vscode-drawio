/**
 * The uses of a color of `drawSlidesCode.colors` in the drawing files of a deck, read and edited one
 * page at a time by `deckColorLinks.ts`.
 *
 * The drawing files of a deck are its section files, or its multi-page file, its templates, and
 * the open drawings of the deck whose text is the XML of draw.io.
 * A page that defines a color itself in its layer of definitions keeps the formulas that name it,
 * because its own definition colors them.
 */
import * as fs from "fs";
import * as path from "path";
import { pageDefinitions } from "./deckAssembly";
import {
	addedColorUses,
	ColorUseEdit,
	ColorUses,
	formulaUsesOfPage,
	linkedUsesOf,
	NO_COLOR_USES,
	withFormulaUseEdit,
	withLinkedUseEdit,
} from "./deckColorLinks";
import {
	configSetting,
	DIAGRAM,
	findSlidesLocation,
	readDeckConfigOrDefaults,
	SUFFIX,
} from "./deckFiles";

/** The text of a drawing file after the edit of the uses of a color, page by page. */
export function withColorUseEditInDrawing(
	text: string,
	edit: ColorUseEdit
): string {
	return text.replace(new RegExp(DIAGRAM.source, "g"), (page) => {
		const linked = withLinkedUseEdit(page, edit);
		return edit.operation === "set" || definesColor(page, edit.name)
			? linked
			: withFormulaUseEdit(linked, edit);
	});
}

/** The text of a drawing file after the edits of the uses of colors, one after the other. */
export function withColorUseEditsInDrawing(
	text: string,
	edits: readonly ColorUseEdit[]
): string {
	return edits.reduce(withColorUseEditInDrawing, text);
}

/** The uses of a color in the pages of a drawing file. */
export function colorUsesInDrawing(text: string, name: string): ColorUses {
	return (text.match(new RegExp(DIAGRAM.source, "g")) ?? []).reduce(
		(uses, page) =>
			addedColorUses(uses, {
				...linkedUsesOf(page, name),
				formula: definesColor(page, name)
					? 0
					: formulaUsesOfPage(page, name),
			}),
		NO_COLOR_USES
	);
}

/** The endings of the names of the drawing files whose text is the XML of draw.io. */
const XML_DRAWING_ENDINGS = [".drawio", ".dio", ".drawio.xml"];

/**
 * The drawing files of a deck, once each: the section files, the templates, and each open drawing
 * of the deck whose name ends in `.drawio`, `.dio` or `.drawio.xml`. A `.drawio.png` holds no
 * text and a `.drawio.svg` holds the XML escaped, so an edit of the uses of a color leaves both
 * out.
 */
export function deckDrawingFiles(
	sectionFiles: readonly string[],
	templates: readonly string[],
	openDrawings: readonly string[]
): string[] {
	const xmlDrawings = openDrawings.filter((file) =>
		XML_DRAWING_ENDINGS.some((ending) => file.toLowerCase().endsWith(ending))
	);
	return [...new Set([...sectionFiles, ...templates, ...xmlDrawings])];
}

/**
 * The section files of a deck folder, or its multi-page file, as `config` of its `package.json`
 * names them, in the order of their names, or none for a folder that holds neither.
 */
export function deckSectionFiles(folder: string): string[] {
	const config = readDeckConfigOrDefaults(folder);
	const location = findSlidesLocation(
		folder,
		configSetting("slides-dir", undefined, config)!,
		configSetting("deck", undefined, config)!
	);
	if (location === undefined) {
		return [];
	}
	if (!location.isFolder) {
		return [location.location];
	}
	return fs
		.readdirSync(location.location)
		.filter((name) => name.endsWith(SUFFIX))
		.sort()
		.map((name) => path.join(location.location, name));
}

function definesColor(page: string, name: string): boolean {
	return pageDefinitions(page).includes(`\\definecolor{${name}}`);
}
