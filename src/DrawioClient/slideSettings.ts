import { FileType, OutputChannel, Uri, workspace } from "vscode";
import * as path from "path";
import { DiagramConfig } from "../Config";
import { ColorScheme } from "./DrawioTypes";
import { BufferImpl } from "../utils/buffer";

/**
 * The settings of a deck that the slide plugins follow without a reload, which the extension
 * gives them in `window.drawioSlidesSettings` and in the action `drawioSlidesSettings`.
 */
export type LiveSlideSettings = SlideSettingsAction["settings"];

/**
 * The live settings of a drawing, with one line for each entry of the settings that the
 * extension leaves out or leaves as written.
 */
export interface LiveSlideSettingsReading {
	readonly settings: LiveSlideSettings;
	readonly problems: readonly string[];
}

/** A template file of a deck, with its pages, the layouts of the slides. */
export type SlideTemplate = SlideTemplatesAction["templates"][number];

const DIAGRAM = /<diagram\b[^>]*>[\s\S]*?<\/diagram>/g;
const DIAGRAM_NAME = /^<diagram\b[^>]*\sname="([^"]*)"/;

/** A name of `drawioSlides.colors`, which TeX reads as the name of a colour. */
const COLOR_NAME = /^[A-Za-z][A-Za-z0-9]*$/;
const COLOR_VALUE = /^#[0-9A-Fa-f]{6}$/;
const SCHEME_COLOR_KEYS = ["fill", "stroke", "gradient", "font"] as const;

interface DeckColour {
	readonly name: string;
	/** The colour as six upper-case hexadecimal digits, as draw.io writes a colour. */
	readonly hex: string;
}

/**
 * The live settings of a drawing: the colours of `drawioSlides.colors` as definitions of MathJax
 * before the commands that MathJax lacks, the presets and the names of the colour picker with the
 * colours added, and the swatches of `drawioSlides.customColorSchemes`, the list styles and the
 * list markers, in which each name of a colour stands for its value.
 */
export function readLiveSlideSettings(
	config: DiagramConfig,
	mathCommands: readonly string[]
): LiveSlideSettingsReading {
	const structureProblems = new Array<string>();
	const entries = isPlainObject(config.colors)
		? Object.entries(config.colors)
		: [];
	if (!isPlainObject(config.colors)) {
		structureProblems.push(
			`drawioSlides.colors holds ${JSON.stringify(config.colors)}, where an object of names and colours was expected, so no colour is defined.`
		);
	}
	let givenListStyles = config.listStyles;
	if (!isPlainObject(givenListStyles)) {
		structureProblems.push(
			`drawioSlides.listStyles holds ${JSON.stringify(givenListStyles)}, where an object was expected, so the editor takes the default.`
		);
		givenListStyles = defaultSetting<SlideListStyles>(
			"drawioSlides.listStyles"
		);
	}
	const givenSchemes = Array.isArray(config.customColorSchemes)
		? config.customColorSchemes
		: [];
	if (!Array.isArray(config.customColorSchemes)) {
		structureProblems.push(
			`drawioSlides.customColorSchemes holds ${JSON.stringify(config.customColorSchemes)}, where an array of pages of swatches was expected, so the editor shows no swatch of the setting.`
		);
	}
	givenSchemes
		.filter((page) => !isSchemePage(page))
		.forEach((page) =>
			structureProblems.push(
				`drawioSlides.customColorSchemes holds the page ${JSON.stringify(page)}, where an array of swatches was expected, so the page is left out.`
			)
		);
	const colours = entries
		.filter(isValidColour)
		.map(([name, value]) => ({ name, hex: value.slice(1).toUpperCase() }));
	const values = new Map(
		colours.map((colour) => [colour.name, `#${colour.hex}`])
	);
	const valueOf = (colour: string): string => values.get(colour) ?? colour;
	const listStyles = withListColourValues(givenListStyles, valueOf);
	const colorSchemes = givenSchemes
		.filter(isSchemePage)
		.map((page) =>
			page.map((scheme) => withSchemeColourValues(scheme, valueOf))
		);
	// A known name stands for its value now, so a name that is left is unknown.
	const unknownListColours = listLevels(listStyles)
		.map((level) => level.color)
		.filter(isColourName);
	const unknownSchemeColours =
		schemeColours(colorSchemes).filter(isColourName);
	const problems = [
		...structureProblems,
		...entries
			.filter((entry) => !isValidColour(entry))
			.map(([name, value]) => invalidColourProblem(name, value)),
		...[...new Set(unknownListColours)].map((name) =>
			unknownNameProblem("drawioSlides.listStyles", name)
		),
		...[...new Set(unknownSchemeColours)].map((name) =>
			unknownNameProblem("drawioSlides.customColorSchemes", name)
		),
		...(config.hasColorDefinitions
			? [
					"The extension does not read drawioSlides.colorDefinitions. The command tools/draw-io/color-settings.py from-tex <file.tex> --project <deck> of the draw.io presentation framework writes the colours of a TeX file into drawioSlides.colors.",
			  ]
			: []),
	];
	return {
		settings: {
			listStyles,
			listMarkers: config.listMarkers,
			mathDefinitions: [
				...colours.map(rgbDefinition),
				...mathCommands,
			].join(""),
			presetColors: withColourPresets(config.presetColors, colours),
			colorNames: withColourNames(config.colorNames, colours),
			colorSchemes,
		},
		problems,
	};
}

