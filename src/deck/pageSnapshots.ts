/**
 * The cells of embedded pages drawn as pictures of their pages, so that every build shows them.
 *
 * A cell with the property `html` shows its page live in the editor and in the HTML file, which
 * leave the cell's own picture undrawn. The PDF and the exported SVGs, which the HTML file is made
 * of, draw the cell itself. So that every build shows the same thing, the build takes a picture of
 * each page at the size of its cell, and draws the cell in the assembled deck as that picture, in
 * place of its own fill. This module draws the cells from the pictures, and names the file of
 * each picture in `build/page-snapshots/`. A cell whose shape is not `image` becomes an image of
 * its page, which drops the outline of the shape, with a warning.
 *
 * Yujun Huang grants an additional permission for this file under section 7 of the GNU General
 * Public License, version 3, in LICENSE-EXCEPTION.md of DrawSlidesCode.
 */
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import {
	CellPage,
	readCellPages,
	readCellsOfTree,
	WRAPPERS,
} from "./deckCells";
import {
	attribute,
	child,
	parseXml,
	serializeXml,
	withAttribute,
	withChildReplaced,
	XmlElement,
} from "./xmlTree";
import { floatText } from "./textFormats";

/** The pictures of the embedded pages, by `snapshotKey`, each the path of a PNG file. */
export type PagePictures = ReadonlyMap<string, string>;

/** A page with its cells drawn as pictures, and a warning for each cell whose shape changed. */
export interface PageWithPictures {
	readonly diagram: string;
	readonly warnings: readonly string[];
}

/** What tells two pictures apart: the address of the page and the size of its cell. */
export function snapshotKey(page: CellPage): string {
	return [page.source, page.rectangle.width, page.rectangle.height].join(
		"\n"
	);
}

/**
 * The file of the picture of a page in the folder of the pictures: the name of the page, then 16
 * hexadecimal digits of the SHA-1 of its address and its size, such as
 * `rocket-requirements-trajectories-ae28892f0cb793f3.png`.
 */
export function snapshotFile(folder: string, page: CellPage): string {
	const digest = crypto
		.createHash("sha1")
		.update(
			`${page.source}|${floatText(page.rectangle.width)}|${floatText(
				page.rectangle.height
			)}`,
			"utf8"
		)
		.digest("hex")
		.slice(0, 16);
	const stem =
		path.parse(path.basename(page.source.replace(/\/+$/, ""))).name ||
		"page";
	return path.join(folder, `${stem}-${digest}.png`);
}

/** The embedded pages of one parsed `<diagram>` page. */
export function embeddedPages(page: XmlElement): CellPage[] {
	return readCellPages(readCellsOfTree(page));
}

interface StyleEntry {
	readonly name: string;
	readonly value: string | undefined;
}

function parseStyle(style: string): StyleEntry[] {
	return style
		.split(";")
		.filter((part) => part !== "")
		.map((part) => {
			const equals = part.indexOf("=");
			return equals < 0
				? { name: part, value: undefined }
				: {
						name: part.slice(0, equals),
						value: part.slice(equals + 1),
				  };
		});
}

/** The style that draws a cell as the picture, and the shape it had when that was not `image`. */
export function pictureStyle(
	style: string,
	data: string
): { style: string; formerShape: string | undefined } {
	const entries = parseStyle(style);
	const shape = entries.find((entry) => entry.name === "shape")?.value;
	const kept = [
		{ name: "shape", value: "image" },
		{ name: "image", value: data },
		{ name: "imageAspect", value: "0" },
		...entries.filter(
			(entry) => !["shape", "image", "imageAspect"].includes(entry.name)
		),
	];
	return {
		style:
			kept
				.map(({ name, value }) =>
					value === undefined ? name : `${name}=${value}`
				)
				.join(";") + ";",
		formerShape: shape === "image" ? undefined : shape || "rectangle",
	};
}

/** The page with each cell of an embedded page drawn as the picture of its page. */
export function withPagePictures(
	diagram: string,
	pictures: PagePictures,
	where: string
): PageWithPictures {
	if (pictures.size === 0 || !diagram.includes("html=")) {
		return { diagram, warnings: [] };
	}
	const tree = parseXml(diagram);
	const cells = readCellsOfTree(tree);
	const styles = new Map<string, string>();
	const warnings = new Array<string>();
	for (const page of readCellPages(cells)) {
		const picture = pictures.get(snapshotKey(page));
		if (picture === undefined) {
			continue;
		}
		const data =
			"data:image/png," + fs.readFileSync(picture).toString("base64");
		const { style, formerShape } = pictureStyle(
			attribute(cells.get(page.cell)!.element, "style") ?? "",
			data
		);
		styles.set(page.cell, style);
		if (formerShape !== undefined) {
			warnings.push(
				`${where}, the cell ${page.cell} of the page ${page.source} is a ${formerShape} shape, so the builds draw it as a rectangular picture of its page; give it the shape image`
			);
		}
	}
	return styles.size > 0
		? { diagram: withStyles(tree, styles), warnings }
		: { diagram, warnings };
}

/** The text of the page with the style of each named cell replaced. */
function withStyles(
	page: XmlElement,
	styles: ReadonlyMap<string, string>
): string {
	const model = child(page, "mxGraphModel");
	const root = model === undefined ? undefined : child(model, "root");
	if (model === undefined || root === undefined) {
		return serializeXml(page);
	}
	const styled = (element: XmlElement): XmlElement => {
		const style = styles.get(attribute(element, "id") ?? "");
		if (style === undefined) {
			return element;
		}
		if (!WRAPPERS.includes(element.tag)) {
			return withAttribute(element, "style", style);
		}
		const inner = child(element, "mxCell");
		return inner === undefined
			? element
			: withChildReplaced(
					element,
					inner,
					withAttribute(inner, "style", style)
			  );
	};
	const newRoot = { ...root, children: root.children.map(styled) };
	return serializeXml(
		withChildReplaced(page, model, withChildReplaced(model, root, newRoot))
	);
}
