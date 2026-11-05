/**
 * The assembled deck: the section files joined into `build/assembled.drawio.xml`, from which the
 * export draws one SVG per page, and the outline of the deck in `build/outline.json`, from which
 * the PDF takes its bookmarks.
 *
 * The assembly gives each use of a color that links to a color of `drawSlidesCode.colors` the value
 * of that color, as `deckColorLinks.ts` says, fills in each cell that holds `%slide%` or
 * `%slides%` with the slide's number and the total without the backup slides, writes into each
 * page the TeX definitions its formulas use and it does not define, draws each cell of an
 * embedded page as a picture of that page, and writes each picture of `assets/` into its cell as
 * data. A page whose name ends in `-hide` is left out, as `deckFiles.ts` says.
 *
 * Yujun Huang grants an additional permission for this file under section 7 of the GNU General
 * Public License, version 3, in LICENSE-EXCEPTION.md of DrawSlidesCode.
 */
import * as fs from "fs";
import * as path from "path";
import { DeckError } from "./deckError";
import {
	configSetting,
	DeckConfig,
	deckOutline,
	DeckPage,
	findSlidesLocation,
	isBackupPage,
	isHiddenPage,
	mainTotal,
	numberSlides,
	PAGE_NAME,
	readDeckConfig,
	readSectionFolder,
	readSingleFile,
	repeatedNames,
	Section,
	sectionPages,
	shownPages,
	stepProblems,
	titleOf,
} from "./deckFiles";
import { withLinkedColorValues } from "./deckColorLinks";
import { colorNamesOf, formulasOfPage } from "./formulaColors";
import { embedPictures } from "./deckPictures";
import { PagePictures, withPagePictures } from "./pageSnapshots";
import { colorDefinition, commandDefinition } from "./texDefinitions";
import { escapeHtml, jsonText, unescapeHtml } from "./textFormats";

/** What a cell writes to have the build fill in the slide's number. */
export const SLIDE_PLACEHOLDER = "%slide%";
/** What a cell writes to have the build fill in the deck's total. */
export const TOTAL_PLACEHOLDER = "%slides%";
/** The `host` of the assembled file, which names the program that wrote it. */
const ASSEMBLED_HOST = "DrawSlidesCode";

const DEFINITIONS_LAYER = "Equation colors, added by the build";
/**
 * The root cell of a page, written as a bare cell, or by the editor as an object that carries
 * data, `<UserObject id="0"><mxCell /></UserObject>`.
 */
const ROOT_CELL =
	/<mxCell id="([^"]+)"(?![^>]*parent=)[^>]*\/>|<(UserObject|object)\b[^>]*?\bid="([^"]+)"[^>]*>\s*<mxCell\s*\/>\s*<\/\2>/;
const CELL = /<mxCell\b([^>]*)>/g;
const ATTRIBUTE = /(\w+)="([^"]*)"/g;
const MATH_ON = /<mxGraphModel\b[^>]*\bmath="1"/;
const MODEL = /<mxGraphModel ([^>]*)>/;
/**
 * Names MathJax draws without a definition. Its color extension knows the dvips names, which are
 * capitalised, such as `Apricot`, and passes any other name on to the browser, which knows the
 * color keywords of CSS. A lower-case name outside the setting drawSlidesCode.colors and outside
 * this list is most likely a typo, which MathJax would draw black.
 */
const CSS_COLORS = new Set(
	`aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet
brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue
darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen
darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey
darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite
forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew
hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue
lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon
lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime
limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple
mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue
mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid
palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum
powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen
seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal
thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen`.split(
		/\s+/
	)
);

/** The facts of `config` with each one that the command line leaves out taken from `package.json` or its default. */
export interface DeckOptions {
	readonly title: string | undefined;
	readonly slidesDir: string;
	readonly deck: string;
}

/** The pages that a deck presents, where they were read from, and the names of the hidden pages. */
export interface DeckSlides {
	readonly slides: readonly DeckPage[];
	/** The slides folder or the multi-page file, as the options name it. */
	readonly source: string;
	readonly hidden: readonly string[];
}

