/**
 * The check of the spelling and the grammar of every label of a deck with a LanguageTool server,
 * which reports each issue with its slide.
 *
 * LanguageTool runs as a server, which Homebrew installs with `brew install languagetool` and
 * starts at `http://localhost:8081` with `brew services start languagetool`. The check asks the
 * server at the address that its caller gives, or else of the setting `drawioSlides.languageTool`
 * of the deck, which the editor plugin reads as well. No text leaves the machine while that
 * address names a server on it.
 *
 * Each label is read as `labelPieces.ts` says, and goes to the server in a request of its own, as
 * the plugin sends the label being edited, so a rule that reads several sentences reads one label
 * alone. The language and the rules left out are the object `CHECK` of the plugin
 * `language-check.plugin.js`, which the check reads from it, so the two check alike. A label that
 * several pages share, such as the steps of a slide, is checked once and reported at its first
 * slide, with the count of the others. A word of the list of the server counts as spelled right
 * in every application. A word of `language-check-words.txt` in the folder of the deck, one per
 * line, such as a name, counts as spelled right in that deck alone, and a line that starts with
 * `#` is a comment.
 */
import * as fs from "fs";
import * as http from "http";
import * as https from "https";
import * as path from "path";
import { URL } from "url";
import {
	BuildReporter,
	BuildStep,
	reportLine,
	reportProgress,
	throwIfCancelled,
} from "./buildEvents";
import { attribute } from "./xmlTree";
import { readCells } from "./deckCells";
import { DeckError, failureText } from "./deckError";
import { DeckPage, numberSlides } from "./deckFiles";
import { pluginFile } from "./extensionFiles";
import { LabelPiece, labelPieces } from "./labelPieces";

/** The editor plugin whose object `CHECK` gives the language and the rules left out. */
const PLUGIN = "language-check.plugin.js";
const WORDS_FILE = "language-check-words.txt";
/** The seconds that the server may take to answer one label. */
const ANSWER_WAIT_MS = 120000;

/** The object `CHECK` of the editor plugin. */
interface CheckOptions {
	readonly language: string;
	readonly disabledRules?: readonly string[];
	readonly formulaReadsAs: string;
}

/** An issue as LanguageTool reports it, with its offsets in UTF-16 code units. */
interface LanguageToolMatch {
	readonly message: string;
	readonly offset: number;
	readonly length: number;
	readonly replacements: readonly { readonly value: string }[];
	readonly rule: { readonly category?: { readonly id?: string } };
}

/** A labelled cell of a page. */
interface PageLabel {
	readonly cellId: string;
	readonly label: string;
	readonly isHtml: boolean;
	readonly isNewLineBreak: boolean;
}

/** A distinct label of the deck, with each place it shows: the slide, the page name and the cell. */
interface DistinctLabel {
	readonly pieces: readonly LabelPiece[];
	readonly places: {
		slide: number;
		pageName: string;
		cellId: string;
		file: string;
		pagePosition: number;
	}[];
}

/** What the check needs. */
export interface LanguageCheckInputs {
	readonly slides: readonly DeckPage[];
	readonly project: string;
	/** The address of the LanguageTool server. */
	readonly server: string;
	readonly extensionRoot: string;
	readonly reporter?: BuildReporter;
	readonly signal?: AbortSignal;
}

function readCheckOptions(extensionRoot: string): CheckOptions {
	const plugin = pluginFile(extensionRoot, PLUGIN);
	const match = /var CHECK = (\{[\s\S]*?\});/.exec(
		fs.readFileSync(plugin, "utf8")
	);
	if (match === null) {
		throw new DeckError(`${plugin} holds no object CHECK`);
	}
	return JSON.parse(match[1]);
}

/** The words that count as spelled right in the deck, in lower case. */
function knownWords(project: string): Set<string> {
	const file = path.join(project, WORDS_FILE);
	if (!fs.existsSync(file)) {
		return new Set();
	}
	return new Set(
		fs
			.readFileSync(file, "utf8")
			.split(/\r\n|\n|\r/)
			.map((line) => line.trim())
			.filter((line) => line !== "" && !line.startsWith("#"))
			.map((line) => line.toLowerCase())
	);
}

