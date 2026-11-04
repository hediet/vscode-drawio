/**
 * The export of each page of the assembled deck to an SVG in `build/slides/`, through the draw.io
 * viewer, in the headless browser.
 *
 * The viewer is the library of draw.io that draws a page in a web page as the editor draws it,
 * by default the one that the extension bundles, so the export needs no network and draws with
 * the draw.io of the editor. A viewer on this machine finds MathJax, its fonts, the stencils and
 * the pictures in the folder `webapp` of draw.io around it, so it must sit in `webapp/js/`, and
 * the export stops when that folder holds no `math4/es5/startup.js`. The viewer draws the page
 * into an SVG element, and that element, given the page's own size and viewBox, is the exported
 * SVG. Labels stay HTML inside a `foreignObject`, so an equation stays MathJax output rather
 * than a picture. The group that draws the shape of a cell with the property `video` or `html`
 * carries `data-cell-id`, so that the HTML file puts the video or the page in that group, behind
 * the cells drawn after it.
 *
 * Several pages export at once, each in a tab of its own. A page is ready when the viewer has
 * drawn it and the fonts have loaded, and on a page with mathematical typesetting on, when every
 * formula is typeset as well. A page that is not ready within the wait of a page is exported as
 * it stood, with a warning, and the next build exports it again.
 *
 * The cache folder keeps the SVG of each ready page under a hash of the page, its size, the rules
 * of the list markers, the code of the export, the viewer and the version of the browser, so a
 * page that has not changed since an earlier build is copied rather than exported again. After
 * the export, the cache holds the files of its pages and the files that another export wrote or
 * copied since its start, so the cache does not grow with every edit.
 *
 * Two exports of one deck may run at once, such as a watch and a build of the PDF. Each page
 * shell carries the process id in its name. An SVG and a cache file are written under a name that
 * holds the process id and then renamed over their target, so the other export finds the earlier
 * file or the new one. An export gives each cache file that it copies the time of the copy, which
 * keeps the file in the cache of the other export. At its start, an export removes the page
 * shells and the partial SVGs of an export whose process no longer runs.
 *
 * Each SVG in `build/slides/` is then written in its light colours on a white page, so a slide
 * looks the same on a system in dark mode. The cache keeps the SVGs as the viewer drew them.
 *
 * Yujun Huang grants an additional permission for this file under section 7 of the GNU General
 * Public License, version 3, in LICENSE-EXCEPTION.md of Draw.io Slides.
 */
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import type { Browser, Page } from "playwright-core";
import {
	BuildReporter,
	BuildStep,
	reportLine,
	reportProgress,
	reportWarnings,
	throwIfCancelled,
} from "./buildEvents";
import { DeckError } from "./deckError";
import { DIAGRAM } from "./deckFiles";
import { readTextFile } from "./textFormats";

/** The settings of the export, each with a default. */
export interface ExportSettings {
	/** The viewer as a path, a `file:` address or an address on the web, the extension's own by default. */
	readonly viewer?: string;
	/** Whether every page is exported again, without the cache. */
	readonly isFresh?: boolean;
	/** The pages that export at once, 4 by default. */
	readonly workers?: number;
	/** The most milliseconds that a page may take to be ready, 15000 by default. */
	readonly pageWaitMs?: number;
}

/** What the export needs beyond its settings. */
export interface ExportInputs {
	/** The text of the assembled deck. */
	readonly assembled: string;
	readonly outdir: string;
	readonly pageCount: number;
	readonly width: number;
	readonly height: number;
	/** The folder of the cache, or undefined for an export without one. */
	readonly cache: string | undefined;
	/** The viewer that the settings name, or else the one of the extension. */
	readonly viewer: string;
	/** The CSS rules of the list markers, which each slide with a list carries. */
	readonly markerCss: string;
	readonly browser: Browser;
	readonly settings: ExportSettings;
	readonly reporter?: BuildReporter;
	readonly signal?: AbortSignal;
}

const DEFAULT_WORKERS = 4;
const DEFAULT_PAGE_WAIT_MS = 15000;

/**
 * The code of the export that its output depends on, which the key of the cache holds, so that a
 * change of the export exports every page again. A change of the code in Node.js that changes
 * the SVG changes the number at its end.
 */
const EXPORT_FORMAT = "slideExport 1";

