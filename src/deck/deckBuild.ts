/**
 * The modes of the build of a deck, one function each, which the commands of the extension and
 * the command line run: `buildDeck` writes the HTML file and the PDF, `buildDeckHtml` the HTML
 * file alone, `buildDeckPdf` the PDF alone, `watchDeck` the HTML file again after every save,
 * `reportDeckOutline` reports the sections, the slides and their pages, `checkDeck` checks the spelling and the grammar of the labels, and `embedDeckPictures` writes
 * the pictures of `assets/` into the slide files.
 *
 * A build joins the section files into `build/assembled.drawio.xml`, as `deckAssembly.ts` says,
 * after taking the pictures of the embedded pages, and exports each page to an SVG in
 * `build/slides/`, which both the HTML file and the PDF are made of:
 *
 *     my-talk/
 *     ├── package.json                    the title, under the key config
 *     ├── .vscode/settings.json           the settings of the editor and the colors of the slides
 *     ├── sections/1-opening.drawio.xml   one file per section
 *     └── build/                          written by the build
 *         ├── my-talk.html, media/        the HTML file and the videos and pages it shows
 *         ├── my-talk.pdf                 the PDF
 *         ├── slides/slide-NN.svg         one SVG per page
 *         ├── assembled.drawio.xml        every page in one file
 *         ├── outline.json                the bookmarks of the PDF
 *         ├── export-cache/               the SVG of each page, kept for the next build
 *         └── page-snapshots/             a picture of each embedded page
 *
 * The HTML file and the PDF take the name of the deck folder, unless the caller names them. The
 * HTML file takes the title of `config`, or else the name of the folder. A build reads the
 * viewer, the plugins it shares with the editor and the defaults of the settings of the slides
 * from the folder of the extension, `extensionRoot`, so that the slides it draws match the
 * editor. Each function raises `DeckError` with the reason when the build stops, and
 * `BuildCancelled` when the caller's signal stops it.
 */
import * as fs from "fs";
import * as path from "path";
import type { Browser } from "playwright-core";
import {
	BuildCancelled,
	BuildReporter,
	BuildStep,
	reportLine,
	reportProgress,
	reportWarnings,
	throwIfCancelled,
} from "./buildEvents";
import { BrowserChoice, launchBrowser } from "./deckBrowser";
import {
	countLine,
	deckOptions,
	DeckOptions,
	hiddenLine,
	outlineLines,
	pdfOutline,
	readDeckSlides,
	writeAssembly,
} from "./deckAssembly";
import {
	deckOutline,
	DeckPage,
	findSlidesLocation,
	mainTotal,
	Section,
} from "./deckFiles";
import { DeckError, failureText } from "./deckError";
import { embedSlideFilePictures } from "./deckPictures";
import {
	DECK_SETTINGS,
	readDeckColors,
	readDeckSettings,
	readListStyles,
	slideSetting,
} from "./deckSettings";
import { pluginFile, viewerFile } from "./extensionFiles";
import { writeHtmlDeck } from "./htmlDeck";
import { checkLanguage } from "./languageCheck";
import { SnapshotSettings, takePagePictures } from "./pageSnapshotTaking";
import { printPdf } from "./pdfPrint";
import {
	exportPages,
	ExportSettings,
	listMarkerCss,
	makeSlidesLight,
	removeSlidesBeyond,
} from "./slideExport";
import { readMissingCommands } from "./texDefinitions";

/** The folder of the SVGs, below the deck folder. */
const SLIDES = path.join("build", "slides");
const MATHJAX_COMMANDS = "mathjax-commands.tex";
const LIST_MARKER_RULES = "list-marker-rules.js";

/** What every mode of the build takes. */
export interface DeckBuildOptions {
	/** The deck folder. */
	readonly project: string;
	/** The folder of the extension, whose viewer, plugins and `package.json` the build reads. */
	readonly extensionRoot: string;
	/** The title, the slides folder and the multi-page file, each over its key of `config`. */
	readonly given?: Partial<DeckOptions>;
	/** The HTML file to write, `build/<folder>.html` by default. */
	readonly htmlFile?: string;
	/** The PDF to write, `build/<folder>.pdf` by default. */
	readonly pdfFile?: string;
	/** Whether the build reports the outline after the count line. */
	readonly isOutlineReported?: boolean;
	readonly browser?: BrowserChoice;
	readonly exportSettings?: ExportSettings;
	readonly snapshotSettings?: SnapshotSettings;
	readonly reporter?: BuildReporter;
	readonly signal?: AbortSignal;
}