/** The labelled cells of a page, without a label that holds `%slide%`. */
function pageLabels(diagram: string): PageLabel[] {
	const labels = new Array<PageLabel>();
	for (const [cellId, cell] of readCells(diagram)) {
		const label =
			Object.keys(cell.properties).length > 0
				? cell.properties.label
				: attribute(cell.element, "value");
		if (!label || label.trim() === "" || label.includes("%slide%")) {
			continue;
		}
		const style = attribute(cell.element, "style") ?? "";
		const isHtml = /(^|;)html=1/.test(style);
		const newLines = /(?:^|;)nl2Br=([^;]*)/.exec(style);
		labels.push({
			cellId,
			label,
			isHtml,
			isNewLineBreak: !isHtml || newLines === null || newLines[1] === "1",
		});
	}
	return labels;
}

function pieceSource(piece: LabelPiece): string {
	return "text" in piece ? piece.text : piece.markup;
}

function pieceReading(piece: LabelPiece): string {
	return "text" in piece ? piece.text : piece.interpretAs;
}

/** The characters of a text, each a code point, so that a character outside the Basic Multilingual Plane counts once. */
function characters(text: string): string[] {
	return Array.from(text);
}

/**
 * The index among the characters of a text at an offset of LanguageTool, which counts UTF-16
 * code units, so that a character outside the Basic Multilingual Plane, such as an emoji, counts
 * twice.
 */
function characterIndex(text: readonly string[], units: number): number {
	let index = 0;
	let count = 0;
	while (index < text.length && count < units) {
		count += text[index].length;
		index += 1;
	}
	return index;
}

function flat(text: string): string {
	return text.replace(/\s+/g, " ");
}

/**
 * The text around an issue, with each tag and formula as it reads, the issue in brackets, and
 * `...` where the text goes on. The start and the length count the characters of the text and
 * the markup of the pieces joined.
 */
export function plainContext(
	pieces: readonly LabelPiece[],
	start: number,
	length: number,
	around = 40
): string {
	let before = "";
	let inside = "";
	let after = "";
	let place = 0;
	for (const piece of pieces) {
		const source = characters(pieceSource(piece));
		const reading = pieceReading(piece);
		const end = place + source.length;
		if (end <= start) {
			before += reading;
		} else if (place >= start + length) {
			after += reading;
		} else if ("text" in piece) {
			before += source.slice(0, Math.max(0, start - place)).join("");
			inside += source
				.slice(Math.max(0, start - place), start + length - place)
				.join("");
			after += source.slice(Math.max(0, start + length - place)).join("");
		} else {
			inside += reading;
		}
		place = end;
	}
	let shownBefore = characters(flat(before).replace(/^\s+/, ""));
	let shownAfter = characters(flat(after).replace(/\s+$/, ""));
	if (shownBefore.length > around) {
		shownBefore = characters(
			"..." + shownBefore.slice(-around).join("").replace(/^\s+/, "")
		);
	}
	if (shownAfter.length > around) {
		shownAfter = characters(
			shownAfter.slice(0, around).join("").replace(/\s+$/, "") + "..."
		);
	}
	return `${shownBefore.join("")}[${flat(inside)}]${shownAfter.join("")}`;
}

/** Posts a form to an address and gives the body of the answer. */
function postForm(address: string, form: URLSearchParams): Promise<string> {
	return new Promise((resolve, reject) => {
		const url = new URL(address);
		const body = form.toString();
		const request = (url.protocol === "https:" ? https : http).request(
			url,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
					"Content-Length": Buffer.byteLength(body),
				},
				timeout: ANSWER_WAIT_MS,
			},
			(response) => {
				const chunks = new Array<Buffer>();
				response.on("data", (chunk: Buffer) => chunks.push(chunk));
				response.on("end", () => {
					const text = Buffer.concat(chunks).toString("utf8");
					if ((response.statusCode ?? 500) >= 400) {
						reject(
							new Error(
								`HTTP ${response.statusCode}: ${text.slice(
									0,
									200
								)}`
							)
						);
					} else {
						resolve(text);
					}
				});
				response.on("error", reject);
			}
		);
		request.on("timeout", () =>
			request.destroy(new Error(`no answer within ${ANSWER_WAIT_MS} ms`))
		);
		request.on("error", reject);
		request.end(body);
	});
}

