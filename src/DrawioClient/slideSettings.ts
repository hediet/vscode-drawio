import {
	ConfigurationTarget,
	FileType,
	OutputChannel,
	Range,
	TextDocument,
	Uri,
	workspace,
	WorkspaceEdit,
} from "vscode";
import * as path from "path";
import { DiagramConfig } from "../Config";
import { ColorScheme } from "./DrawioTypes";
import { BufferImpl } from "../utils/buffer";
import {
	COLOR_NAME,
	COLOR_VALUE,
	hasColoursMember,
	LIST_KINDS,
	RefusedColourEdit,
	SCHEME_COLOR_KEYS,
	withColourEdit,
	withColourEditInSettings,
} from "./deckColourEdits";

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

interface DeckColour {
	readonly name: string;
	/** The colour as six upper-case hexadecimal digits, as draw.io writes a colour. */
	readonly hex: string;
}

/**
 * The live settings of a drawing: the valid colours of `drawioSlides.colors`, the same colours as
 * definitions of MathJax before the commands that MathJax lacks, the presets and the names of the colour picker with the
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
			colors: colours.map(({ name, hex }) => ({
				name,
				value: `#${hex}`,
			})),
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
 * Writes an edit of the colours of a drawing into `drawioSlides.colors` of the `.vscode/settings.json`
 * of its workspace folder, as a text edit of that member and, for a rename, of the colours of
 * `drawioSlides.listStyles` and `drawioSlides.customColorSchemes` that name the colour, so every
 * comment of the file stays. When the file is missing, or lacks the member while another scope
 * defines the setting, VS Code writes the whole setting at the scope of the workspace folder.
 * Raises `RefusedColourEdit` for an edit that the extension does not write, and `Error` when VS
 * Code does not save the file.
 */
export async function writeDeckColourEdit(
	config: DiagramConfig,
	edit: DeckColourEdit
): Promise<void> {
	const folder = workspace.getWorkspaceFolder(config.uri);
	if (folder === undefined) {
		throw new RefusedColourEdit(
			`The drawing ${config.uri.fsPath} lies in no workspace folder, so no .vscode/settings.json holds the colours of its deck.`
		);
	}
	const settingsFile = Uri.joinPath(folder.uri, ".vscode", "settings.json");
	const otherScope =
		edit.operation === "set"
			? undefined
			: scopeDefiningColour(config.uri, edit.name);
	if (otherScope !== undefined) {
		throw new RefusedColourEdit(
			`The colour ${edit.name} is also defined in ${otherScope}, so ${
				edit.operation === "remove" ? "removing" : "renaming"
			} it in ${settingsFile.fsPath} would leave it in the deck.`
		);
	}
	const document = await openExistingDocument(settingsFile);
	if (
		document === undefined ||
		(!hasColoursMember(document.getText()) &&
			isColoursSettingDefined(config.uri))
	) {
		await workspace
			.getConfiguration(undefined, config.uri)
			.update(
				"drawioSlides.colors",
				withColourEdit(folderColours(config.uri), edit),
				ConfigurationTarget.WorkspaceFolder
			);
		return;
	}
	if (document.isDirty) {
		throw new RefusedColourEdit(
			`${settingsFile.fsPath} has changes that are not saved, so drawioSlides.colors stays as it is.`
		);
	}
	const text = document.getText();
	const edited = withColourEditInSettings(text, edit);
	if (edited === text) {
		return;
	}
	const change = changedPart(text, edited);
	const workspaceEdit = new WorkspaceEdit();
	workspaceEdit.replace(
		settingsFile,
		new Range(
			document.positionAt(change.start),
			document.positionAt(change.end)
		),
		change.text
	);
	if (
		!(await workspace.applyEdit(workspaceEdit)) ||
		!(await document.save())
	) {
		throw new Error(
			`VS Code did not write ${settingsFile.fsPath}, so drawioSlides.colors stays as it is.`
		);
	}
}

/** The settings file as a document, without a window, or `undefined` when the file is missing. */
async function openExistingDocument(
	file: Uri
): Promise<TextDocument | undefined> {
	try {
		await workspace.fs.stat(file);
	} catch {
		return undefined;
	}
	return workspace.openTextDocument(file);
}

/** The colours that the settings of the workspace folder alone give `drawioSlides.colors`. */
function folderColours(uri: Uri): Record<string, unknown> {
	const value = workspace
		.getConfiguration(undefined, uri)
		.inspect("drawioSlides.colors")?.workspaceFolderValue;
	return isPlainObject(value) ? value : {};
}

/**
 * The settings other than those of the workspace folder that define the colour: the user settings,
 * or the file of a workspace of several folders. In a window of one folder, VS Code gives the
 * settings of the folder as the settings of the workspace as well.
 */
function scopeDefiningColour(uri: Uri, name: string): string | undefined {
	const inspected = workspace
		.getConfiguration(undefined, uri)
		.inspect("drawioSlides.colors");
	const defines = (value: unknown) =>
		isPlainObject(value) && Object.prototype.hasOwnProperty.call(value, name);
	if (defines(inspected?.globalValue)) {
		return "the user settings";
	}
	if (
		workspace.workspaceFile !== undefined &&
		defines(inspected?.workspaceValue)
	) {
		return workspace.workspaceFile.fsPath;
	}
	return undefined;
}

/** Whether a settings file of the user, of the workspace or of the folder defines `drawioSlides.colors`. */
function isColoursSettingDefined(uri: Uri): boolean {
	const inspected = workspace
		.getConfiguration(undefined, uri)
		.inspect("drawioSlides.colors");
	return (
		inspected !== undefined &&
		[
			inspected.globalValue,
			inspected.workspaceValue,
			inspected.workspaceFolderValue,
		].some((value) => value !== undefined)
	);
}

/**
 * The one span of a text that an edit changes: the offsets of its start and of its end in the text
 * before, and the text that replaces it.
 */
function changedPart(
	before: string,
	after: string
): { start: number; end: number; text: string } {
	const longestCommon = (isSame: (index: number) => boolean): number => {
		const limit = Math.min(before.length, after.length);
		let count = 0;
		while (count < limit && isSame(count)) {
			count++;
		}
		return count;
	};
	const start = longestCommon((index) => before[index] === after[index]);
	const end = longestCommon(
		(index) =>
			index < before.length - start &&
			index < after.length - start &&
			before[before.length - 1 - index] ===
				after[after.length - 1 - index]
	);
	return {
		start,
		end: before.length - end,
		text: after.slice(start, after.length - end),
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
	return LIST_KINDS.flatMap((kind) => listStyles[kind] ?? []);
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