/**
 * The commands that MathJax lacks, which the extension ships in
 * `drawio-custom-plugins/slides/mathjax-commands.tex`, one per line.
 */
export async function readMathCommands(extensionUri: Uri): Promise<string[]> {
	const commands = await readText(
		Uri.joinPath(
			extensionUri,
			"drawio-custom-plugins",
			"slides",
			"mathjax-commands.tex"
		)
	);
	return commands
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "" && !line.startsWith("%"));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether a page of `drawioSlides.customColorSchemes` is an array of swatches. */
function isSchemePage(page: unknown): page is ColorScheme[] {
	return Array.isArray(page) && page.every(isPlainObject);
}

/** The default value of a setting, which `package.json` declares. */
function defaultSetting<T>(name: string): T {
	return workspace.getConfiguration().inspect<T>(name)!.defaultValue!;
}

function isValidColour(entry: [string, unknown]): entry is [string, string] {
	const [name, value] = entry;
	return (
		COLOR_NAME.test(name) &&
		typeof value === "string" &&
		COLOR_VALUE.test(value)
	);
}

function invalidColourProblem(name: string, value: unknown): string {
	const shownName = JSON.stringify(name);
	const shownValue = JSON.stringify(value);
	return COLOR_NAME.test(name)
		? `drawioSlides.colors gives ${name} the value ${shownValue}, which is not # and six hexadecimal digits, so the colour is left out.`
		: `drawioSlides.colors names a colour ${shownName}, which is not letters and digits that start with a letter, so the colour is left out.`;
}

function unknownNameProblem(setting: string, name: string): string {
	return `${setting} names the colour ${name}, which drawioSlides.colors does not define, so the value stays as written.`;
}

/** Whether a colour of a setting is a name, which the values `none` and `#RRGGBB` are not. */
function isColourName(colour: string | undefined): colour is string {
	return colour !== undefined && colour !== "none" && COLOR_NAME.test(colour);
}

/** The levels of the bulleted and of the numbered lists of the list styles. */
function listLevels(listStyles: SlideListStyles): SlideListLevelStyle[] {
	return [...(listStyles.bulleted ?? []), ...(listStyles.numbered ?? [])];
}

/** The colours of every swatch, in the order of the pages and of the keys of a swatch. */
function schemeColours(schemes: ColorScheme[][]): (string | undefined)[] {
	return new Array<ColorScheme>()
		.concat(...schemes)
		.reduce(
			(colours, scheme) => [
				...colours,
				...SCHEME_COLOR_KEYS.map((key) => scheme[key]),
			],
			new Array<string | undefined>()
		);
}