async function askLanguageTool(
	server: string,
	pieces: readonly LabelPiece[],
	options: CheckOptions
): Promise<LanguageToolMatch[]> {
	const form = new URLSearchParams({
		data: JSON.stringify({ annotation: pieces }),
		language: options.language,
		disabledRules: (options.disabledRules ?? []).join(","),
	});
	let answer: string;
	try {
		answer = await postForm(server + "/v2/check", form);
	} catch (error) {
		throw new DeckError(
			`LanguageTool did not answer at ${server} (${failureText(
				error
			)}); start it with brew services start languagetool`
		);
	}
	return JSON.parse(answer).matches;
}

/** The distinct labels of the slides, each once with the places it shows, in the order of the deck. */
function distinctLabels(
	slides: readonly DeckPage[],
	formulaReadsAs: string
): DistinctLabel[] {
	const { numbers } = numberSlides(slides);
	const labels = new Map<string, DistinctLabel>();
	slides.forEach((slide, index) => {
		for (const label of pageLabels(slide.diagram)) {
			const key = JSON.stringify([
				label.label,
				label.isHtml,
				label.isNewLineBreak,
			]);
			const entry = labels.get(key) ?? {
				pieces: labelPieces(
					label.label,
					label.isHtml,
					label.isNewLineBreak,
					formulaReadsAs
				),
				places: [],
			};
			labels.set(key, entry);
			entry.places.push({
				slide: numbers[index],
				pageName: slide.pageName,
				cellId: label.cellId,
				file: slide.source,
				pagePosition: slide.position,
			});
		}
	});
	return [...labels.values()].filter((entry) =>
		entry.pieces.some(
			(piece) => "text" in piece && piece.text.trim() !== ""
		)
	);
}

/** Reports the issues of the labels of the slides, and returns their number. */
export async function checkLanguage(
	inputs: LanguageCheckInputs
): Promise<number> {
	const server = inputs.server.replace(/\/+$/, "");
	const options = readCheckOptions(inputs.extensionRoot);
	const words = knownWords(inputs.project);
	const entries = distinctLabels(inputs.slides, options.formulaReadsAs);
	let found = 0;
	for (const [done, entry] of entries.entries()) {
		throwIfCancelled(inputs.signal);
		const full = characters(entry.pieces.map(pieceSource).join(""));
		for (const match of await askLanguageTool(
			server,
			entry.pieces,
			options
		)) {
			const start = characterIndex(full, match.offset);
			const end = characterIndex(full, match.offset + match.length);
			const word = full.slice(start, end).join("");
			const isSpelling = match.rule.category?.id === "TYPOS";
			if (isSpelling && words.has(word.toLowerCase())) {
				continue;
			}
			found += 1;
			const first = entry.places[0];
			const others =
				new Set(entry.places.map((place) => place.slide)).size - 1;
			const fixes = match.replacements
				.slice(0, 5)
				.map((fix) => fix.value);
			const context = plainContext(entry.pieces, start, end - start);
			reportLine(
				inputs.reporter,
				`slide ${first.slide}, ${first.pageName}, cell ${first.cellId}${
					others > 0
						? ` and ${others} other slide${others > 1 ? "s" : ""}`
						: ""
				}: ${isSpelling ? "spelling:" : "grammar or style:"} ${
					match.message
				}${fixes.join(", ") ? "; " + fixes.join(", ") : ""}`
			);
			reportLine(inputs.reporter, `    ${context}`);
			inputs.reporter?.onIssue?.({
				slide: first.slide,
				pageName: first.pageName,
				cellId: first.cellId,
				file: first.file,
				pagePosition: first.pagePosition,
				otherSlides: others,
				isSpelling,
				message: match.message,
				fixes,
				context,
			});
		}
		reportProgress(
			inputs.reporter,
			BuildStep.LANGUAGE_CHECK,
			done + 1,
			entries.length
		);
	}
	reportLine(
		inputs.reporter,
		`${found} issues in ${entries.length} distinct labels of ${inputs.slides.length} pages, checked by LanguageTool at ${server}`
	);
	return found;
}
