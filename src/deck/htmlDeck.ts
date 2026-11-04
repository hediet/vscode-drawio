/**
 * The HTML file of a built deck, which presents the deck in a browser. The file holds every
 * exported SVG, the outline of the deck, and the links, the videos and the embedded pages of the
 * cells, and the page `html-deck.html` of the extension shows them. The exported SVGs keep no
 * property of a cell, the link of the cell among them, so all three are read from the draw.io
 * pages, with the rectangle of each cell.
 *
 * The properties of a cell that reach the HTML file, a link, a video and a page, are in the
 * section on links, videos and pages of `docs/presentations.md`. A link to a page of the deck
 * reads `data:page/id,<page id>`, as Edit Link > Page writes it, and the build points it at the
 * address of the page in the HTML file, in the property of a cell and inside the text of a label.
 *
 * Each video and each page is copied into `media/` beside the HTML file, at its path relative to
 * the presentation folder, with the files that a page names beside it in its `src` and `href`
 * attributes, such as the `plotly.min.js` of a Plotly figure. A file outside the presentation
 * folder goes to `media/outside/<first 8 hex digits of the SHA-1 of its absolute path>/`, and the
 * files that a page there names beside it go into the same folder, at their paths relative to the
 * page. A file that a script of the page loads in another way, such as by `fetch`, is not copied,
 * so such a page keeps its data inside it. An address that starts with `http:` or `https:` is
 * used as it stands.
 *
 * `media/.deck-media.json` lists the files that the last build of each HTML file beside `media/`
 * copied. A build removes each file that the list of its HTML file from the build before names
 * and that every list now leaves out. A video taken out of the deck thus leaves `media/`, and a
 * file put there by hand stays.
 *
 * Yujun Huang grants an additional permission for this file under section 7 of the GNU General
 * Public License, version 3, in LICENSE-EXCEPTION.md of Draw.io Slides.
 */
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { decodeHTML } from "entities";
import {
	BarTimes,
	barTimes,
	Cell,
	isVertex,
	pageRectangle,
	readCells,
	readCellPages,
	Rectangle,
} from "./deckCells";
import { DeckError } from "./deckError";
import {
	DeckPage,
	mainTotal,
	numberSlides,
	Section,
	titleOf,
} from "./deckFiles";
import { htmlPageFile, pluginFile } from "./extensionFiles";
import { slideFileName } from "./slideExport";
import {
	compactJsonText,
	escapeHtml,
	JsonFloat,
	jsonText,
	quoteUrlPath,
	readTextFile,
	unquoteUrl,
} from "./textFormats";

