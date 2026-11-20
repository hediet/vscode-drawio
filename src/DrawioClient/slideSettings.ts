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
	hasColorsMember,
	LIST_KINDS,
	RefusedColorEdit,
	SCHEME_COLOR_KEYS,
	withColorEdit,
	withColorEditInSettings,
} from "./deckColorEdits";
import { colorDefinition, mathCommandLines } from "../deck/texDefinitions";
import { DeckStyleRules, namedStyles, readDeckStyles } from "../deck/deckStyles";
import {
	RefusedStyleEdit,
	withStyleEdit,
	withStyleEditInSettings,
} from "./deckStyleEdits";

/**
 * The settings of a deck that the slide plugins follow without a reload, which the extension
 * gives them in `window.drawSlidesCodeSettings` and in the action `drawSlidesCodeSettings`.
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

interface DeckColor {
	readonly name: string;
	/** The color as six upper-case hexadecimal digits, as draw.io writes a color. */
	readonly hex: string;
}

/**
 * The live settings of a drawing: the valid colors of `drawSlidesCode.colors`, the same colors as
 * definitions of MathJax before the commands that MathJax lacks, the presets and the names of the color picker with the
 * colors added, and the swatches of `drawSlidesCode.customColorSchemes`, the list styles and the
 * list markers, in which each name of a color stands for its value, and the styles of
 * `drawSlidesCode.deckStyles` with their kinds, in the order of the setting.
 */
export function readLiveSlideSettings(
	config: DiagramConfig,
	mathCommands: readonly string[],
	styleRules: DeckStyleRules
): LiveSlideSettingsReading {
	const structureProblems = new Array<string>();
	const entries = isPlainObject(config.colors)
		? Object.entries(config.colors)
		: [];
	if (!isPlainObject(config.colors)) {
		structureProblems.push(
			`drawSlidesCode.colors holds ${JSON.stringify(config.colors)}, where an object of names and colors was expected, so no color is defined.`
		);
	}
	let givenListStyles = config.listStyles;
	if (!isPlainObject(givenListStyles)) {
		structureProblems.push(
			`drawSlidesCode.listStyles holds ${JSON.stringify(givenListStyles)}, where an object was expected, so the editor takes the default.`
		);
		givenListStyles = defaultSetting<SlideListStyles>(
			"drawSlidesCode.listStyles"
		);
	}
	const givenSchemes = Array.isArray(config.customColorSchemes)
		? config.customColorSchemes
		: [];
	if (!Array.isArray(config.customColorSchemes)) {
		structureProblems.push(
			`drawSlidesCode.customColorSchemes holds ${JSON.stringify(config.customColorSchemes)}, where an array of pages of swatches was expected, so the editor shows no swatch of the setting.`
		);
	}
	givenSchemes
		.filter((page) => !isSchemePage(page))
		.forEach((page) =>
			structureProblems.push(
				`drawSlidesCode.customColorSchemes holds the page ${JSON.stringify(page)}, where an array of swatches was expected, so the page is left out.`
			)
		);
	const colors = entries
		.filter(isValidColor)
		.map(([name, value]) => ({ name, hex: value.slice(1).toUpperCase() }));
	const values = new Map(
		colors.map((color) => [color.name, `#${color.hex}`])
	);
	const valueOf = (color: string): string => values.get(color) ?? color;
	const listStyles = withListColorValues(givenListStyles, valueOf);
	const colorSchemes = givenSchemes
		.filter(isSchemePage)
		.map((page) =>
			page.map((scheme) => withSchemeColorValues(scheme, valueOf))
		);
	// A known name stands for its value now, so a name that is left is unknown.
	const unknownListColors = listLevels(listStyles)
		.map((level) => level.color)
		.filter(isColorName);
	const unknownSchemeColors =
		schemeColors(colorSchemes).filter(isColorName);
	const styles = readDeckStyles(config.deckStyles, styleRules);
	const problems = [
		...structureProblems,
		...styles.problems,
		...entries
			.filter((entry) => !isValidColor(entry))
			.map(([name, value]) => invalidColorProblem(name, value)),
		...[...new Set(unknownListColors)].map((name) =>
			unknownNameProblem("drawSlidesCode.listStyles", name)
		),
		...[...new Set(unknownSchemeColors)].map((name) =>
			unknownNameProblem("drawSlidesCode.customColorSchemes", name)
		),
		...(config.hasColorDefinitions
			? [
					"The extension does not read drawSlidesCode.colorDefinitions. The command DrawSlidesCode: Import Colors from TeX writes the colors of a TeX file into drawSlidesCode.colors.",
			  ]
			: []),
	];
	return {
		settings: {
			colors: colors.map(({ name, hex }) => ({
				name,
				value: `#${hex}`,
			})),
			listStyles,
			listMarkers: config.listMarkers,
			mathDefinitions: [
				...colors.map(rgbDefinition),
				...mathCommands,
			].join(""),
			presetColors: withColorPresets(config.presetColors, colors),
			colorNames: withColorNames(config.colorNames, colors),
			colorSchemes,
			styles: namedStyles(styles.styles),
		},
		problems,
	};
}

