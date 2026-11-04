/**
 * A row of logos written into one page of a section file, for the title slide of a deck.
 *
 * Each logo is a PNG file. It is cropped to the box of its pixels whose alpha exceeds 16, and
 * resampled with a Lanczos filter of three lobes to `scale` times its height on the slide. The
 * page holds each logo as a PNG data URI, because the draw.io editor shows no picture that a path
 * names. Every logo gets the same height, the logos are centred on one horizontal line, and they
 * spread from `left` to `right` with equal gaps. A cell with a given id is replaced in place, and
 * a missing cell is added at the end of the page, in the layout that the editor saves, so that a
 * save in the editor changes no line.
 *
 * Yujun Huang grants an additional permission for this file under section 7 of the GNU General
 * Public License, version 3, in LICENSE-EXCEPTION.md of Draw.io Slides.
 */
import * as fs from "fs";
import { PNG } from "pngjs";
import { DeckError } from "./deckError";
import { readTextFile, roundHalfToEven } from "./textFormats";

/** A logo by the id of its cell and the PNG file that it is drawn from. */
export interface Logo {
	readonly cellId: string;
	readonly file: string;
}

/** Where the row lies on the slide, in pixels of the slide, and the resolution of the pictures. */
export interface LogoRow {
	readonly height: number;
	readonly centreY: number;
	readonly left: number;
	readonly right: number;
	/** The height of each picture as a multiple of its height on the slide. */
	readonly scale: number;
}

/** The row below the affiliation of the title slide of the template. */
export const TITLE_SLIDE_ROW: LogoRow = {
	height: 100,
	centreY: 925,
	left: 160,
	right: 1760,
	scale: 3,
};

/** The pixels of a picture as 8-bit RGBA, row by row. */
interface Picture {
	readonly width: number;
	readonly height: number;
	readonly data: Uint8Array;
}

const PICTURE_STYLE = (data: string): string =>
	`shape=image;html=1;imageAspect=1;aspect=fixed;image=data:image/png,${data};`;
/** An alpha above this value counts as a pixel of the logo for the crop. */
const OPAQUE_ALPHA = 16;
const LANCZOS_LOBES = 3;

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The value with `digits` decimals, rounded half to even, as Python's `%.<digits>f` writes it. */
function fixed(value: number, digits: number): string {
	const factor = 10 ** digits;
	return (roundHalfToEven(value * factor) / factor).toFixed(digits);
}

/** The value with at most two decimals and no trailing zero, such as `926.5`. */
function geometryNumber(value: number): string {
	return fixed(value, 2).replace(/0+$/, "").replace(/\.$/, "");
}

function readPicture(file: string): Picture {
	if (!fs.existsSync(file)) {
		throw new DeckError(`the logo ${file} does not exist`);
	}
	try {
		const png = PNG.sync.read(fs.readFileSync(file));
		return { width: png.width, height: png.height, data: png.data };
	} catch (error) {
		throw new DeckError(
			`the logo ${file} does not read as a PNG file: ${
				(error as Error).message
			}`
		);
	}
}

/** The picture cut to the box of its pixels whose alpha exceeds `OPAQUE_ALPHA`. */
function croppedToLogo(picture: Picture, file: string): Picture {
	let [left, top, right, bottom] = [picture.width, picture.height, -1, -1];
	for (let y = 0; y < picture.height; y++) {
		for (let x = 0; x < picture.width; x++) {
			if (picture.data[(y * picture.width + x) * 4 + 3] > OPAQUE_ALPHA) {
				left = Math.min(left, x);
				right = Math.max(right, x);
				top = Math.min(top, y);
				bottom = Math.max(bottom, y);
			}
		}
	}
	if (right < 0) {
		throw new DeckError(
			`the logo ${file} has no pixel that is not transparent`
		);
	}
	const width = right - left + 1;
	const height = bottom - top + 1;
	const data = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++) {
		const start = ((top + y) * picture.width + left) * 4;
		data.set(
			picture.data.subarray(start, start + width * 4),
			y * width * 4
		);
	}
	return { width, height, data };
}

function lanczos(distance: number): number {
	if (distance === 0) {
		return 1;
	}
	if (Math.abs(distance) >= LANCZOS_LOBES) {
		return 0;
	}
	const angle = Math.PI * distance;
	return (
		(LANCZOS_LOBES * Math.sin(angle) * Math.sin(angle / LANCZOS_LOBES)) /
		(angle * angle)
	);
}