/** The bars of a video and of a page, which the editor plugin shares, written into the HTML file. */
const MEDIA_BAR_SCRIPT = "media-bar.js";
const PAGE_LINK = "data:page/id,";
/** The `data:` address of a link inside the text of a label, in the SVG of a page. */
const LABEL_LINK =
	/(<a\b[^>]*?\s(?:xlink:)?href\s*=\s*)(["'])(data:[^"']*)\2/gi;
/** The list in `media/` of the files that the last build of each HTML file beside it copied. */
const MEDIA_LIST = ".deck-media.json";
/** An address on the web, which the HTML file uses as it stands. */
export const REMOTE = /^(https?:)?\/\//i;
/** How a video fills the shape of its cell, the first being the default. */
const FITS = ["contain", "stretch", "crop"] as const;
type Fit = typeof FITS[number];
/**
 * A file that a page names in a `src` or `href` attribute, with or without quotes, relative to
 * the page: no scheme, no leading slash, no fragment or query.
 */
const PAGE_FILE_REFERENCE =
	/\b(?:src|href)\s*=\s*(?:"([^"#?:]+)["#?]|'([^'#?:]+)['#?]|([^\s"'<>`=#?:]+)(?=[\s>#?]|$))/gi;
/** A placeholder of `html-deck.html`. */
const PLACEHOLDER = /\{\{(title|media_bar|deck)\}\}/g;

/** A link of a cell, at the rectangle of the cell. */
interface CellLink {
	readonly cell: string;
	readonly rectangle: Rectangle;
	readonly href: string;
	readonly opensNewTab: boolean;
}

/** A video of a cell, at the rectangle of the cell. */
interface CellVideo extends BarTimes {
	readonly cell: string;
	readonly rectangle: Rectangle;
	readonly source: string;
	readonly autoplay: boolean;
	readonly loop: boolean;
	readonly muted: boolean;
	readonly fit: Fit;
}

/** What the HTML file needs of a deck. */
export interface HtmlDeckInputs {
	readonly target: string;
	readonly title: string;
	readonly project: string;
	readonly svgFolder: string;
	readonly pages: readonly DeckPage[];
	readonly sections: readonly Section[];
	readonly width: number;
	readonly height: number;
	readonly extensionRoot: string;
}

/** The lines and the warnings of the writing of the HTML file. */
export interface HtmlDeckResult {
	readonly lines: readonly string[];
	readonly warnings: readonly string[];
}

function isOn(
	properties: Readonly<Record<string, string>>,
	name: string
): boolean {
	const value = properties[name];
	return (
		value !== undefined &&
		["1", "true", "yes"].includes(value.trim().toLowerCase())
	);
}

function diagramId(diagram: string): string | undefined {
	const match = /^<diagram\b[^>]*\bid="([^"]*)"/.exec(diagram);
	return match === null ? undefined : decodeHTML(match[1]);
}

/** The number of a page as the HTML file shows it: its slide, its step, the steps of its slide, and whether it is a backup slide. */
interface PageNumber {
	readonly slide: number;
	readonly step: number;
	readonly steps: number;
	readonly backup: boolean;
}

function pageNumbers(sections: readonly Section[]): Map<number, PageNumber> {
	const numbers = new Map<number, PageNumber>();
	for (const section of sections) {
		for (const slide of section.slides) {
			slide.pages.forEach((index, step) =>
				numbers.set(index, {
					slide: slide.number,
					step: step + 1,
					steps: slide.pages.length,
					backup: slide.isBackup,
				})
			);
		}
	}
	return numbers;
}

/** The address of each page in the HTML file: `12` for the first step of slide 12, `12.3` for its third. */
function pageLocations(sections: readonly Section[]): Map<number, string> {
	const locations = new Map<number, string>();
	for (const section of sections) {
		for (const slide of section.slides) {
			slide.pages.forEach((index, step) =>
				locations.set(
					index,
					step === 0
						? String(slide.number)
						: `${slide.number}.${step + 1}`
				)
			);
		}
	}
	return locations;
}

/**
 * The links of the cells of a page, and a warning for each link the HTML file cannot follow.
 * `targets` gives the address in the HTML file of each page id of the deck.
 */
function readCellLinks(
	cells: ReadonlyMap<string, Cell>,
	targets: ReadonlyMap<string, string>,
	problems: string[]
): CellLink[] {
	const links = new Array<CellLink>();
	for (const [cellId, cell] of cells) {
		const link = (cell.properties.link ?? "").trim();
		if (link === "") {
			continue;
		}
		if (!isVertex(cell)) {
			problems.push(
				`the cell ${cellId} is no vertex, such as an edge, and the HTML file follows the link of a vertex alone`
			);
			continue;
		}
		const rectangle = pageRectangle(cells, cellId);
		if (rectangle === undefined) {
			continue;
		}
		if (link.startsWith(PAGE_LINK)) {
			const page = link.slice(PAGE_LINK.length);
			const target = targets.get(page);
			if (target === undefined) {
				problems.push(
					`the cell ${cellId} links to the page ${page}, which the deck does not show`
				);
				continue;
			}
			links.push({
				cell: cellId,
				rectangle,
				href: "#" + target,
				opensNewTab: false,
			});
		} else if (link.startsWith("data:")) {
			problems.push(
				`the cell ${cellId} has the link ${link.slice(
					0,
					40
				)}, which only the editor follows`
			);
		} else {
			links.push({
				cell: cellId,
				rectangle,
				href: link,
				opensNewTab: cell.properties.linkTarget !== "_self",
			});
		}
	}
	return links;
}

/**
 * The SVG of a page with each link to a page inside the text of a label pointed at the address
 * of that page in the HTML file, and a warning for each `data:` link of a label that the HTML
 * file cannot follow.
 */
function withLabelLinksPointed(
	svg: string,
	targets: ReadonlyMap<string, string>,
	problems: string[]
): string {
	return svg.replace(
		LABEL_LINK,
		(whole, start: string, quote: string, address: string) => {
			const link = decodeHTML(address);
			if (!link.startsWith(PAGE_LINK)) {
				problems.push(
					`a label has the link ${link.slice(
						0,
						40
					)}, which only the editor follows`
				);
				return whole;
			}
			const page = link.slice(PAGE_LINK.length);
			const target = targets.get(page);
			if (target === undefined) {
				problems.push(
					`a label links to the page ${page}, which the deck does not show`
				);
				return whole;
			}
			return start + quote + "#" + escapeHtml(target) + quote;
		}
	);
}

/** The videos of the cells of a page, and a warning for each value of `fit` that is no fit. */
function readCellVideos(
	cells: ReadonlyMap<string, Cell>,
	problems: string[]
): CellVideo[] {
	const videos = new Array<CellVideo>();
	for (const [cellId, cell] of cells) {
		const source = (cell.properties.video ?? "").trim();
		const rectangle =
			source === "" ? undefined : pageRectangle(cells, cellId);
		if (rectangle === undefined) {
			continue;
		}
		let fit = (cell.properties.fit ?? FITS[0]).trim().toLowerCase();
		if (!(FITS as readonly string[]).includes(fit)) {
			problems.push(
				`the cell ${cellId} has fit=${fit}, which is none of ${FITS.join(
					", "
				)}, so it shows as ${FITS[0]}`
			);
			fit = FITS[0];
		}
		videos.push({
			cell: cellId,
			rectangle,
			source,
			autoplay: isOn(cell.properties, "autoplay"),
			loop: isOn(cell.properties, "loop"),
			muted: isOn(cell.properties, "muted"),
			fit: fit as Fit,
			...barTimes(cellId, cell.properties, problems),
		});
	}
	return videos;
}

/** Whether a relative path leads out of the folder it is relative to. */
function isOutside(relative: string): boolean {
	return relative === ".." || relative.startsWith(".." + path.sep);
}

/**
 * The path in `media/` of the copy of a local file: its path relative to the presentation folder,
 * or a folder of its own under `outside/` for a file outside the presentation folder, so that two
 * files of one name in two folders get two copies.
 */
function mediaPath(file: string, project: string): string {
	const relative = path.relative(project, file);
	if (!isOutside(relative)) {
		return relative;
	}
	const digest = crypto
		.createHash("sha1")
		.update(path.resolve(file), "utf8")
		.digest("hex")
		.slice(0, 8);
	return path.join("outside", digest, path.basename(file));
}

/** The time of the last change of a file, in whole milliseconds, which a copy keeps. */
function changedAtMs(file: string): number {
	return Math.trunc(fs.statSync(file).mtimeMs);
}

/** Copies a file with its times, unless the copy is as new as the file and of the same size. */
function copyFile(file: string, target: string): void {
	fs.mkdirSync(path.dirname(target), { recursive: true });
	const source = fs.statSync(file);
	const copy = fs.statSync(target, { throwIfNoEntry: false });
	if (
		copy !== undefined &&
		changedAtMs(target) >= Math.trunc(source.mtimeMs) &&
		copy.size === source.size
	) {
		return;
	}
	fs.copyFileSync(file, target);
	fs.utimesSync(target, source.atime, source.mtime);
}

function mediaAddress(relative: string): string {
	return "media/" + quoteUrlPath(relative.split(path.sep).join("/"));
}

/**
 * The address of a video or a page as the HTML file loads it, after copying a local file into
 * `media/`, or undefined when the file is missing.
 */
function copyMediaFile(
	source: string,
	project: string,
	media: string
): string | undefined {
	if (REMOTE.test(source)) {
		return source;
	}
	const file = path.resolve(project, source);
	if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
		return undefined;
	}
	const relative = mediaPath(file, project);
	copyFile(file, path.join(media, relative));
	return mediaAddress(relative);
}