/** The size of a page of the assembled deck, and its name as the page writes it. */
export interface AssembledPage {
	readonly name: string;
	readonly width: number;
	readonly height: number;
}

/** The text of the assembled deck, its pages, the total that it shows, and the warnings of the assembly. */
export interface AssembledDeck {
	readonly text: string;
	readonly pages: readonly AssembledPage[];
	readonly total: number;
	readonly warnings: readonly string[];
}

/** The inputs of the assembly beyond the pages. */
export interface AssemblyInputs {
	/** The folder of the deck, whose `assets/` the pictures are read from. */
	readonly project: string;
	/** The colors of `drawSlidesCode.colors`, name to `#RRGGBB`. */
	readonly colors: ReadonlyMap<string, string>;
	/** The commands that MathJax lacks, name to body. */
	readonly missingCommands: ReadonlyMap<string, string>;
	readonly pictures: PagePictures;
}

/**
 * The options of a deck: each one given, or else the one of `config` of its `package.json`, or
 * else its default.
 */
export function deckOptions(
	project: string,
	given: Partial<DeckOptions> = {}
): DeckOptions {
	const config: DeckConfig = readDeckConfig(path.resolve(project));
	return {
		title: configSetting("title", given.title, config),
		slidesDir: configSetting("slides-dir", given.slidesDir, config)!,
		deck: configSetting("deck", given.deck, config)!,
	};
}

/**
 * The pages that the deck presents and where they were read from. Pages whose name ends in
 * `-hide` are left out and listed. Raises `DeckError` for a deck that holds neither its slides
 * folder nor its multi-page file, and for a section file that the reading refuses.
 */
export function readDeckSlides(
	project: string,
	options: DeckOptions
): DeckSlides {
	const folder = path.resolve(project);
	const found = findSlidesLocation(folder, options.slidesDir, options.deck);
	if (found === undefined) {
		throw new DeckError(
			`${folder} holds neither ${options.slidesDir}/ nor ${options.deck}. Run the command Set Up a Presentation in This Folder to start a presentation.`
		);
	}
	let pages: DeckPage[];
	try {
		pages = found.isFolder
			? readSectionFolder(found.location)
			: readSingleFile(found.location);
	} catch (error) {
		if (error instanceof DeckError) {
			throw new DeckError(`${found.location}: ${error.message}`);
		}
		throw error;
	}
	return {
		slides: shownPages(pages),
		source: found.isFolder ? options.slidesDir : options.deck,
		hidden: pages.filter(isHiddenPage).map((page) => page.pageName),
	};
}

/** The line that names the hidden pages, or undefined when no page is hidden. */
export function hiddenLine(hidden: readonly string[]): string | undefined {
	return hidden.length === 0
		? undefined
		: `${hidden.length} ${
				hidden.length === 1 ? "page" : "pages"
		  } hidden: ${hidden.join(", ")}`;
}

function attributesOf(text: string): Record<string, string> {
	const attributes: Record<string, string> = {};
	for (const match of matchesOf(ATTRIBUTE, text)) {
		attributes[match[1]] = match[2];
	}
	return attributes;
}

