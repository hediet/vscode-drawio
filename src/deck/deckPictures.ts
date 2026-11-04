/**
 * The pictures of a deck, written into the cells that show them as data.
 *
 * A picture is a cell whose style names a file of the deck, `image=assets/<name>`. A draw.io
 * editor that looks such a path up beside its own page, or the viewer of the export, finds
 * nothing there and shows the placeholder of a missing picture. The build therefore writes the
 * file into the cell as a data URI and keeps its name in the style key `assetSource=assets/<name>`,
 * which draw.io keeps and ignores. A cell that carries `assetSource` gets the data of its file
 * again, so a picture whose file changed shows the new file.
 *
 * The build writes the data into the pages it assembles, for the slides, and
 * `embedSlideFilePictures` writes it into the slide files of a deck, for a draw.io editor that
 * finds no picture beside the drawing, as `hediet.vscode-drawio` and the desktop application do.
 * The editor of this extension draws the pictures from their files by itself.
 *
 * Yujun Huang grants an additional permission for this file under section 7 of the GNU General
 * Public License, version 3, in LICENSE-EXCEPTION.md of Draw.io Slides.
 */
import * as fs from "fs";
import * as path from "path";
import { DeckError } from "./deckError";
import { findSlidesLocation, isFile, SUFFIX } from "./deckFiles";
import { escapeHtml, readTextFile, unescapeHtml } from "./textFormats";

const MEDIA: Readonly<Record<string, string>> = {
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
};
const STYLE = /(<mxCell\b[^>]*?\bstyle=")([^"]*)(")/g;
const SOURCE = /(?:^|;)assetSource=(assets\/[^;]+)/;
const LINKED = /(?:^|;)image=(assets\/[^;]+)/;

/**
 * A text with its pictures written as data, the count of the cells whose data changed, and the
 * names of the pictures whose files do not exist, in the order of the text.
 */
export interface EmbeddedText {
	readonly text: string;
	readonly written: number;
	readonly missing: readonly string[];
}

export function dataUri(file: string): string {
	const media = MEDIA[path.extname(file).toLowerCase()] ?? "image/png";
	return `data:${media},${fs.readFileSync(file).toString("base64")}`;
}

/**
 * The file a style names as its picture, `assetSource` first, or undefined. The keys are the style
 * with its references of XML read, so a name that holds `&` is whole.
 */
export function pictureName(keys: string): string | undefined {
	return (SOURCE.exec(keys) ?? LINKED.exec(keys))?.[1];
}

/** The keys with the data of the file in `image=`, and the name in `assetSource=`. */
export function embeddedKeys(keys: string, name: string, data: string): string {
	const embedded = keys.replace(
		/(^|;)image=[^;]*/,
		(_whole, start: string) => `${start}image=${data}`
	);
	return SOURCE.test(embedded)
		? embedded
		: `${embedded.replace(/;+$/, "")};assetSource=${name};`;
}

/**
 * The text of a drawing with the picture of each cell written as data from its file in the deck
 * folder. A style whose data already equals its file is left as it stands, so a second run
 * changes nothing, and a picture whose file does not exist leaves its cell as it is.
 */
export function embedPictures(text: string, deck: string): EmbeddedText {
	let written = 0;
	const missing = new Array<string>();
	const embedded = text.replace(
		STYLE,
		(whole, start: string, style: string, end: string) => {
			const keys = unescapeHtml(style);
			const name = pictureName(keys);
			if (name === undefined) {
				return whole;
			}
			const file = path.join(deck, name);
			if (!isFile(file)) {
				missing.push(name);
				return whole;
			}
			const withData = embeddedKeys(keys, name, dataUri(file));
			if (withData === keys) {
				return whole;
			}
			written += 1;
			return start + escapeHtml(withData) + end;
		}
	);
	return { text: embedded, written, missing };
}

/** The lines of the writing of the pictures into the slide files, and a warning for each missing picture. */
export interface SlideFilePictures {
	readonly lines: readonly string[];
	readonly warnings: readonly string[];
}

/**
 * The files that hold the pages of the deck, the section files before a single file, as the
 * build reads them. Raises `DeckError` for a deck that holds neither.
 */
function slideFiles(deck: string, slidesDir: string, single: string): string[] {
	const found = findSlidesLocation(deck, slidesDir, single);
	if (found === undefined) {
		throw new DeckError(
			`${deck} holds no file ${slidesDir}/*${SUFFIX} and no ${single}`
		);
	}
	if (!found.isFolder) {
		return [found.location];
	}
	const files = fs
		.readdirSync(found.location)
		.filter((name) => name.endsWith(SUFFIX) && !name.startsWith("."))
		.sort()
		.map((name) => path.join(found.location, name));
	if (files.length === 0) {
		throw new DeckError(`${found.location}/ holds no file *${SUFFIX}`);
	}
	return files;
}

/**
 * Writes the picture of each cell of the slide files of a deck as data from its file, as
 * `embedPictures` does for a text, and names each picture whose file does not exist.
 */
export function embedSlideFilePictures(
	deck: string,
	slidesDir: string,
	single: string
): SlideFilePictures {
	const folder = path.resolve(deck);
	const lines = new Array<string>();
	const missing = new Set<string>();
	for (const file of slideFiles(folder, slidesDir, single)) {
		const text = readTextFile(file);
		const embedded = embedPictures(text, folder);
		if (embedded.text !== text) {
			fs.writeFileSync(file, embedded.text, "utf8");
		}
		if (embedded.written > 0) {
			lines.push(
				`${path.relative(folder, file)}: ${embedded.written} ${
					embedded.written === 1 ? "picture" : "pictures"
				} written as data`
			);
		}
		embedded.missing.forEach((name) => missing.add(name));
	}
	return {
		lines,
		warnings: [...missing]
			.sort()
			.map(
				(name) =>
					`${name} does not exist, so its cells stay as they are`
			),
	};
}