/**
 * The paths of the files that a local page names beside it in its `src` and `href` attributes,
 * such as a script or a picture, and that exist. A file that a script of the page loads in
 * another way, such as by `fetch`, is not seen.
 */
export function namedPageFiles(page: string): string[] {
	let text: string;
	try {
		text = fs.readFileSync(page).toString("utf8");
	} catch {
		return [];
	}
	const files = new Set<string>();
	for (const match of text.matchAll(PAGE_FILE_REFERENCE)) {
		const reference = unquoteUrl(
			decodeHTML(
				(match[1] ?? "") + (match[2] ?? "") + (match[3] ?? "")
			).trim()
		);
		if (reference === "" || reference.startsWith("/")) {
			continue;
		}
		const file = path.resolve(path.dirname(page), reference);
		if (fs.statSync(file, { throwIfNoEntry: false })?.isFile()) {
			files.add(file);
		}
	}
	return [...files].sort();
}

/**
 * Copies into `media/` the files that a local page names beside it, and returns their paths in
 * `media/`. The copy of a page inside the presentation folder takes each file of that folder at
 * its path relative to the folder. The copy of a page outside the presentation folder takes each
 * file of the folder of the page or below it beside it, at its path relative to the page.
 */
function copyPageFiles(
	source: string,
	project: string,
	media: string
): string[] {
	if (REMOTE.test(source)) {
		return [];
	}
	const page = path.resolve(project, source);
	const isPageOutside = isOutside(path.relative(project, page));
	const root = isPageOutside ? path.dirname(page) : project;
	const folder = isPageOutside ? path.dirname(mediaPath(page, project)) : "";
	const copied = new Array<string>();
	for (const file of namedPageFiles(page)) {
		const relative = path.relative(root, file);
		if (isOutside(relative)) {
			continue;
		}
		const target = path.join(folder, relative);
		copyFile(file, path.join(media, target));
		copied.push(target);
	}
	return copied;
}