/**
 * The weights of the source pixels of each target pixel along one axis, with the filter widened
 * by the factor of a reduction, as Pillow computes them.
 */
function axisWeights(
	sourceSize: number,
	targetSize: number
): { first: number; weights: Float64Array }[] {
	const ratio = sourceSize / targetSize;
	const widening = Math.max(ratio, 1);
	const support = LANCZOS_LOBES * widening;
	return Array.from({ length: targetSize }, (_unused, target) => {
		const centre = (target + 0.5) * ratio;
		const first = Math.max(0, Math.floor(centre - support + 0.5));
		const last = Math.min(sourceSize, Math.floor(centre + support + 0.5));
		const weights = new Float64Array(last - first);
		for (let source = first; source < last; source++) {
			weights[source - first] = lanczos(
				(source - centre + 0.5) / widening
			);
		}
		const total = weights.reduce((sum, weight) => sum + weight, 0);
		return { first, weights: weights.map((weight) => weight / total) };
	});
}

function clampedByte(value: number): number {
	return Math.min(255, Math.max(0, Math.round(value)));
}

/** One pass of the filter along one axis, which reads and writes 8-bit RGBA, as Pillow does. */
function resampledAlong(
	source: Uint8Array,
	sourceWidth: number,
	sourceHeight: number,
	isHorizontal: boolean,
	targetSize: number
): Uint8Array {
	const [width, height] = isHorizontal
		? [targetSize, sourceHeight]
		: [sourceWidth, targetSize];
	const weights = axisWeights(
		isHorizontal ? sourceWidth : sourceHeight,
		targetSize
	);
	const target = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const { first, weights: lineWeights } =
				weights[isHorizontal ? x : y];
			for (let channel = 0; channel < 4; channel++) {
				let sum = 0;
				lineWeights.forEach((weight, offset) => {
					const [sourceX, sourceY] = isHorizontal
						? [first + offset, y]
						: [x, first + offset];
					sum +=
						weight *
						source[(sourceY * sourceWidth + sourceX) * 4 + channel];
				});
				target[(y * width + x) * 4 + channel] = clampedByte(sum);
			}
		}
	}
	return target;
}

/**
 * The picture resampled to the size, through colours multiplied by their alpha, so that the
 * colour of a transparent pixel does not bleed into the edge of the logo. Each stage keeps 8-bit
 * values, as `Image.resize` of Pillow does for RGBA.
 */
function resampled(picture: Picture, width: number, height: number): Picture {
	const premultiplied = new Uint8Array(picture.data.length);
	for (let index = 0; index < picture.data.length; index += 4) {
		const alpha = picture.data[index + 3];
		for (let channel = 0; channel < 3; channel++) {
			premultiplied[index + channel] = clampedByte(
				(picture.data[index + channel] * alpha) / 255
			);
		}
		premultiplied[index + 3] = alpha;
	}
	const across = resampledAlong(
		premultiplied,
		picture.width,
		picture.height,
		true,
		width
	);
	const both = resampledAlong(across, width, picture.height, false, height);
	const data = new Uint8Array(both.length);
	for (let index = 0; index < both.length; index += 4) {
		const alpha = both[index + 3];
		data[index + 3] = alpha;
		for (let channel = 0; channel < 3; channel++) {
			data[index + channel] =
				alpha === 255 || alpha === 0
					? both[index + channel]
					: Math.min(
							255,
							Math.floor((255 * both[index + channel]) / alpha)
					  );
		}
	}
	return { width, height, data };
}

/** The logo cropped and resampled to `height` pixels, as base64 PNG, with its aspect ratio. */
export function logoData(
	file: string,
	height: number
): { ratio: number; data: string } {
	const logo = croppedToLogo(readPicture(file), file);
	const width = Math.max(
		1,
		roundHalfToEven((logo.width * height) / logo.height)
	);
	const picture = resampled(logo, width, height);
	const png = new PNG({ width, height });
	png.data = Buffer.from(picture.data);
	const encoded = PNG.sync.write(png, { colorType: 6, deflateLevel: 9 });
	return { ratio: width / height, data: encoded.toString("base64") };
}

