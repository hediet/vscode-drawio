/**
 * The taking of the pictures of the embedded pages of a deck, each as its page first draws, which
 * `pageSnapshots.ts` draws into the cells of the pages.
 *
 * Each page loads in the headless browser in a window of the size of its cell on the slide, as
 * the editor and the HTML file lay it out, and the picture is taken after its load, two frames
 * of drawing and a wait, so that a plot has drawn. The picture has twice the pixels of the cell,
 * and keeps the parts of the page without a background transparent.
 *
 * The pictures are kept in `build/page-snapshots/`, which keeps the pictures of the last build
 * alone. A picture of a local page is taken again when its file, or a file that it names in a
 * `src` or an `href` attribute, such as its data script, is newer than the picture. A page of
 * another server is taken again on every build. A page that gives no picture keeps the picture
 * of an earlier build, so that a build without the network still shows a page of another server,
 * and leaves its cell as it is when it has none, with a warning in both cases.
 */
import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import type { Browser } from "playwright-core";
import {
	BuildReporter,
	BuildStep,
	reportLine,
	reportProgress,
	reportWarnings,
	throwIfCancelled,
} from "./buildEvents";
import { failureText } from "./deckError";
import { DeckPage } from "./deckFiles";
import { namedPageFiles, REMOTE } from "./htmlDeck";
import {
	embeddedPages,
	PagePictures,
	snapshotFile,
	snapshotKey,
} from "./pageSnapshots";
import { parseXml } from "./xmlTree";

/** The waits of the pictures, each with a default. */
export interface SnapshotSettings {
	/** The milliseconds after the load and two frames before the picture, 500 by default. */
	readonly settleMs?: number;
	/** The most milliseconds that a page may take to load, 30000 by default. */
	readonly loadWaitMs?: number;
}

/** What the taking of the pictures needs. */
export interface SnapshotInputs {
	readonly slides: readonly DeckPage[];
	readonly project: string;
	/** The folder of the pictures, `build/page-snapshots/` of the deck. */
	readonly folder: string;
	/** Launches the browser when a picture has to be taken. */
	readonly browser: () => Promise<Browser>;
	readonly settings: SnapshotSettings;
	readonly reporter?: BuildReporter;
	readonly signal?: AbortSignal;
}

const DEFAULT_SETTLE_MS = 500;
const DEFAULT_LOAD_WAIT_MS = 30000;
const TWO_FRAMES_EXPRESSION =
	"new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))";

/** A page whose picture is wanted: its address, the size of its cell and the PNG of the picture. */
interface SnapshotJob {
	readonly address: string;
	readonly width: number;
	readonly height: number;
	readonly output: string;
	readonly source: string;
	readonly cell: string;
	/** The time of the last change of the PNG before the build, or undefined without one. */
	readonly before: number | undefined;
}

function changedAtMs(file: string): number | undefined {
	return fs.statSync(file, { throwIfNoEntry: false })?.mtimeMs;
}

/** The local file of a page, or undefined for a page of another server. */
function localFile(source: string, project: string): string | undefined {
	return REMOTE.test(source) ? undefined : path.resolve(project, source);
}

/** The address that the browser loads for a page, or undefined for a missing file. */
function pageAddress(source: string, project: string): string | undefined {
	const file = localFile(source, project);
	if (file === undefined) {
		return source.startsWith("//") ? "https:" + source : source;
	}
	return fs.statSync(file, { throwIfNoEntry: false })?.isFile()
		? pathToFileURL(file).href
		: undefined;
}

/** The time of the newest of a local page and of the files that it names in `src` and `href`. */
function pageChangedAtMs(page: string): number {
	return Math.max(
		...[page, ...namedPageFiles(page)].map((file) => changedAtMs(file) ?? 0)
	);
}

/** Removes each picture of the folder that no cell of this build shows. */
function removeUnused(folder: string, kept: ReadonlySet<string>): void {
	if (!fs.existsSync(folder)) {
		return;
	}
	for (const name of fs.readdirSync(folder)) {
		if (name.endsWith(".png") && !kept.has(name)) {
			fs.rmSync(path.join(folder, name));
		}
	}
}

/** Takes the picture of one page. Returns the reason when the page gave none. */
async function takePicture(
	browser: Browser,
	job: SnapshotJob,
	settings: SnapshotSettings
): Promise<string | undefined> {
	const page = await browser.newPage({
		viewport: {
			width: Math.ceil(job.width),
			height: Math.ceil(job.height),
		},
		deviceScaleFactor: 2,
	});
	try {
		await page.goto(job.address, {
			waitUntil: "load",
			timeout: settings.loadWaitMs ?? DEFAULT_LOAD_WAIT_MS,
		});
		await page.evaluate(TWO_FRAMES_EXPRESSION);
		await page.waitForTimeout(settings.settleMs ?? DEFAULT_SETTLE_MS);
		await page.screenshot({ path: job.output, omitBackground: true });
		return undefined;
	} catch (error) {
		return failureText(error).split("\n")[0];
	} finally {
		await page.close();
	}
}