function readMediaLists(listFile: string): Record<string, unknown> {
	try {
		const lists: unknown = JSON.parse(fs.readFileSync(listFile, "utf8"));
		return typeof lists === "object" &&
			lists !== null &&
			!Array.isArray(lists)
			? (lists as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

/**
 * Writes the list of the files that this build of the HTML file copied into `media/`, and removes
 * the files of its list before that every list now leaves out, which the deck no longer uses.
 * Each HTML file beside `media/` has a list of its own, so a build keeps the files of the others,
 * and a file outside every list, such as one put into `media/` by hand, stays. Returns the paths
 * in `media/` of the files removed.
 */
function removeStaleMedia(
	media: string,
	htmlFile: string,
	copied: ReadonlySet<string>
): string[] {
	const listFile = path.join(media, MEDIA_LIST);
	const lists = readMediaLists(listFile);
	const before = new Set(
		Array.isArray(lists[htmlFile]) ? (lists[htmlFile] as string[]) : []
	);
	lists[htmlFile] = [...copied]
		.map((file) => file.split(path.sep).join("/"))
		.sort();
	const named = new Set<string>();
	for (const files of Object.values(lists)) {
		if (Array.isArray(files)) {
			files.forEach((file) => named.add(file));
		}
	}
	const removed = new Array<string>();
	for (const relative of [...before]
		.filter((file) => !named.has(file))
		.sort()) {
		const file = path.resolve(media, relative);
		if (
			isOutside(path.relative(media, file)) ||
			!fs.statSync(file, { throwIfNoEntry: false })?.isFile()
		) {
			continue;
		}
		fs.rmSync(file);
		removed.push(relative);
		let folder = path.dirname(file);
		while (
			folder !== path.resolve(media) &&
			fs.readdirSync(folder).length === 0
		) {
			fs.rmdirSync(folder);
			folder = path.dirname(folder);
		}
	}
	if (fs.existsSync(media)) {
		const sorted = new Map(
			Object.keys(lists)
				.sort()
				.map((key): [string, unknown] => [key, lists[key]])
		);
		fs.writeFileSync(listFile, jsonText(sorted, 1) + "\n", "utf8");
	}
	return removed;
}

function readSvg(file: string): string {
	const svg = readTextFile(file);
	return svg.slice(svg.indexOf("<svg"));
}

function rectangleJson(rectangle: Rectangle): Record<string, JsonFloat> {
	return {
		x: new JsonFloat(rectangle.x),
		y: new JsonFloat(rectangle.y),
		width: new JsonFloat(rectangle.width),
		height: new JsonFloat(rectangle.height),
	};
}

function barTimesJson(times: BarTimes): Record<string, JsonFloat> {
	return {
		bar_hide_delay: new JsonFloat(times.barHideDelay),
		bar_fade_out: new JsonFloat(times.barFadeOut),
	};
}

function outlineEntries(sections: readonly Section[]): unknown[] {
	return sections.map((section) => ({
		title: `${section.number} ${titleOf(section.name)}`,
		slides: section.slides.map((slide) => ({
			number: slide.number,
			title: titleOf(slide.name),
			pages: slide.pages,
		})),
	}));
}

/**
 * JSON that may sit inside a `<script>` element, with every `<` written as an escape. `</` ends
 * the element, and `<!--` followed by `<script` makes the browser read on past its end.
 */
function scriptJson(value: unknown): string {
	return compactJsonText(value).replace(/</g, "\\u003c");
}

/** The address in the HTML file of each page id of the deck, and a warning for each id of two pages. */
function pageTargets(
	pages: readonly DeckPage[],
	locations: ReadonlyMap<number, string>,
	warnings: string[]
): Map<string, string> {
	const targets = new Map<string, string>();
	pages.forEach((page, index) => {
		const pageId = diagramId(page.diagram);
		if (pageId !== undefined && targets.has(pageId)) {
			warnings.push(
				`two pages have the id ${pageId}, so a link to it goes to the first`
			);
		} else if (pageId) {
			targets.set(pageId, locations.get(index)!);
		}
	});
	return targets;
}

/** What the entry of every page of the HTML file reads. */
interface HtmlDeckContext {
	readonly inputs: HtmlDeckInputs;
	/** The address in the HTML file of each page id of the deck. */
	readonly targets: ReadonlyMap<string, string>;
	readonly locations: ReadonlyMap<number, string>;
	readonly numbers: ReadonlyMap<number, PageNumber>;
	/** The folder `media/` beside the HTML file. */
	readonly media: string;
}

/** The entry of one page in the HTML file, with its warnings and the files that it copied into `media/`. */
interface DeckPageEntry {
	readonly entry: {
		readonly links: readonly unknown[];
		readonly videos: readonly Record<string, unknown>[];
		readonly embeds: readonly Record<string, unknown>[];
	} & Record<string, unknown>;
	readonly warnings: readonly string[];
	/** The videos and the pages copied, relative to `media/`. */
	readonly copied: readonly string[];
	/** The files beside the pages copied, relative to `media/`. */
	readonly pageFiles: readonly string[];
}

/**
 * Reads the links, the videos and the embedded pages of the cells of one page and the SVG of the
 * page, and copies the videos and the pages into `media/`.
 */
function readDeckPage(
	context: HtmlDeckContext,
	page: DeckPage,
	index: number
): DeckPageEntry {
	const { inputs, targets, media } = context;
	const where = `page ${index + 1}, ${jsonText(page.pageName)}`;
	const cells = readCells(page.diagram);
	const linkProblems = new Array<string>();
	const links = readCellLinks(cells, targets, linkProblems);
	const videoProblems = new Array<string>();
	const cellVideos = readCellVideos(cells, videoProblems);
	const pageProblems = new Array<string>();
	const cellPages = readCellPages(cells, pageProblems);
	const labelProblems = new Array<string>();
	const svg = withLabelLinksPointed(
		readSvg(path.join(inputs.svgFolder, slideFileName(index + 1))),
		targets,
		labelProblems
	);
	const warnings = [
		...linkProblems,
		...labelProblems,
		...videoProblems,
		...pageProblems,
	].map((problem) => `${where}: ${problem}`);
	const videos = new Array<Record<string, unknown>>();
	for (const video of cellVideos) {
		const address = copyMediaFile(video.source, inputs.project, media);
		if (address === undefined) {
			warnings.push(
				`${where}: the video ${video.source} of the cell ${video.cell} does not exist`
			);
			continue;
		}
		videos.push({
			cell: video.cell,
			rectangle: rectangleJson(video.rectangle),
			source: address,
			autoplay: video.autoplay,
			loop: video.loop,
			muted: video.muted,
			fit: video.fit,
			...barTimesJson(video),
		});
	}
	const embeds = new Array<Record<string, unknown>>();
	const pageFiles = new Array<string>();
	for (const embed of cellPages) {
		const address = copyMediaFile(embed.source, inputs.project, media);
		if (address === undefined) {
			warnings.push(
				`${where}: the page ${embed.source} of the cell ${embed.cell} does not exist`
			);
			continue;
		}
		pageFiles.push(...copyPageFiles(embed.source, inputs.project, media));
		embeds.push({
			cell: embed.cell,
			rectangle: rectangleJson(embed.rectangle),
			source: address,
			...barTimesJson(embed),
		});
	}
	const copied = [...videos, ...embeds]
		.map((item) => item.source as string)
		.filter((source) => source.startsWith("media/"))
		.map((source) => unquoteUrl(source.slice("media/".length)));
	return {
		entry: {
			location: context.locations.get(index),
			number: context.numbers.get(index),
			svg,
			links: links.map((link) => ({
				cell: link.cell,
				rectangle: rectangleJson(link.rectangle),
				href: link.href,
				opens_new_tab: link.opensNewTab,
			})),
			videos,
			embeds,
		},
		warnings,
		copied,
		pageFiles,
	};
}

/** The text of `html-deck.html` of the extension with its placeholders filled for the deck. */
function fillPageTemplate(inputs: HtmlDeckInputs, deck: unknown): string {
	const mediaBarFile = pluginFile(inputs.extensionRoot, MEDIA_BAR_SCRIPT);
	const mediaBar = readTextFile(mediaBarFile);
	if (mediaBar.toLowerCase().includes("</script")) {
		throw new DeckError(
			`${mediaBarFile} holds </script, which would end its <script> element`
		);
	}
	const fillings: Record<string, string> = {
		title: escapeHtml(inputs.title),
		media_bar: mediaBar,
		deck: scriptJson(deck),
	};
	return readTextFile(htmlPageFile(inputs.extensionRoot)).replace(
		PLACEHOLDER,
		(_whole, name: string) => fillings[name]
	);
}

/** Writes the HTML file of a built deck, and copies its videos and pages into `media/` beside it. */
export function writeHtmlDeck(inputs: HtmlDeckInputs): HtmlDeckResult {
	const { pages, sections } = inputs;
	const target = path.resolve(inputs.target);
	const warnings = new Array<string>();
	const locations = pageLocations(sections);
	const context: HtmlDeckContext = {
		inputs,
		targets: pageTargets(pages, locations, warnings),
		locations,
		numbers: pageNumbers(sections),
		media: path.join(path.dirname(target), "media"),
	};
	const entries = pages.map((page, index) =>
		readDeckPage(context, page, index)
	);
	entries.forEach((entry) => warnings.push(...entry.warnings));
	const count = (items: (entry: DeckPageEntry) => readonly unknown[]) =>
		entries.reduce((sum, entry) => sum + items(entry).length, 0);
	const copied = new Set(entries.flatMap((entry) => entry.copied));
	const pageFiles = new Set(entries.flatMap((entry) => entry.pageFiles));
	const deck = {
		title: inputs.title,
		width: inputs.width,
		height: inputs.height,
		total: mainTotal(pages),
		totalWithBackup: numberSlides(pages).total,
		outline: outlineEntries(sections),
		pages: entries.map((entry) => entry.entry),
	};
	const page = fillPageTemplate(inputs, deck);
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.writeFileSync(target, page, "utf8");
	const removed = removeStaleMedia(
		context.media,
		path.basename(target),
		new Set([...copied, ...pageFiles])
	);
	const lines = [
		`${target} written: ${entries.length} pages, ${count(
			(entry) => entry.entry.links
		)} links, ${count((entry) => entry.entry.videos)} videos, ${count(
			(entry) => entry.entry.embeds
		)} embedded pages, ${pageFiles.size} files beside the pages`,
	];
	if (removed.length > 0) {
		lines.push(
			`${context.media}: removed ${removed.join(
				", "
			)}, which the deck no longer uses`
		);
	}
	return { lines, warnings };
}