/** Whether a page has been drawn, evaluated in the page shell until it holds. */
const READY_EXPRESSION = String.raw`(() => {
  const svg = document.querySelector('#page svg');
  if (!svg || !window.pageViewer || document.fonts.status !== 'loaded') return false;
  return !window.pageViewer.graph.mathEnabled || ![...svg.querySelectorAll('foreignObject')]
    .some(node => /\\\(|\$\$/.test(node.textContent));
})()`;

/** Two frames of drawing after the page is ready, so the last layout is on the page. */
const TWO_FRAMES_EXPRESSION =
	"new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))";

/**
 * The function that gives the SVG of the page shell, called with the width and the height of the
 * slide and the rules of the list markers. It marks the group of the shape of each cell with a
 * video or a page, gives the SVG the size of the slide and a view box at the offset of the
 * drawing, and copies into it the rules of the animations it names and, on a slide with a list,
 * the rules of the list markers.
 */
const SVG_FUNCTION = String.raw`([w, h, markers]) => {
  const element = document.querySelector('#page svg');
  if (!element) return null;
  const graph = window.pageViewer.graph;
  for (const cell of Object.values(graph.model.cells)) {
    const state = graph.view.getState(cell);
    const value = cell.value && cell.value.getAttribute ? cell.value : null;
    const media = value ? value.getAttribute('video') || value.getAttribute('html') : null;
    if (!media || !state || !state.shape || !state.shape.node) continue;
    state.shape.node.setAttribute('data-cell-id', cell.id);
  }
  const clone = element.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  clone.removeAttribute('style');
  let transform = '';
  for (const group of element.querySelectorAll('g')) {
    const value = group.getAttribute('transform') || '';
    if (/translate\(/.test(value)) { transform = value; break; }
  }
  const translate = /translate\(([-\d.]+)[, ]+([-\d.]+)\)/.exec(transform);
  const zoom = /scale\(([-\d.]+)\)/.exec(transform);
  const scale = zoom ? parseFloat(zoom[1]) : 1;
  const tx = translate ? parseFloat(translate[1]) : 0;
  const ty = translate ? parseFloat(translate[2]) : 0;
  clone.setAttribute('width', w);
  clone.setAttribute('height', h);
  clone.setAttribute('viewBox', tx + ' ' + ty + ' ' + (w * scale) + ' ' + (h * scale));
  const markup = clone.outerHTML;
  const animations = [...document.head.querySelectorAll('style')]
    .map(style => style.textContent)
    .filter(css => [...css.matchAll(/@keyframes\s+([\w-]+)/g)].some(m => markup.includes(m[1])));
  const rules = animations.concat(clone.querySelector('ul, ol') ? [markers] : []);
  if (rules.length) {
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = rules.join('\n');
    clone.insertBefore(style, clone.firstChild);
  }
  return new XMLSerializer().serializeToString(clone);
}`;

/** The viewer by its address, and the scripts that point it at the folder `webapp` around it. */
interface Viewer {
	readonly address: string;
	readonly key: string;
	readonly paths: string;
	readonly shown: string;
}

function readViewer(named: string): Viewer {
	if (/^https?:/.test(named)) {
		return { address: named, key: named, paths: "", shown: named };
	}
	const file = path.resolve(
		/^file:/.test(named) ? fileURLToPath(named) : named
	);
	if (!fs.existsSync(file)) {
		throw new DeckError(`the viewer ${file} does not exist`);
	}
	const webappFolder = path.dirname(path.dirname(file));
	if (!fs.existsSync(path.join(webappFolder, "math4", "es5", "startup.js"))) {
		throw new DeckError(
			`the viewer ${file} lies outside the folder webapp of draw.io: ${webappFolder} holds no math4/es5/startup.js, so its formulas would stay TeX; name the viewer-static.min.js in webapp/js/`
		);
	}
	const webapp = pathToFileURL(webappFolder).href;
	const paths = `<script>
window.DRAW_MATH_URL = '${webapp}/math4/es5';
window.STENCIL_PATH = '${webapp}/stencils';
window.SHAPES_PATH = '${webapp}/shapes';
window.IMAGE_PATH = '${webapp}/images';
window.STYLE_PATH = '${webapp}/styles';
window.mxBasePath = '${webapp}/mxgraph/';
window.mxImageBasePath = '${webapp}/mxgraph/images';
</script>
`;
	const stat = fs.statSync(file);
	return {
		address: pathToFileURL(file).href,
		key: `${file} ${stat.size} ${stat.mtimeMs}`,
		paths,
		shown: file,
	};
}