function matchesOf(pattern: RegExp, text: string): RegExpExecArray[] {
	const global = new RegExp(pattern.source, "g");
	const found = new Array<RegExpExecArray>();
	for (
		let match = global.exec(text);
		match !== null;
		match = global.exec(text)
	) {
		found.push(match);
	}
	return found;
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The text of the labels in the page's layers of definitions. A definition counts only there, in
 * a layer declared before the drawing, because a definition in a tooltip or in a label typeset
 * after the formula does not reach the formula in the viewer or in the editor.
 */
export function pageDefinitions(diagram: string): string {
	const cells = matchesOf(CELL, diagram).map((match) =>
		attributesOf(match[1])
	);
	const layers = new Set(
		cells
			.filter(
				(cell) =>
					cell.value === "Equation colors" ||
					cell.value === DEFINITIONS_LAYER
			)
			.map((cell) => cell.id)
	);
	return cells
		.filter((cell) => cell.parent !== undefined && layers.has(cell.parent))
		.map((cell) => unescapeHtml(cell.value ?? ""))
		.join("");
}

function isLowerCaseLetter(character: string): boolean {
	return (
		character !== "" &&
		character.toLowerCase() === character &&
		character.toUpperCase() !== character
	);
}

/**
 * The definitions a page's formulas use and the page does not write, and the names of colors
 * that neither the page nor the colors define. A person who types `\textcolor{accent}{x}` on a
 * page without definitions sees the color in the editor through the plugin, and every other
 * renderer needs the definition on the page. A definition the page writes in its own layer of
 * definitions is left to the page.
 */
export function missingDefinitions(
	diagram: string,
	colors: ReadonlyMap<string, string>,
	missingCommands: ReadonlyMap<string, string>
): { definitions: string; unknown: string[] } {
	const own = pageDefinitions(diagram);
	const names = new Set(formulasOfPage(diagram).flatMap(colorNamesOf));
	const needed = new Array<string>();
	const unknown = new Array<string>();
	for (const name of [...names].sort()) {
		if (
			new RegExp(`\\\\definecolor\\{${escapeRegExp(name)}\\}`).test(own)
		) {
			continue;
		}
		const value = colors.get(name);
		if (value !== undefined) {
			needed.push(colorDefinition(name, value));
		} else if (
			isLowerCaseLetter(name.slice(0, 1)) &&
			!CSS_COLORS.has(name)
		) {
			unknown.push(name);
		}
	}
	for (const name of [...missingCommands.keys()].sort()) {
		if (
			new RegExp(`\\\\${name}(?![A-Za-z])`).test(diagram) &&
			!new RegExp(`\\\\def\\\\${name}(?![A-Za-z])`).test(own)
		) {
			needed.push(commandDefinition(name, missingCommands.get(name)!));
		}
	}
	return { definitions: needed.join(""), unknown };
}

export function isMathEnabled(diagram: string): boolean {
	return MATH_ON.test(diagram);
}

/**
 * The page with the definitions in a layer of their own, declared before every other layer. The
 * viewer of the export and the editor keep a definition only for the labels typeset after it, and
 * they typeset the layers in the order the root lists them.
 */
export function withDefinitions(
	diagram: string,
	definitions: string,
	pageId: string
): string {
	if (definitions === "") {
		return diagram;
	}
	const root = ROOT_CELL.exec(diagram);
	if (root === null) {
		throw new DeckError(
			`the page ${pageId} has no root cell to put its definitions under`
		);
	}
	const layer = `${pageId}-build-definitions`;
	const cells =
		`<mxCell id="${layer}" parent="${
			root[1] ?? root[3]
		}" style="locked=1;" value="${DEFINITIONS_LAYER}" />` +
		`<mxCell id="${layer}-label" parent="${layer}" style="text;html=1;strokeColor=none;fillColor=none;` +
		`align=left;verticalAlign=top;whiteSpace=nowrap;overflow=visible;fontSize=1;" ` +
		`value="\\(${escapeHtml(
			definitions
		)}\\)" vertex="1"><mxGeometry width="1" height="1" as="geometry" />` +
		`</mxCell>`;
	const end = root.index + root[0].length;
	return diagram.slice(0, end) + cells + diagram.slice(end);
}

/** The warnings on the names and the steps of the slides, before the pages are assembled. */
function slideNameWarnings(slides: readonly DeckPage[]): string[] {
	return [
		...[...repeatedNames(slides)]
			.sort(([first], [second]) =>
				first < second ? -1 : first > second ? 1 : 0
			)
			.map(
				([name, found]) =>
					`the name ${jsonText(name)} starts slides ${found.join(
						", "
					)}, so they are counted as different slides. Rename one of them or move its pages next to the others.`
			),
		...stepProblems(slides).map(
			({ number, name, steps }) =>
				`slide ${number}, ${jsonText(name)}, has the steps ${steps.join(
					", "
				)} in page order, where 1 to ${steps.length} was expected`
		),
	];
}

/**
 * The slide files written into one deck, with the slide numbers filled in. A cell that holds
 * `%slide%` or `%slides%` gets the slide's own number and the deck's total, which leaves out the
 * backup slides. On a backup slide `%slides%` gets the total and the total with the backup
 * slides, so `%slide%/%slides%` reads `54/40-54`. A cell of an embedded page is drawn as the
 * picture of its page, and every picture of a file of `assets/` is written into its page as data,
 * so an SVG that the PDF or the HTML file shows needs no file beside it. A use of a color linked
 * to a color of the deck takes the value of that color. Raises `DeckError` for a deck without
 * pages.
 */
export function assembleDeck(
	slides: readonly DeckPage[],
	inputs: AssemblyInputs
): AssembledDeck {
	if (slides.length === 0) {
		throw new DeckError(`${inputs.project} holds no pages`);
	}
	const { numbers, total: everything } = numberSlides(slides);
	const total = mainTotal(slides);
	const warnings = slideNameWarnings(slides);
	const body = new Array<string>();
	const pages = new Array<AssembledPage>();
	slides.forEach((slide, index) => {
		const where = `slide ${numbers[index]}, ${jsonText(slide.pageName)}`;
		const linked = withLinkedColorValues(slide.diagram, inputs.colors);
		if (linked.unknown.length > 0) {
			warnings.push(
				`${where}, links colors to ${linked.unknown.join(
					", "
				)}, which the setting drawSlidesCode.colors does not define, so they keep the values beside the links`
			);
		}
		warnings.push(
			...linked.differing.map(
				({ written, name, value }) =>
					`${where}, holds ${written} beside a link to ${name}, ${value}, and draws ${value}`
			)
		);
		const numbered = linked.page
			.split(SLIDE_PLACEHOLDER)
			.join(String(numbers[index]))
			.split(TOTAL_PLACEHOLDER)
			.join(
				isBackupPage(slide) ? `${total}-${everything}` : String(total)
			);
		const pictured = withPagePictures(numbered, inputs.pictures, where);
		warnings.push(...pictured.warnings);
		const embedded = embedPictures(pictured.diagram, inputs.project);
		warnings.push(
			...embedded.missing.map(
				(name) =>
					`${where}, names the picture ${name}, which does not exist`
			)
		);
		let diagram = embedded.text;
		if (isMathEnabled(diagram)) {
			const { definitions, unknown } = missingDefinitions(
				diagram,
				inputs.colors,
				inputs.missingCommands
			);
			diagram = withDefinitions(
				diagram,
				definitions,
				`page-${index + 1}`
			);
			if (unknown.length > 0) {
				warnings.push(
					`${where}, colors formulas with ${unknown.join(
						", "
					)}, which neither the page nor the setting drawSlidesCode.colors defines`
				);
			}
		} else if (formulasOfPage(diagram).length > 0) {
			warnings.push(
				`${where}, holds a formula and has mathematical typesetting off, so the formula shows as raw text. Switch on Extras > Mathematical Typesetting on that page.`
			);
		}
		const model = MODEL.exec(diagram);
		const attributes = model ? attributesOf(model[1]) : {};
		body.push("  " + diagram.trim() + "\n");
		pages.push({
			name: PAGE_NAME.exec(diagram)![1],
			width: Math.trunc(parseFloat(attributes.pageWidth ?? "1920")),
			height: Math.trunc(parseFloat(attributes.pageHeight ?? "1080")),
		});
	});
	const text = `<mxfile host="${ASSEMBLED_HOST}" pages="${
		slides.length
	}">\n${body.join("")}</mxfile>\n`;
	return { text, pages, total, warnings };
}

/** The pages and the slides of the talk and of the backup slides, in one line. */
export function countLine(
	sections: readonly Section[],
	source: string
): string {
	const part = (isBackup: boolean) => {
		const slides = new Array<Section["slides"][number]>()
			.concat(...sections.map((section) => section.slides))
			.filter((slide) => slide.isBackup === isBackup);
		return {
			slides: slides.length,
			pages: slides.reduce((sum, slide) => sum + slide.pages.length, 0),
		};
	};
	const talk = part(false);
	const backup = part(true);
	return `${talk.pages + backup.pages} pages assembled from ${source}: ${
		talk.slides
	} slides on ${talk.pages} pages, and ${backup.slides} backup slides on ${
		backup.pages
	} pages`;
}

/** The lines of the outline: the sections, each slide with its number as the deck shows it, and its pages. */
export function outlineLines(
	sections: readonly Section[],
	total: number
): string[] {
	const lastSection = sections[sections.length - 1];
	const everything = lastSection.slides[lastSection.slides.length - 1].number;
	const lines = new Array<string>();
	for (const section of sections) {
		const pages = sectionPages(section);
		lines.push(
			`${section.number} ${titleOf(section.name)}${
				section.isBackup ? " (backup)" : ""
			}, pages ${pages[0] + 1}-${pages[pages.length - 1] + 1}`
		);
		for (const slide of section.slides) {
			const shown = slide.isBackup
				? `${slide.number}/${total}-${everything}`
				: `${slide.number}/${total}`;
			const first = slide.pages[0] + 1;
			const last = slide.pages[slide.pages.length - 1] + 1;
			const span =
				first === last
					? `page ${first}`
					: `pages ${first}-${last}, ${last - first + 1} steps`;
			lines.push(`  ${shown.padEnd(9)} ${slide.name.padEnd(48)} ${span}`);
		}
	}
	return lines;
}

/** A bookmark of the PDF: its level, its page from 1 and its title. */
export interface PdfOutlineEntry {
	readonly level: 1 | 2 | 3;
	readonly page: number;
	readonly title: string;
}

/** The bookmarks of the PDF: a section per file, under it its slides, and under a slide in steps its pages. */
export function pdfOutline(sections: readonly Section[]): PdfOutlineEntry[] {
	const entries = new Array<PdfOutlineEntry>();
	for (const section of sections) {
		entries.push({
			level: 1,
			page: sectionPages(section)[0] + 1,
			title: `${section.number} ${titleOf(section.name)}`,
		});
		for (const slide of section.slides) {
			entries.push({
				level: 2,
				page: slide.pages[0] + 1,
				title: `${slide.number} ${titleOf(slide.name)}`,
			});
			if (slide.pages.length > 1) {
				slide.pages.forEach((index, step) =>
					entries.push({
						level: 3,
						page: index + 1,
						title: `Step ${step + 1}, page ${index + 1}`,
					})
				);
			}
		}
	}
	return entries;
}

/** The text of `build/outline.json`. */
export function pdfOutlineText(sections: readonly Section[]): string {
	return jsonText(pdfOutline(sections), 1);
}

/** The deck assembled into the build folder, with what the export, the PDF and the HTML file need of it. */
export interface WrittenAssembly {
	readonly assembled: AssembledDeck;
	readonly sections: readonly Section[];
	/** The file of the assembled deck. */
	readonly file: string;
	/** The file of the bookmarks of the PDF. */
	readonly outlineFile: string;
}

/** Writes `build/assembled.drawio.xml` and `build/outline.json` of a deck. */
export function writeAssembly(
	slides: readonly DeckPage[],
	inputs: AssemblyInputs
): WrittenAssembly {
	const assembled = assembleDeck(slides, inputs);
	const sections = deckOutline(slides);
	const build = path.join(path.resolve(inputs.project), "build");
	fs.mkdirSync(build, { recursive: true });
	const file = path.join(build, "assembled.drawio.xml");
	const outlineFile = path.join(build, "outline.json");
	fs.writeFileSync(file, assembled.text, "utf8");
	fs.writeFileSync(outlineFile, pdfOutlineText(sections), "utf8");
	return { assembled, sections, file, outlineFile };
}
