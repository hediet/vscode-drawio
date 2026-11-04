/**
 * A draw.io colour configuration written from the colours that a deck uses.
 *
 * draw.io takes three colour settings in its configuration. `colorNames` gives a name to a hex
 * value, which the colour dialog then shows as a tooltip. `presetColors` fills the top row of that
 * dialog. `customColorSchemes` adds rows of swatches, each a fill, a stroke and a font colour, to
 * the top of the Format panel's Style tab. This module counts the colours in a drawing, names
 * them, and writes the three settings as one JSON object ready to paste into a configuration.
 *
 * An output file that ends in `.tex` gets the colours as `\definecolor` lines instead, in the
 * model HTML, which the import of colours from TeX writes into the setting `drawioSlides.colors`
 * of a deck. A name of a hue there keeps its letters and digits alone, in lower case, such as
 * `grey8b959e` for `Grey 8B959E`, and the name of a `\definecolor` stays as written.
 *
 * A name comes from two places, in order. A colour that a LaTeX file gives a `\definecolor` keeps
 * the name of that definition as written, because it is the deck's own word for it. Anything left
 * is named after its hue, as `familyNames` says, so that no two names differ by a shade word
 * alone.
 *
 * Yujun Huang grants an additional permission for this file under section 7 of the GNU General
 * Public License, version 3, in LICENSE-EXCEPTION.md of Draw.io Slides.
 */
import * as fs from "fs";
import * as path from "path";
import { readDefinitions, unreadDefinitionWarnings } from "./texDefinitions";
import { jsonText } from "./textFormats";