/**
 * The CSS rules of the list markers for the list styles of a deck, which the function
 * `listMarkerCss` of `list-marker-rules.js` of the extension writes, as the editor writes them.
 */
export function listMarkerCss(
	markerRulesFile: string,
	listStyles: Record<string, unknown>
): string {
	const write = new Function(
		fs.readFileSync(markerRulesFile, "utf8") + "\nreturn listMarkerCss;"
	)() as (styles: Record<string, unknown>) => string;
	return write(listStyles);
}

function isProcessRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code !== "ESRCH";
	}
}

/** Removes the page shells and the partial SVGs of an export whose process no longer runs. */
function removeLeftovers(outdir: string): void {
	for (const name of fs.readdirSync(outdir)) {
		const match =
			/^(?:\.page-(\d+)-\d+\.html|slide-\d+\.svg\.(\d+)\.tmp)$/.exec(
				name
			);
		if (match && !isProcessRunning(Number(match[1] || match[2]))) {
			fs.rmSync(path.join(outdir, name), { force: true });
		}
	}
}

/** Writes a file under a name of this process, then renames it over its target. */
function replaceFile(target: string, write: (partial: string) => void): void {
	const partial = `${target}.${process.pid}.tmp`;
	write(partial);
	fs.renameSync(partial, target);
}

/** The name of the SVG of a page, from 1, such as `slide-07.svg`. */
export function slideFileName(pageNumber: number): string {
	return `slide-${String(pageNumber).padStart(2, "0")}.svg`;
}

/** The page shell that the viewer draws one page in. */
function pageShell(viewer: Viewer, xml: string): string {
	const configuration = JSON.stringify({
		nav: false,
		resize: false,
		toolbar: "",
		xml,
		border: 0,
		math: true,
		zoom: 1,
		page: 0,
	});
	const escaped = configuration
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/"/g, "&quot;");
	return `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;background:#fff">
<div id="page" data-mxgraph="${escaped}"></div>
${viewer.paths}<script src="${viewer.address}"></script>
<script>GraphViewer.createViewerForElement(document.getElementById('page'),
  function (viewer) { window.pageViewer = viewer; });</script></body></html>`;
}

/** The pixels of the viewport of a page shell beyond each side of the slide, so the viewer draws the whole slide. */
const VIEWPORT_MARGIN = 200;

/**
 * The code of the export that the SVG of a page depends on, which the key of the cache holds:
 * the constants above, the page shell and the viewport.
 */
const EXPORT_CODE = [
	EXPORT_FORMAT,
	READY_EXPRESSION,
	TWO_FRAMES_EXPRESSION,
	SVG_FUNCTION,
	String(pageShell),
	String(VIEWPORT_MARGIN),
].join("\n");

/** What the export of the pages gave. */
export interface ExportResult {
	readonly written: number;
	readonly copied: number;
}

/** What every page of one export reads, and the counts that its workers advance. */
interface ExportContext {
	readonly inputs: ExportInputs;
	readonly viewer: Viewer;
	/** The pages of the assembled deck, each a `<diagram>` element. */
	readonly diagrams: readonly string[];
	/** The folder of the cache, or undefined for an export without one. */
	readonly cache: string | undefined;
	readonly browserVersion: string;
	readonly pageWaitMs: number;
	/** The names of the cache files that this export used. */
	readonly used: Set<string>;
	readonly counts: {
		/** The index of the next page that a worker takes. */
		next: number;
		/** The pages whose export ended. */
		done: number;
		written: number;
		copied: number;
	};
}

/** The key of a page in the cache, which changes with everything that its SVG depends on. */
function cacheKey(context: ExportContext, xml: string): string {
	const { inputs, viewer, browserVersion } = context;
	return crypto
		.createHash("sha1")
		.update(
			`${inputs.width}x${inputs.height}\n${viewer.key}\n${browserVersion}\n${EXPORT_CODE}\n${inputs.markerCss}\n${xml}`
		)
		.digest("hex");
}

/**
 * The SVG that the viewer draws of the page in the tab, or null, and whether the page was ready
 * within the wait of a page.
 */