/** What the watch takes beyond the options of every mode. */
export interface WatchOptions extends DeckBuildOptions {
	/** The milliseconds between two looks at the files of the deck, 1000 by default. */
	readonly intervalMs?: number;
}

/** What the language check takes beyond the options of every mode. */
export interface CheckOptions extends DeckBuildOptions {
	/** The address of the LanguageTool server, the setting `drawSlidesCode.languageTool` of the deck by default. */
	readonly languageTool?: string;
}

/** The files that a mode wrote. */
export interface DeckBuildResult {
	readonly htmlFile?: string;
	readonly pdfFile?: string;
}

/** The deck exported to `build/slides/`, with what the HTML file and the PDF need of it. */
interface ExportedDeck {
	readonly slides: readonly DeckPage[];
	readonly sections: readonly Section[];
	readonly pageCount: number;
	readonly width: number;
	readonly height: number;
}

/**
 * The browser of one run of a mode, or of every build of a watch, launched at its first use and
 * closed at the end of the run. A launch that failed, or a browser that has since closed, such as
 * after a crash, is launched again at the next use.
 */
interface BrowserSession {
	readonly browser: () => Promise<Browser>;
	readonly close: () => Promise<void>;
}

function browserSession(
	choice: BrowserChoice | undefined,
	reporter: BuildReporter | undefined
): BrowserSession {
	let launched: Promise<Browser> | undefined;
	return {
		browser: async () => {
			const running = await launched?.catch(() => undefined);
			if (running === undefined || !running.isConnected()) {
				launched = launchBrowser(choice, reporter);
			}
			return launched!;
		},
		close: async () => {
			if (launched !== undefined) {
				await (await launched.catch(() => undefined))?.close();
			}
		},
	};
}

/** Runs a mode with a browser session, which is closed whatever the end of the run. */
async function withBrowser<T>(
	options: DeckBuildOptions,
	run: (session: BrowserSession) => Promise<T>
): Promise<T> {
	const session = browserSession(options.browser, options.reporter);
	try {
		return await run(session);
	} finally {
		await session.close();
	}
}

function projectOf(options: DeckBuildOptions): string {
	return path.resolve(options.project);
}

function deckName(options: DeckBuildOptions): string {
	return path.basename(projectOf(options));
}

function readSlides(
	options: DeckBuildOptions,
	deck: DeckOptions
): { slides: readonly DeckPage[]; source: string } {
	const { slides, source, hidden } = readDeckSlides(projectOf(options), deck);
	const line = hiddenLine(hidden);
	if (line !== undefined) {
		reportLine(options.reporter, line);
	}
	return { slides, source };
}

/** Assembles the deck and exports each page to an SVG in `build/slides/`. */
async function exportSlides(
	options: DeckBuildOptions,
	deck: DeckOptions,
	session: BrowserSession
): Promise<ExportedDeck> {
	const project = projectOf(options);
	const { extensionRoot, reporter, signal } = options;
	const outdir = path.join(project, SLIDES);
	fs.mkdirSync(outdir, { recursive: true });
	const { slides, source } = readSlides(options, deck);
	const settings = readDeckSettings(project);
	const colors = readDeckColors(project, settings, extensionRoot);
	reportWarnings(reporter, colors.warnings);
	const listStyles = readListStyles(
		project,
		settings,
		extensionRoot,
		colors.value
	);
	reportWarnings(reporter, listStyles.warnings);
	throwIfCancelled(signal);
	const pictures = await takePagePictures({
		slides,
		project,
		folder: path.join(project, "build", "page-snapshots"),
		browser: session.browser,
		settings: options.snapshotSettings ?? {},
		reporter,
		signal,
	});
	const commandsFile = pluginFile(extensionRoot, MATHJAX_COMMANDS);
	const written = writeAssembly(slides, {
		project,
		colors: colors.value,
		missingCommands: readMissingCommands(
			commandsFile,
			fs.readFileSync(commandsFile, "utf8")
		),
		pictures,
	});
	const { assembled, sections } = written;
	reportWarnings(reporter, assembled.warnings);
	reportLine(reporter, countLine(sections, source));
	if (options.isOutlineReported) {
		outlineLines(sections, assembled.total).forEach((line) =>
			reportLine(reporter, line)
		);
	}
	const [first] = assembled.pages;
	await exportPages({
		assembled: assembled.text,
		outdir,
		pageCount: assembled.pages.length,
		width: first.width,
		height: first.height,
		cache: path.join(project, "build", "export-cache"),
		viewer: options.exportSettings?.viewer ?? viewerFile(extensionRoot),
		markerCss: listMarkerCss(
			pluginFile(extensionRoot, LIST_MARKER_RULES),
			listStyles.value
		),
		browser: await session.browser(),
		settings: options.exportSettings ?? {},
		reporter,
		signal,
	});
	makeSlidesLight(outdir, assembled.pages.length);
	removeSlidesBeyond(outdir, assembled.pages.length);
	return {
		slides,
		sections,
		pageCount: assembled.pages.length,
		width: first.width,
		height: first.height,
	};
}