/**
 * The list styles with the value of each colour that they name. Levels that the setting leaves out
 * stay left out.
 */
function withListColourValues(
	listStyles: SlideListStyles,
	valueOf: (colour: string) => string
): SlideListStyles {
	const withValues = (levels: SlideListLevelStyle[]): SlideListLevelStyle[] =>
		levels?.map((level) =>
			level.color === undefined
				? level
				: { ...level, color: valueOf(level.color) }
		);
	return {
		...listStyles,
		bulleted: withValues(listStyles.bulleted),
		numbered: withValues(listStyles.numbered),
	};
}

function withSchemeColourValues(
	scheme: ColorScheme,
	valueOf: (colour: string) => string
): ColorScheme {
	const result = { ...scheme };
	for (const key of SCHEME_COLOR_KEYS) {
		const colour = scheme[key];
		if (typeof colour === "string") {
			result[key] = valueOf(colour);
		}
	}
	return result;
}

/** The colour names of the settings, with a name for each colour of the deck that has none. */
function withColourNames(
	names: Record<string, string>,
	colours: readonly DeckColour[]
): Record<string, string> {
	const result = { ...names };
	for (const colour of colours) {
		if (!(colour.hex in result)) {
			result[colour.hex] = colour.name;
		}
	}
	return result;
}

/** The preset colours of the settings, followed by each colour of the deck that they lack. */
function withColourPresets(
	presets: string[],
	colours: readonly DeckColour[]
): string[] {
	const result = [...presets];
	for (const colour of colours) {
		if (!result.some((preset) => preset.toUpperCase() === colour.hex)) {
			result.push(colour.hex);
		}
	}
	return result;
}

/**
 * The template files that the patterns name, in the order of the patterns and, within one
 * pattern, of the file names. The last part of a pattern may hold `*`, which matches any run of
 * characters other than `/`.
 */
export async function templateFiles(patterns: string[]): Promise<Uri[]> {
	const files = new Array<Uri>();
	for (const pattern of patterns) {
		const folder = Uri.file(path.dirname(pattern));
		const namePattern = path.basename(pattern);
		if (!namePattern.includes("*")) {
			files.push(Uri.file(pattern));
			continue;
		}
		const matcher = new RegExp(
			"^" +
				namePattern
					.split("*")
					.map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
					.join("[^/]*") +
				"$"
		);
		let entries: [string, FileType][];
		try {
			entries = await workspace.fs.readDirectory(folder);
		} catch {
			continue;
		}
		files.push(
			...entries
				.filter(
					([name, type]) =>
						type === FileType.File && matcher.test(name)
				)
				.map(([name]) => name)
				.sort()
				.map((name) => Uri.joinPath(folder, name))
		);
	}
	return files;
}

/** The pages of every template file that the patterns name. */
export async function readTemplates(
	patterns: string[],
	log: OutputChannel
): Promise<SlideTemplate[]> {
	const templates = new Array<SlideTemplate>();
	for (const file of await templateFiles(patterns)) {
		let text: string;
		try {
			text = await readText(file);
		} catch {
			log.appendLine(`The template ${file.fsPath} does not exist.`);
			continue;
		}
		const pages = (text.match(DIAGRAM) ?? []).map((xml) => ({
			name: unescapeXml(DIAGRAM_NAME.exec(xml)?.[1] ?? "page"),
			xml,
		}));
		templates.push({ name: path.basename(file.path), pages });
	}
	return templates;
}

function unescapeXml(text: string): string {
	return text
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, "&");
}

async function readText(file: Uri): Promise<string> {
	return BufferImpl.from(await workspace.fs.readFile(file)).toString("utf-8");
}

/** The definition of a colour in the model `RGB`, which the MathJax of draw.io reads. */
function rgbDefinition({ name, hex }: DeckColour): string {
	const [red, green, blue] = [0, 2, 4].map((start) =>
		parseInt(hex.slice(start, start + 2), 16)
	);
	return `\\definecolor{${name}}{RGB}{${red},${green},${blue}}`;
}