async function drawnSvg(
	context: ExportContext,
	page: Page,
	index: number,
	xml: string
): Promise<{ svg: string | null; isReady: boolean }> {
	const { inputs, pageWaitMs } = context;
	const shell = path.resolve(
		inputs.outdir,
		`.page-${process.pid}-${index}.html`
	);
	fs.writeFileSync(shell, pageShell(context.viewer, xml));
	let isReady = true;
	try {
		await page.goto(pathToFileURL(shell).href);
		await page
			.waitForFunction(READY_EXPRESSION, undefined, {
				timeout: pageWaitMs,
				polling: 250,
			})
			.catch(() => {
				isReady = false;
				reportWarnings(inputs.reporter, [
					`page ${
						index + 1
					} was not ready within ${pageWaitMs} ms; exported as it stood and kept out of the cache`,
				]);
			});
		await page.evaluate(TWO_FRAMES_EXPRESSION);
		const svg = (await page.evaluate(
			`(${SVG_FUNCTION})(${JSON.stringify([
				inputs.width,
				inputs.height,
				inputs.markerCss,
			])})`
		)) as string | null;
		return { svg, isReady };
	} finally {
		fs.rmSync(shell, { force: true });
	}
}

/** Exports the page of the index to its SVG, from the cache when the cache holds it. */
async function exportPage(
	context: ExportContext,
	page: Page,
	index: number
): Promise<void> {
	const { inputs, cache, counts } = context;
	const xml = `<mxfile host="Draw.io Slides" pages="1">\n${context.diagrams[index]}\n</mxfile>\n`;
	const target = path.join(inputs.outdir, slideFileName(index + 1));
	const cached =
		cache === undefined
			? undefined
			: path.join(cache, `${cacheKey(context, xml)}.svg`);
	if (cached !== undefined) {
		context.used.add(path.basename(cached));
	}
	if (
		cached !== undefined &&
		!inputs.settings.isFresh &&
		fs.existsSync(cached)
	) {
		replaceFile(target, (partial) => fs.copyFileSync(cached, partial));
		const now = new Date();
		fs.utimesSync(cached, now, now);
		counts.written += 1;
		counts.copied += 1;
		return;
	}
	const { svg, isReady } = await drawnSvg(context, page, index, xml);
	if (!svg) {
		fs.rmSync(target, { force: true });
		reportWarnings(inputs.reporter, [`page ${index + 1} produced no SVG`]);
		return;
	}
	const text = '<?xml version="1.0" encoding="UTF-8"?>\n' + svg + "\n";
	replaceFile(target, (partial) => fs.writeFileSync(partial, text));
	if (cached !== undefined && isReady) {
		replaceFile(cached, (partial) => fs.writeFileSync(partial, text));
	}
	counts.written += 1;
}

/** A worker of the export: one tab that exports the next page until none is left or the signal is aborted. */
async function runExportWorker(context: ExportContext): Promise<void> {
	const { inputs, counts } = context;
	const page = await inputs.browser.newPage({
		viewport: {
			width: inputs.width + VIEWPORT_MARGIN,
			height: inputs.height + VIEWPORT_MARGIN,
		},
	});
	try {
		while (counts.next < inputs.pageCount && !inputs.signal?.aborted) {
			await exportPage(context, page, counts.next++);
			counts.done += 1;
			reportProgress(
				inputs.reporter,
				BuildStep.EXPORT,
				counts.done,
				inputs.pageCount
			);
		}
	} finally {
		await page.close();
	}
}

/**
 * Exports each page of the assembled deck to `slide-NN.svg` in the folder, copying a page that
 * the cache holds. Raises `DeckError` when a page gives no SVG, after the other pages are written.
 */
