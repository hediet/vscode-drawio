/**
 * The cells of a page of draw.io, with the properties that the editor sets with Edit Data and
 * Edit Link, and the rectangle of each cell on the page.
 *
 * A cell is an `mxCell`, or a `UserObject` or an `object` that wraps an `mxCell` and carries the
 * properties of the cell as its attributes, such as `html="assets/plots/surface.html"`, an HTML
 * page that the cell shows. The build reads the embedded pages of the cells to draw each one as a
 * picture of its page, and the HTML file reads the links, the videos and the pages of the cells.
 */
import {
	attribute,
	attributeObject,
	child,
	descendant,
	parseXml,
	XmlElement,
} from "./xmlTree";

/** The tags of the elements that wrap an `mxCell` and carry the properties of the cell. */
export const WRAPPERS: readonly string[] = ["UserObject", "object"];
/** The times of the bar of a video or a page, by their properties, with their defaults in seconds. */
export const BAR_TIMES = [
	{ property: "barHideDelay", field: "barHideDelay", seconds: 0 },
	{ property: "barFadeOut", field: "barFadeOut", seconds: 0.25 },
] as const;

export interface Rectangle {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

/** A cell of a page: the attributes of its wrapper, if any, and its `mxCell`. */
export interface Cell {
	readonly properties: Readonly<Record<string, string>>;
	readonly element: XmlElement;
}

/** The times of the bar of controls that the HTML file shows under a video or a page. */
export interface BarTimes {
	readonly barHideDelay: number;
	readonly barFadeOut: number;
}

/** A cell that shows an HTML page, the rectangle of the cell and the address of the page. */
export interface CellPage extends BarTimes {
	readonly cell: string;
	readonly rectangle: Rectangle;
	readonly source: string;
}

export function parentOf(cell: Cell): string | undefined {
	return attribute(cell.element, "parent");
}

export function isVertex(cell: Cell): boolean {
	return attribute(cell.element, "vertex") === "1";
}

export function isVisible(cell: Cell): boolean {
	return attribute(cell.element, "visible") !== "0";
}

/** The cells of the root element of a page, by their id, in the order of the page. */
export function readCellsOfTree(page: XmlElement): Map<string, Cell> {
	const root = descendant(page, ["mxGraphModel", "root"]);
	const cells = new Map<string, Cell>();
	for (const element of root?.children ?? []) {
		const id = attribute(element, "id") as string;
		if (WRAPPERS.includes(element.tag)) {
			cells.set(id, {
				properties: attributeObject(element),
				element: child(element, "mxCell") ?? {
					tag: "mxCell",
					attributes: [],
					text: undefined,
					tail: undefined,
					children: [],
				},
			});
		} else if (element.tag === "mxCell") {
			cells.set(id, { properties: {}, element });
		}
	}
	return cells;
}

/** The cells of one `<diagram>` page, by their id. */
export function readCells(diagram: string): Map<string, Cell> {
	return readCellsOfTree(parseXml(diagram));
}

function numberOf(element: XmlElement | undefined, name: string): number {
	const value = element === undefined ? undefined : attribute(element, name);
	return value === undefined ? 0 : Number(value);
}

/**
 * The rectangle of a vertex in the coordinates of the page, or undefined when it shows nowhere.
 * The geometry of a cell inside a group or a container is relative to its parent, so the offsets
 * of the vertices above it are added. A cell is hidden when it or a cell above it, its layer among
 * them, is invisible.
 */
export function pageRectangle(
	cells: ReadonlyMap<string, Cell>,
	cellId: string
): Rectangle | undefined {
	const cell = cells.get(cellId)!;
	const geometry = child(cell.element, "mxGeometry");
	if (
		!isVertex(cell) ||
		geometry === undefined ||
		attribute(geometry, "relative") === "1"
	) {
		return undefined;
	}
	let x = numberOf(geometry, "x");
	let y = numberOf(geometry, "y");
	const parent = parentOf(cell);
	let ancestor = parent === undefined ? undefined : cells.get(parent);
	while (ancestor !== undefined) {
		if (!isVisible(ancestor)) {
			return undefined;
		}
		if (isVertex(ancestor)) {
			const offset = child(ancestor.element, "mxGeometry");
			x += numberOf(offset, "x");
			y += numberOf(offset, "y");
		}
		const above = parentOf(ancestor);
		ancestor = above === undefined ? undefined : cells.get(above);
	}
	if (!isVisible(cell)) {
		return undefined;
	}
	return {
		x,
		y,
		width: numberOf(geometry, "width"),
		height: numberOf(geometry, "height"),
	};
}

/** The times of the bar of a cell, with a warning for a value that is no time of 0 s or more. */
export function barTimes(
	cellId: string,
	properties: Readonly<Record<string, string>>,
	problems: string[]
): BarTimes {
	const times = BAR_TIMES.map(({ property, seconds: defaultSeconds }) => {
		const value = (properties[property] ?? "").trim();
		const parsed = value === "" ? defaultSeconds : Number(value);
		if (!(parsed >= 0) || parsed === Infinity) {
			problems.push(
				`the cell ${cellId} has ${property}=${value}, which is no time of 0 s or more, so it takes ${defaultSeconds}`
			);
			return defaultSeconds;
		}
		return parsed;
	});
	return { barHideDelay: times[0], barFadeOut: times[1] };
}

/**
 * The embedded pages of the cells of a page, without a cell that has a video, which shows the
 * video. A warning for a time of the bar goes to `problems`.
 */
export function readCellPages(
	cells: ReadonlyMap<string, Cell>,
	problems: string[] = []
): CellPage[] {
	const pages = new Array<CellPage>();
	for (const [cellId, cell] of cells) {
		const source = (cell.properties.html ?? "").trim();
		if (source === "" || (cell.properties.video ?? "").trim() !== "") {
			continue;
		}
		const rectangle = pageRectangle(cells, cellId);
		if (rectangle !== undefined) {
			pages.push({
				cell: cellId,
				rectangle,
				source,
				...barTimes(cellId, cell.properties, problems),
			});
		}
	}
	return pages;
}