/** Writes the HTML file from the SVGs. */
function writeHtml(
	options: DeckBuildOptions,
	deck: DeckOptions,
	exported: ExportedDeck
): string {
	const project = projectOf(options);
	const target = path.resolve(
		options.htmlFile ??
			path.join(project, "build", deckName(options) + ".html")
	);
	const result = writeHtmlDeck({
		target,
		title: deck.title || deckName(options),
		project,
		svgFolder: path.join(project, SLIDES),
		pages: exported.slides,
		sections: exported.sections,
		width: exported.width,
		height: exported.height,
		extensionRoot: options.extensionRoot,
	});
	reportWarnings(options.reporter, result.warnings);
	result.lines.forEach((line) => reportLine(options.reporter, line));
	reportProgress(options.reporter, BuildStep.HTML, 1, 1);
	return target;
}

/** Prints the PDF from the SVGs. */
async function writePdf(
	options: DeckBuildOptions,
	exported: ExportedDeck,
	session: BrowserSession
): Promise<string> {
	const project = projectOf(options);
	const output = path.resolve(
		options.pdfFile ??
			path.join(project, "build", deckName(options) + ".pdf")
	);
	throwIfCancelled(options.signal);
	await printPdf({
		svgFolder: path.join(project, SLIDES),
		pageCount: exported.pageCount,
		output,
		width: exported.width,
		height: exported.height,
		bookmarks: pdfOutline(exported.sections),
		browser: await session.browser(),
	});
	reportLine(
		options.reporter,
		`${exported.pageCount} pages printed to ${output}`
	);
	reportProgress(options.reporter, BuildStep.PDF, 1, 1);
	return output;
}

/** Exports the slides once, then writes the HTML file and the PDF from them. */
export function buildDeck(options: DeckBuildOptions): Promise<DeckBuildResult> {
	return withBrowser(options, async (session) => {
		const deck = deckOptions(projectOf(options), options.given);
		const exported = await exportSlides(options, deck, session);
		const htmlFile = writeHtml(options, deck, exported);
		const pdfFile = await writePdf(options, exported, session);
		return { htmlFile, pdfFile };
	});
}

/** Exports the slides and writes the HTML file, with the browser of the session. */
async function buildHtmlWith(
	options: DeckBuildOptions,
	session: BrowserSession
): Promise<DeckBuildResult> {
	const deck = deckOptions(projectOf(options), options.given);
	const exported = await exportSlides(options, deck, session);
	return { htmlFile: writeHtml(options, deck, exported) };
}

/** Exports the slides and writes the HTML file. */
export function buildDeckHtml(
	options: DeckBuildOptions
): Promise<DeckBuildResult> {
	return withBrowser(options, (session) => buildHtmlWith(options, session));
}

/** Exports the slides and prints the PDF. */
export function buildDeckPdf(
	options: DeckBuildOptions
): Promise<DeckBuildResult> {
	return withBrowser(options, async (session) => {
		const deck = deckOptions(projectOf(options), options.given);
		const exported = await exportSlides(options, deck, session);
		return { pdfFile: await writePdf(options, exported, session) };
	});
}

/** The time of the last change of a file in milliseconds, or undefined when it has gone. */
function changedAt(file: string): number | undefined {
	return fs.statSync(file, { throwIfNoEntry: false })?.mtimeMs;
}

function filesBelow(folder: string): string[] {
	if (!fs.existsSync(folder)) {
		return [];
	}
	return fs
		.readdirSync(folder, { withFileTypes: true })
		.flatMap((entry) =>
			entry.isDirectory()
				? filesBelow(path.join(folder, entry.name))
				: [path.join(folder, entry.name)]
		);
}

/**
 * The name and the time of each file a build reads: the slides, the files of `assets/` and the
 * settings, which hold the colors. A file renamed, added or deleted changes the state as a saved
 * one does.
 */