export async function exportPages(inputs: ExportInputs): Promise<ExportResult> {
	const started = Date.now();
	const workers = Math.max(1, inputs.settings.workers ?? DEFAULT_WORKERS);
	const viewer = readViewer(inputs.viewer);
	reportLine(inputs.reporter, `viewer: ${viewer.shown}`);
	fs.mkdirSync(inputs.outdir, { recursive: true });
	removeLeftovers(inputs.outdir);
	const cache =
		inputs.cache === undefined ? undefined : path.resolve(inputs.cache);
	if (cache !== undefined) {
		fs.mkdirSync(cache, { recursive: true });
	}
	const context: ExportContext = {
		inputs,
		viewer,
		diagrams: inputs.assembled.match(DIAGRAM) ?? [],
		cache,
		browserVersion: inputs.browser.version(),
		pageWaitMs: inputs.settings.pageWaitMs ?? DEFAULT_PAGE_WAIT_MS,
		used: new Set<string>(),
		counts: { next: 0, done: 0, written: 0, copied: 0 },
	};
	await Promise.all(
		Array.from({ length: Math.min(workers, inputs.pageCount) }, () =>
			runExportWorker(context)
		)
	);
	throwIfCancelled(inputs.signal);
	if (cache !== undefined) {
		removeUnusedCacheFiles(cache, context.used, started);
	}
	const { written, copied } = context.counts;
	reportLine(
		inputs.reporter,
		`${written} pages exported to ${inputs.outdir}, ${copied} of them unchanged and copied from the cache`
	);
	if (written < inputs.pageCount) {
		throw new DeckError(
			`${inputs.pageCount - written} of ${
				inputs.pageCount
			} pages produced no SVG`
		);
	}
	return { written, copied };
}

/** Removes each file of the cache that this export did not use and no export touched since its start. */
function removeUnusedCacheFiles(
	cache: string,
	used: ReadonlySet<string>,
	started: number
): void {
	for (const name of fs.readdirSync(cache)) {
		const file = path.join(cache, name);
		if (!/\.(svg|tmp)$/.test(name) || used.has(name)) {
			continue;
		}
		const stat = fs.statSync(file, { throwIfNoEntry: false });
		if (stat !== undefined && stat.mtimeMs < started) {
			fs.rmSync(file, { force: true });
		}
	}
}

/**
 * The text with every `light-dark(<light>, <dark>)` replaced by its light colour. A colour may
 * hold commas and brackets of its own, as `rgb(0, 136, 43)` does, so the two arguments are split
 * at the comma outside every bracket.
 */
export function firstOfLightDark(text: string): string {
	const opening = "light-dark(";
	const out = new Array<string>();
	let index = 0;
	for (;;) {
		const start = text.indexOf(opening, index);
		if (start < 0) {
			out.push(text.slice(index));
			return out.join("");
		}
		out.push(text.slice(index, start));
		let depth = 1;
		let cursor = start + opening.length;
		let comma: number | undefined;
		while (cursor < text.length && depth > 0) {
			const character = text[cursor];
			if (character === "(") {
				depth += 1;
			} else if (character === ")") {
				depth -= 1;
			} else if (
				character === "," &&
				depth === 1 &&
				comma === undefined
			) {
				comma = cursor;
			}
			cursor += 1;
		}
		out.push(
			text.slice(start + opening.length, comma ?? cursor - 1).trim()
		);
		index = cursor;
	}
}

/**
 * The SVG in its light colours on a white page. draw.io writes a colour as
 * `light-dark(<light>, <dark>)` and the root as `color-scheme: light dark` on a transparent
 * background, so a browser on a system in dark mode would draw the slide dark.
 */
export function lightSvg(svg: string): string {
	const light = firstOfLightDark(svg)
		.split("color-scheme: light dark")
		.join("color-scheme: light");
	const headEnd = light.indexOf(">", light.indexOf("<svg")) + 1;
	const head = light.slice(0, headEnd);
	const background = "background-color: #ffffff; color-scheme: light;";
	const styled = /<svg\b[^>]*\bstyle="/.test(head)
		? head.replace(
				/(<svg\b[^>]*\bstyle=")[^"]*"/,
				(_whole, start: string) => `${start}${background}"`
		  )
		: `${head.slice(0, -1)} style="${background}">`;
	return styled + light.slice(headEnd);
}

/** Writes each SVG of the folder, from the first page to the last, in its light colours. */
export function makeSlidesLight(outdir: string, pageCount: number): void {
	for (let number = 1; number <= pageCount; number++) {
		const file = path.join(outdir, slideFileName(number));
		fs.writeFileSync(file, lightSvg(readTextFile(file)), "utf8");
	}
}

/**
 * Removes the SVGs of pages beyond the last, which a deck that lost pages, to `-hide` or to a
 * deletion, would otherwise keep from the build before.
 */
export function removeSlidesBeyond(outdir: string, pageCount: number): void {
	for (const name of fs.readdirSync(outdir)) {
		const match = /^slide-(\d+)\.svg$/.exec(name);
		if (match && parseInt(match[1], 10) > pageCount) {
			fs.rmSync(path.join(outdir, name));
		}
	}
}