/**
 * Writes an edit of the colors of a drawing into `drawSlidesCode.colors` of the `.vscode/settings.json`
 * of its workspace folder, as a text edit of that member and, for a rename, of the colors of
 * `drawSlidesCode.listStyles` and `drawSlidesCode.customColorSchemes` that name the color, so every
 * comment of the file stays. When the file is missing, or lacks the member while another scope
 * defines the setting, VS Code writes the whole setting at the scope of the workspace folder.
 * Raises `RefusedColorEdit` for an edit that the extension does not write, and `Error` when VS
 * Code does not save the file.
 */
export async function writeDeckColorEdit(
	config: DiagramConfig,
	edit: DeckColorEdit
): Promise<void> {
	const write = await plannedSettingsWrite(config, edit);
	await write();
}

/**
 * Raises `RefusedColorEdit` for an edit of the colors of a drawing that `writeDeckColorEdit` would
 * refuse, and writes nothing.
 */
export async function checkDeckColorEdit(
	config: DiagramConfig,
	edit: DeckColorEdit
): Promise<void> {
	await plannedSettingsWrite(config, edit);
}

/** The write of `writeDeckColorEdit`, after the checks that may refuse the edit. */
async function plannedSettingsWrite(
	config: DiagramConfig,
	edit: DeckColorEdit
): Promise<() => Promise<void>> {
	const folder = workspace.getWorkspaceFolder(config.uri);
	if (folder === undefined) {
		throw new RefusedColorEdit(
			`The drawing ${config.uri.fsPath} lies in no workspace folder, so no .vscode/settings.json holds the colors of its deck.`
		);
	}
	const settingsFile = Uri.joinPath(folder.uri, ".vscode", "settings.json");
	const otherScope =
		edit.operation === "set"
			? undefined
			: scopeDefiningColor(config.uri, edit.name);
	if (otherScope !== undefined) {
		throw new RefusedColorEdit(
			`The color ${edit.name} is also defined in ${otherScope}, so ${
				edit.operation === "remove" ? "removing" : "renaming"
			} it in ${settingsFile.fsPath} would leave it in the deck.`
		);
	}
	const document = await openExistingDocument(settingsFile);
	if (
		document === undefined ||
		(!hasColorsMember(document.getText()) &&
			isColorsSettingDefined(config.uri))
	) {
		const colors = withColorEdit(folderColors(config.uri), edit);
		return async () => {
			await workspace
				.getConfiguration(undefined, config.uri)
				.update(
					"drawSlidesCode.colors",
					colors,
					ConfigurationTarget.WorkspaceFolder
				);
		};
	}
	if (document.isDirty) {
		throw new RefusedColorEdit(
			`${settingsFile.fsPath} has changes that are not saved, so drawSlidesCode.colors stays as it is.`
		);
	}
	const text = document.getText();
	const edited = withColorEditInSettings(text, edit);
	return async () => {
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
				`VS Code did not write ${settingsFile.fsPath}, so drawSlidesCode.colors stays as it is.`
			);
		}
	};
}

/**
 * Writes an edit of the styles of a drawing into `drawSlidesCode.deckStyles` of the
 * `.vscode/settings.json` of its workspace folder, as a text edit of that member, so every comment
 * of the file stays, and VS Code writes the whole setting at the scope of the workspace folder when
 * the file is missing. Returns the write, after the checks that raise `RefusedStyleEdit` for an
 * edit that the extension does not write, so that the caller asks before it writes. The write
 * raises `Error` when VS Code does not save the file.
 */
export async function plannedStyleSettingsWrite(
	config: DiagramConfig,
	edit: DeckStyleEdit,
	rules: DeckStyleRules
): Promise<() => Promise<void>> {
	const setting = "drawSlidesCode.deckStyles";
	const folder = workspace.getWorkspaceFolder(config.uri);
	if (folder === undefined) {
		throw new RefusedStyleEdit(
			`The drawing ${config.uri.fsPath} lies in no workspace folder, so no .vscode/settings.json holds the styles of its deck.`
		);
	}
	const settingsFile = Uri.joinPath(folder.uri, ".vscode", "settings.json");
	const document = await openExistingDocument(settingsFile);
	if (document === undefined) {
		const value = workspace
			.getConfiguration(undefined, config.uri)
			.inspect(setting)?.workspaceFolderValue;
		const styles = withStyleEdit(
			isPlainObject(value) ? value : {},
			edit,
			rules
		);
		return async () => {
			await workspace
				.getConfiguration(undefined, config.uri)
				.update(setting, styles, ConfigurationTarget.WorkspaceFolder);
		};
	}
	if (document.isDirty) {
		throw new RefusedStyleEdit(
			`${settingsFile.fsPath} has changes that are not saved, so ${setting} stays as it is.`
		);
	}
	const text = document.getText();
	const edited = withStyleEditInSettings(text, edit, rules);
	return async () => {
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
				`VS Code did not write ${settingsFile.fsPath}, so ${setting} stays as it is.`
			);
		}
	};
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