const HUE_NAMES: readonly [number, string][] = [
	[15, "Red"],
	[45, "Orange"],
	[70, "Yellow"],
	[160, "Green"],
	[200, "Cyan"],
	[250, "Blue"],
	[290, "Violet"],
	[330, "Magenta"],
	[361, "Red"],
];
const COLOUR_PATTERNS = [
	/(?:fillColor|strokeColor|fontColor)=(#[0-9a-fA-F]{6})/g,
	/font color=&quot;(#[0-9a-fA-F]{6})/g,
	/textcolor\{(#[0-9a-fA-F]{6})\}/g,
	/color:\s*(#[0-9a-fA-F]{6})/g,
];

/** A swatch of the Format panel: the fill, the stroke and the font colour. */
export interface Swatch {
	readonly fill: string;
	readonly stroke: string;
	readonly font: string;
}

/** The colours of a drawing that the configuration keeps, named, most used first, with a summary. */
export interface ColourConfiguration {
	/** The text of the output file, JSON or `\definecolor` lines. */
	readonly text: string;
	/** The line of the counts and one line per colour kept. */
	readonly lines: readonly string[];
	readonly warnings: readonly string[];
}

/**
 * The colours that the given LaTeX files name, value `#rrggbb` to name. The first file that
 * defines a value names it.
 */
export function readDefinedColours(files: readonly string[]): {
	named: Map<string, string>;
	warnings: string[];
} {
	const named = new Map<string, string>();
	const warnings = new Array<string>();
	for (const file of files) {
		const definitions = readDefinitions(fs.readFileSync(file, "utf8"));
		warnings.push(...unreadDefinitionWarnings(file, definitions));
		for (const definition of definitions) {
			if (
				definition.value !== undefined &&
				!named.has(definition.value)
			) {
				named.set(definition.value, definition.name);
			}
		}
	}
	return { named, warnings };
}

/** The uses of each colour `#rrggbb` of a drawing, in the order the colours first appear. */
export function countColours(text: string): Map<string, number> {
	const counts = new Map<string, number>();
	for (const pattern of COLOUR_PATTERNS) {
		for (const match of text.matchAll(new RegExp(pattern.source, "g"))) {
			const value = match[1].toLowerCase();
			counts.set(value, (counts.get(value) ?? 0) + 1);
		}
	}
	return counts;
}

/** The red, the green and the blue of a value `#rrggbb`, each from 0 to 1. */
function channels(value: string): [number, number, number] {
	const [red, green, blue] = [1, 3, 5].map(
		(start) => parseInt(value.slice(start, start + 2), 16) / 255
	);
	return [red, green, blue];
}

/** The hue from 0 to 1, the lightness and the saturation of a colour in the model HLS. */
export function hueLightnessSaturation(
	red: number,
	green: number,
	blue: number
): [number, number, number] {
	const maximum = Math.max(red, green, blue);
	const minimum = Math.min(red, green, blue);
	const lightness = (minimum + maximum) / 2;
	if (minimum === maximum) {
		return [0, lightness, 0];
	}
	const range = maximum - minimum;
	const saturation =
		lightness <= 0.5
			? range / (maximum + minimum)
			: range / (2 - maximum - minimum);
	const redDistance = (maximum - red) / range;
	const greenDistance = (maximum - green) / range;
	const blueDistance = (maximum - blue) / range;
	const sextant =
		red === maximum
			? blueDistance - greenDistance
			: green === maximum
			? 2 + redDistance - blueDistance
			: 4 + greenDistance - redDistance;
	const hue = (((sextant / 6) % 1) + 1) % 1;
	return [hue, lightness, saturation];
}

export function hueName(value: string): string {
	const [red, green, blue] = channels(value);
	const [hue, lightness, saturation] = hueLightnessSaturation(
		red,
		green,
		blue
	);
	// The saturation of HLS grows as a colour nears white, so a near-white colour is a grey by its
	// chroma, the largest channel less the smallest, and a pale tint such as #dae8fc keeps its hue.
	const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
	if (saturation < 0.12 || (lightness > 0.9 && chroma < 0.05)) {
		return lightness < 0.25 ? "Black" : lightness > 0.9 ? "White" : "Grey";
	}
	const degrees = hue * 360;
	return HUE_NAMES.find(([limit]) => degrees < limit)![1];
}

/** How light a colour is, 0 for black and 1 for white. */
export function luminance(value: string): number {
	const [red, green, blue] = channels(value);
	return 0.299 * red + 0.587 * green + 0.114 * blue;
}

/**
 * Two rows for the Format panel: filled shapes, then outlines. A swatch sets the fill, the stroke
 * and the font colour together, so the font is chosen for contrast against the fill. A colour
 * close to white is left out of both rows, because a white fill with a white stroke, or a white
 * outline, is a swatch that makes a shape vanish on the page and looks empty in the panel.
 */
export function swatchRows(ordered: readonly string[], count = 8): Swatch[][] {
	const usable = ordered
		.filter((value) => luminance(value) < 0.93)
		.slice(0, count);
	return [
		usable.map((value) => ({
			fill: value,
			stroke: value,
			font: luminance(value) < 0.6 ? "#ffffff" : "#000000",
		})),
		usable.map((value) => ({ fill: "none", stroke: value, font: value })),
	];
}

/**
 * The names of the colours of one hue: the plain name of the hue when it has one colour, and the
 * name followed by the hex value for each colour of a hue of several.
 */
export function familyNames(
	base: string,
	members: readonly string[]
): Map<string, string> {
	return members.length === 1
		? new Map([[members[0], base]])
		: new Map(
				members.map((value) => [
					value,
					`${base} ${value.slice(1).toUpperCase()}`,
				])
		  );
}

/** The colours sorted by their uses, most first, colours of equal uses in their order. */
function byUses(counts: ReadonlyMap<string, number>): string[] {
	return [...counts.keys()].sort(
		(first, second) => counts.get(second)! - counts.get(first)!
	);
}

/**
 * One name per colour: the name of a LaTeX file for a colour it names, and otherwise a name of the
 * family of its hue.
 */
export function nameColours(
	counts: ReadonlyMap<string, number>,
	defined: ReadonlyMap<string, string>
): Map<string, string> {
	const families = new Map<string, string[]>();
	const names = new Map<string, string>();
	for (const value of byUses(counts)) {
		const name = defined.get(value);
		if (name !== undefined) {
			names.set(value, name);
		} else {
			const family = hueName(value);
			families.set(family, [...(families.get(family) ?? []), value]);
		}
	}
	for (const [base, members] of families) {
		for (const [value, name] of familyNames(base, members)) {
			names.set(value, name);
		}
	}
	return names;
}

/** A name of a colour as TeX reads it: its letters and digits, in lower case. */
export function texName(name: string): string {
	return name.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
}

/** The `\definecolor` lines of the colours, in their order. */
export function colourDefinitionLines(
	ordered: readonly string[],
	names: ReadonlyMap<string, string>,
	defined: ReadonlyMap<string, string>
): string {
	return ordered
		.map((value) => {
			const name = defined.has(value)
				? names.get(value)!
				: texName(names.get(value)!);
			return `\\definecolor{${name}}{HTML}{${value
				.slice(1)
				.toUpperCase()}}\n`;
		})
		.join("");
}

/**
 * The colour configuration of a drawing, or its `\definecolor` lines when the output file ends in
 * `.tex`, of the colours used at least `least` times.
 */
export function makeColourConfiguration(
	drawing: string,
	output: string,
	definitionFiles: readonly string[] = [],
	least = 8
): ColourConfiguration {
	const counts = countColours(fs.readFileSync(drawing, "utf8"));
	const kept = new Map([...counts].filter(([_value, uses]) => uses >= least));
	const { named: defined, warnings } = readDefinedColours(definitionFiles);
	const names = nameColours(kept, defined);
	const ordered = byUses(kept);
	const text = output.endsWith(".tex")
		? `% Written by Draw.io Slides, the colour configuration of the colours of a drawing, from ${path.basename(
				drawing
		  )}.\n` + colourDefinitionLines(ordered, names, defined)
		: jsonText(
				{
					colorNames: new Map(
						ordered.map((value) => [
							value.slice(1).toUpperCase(),
							names.get(value),
						])
					),
					presetColors: ordered.map((value) =>
						value.slice(1).toUpperCase()
					),
					customColorSchemes: swatchRows(ordered),
				},
				2
		  ) + "\n";
	const uses = [...kept.values()].reduce((sum, count) => sum + count, 0);
	return {
		text,
		lines: [
			`${kept.size} colours of ${counts.size} kept, ${uses} uses`,
			...ordered.map(
				(value) =>
					`  ${value}  ${names.get(value)!.padEnd(28)} ${String(
						kept.get(value)
					).padStart(5)} uses`
			),
		],
		warnings,
	};
}

/** Writes the colour configuration of a drawing into the output file. */
export function writeColourConfiguration(
	drawing: string,
	output: string,
	definitionFiles: readonly string[] = [],
	least = 8
): ColourConfiguration {
	const configuration = makeColourConfiguration(
		drawing,
		output,
		definitionFiles,
		least
	);
	fs.writeFileSync(output, configuration.text, "utf8");
	return configuration;
}
