/**
 * A PNG of each built slide of a deck, and contact sheets of twelve slides each, for a look at
 * the slides of a build without opening them one by one.
 *
 * The browser opens each SVG of `build/slides/` at 1920 by 1080 and writes `slide-NN.png` into
 * the output folder. It then lays the PNGs out three across and four down, at a third of their
 * size, and writes `sheet-N.png`.
 */
import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import { BuildReporter, throwIfCancelled } from "./buildEvents";
import { BrowserChoice, launchBrowser } from "./deckBrowser";
import { DeckError } from "./deckError";

/** What `screenshotSlides` reads and writes. */
export interface ScreenshotOptions {
	readonly project: string;
	readonly outdir: string;
	readonly browser?: BrowserChoice;
	readonly reporter?: BuildReporter;
	readonly signal?: AbortSignal;
}

const SLIDE_SVG = /^slide-(\d+)\.svg$/;
const VIEWPORT = { width: 1920, height: 1080 };
/** The milliseconds after the load of a slide before its picture, for the fonts to draw. */
const SETTLE_MS = 500;
const SHEET = { across: 3, down: 4, width: 640, height: 360, margin: 10 };

/** The SVGs of the built slides, in the order of their numbers. */
function builtSlides(slides: string): string[] {
	if (!fs.existsSync(slides)) {
		throw new DeckError(
			`${slides} does not exist, so build the deck first, with npm run build or npm run html`
		);
	}
	return fs
		.readdirSync(slides)
		.filter((name) => SLIDE_SVG.test(name))
		.sort(
			(first, second) =>
				Number(SLIDE_SVG.exec(first)![1]) -
				Number(SLIDE_SVG.exec(second)![1])
		);
}

function sheetHtml(shots: readonly string[]): string {
	const images = shots
		.map(
			(shot) =>
				`<img src="${pathToFileURL(shot).href}" style="width:${
					SHEET.width
				}px;height:${SHEET.height}px;background:#fff">`
		)
		.join("");
	return (
		`<!doctype html><body style="margin:0;padding:${SHEET.margin}px;background:#888;` +
		`display:grid;grid-template-columns:repeat(${SHEET.across},${SHEET.width}px);gap:${SHEET.margin}px">${images}</body>`
	);
}

/** Writes the pictures of the slides and the contact sheets, and returns the line that counts them. */
export async function screenshotSlides(
	options: ScreenshotOptions
): Promise<string> {
	const slides = path.join(path.resolve(options.project), "build", "slides");
	const names = builtSlides(slides);
	if (names.length === 0) {
		throw new DeckError(
			`${slides} holds no slide-NN.svg, so build the deck first`
		);
	}
	const outdir = path.resolve(options.outdir);
	fs.mkdirSync(outdir, { recursive: true });
	const browser = await launchBrowser(options.browser, options.reporter);
	try {
		const page = await browser.newPage({ viewport: VIEWPORT });
		const shots: string[] = [];
		for (const name of names) {
			throwIfCancelled(options.signal);
			await page.goto(pathToFileURL(path.join(slides, name)).href, {
				waitUntil: "networkidle",
			});
			await page.waitForTimeout(SETTLE_MS);
			const shot = path.join(outdir, name.replace(/\.svg$/, ".png"));
			await page.screenshot({ path: shot });
			shots.push(shot);
		}
		const perSheet = SHEET.across * SHEET.down;
		await page.setViewportSize({
			width: SHEET.across * (SHEET.width + SHEET.margin) + SHEET.margin,
			height: SHEET.down * (SHEET.height + SHEET.margin) + SHEET.margin,
		});
		for (let first = 0; first < shots.length; first += perSheet) {
			throwIfCancelled(options.signal);
			const sheet = path.join(outdir, `sheet-${first / perSheet + 1}`);
			fs.writeFileSync(
				sheet + ".html",
				sheetHtml(shots.slice(first, first + perSheet))
			);
			await page.goto(pathToFileURL(sheet + ".html").href, {
				waitUntil: "load",
			});
			await page.screenshot({ path: sheet + ".png", fullPage: true });
			fs.unlinkSync(sheet + ".html");
		}
		return `${shots.length} slides and ${Math.ceil(
			shots.length / perSheet
		)} sheets written to ${outdir}`;
	} finally {
		await browser.close();
	}
}