function pictureCell(
	cellId: string,
	parent: string,
	data: string,
	x: number,
	y: number,
	width: number,
	height: number,
	indent: string
): string {
	return (
		`<mxCell id="${cellId}" parent="${parent}" style="${PICTURE_STYLE(
			data
		)}" value="" vertex="1">\n` +
		`${indent}    <mxGeometry height="${geometryNumber(
			height
		)}" width="${geometryNumber(width)}" x="${geometryNumber(
			x
		)}" y="${geometryNumber(y)}" as="geometry"/>\n` +
		`${indent}</mxCell>`
	);
}

/** The indentation of the cells of the page. */
function cellIndent(page: string): string {
	return /\n([ \t]*)<mxCell /.exec(page)?.[1] ?? "";
}

/** The id of the last layer of the page that carries only an id and a parent. */
function drawingLayer(page: string): string {
	const layers = [
		...page.matchAll(/<mxCell id="([^"]+)" parent="[^"]+"\s*\/>/g),
	];
	if (layers.length === 0) {
		throw new DeckError("the page has no layer to put the logos on");
	}
	return layers[layers.length - 1][1];
}

/** The page with each cell replaced in place, or added before the end of its root. */
function withCells(
	page: string,
	cells: readonly { cellId: string; cell: string }[]
): string {
	return cells.reduce((current, { cellId, cell }) => {
		const existing = new RegExp(
			`<mxCell id="${escapeRegExp(
				cellId
			)}"[^>]*?(?:/>|>[\\s\\S]*?</mxCell>)`
		);
		if (existing.test(current)) {
			return current.replace(existing, () => cell);
		}
		const closing = /\n([ \t]*)<\/root>/.exec(current);
		if (closing === null) {
			// A page written on one line, as draw.io never saves it, takes the cell on that line.
			return current.replace("</root>", () => `${cell}</root>`);
		}
		const indent = cellIndent(current);
		return current.replace(
			`\n${closing[1]}</root>`,
			() => `\n${indent}${cell}\n${closing[1]}</root>`
		);
	}, page);
}

/**
 * Writes the logos, from left to right, into the page of the section file, and returns a line
 * per logo with its place and a line with the gap between two logos.
 */
export function placeLogos(
	sectionFile: string,
	pageName: string,
	logos: readonly Logo[],
	row: LogoRow = TITLE_SLIDE_ROW
): string[] {
	if (!fs.existsSync(sectionFile)) {
		throw new DeckError(`the section file ${sectionFile} does not exist`);
	}
	const text = readTextFile(sectionFile);
	const diagram = new RegExp(
		`<diagram [^>]*name="${escapeRegExp(
			pageName
		)}"[^>]*>[\\s\\S]*?</diagram>`
	);
	const found = diagram.exec(text);
	if (found === null) {
		throw new DeckError(`${sectionFile} has no page named ${pageName}`);
	}
	const page = found[0];
	const pictureHeight = roundHalfToEven(row.height * row.scale);
	const pictures = logos.map((logo) => {
		const { ratio, data } = logoData(logo.file, pictureHeight);
		return { ...logo, width: row.height * ratio, data };
	});
	const gap =
		(row.right -
			row.left -
			pictures.reduce((sum, logo) => sum + logo.width, 0)) /
		Math.max(pictures.length - 1, 1);
	const top = row.centreY - row.height / 2;
	const indent = cellIndent(page);
	const lefts = pictures.reduce(
		(xs, logo) => [...xs, xs[xs.length - 1] + (logo.width + gap)],
		[row.left]
	);
	const lines: string[] = [];
	const cells = pictures.map((logo, index) => {
		const x = lefts[index];
		const parent =
			new RegExp(
				`<mxCell id="${escapeRegExp(logo.cellId)}" parent="([^"]+)"`
			).exec(page)?.[1] ?? drawingLayer(page);
		lines.push(
			`${logo.cellId} at x ${fixed(x, 1)}, ${fixed(
				logo.width,
				1
			)} wide and ${fixed(row.height, 1)} high`
		);
		return {
			cellId: logo.cellId,
			cell: pictureCell(
				logo.cellId,
				parent,
				logo.data,
				x,
				top,
				logo.width,
				row.height,
				indent
			),
		};
	});
	lines.push(`gap between two logos: ${fixed(gap, 1)}`);
	const placed =
		text.slice(0, found.index) +
		withCells(page, cells) +
		text.slice(found.index + page.length);
	fs.writeFileSync(sectionFile, placed, "utf8");
	return lines;
}