function deckState(options: DeckBuildOptions, deck: DeckOptions): string {
	const project = projectOf(options);
	const found = findSlidesLocation(project, deck.slidesDir, deck.deck);
	if (found === undefined) {
		throw new DeckError(
			`${project} holds neither ${deck.slidesDir}/ nor ${deck.deck}. Run the command Set Up a Presentation in This Folder to start a presentation.`
		);
	}
	const files = [
		...(found.isFolder
			? fs
					.readdirSync(found.location)
					.map((name) => path.join(found.location, name))
			: [found.location]),
		...filesBelow(path.join(project, "assets")),
		path.join(project, DECK_SETTINGS),
	];
	return JSON.stringify(
		[...new Set(files)]
			.sort()
			.map((file) => [file, changedAt(file) ?? null])
	);
}

/** Waits the milliseconds, or less when the signal is aborted. */
function pause(
	milliseconds: number,
	signal: AbortSignal | undefined
): Promise<void> {
	return new Promise((resolve) => {
		const timer = setTimeout(done, milliseconds);
		function done() {
			clearTimeout(timer);
			signal?.removeEventListener("abort", done);
			resolve();
		}
		signal?.addEventListener("abort", done);
	});
}

/**
 * Writes the HTML file again after every change of a file that the build reads, for a browser
 * that shows it to reload, until the signal is aborted. A build that fails, such as on a file
 * half written, is reported through `onFailure`, and the next change builds again. One browser
 * serves every build of the watch, so a build after a save does not wait for a browser to start.
 */
export function watchDeck(options: WatchOptions): Promise<void> {
	return withBrowser(options, (session) => watchWith(options, session));
}

async function watchWith(
	options: WatchOptions,
	session: BrowserSession
): Promise<void> {
	const deck = deckOptions(projectOf(options), options.given);
	const found = findSlidesLocation(
		projectOf(options),
		deck.slidesDir,
		deck.deck
	);
	reportLine(
		options.reporter,
		`watching ${
			found?.location ?? projectOf(options)
		} until the watch is stopped`
	);
	let last: string | undefined;
	while (!options.signal?.aborted) {
		let state: string;
		try {
			state = deckState(options, deck);
		} catch (error) {
			state = failureText(error);
		}
		if (state !== last) {
			last = state;
			try {
				await buildHtmlWith(options, session);
			} catch (error) {
				if (error instanceof BuildCancelled) {
					return;
				}
				options.reporter?.onFailure?.(failureText(error));
			}
		}
		await pause(options.intervalMs ?? 1000, options.signal);
	}
}

/**
 * Reports the outline of the deck without building it: the hidden pages, the count line, and the
 * sections with the slides and their pages. Raises `DeckError` for a deck without pages.
 */
export function reportDeckOutline(options: DeckBuildOptions): void {
	const project = projectOf(options);
	const deck = deckOptions(project, options.given);
	const { slides, source } = readSlides(options, deck);
	if (slides.length === 0) {
		throw new DeckError(`${project} holds no pages`);
	}
	const sections = deckOutline(slides);
	reportLine(options.reporter, countLine(sections, source));
	outlineLines(sections, mainTotal(slides)).forEach((line) =>
		reportLine(options.reporter, line)
	);
}

/**
 * Checks the spelling and the grammar of every label of the deck with LanguageTool, reports each
 * issue with its slide, and returns the number of issues.
 */
export async function checkDeck(options: CheckOptions): Promise<number> {
	const project = projectOf(options);
	const deck = deckOptions(project, options.given);
	const { slides } = readSlides(options, deck);
	const server =
		options.languageTool ??
		String(
			slideSetting(
				readDeckSettings(project),
				options.extensionRoot,
				"languageTool"
			)
		);
	return checkLanguage({
		slides,
		project,
		server,
		extensionRoot: options.extensionRoot,
		reporter: options.reporter,
		signal: options.signal,
	});
}

/**
 * Writes the picture of each cell of the slide files of the deck as data from its file in
 * `assets/`, for a draw.io editor that finds no picture beside the drawing, and reports the files
 * written and each picture whose file does not exist.
 */
export function embedDeckPictures(options: DeckBuildOptions): void {
	const deck = deckOptions(projectOf(options), options.given);
	const result = embedSlideFilePictures(
		projectOf(options),
		deck.slidesDir,
		deck.deck
	);
	result.lines.forEach((line) => reportLine(options.reporter, line));
	reportWarnings(options.reporter, result.warnings);
}