/** The colors that the settings of the workspace folder alone give `drawSlidesCode.colors`. */
function folderColors(uri: Uri): Record<string, unknown> {
	const value = workspace
		.getConfiguration(undefined, uri)
		.inspect("drawSlidesCode.colors")?.workspaceFolderValue;
	return isPlainObject(value) ? value : {};
}

/**
 * The settings other than those of the workspace folder that define the color: the user settings,
 * or the file of a workspace of several folders. In a window of one folder, VS Code gives the
 * settings of the folder as the settings of the workspace as well.
 */
function scopeDefiningColor(uri: Uri, name: string): string | undefined {
	const inspected = workspace
		.getConfiguration(undefined, uri)
		.inspect("drawSlidesCode.colors");
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

/** Whether a settings file of the user, of the workspace or of the folder defines `drawSlidesCode.colors`. */
function isColorsSettingDefined(uri: Uri): boolean {
	const inspected = workspace
		.getConfiguration(undefined, uri)
		.inspect("drawSlidesCode.colors");
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
export function changedPart(
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
	return mathCommandLines(commands);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether a page of `drawSlidesCode.customColorSchemes` is an array of swatches. */
function isSchemePage(page: unknown): page is ColorScheme[] {
	return Array.isArray(page) && page.every(isPlainObject);
}

/** The default value of a setting, which `package.json` declares. */
function defaultSetting<T>(name: string): T {
	return workspace.getConfiguration().inspect<T>(name)!.defaultValue!;
}

function isValidColor(entry: [string, unknown]): entry is [string, string] {
	const [name, value] = entry;
	return (
		COLOR_NAME.test(name) &&
		typeof value === "string" &&
		COLOR_VALUE.test(value)
	);
}

function invalidColorProblem(name: string, value: unknown): string {
	const shownName = JSON.stringify(name);
	const shownValue = JSON.stringify(value);
	return COLOR_NAME.test(name)
		? `drawSlidesCode.colors gives ${name} the value ${shownValue}, which is not # and six hexadecimal digits, so the color is left out.`
		: `drawSlidesCode.colors names a color ${shownName}, which is not letters and digits that start with a letter, so the color is left out.`;
}

function unknownNameProblem(setting: string, name: string): string {
	return `${setting} names the color ${name}, which drawSlidesCode.colors does not define, so the value stays as written.`;
}

/** Whether a color of a setting is a name, which the values `none` and `#RRGGBB` are not. */
function isColorName(color: string | undefined): color is string {
	return color !== undefined && color !== "none" && COLOR_NAME.test(color);
}

/** The levels of the bulleted and of the numbered lists of the list styles. */
function listLevels(listStyles: SlideListStyles): SlideListLevelStyle[] {
	return LIST_KINDS.flatMap((kind) => listStyles[kind] ?? []);
}

/** The colors of every swatch, in the order of the pages and of the keys of a swatch. */
function schemeColors(schemes: ColorScheme[][]): (string | undefined)[] {
	return new Array<ColorScheme>()
		.concat(...schemes)
		.reduce(
			(colors, scheme) => [
				...colors,
				...SCHEME_COLOR_KEYS.map((key) => scheme[key]),
			],
			new Array<string | undefined>()
		);
}

/**
 * The list styles with the value of each color that they name. Levels that the setting leaves out
 * stay left out.
 */
function withListColorValues(
	listStyles: SlideListStyles,
	valueOf: (color: string) => string
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

function withSchemeColorValues(
	scheme: ColorScheme,
	valueOf: (color: string) => string
): ColorScheme {
	const result = { ...scheme };
	for (const key of SCHEME_COLOR_KEYS) {
		const color = scheme[key];
		if (typeof color === "string") {
			result[key] = valueOf(color);
		}
	}
	return result;
}

/** The color names of the settings, with a name for each color of the deck that has none. */
function withColorNames(
	names: Record<string, string>,
	colors: readonly DeckColor[]
): Record<string, string> {
	const result = { ...names };
	for (const color of colors) {
		if (!(color.hex in result)) {
			result[color.hex] = color.name;
		}
	}
	return result;
}

/** The preset colors of the settings, followed by each color of the deck that they lack. */
function withColorPresets(
	presets: string[],
	colors: readonly DeckColor[]
): string[] {
	const result = [...presets];
	for (const color of colors) {
		if (!result.some((preset) => preset.toUpperCase() === color.hex)) {
			result.push(color.hex);
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

/** The definition of a color in the model `RGB`, which the MathJax of draw.io reads. */
function rgbDefinition({ name, hex }: DeckColor): string {
	return colorDefinition(name, `#${hex}`);
}
