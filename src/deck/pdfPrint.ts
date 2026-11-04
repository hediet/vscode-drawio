/**
 * The PDF of a built deck: the SVGs of `build/slides/` printed into one PDF, one page per SVG, at
 * the size of the slide, by the headless browser, so the PDF shows what the HTML file shows.
 *
 * The SVGs already carry the slide numbers, the TeX definitions and the pictures, and leave out
 * the hidden pages. `build/outline.json` lists the bookmarks of the PDF, each with its level, its
 * page and its title. The browser makes the bookmarks from the headings of the page it prints, so
 * each bookmark is a heading on its page that holds a transparent picture of one pixel with the
 * title as its alternative text. The title is then no text of the PDF, so a search and a copy of
 * the text do not find it.
 */
import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import type { Browser } from "playwright-core";
import { PdfOutlineEntry } from "./deckAssembly";
import { DeckError } from "./deckError";
import { slideFileName } from "./slideExport";

/** What the printing of the PDF needs. */
export interface PdfInputs {
	readonly svgFolder: string;
	readonly pageCount: number;
	readonly output: string;
	readonly width: number;
	readonly height: number;
	readonly bookmarks: readonly PdfOutlineEntry[];
	readonly browser: Browser;
}

const PIXEL =
	"data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
/** The page that the SVGs are printed from, beside them, so that their file addresses load. */
const PRINT_SHELL = ".print-pdf.html";
/** The pictures that did not load, evaluated in the page that prints the PDF. */
const BROKEN_PICTURES_EXPRESSION = `(async () => {
  const all = [...document.querySelectorAll('.page > img')];
  await Promise.all(all.map(image => image.decode().catch(() => null)));
  return all.filter(image => !image.naturalWidth).map(image => image.src);
})()`;

function escapeAttribute(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/** The page that holds each SVG of the deck at the size of the slide, with the headings of its bookmarks. */
function printShell(inputs: PdfInputs, svgFolder: string): string {
	const images = new Array<string>();
	for (let number = 1; number <= inputs.pageCount; number++) {
		const file = path.join(svgFolder, slideFileName(number));
		if (!fs.existsSync(file)) {
			throw new DeckError(`${file} is missing; run the build first`);
		}
		const headings = inputs.bookmarks
			.filter((mark) => mark.page === number)
			.map(
				(mark) =>
					`<h${mark.level}><img alt="${escapeAttribute(
						mark.title
					)}" src="${PIXEL}"></h${mark.level}>`
			)
			.join("");
		images.push(
			`<div class="page">${headings}<img src="${
				pathToFileURL(file).href
			}"></div>`
		);
	}
	const { width, height } = inputs;
	return `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: ${width}px ${height}px; margin: 0; }
html, body { margin: 0; background: #fff; }
.page { position: relative; width: ${width}px; height: ${height}px; overflow: hidden;
  break-after: page; }
.page h1, .page h2, .page h3 { position: absolute; top: 0; left: 0; margin: 0; font-size: 1px; }
.page h1 img, .page h2 img, .page h3 img { width: 1px; height: 1px; }
.page:last-child { break-after: auto; }
.page > img { display: block; width: ${width}px; height: ${height}px; }
</style></head><body>
${images.join("\n")}
</body></html>`;
}

/** Prints the SVGs into the PDF. Raises `DeckError` when an SVG is missing or does not load. */
export async function printPdf(inputs: PdfInputs): Promise<void> {
	const svgFolder = path.resolve(inputs.svgFolder);
	const output = path.resolve(inputs.output);
	const shell = path.join(svgFolder, PRINT_SHELL);
	fs.writeFileSync(shell, printShell(inputs, svgFolder));
	const page = await inputs.browser.newPage({
		viewport: { width: inputs.width, height: inputs.height },
	});
	try {
		await page.goto(pathToFileURL(shell).href);
		const broken = (await page.evaluate(
			BROKEN_PICTURES_EXPRESSION
		)) as string[];
		if (broken.length > 0) {
			throw new DeckError(
				`these SVGs did not load: ${broken.join(", ")}`
			);
		}
		fs.mkdirSync(path.dirname(output), { recursive: true });
		const hasBookmarks = inputs.bookmarks.length > 0;
		await page.pdf({
			path: output,
			width: `${inputs.width}px`,
			height: `${inputs.height}px`,
			printBackground: true,
			preferCSSPageSize: true,
			outline: hasBookmarks,
			tagged: hasBookmarks,
		});
	} finally {
		await page.close();
		fs.rmSync(shell, { force: true });
	}
}