/** An embedded page that a cell shows: its source, the size of its cell and the PNG of its picture. */
interface WantedSnapshot {
	readonly source: string;
	readonly width: number;
	readonly height: number;
	readonly cell: string;
	readonly output: string;
}

/** The embedded pages of the slides, each once by its key. */
function wantedSnapshots(
	slides: readonly DeckPage[],
	folder: string
): Map<string, WantedSnapshot> {
	const wanted = new Map<string, WantedSnapshot>();
	for (const slide of slides) {
		if (!slide.diagram.includes("html=")) {
			continue;
		}
		for (const page of embeddedPages(parseXml(slide.diagram))) {
			wanted.set(snapshotKey(page), {
				source: page.source,
				width: page.rectangle.width,
				height: page.rectangle.height,
				cell: page.cell,
				output: snapshotFile(folder, page),
			});
		}
	}
	return wanted;
}

/**
 * The PNG of each wanted page whose file exists, by its key, and the pages whose picture is taken
 * again: a page of another server, and a local page newer than its picture or without one. A
 * missing page gets a warning.
 */
function plannedSnapshots(
	wanted: ReadonlyMap<string, WantedSnapshot>,
	project: string,
	reporter: BuildReporter | undefined
): { pictures: Map<string, string>; jobs: SnapshotJob[] } {
	const pictures = new Map<string, string>();
	const jobs = new Array<SnapshotJob>();
	for (const [key, page] of wanted) {
		const address = pageAddress(page.source, project);
		if (address === undefined) {
			reportWarnings(reporter, [
				`the page ${page.source} of the cell ${page.cell} is missing, so the builds draw the cell as it is`,
			]);
			continue;
		}
		pictures.set(key, page.output);
		const file = localFile(page.source, project);
		const pictureTime = changedAtMs(page.output);
		if (
			file !== undefined &&
			pictureTime !== undefined &&
			pictureTime >= pageChangedAtMs(file)
		) {
			continue;
		}
		jobs.push({ ...page, address, before: pictureTime });
	}
	return { pictures, jobs };
}

/** Takes the picture of each job, and warns about each page that gave none. */
async function takeSnapshots(
	inputs: SnapshotInputs,
	jobs: readonly SnapshotJob[]
): Promise<void> {
	const { reporter } = inputs;
	if (jobs.length > 0) {
		const browser = await inputs.browser();
		let taken = 0;
		for (const [index, job] of jobs.entries()) {
			throwIfCancelled(inputs.signal);
			const failure = await takePicture(browser, job, inputs.settings);
			if (failure === undefined) {
				taken += 1;
			} else {
				reportWarnings(reporter, [
					`the page ${job.address} gave no picture: ${failure}`,
				]);
			}
			reportProgress(
				reporter,
				BuildStep.PAGE_PICTURES,
				index + 1,
				jobs.length
			);
		}
		reportLine(reporter, `${taken} pictures of embedded pages taken`);
	}
	for (const job of jobs) {
		const after = changedAtMs(job.output);
		if (after !== undefined && after !== job.before) {
			continue;
		}
		const shows =
			after === undefined
				? "as it is"
				: "with the picture of an earlier build";
		reportWarnings(reporter, [
			`the page ${job.source} of the cell ${job.cell} gave no picture, so the builds draw the cell ${shows}`,
		]);
	}
}

/** The PNG of each embedded page of the slides at the size of its cell, taking what is missing. */
export async function takePagePictures(
	inputs: SnapshotInputs
): Promise<PagePictures> {
	const { folder } = inputs;
	const wanted = wantedSnapshots(inputs.slides, folder);
	if (wanted.size === 0) {
		removeUnused(folder, new Set());
		return new Map();
	}
	fs.mkdirSync(folder, { recursive: true });
	const { pictures, jobs } = plannedSnapshots(
		wanted,
		inputs.project,
		inputs.reporter
	);
	await takeSnapshots(inputs, jobs);
	const existing = new Map(
		[...pictures].filter(([, file]) => fs.existsSync(file))
	);
	removeUnused(
		folder,
		new Set([...existing.values()].map((file) => path.basename(file)))
	);
	return existing;
}
