/**
 * The settings of the slides of a deck, read as the editor reads them: the value in
 * `.vscode/settings.json` of the deck, or else the default that `contributes.configuration` of
 * the `package.json` of the extension gives. An object of the deck merges over the object of the
 * default key by key, as VS Code merges it, and any other value replaces the default.
 *
 * A path of a setting may hold `${deckFolder}` and `${workspaceFolder}`, which both stand for the
 * deck folder here, because the build knows no window of VS Code. A relative path is read from
 * the deck folder. A setting that VS Code takes from the user settings is out of the build's
 * sight, so a deck keeps its slide settings in its own folder. VS Code reads the
 * `.vscode/settings.json` of the folder that its window opens alone, so the editor and the build
 * read the same settings only in a window opened at the deck folder.
 *
 * The colours of a deck are the setting `drawioSlides.colors`, an object of names and values
 * `#RRGGBB`. An entry whose name is not letters and digits that start with a letter, or whose
 * value is not `#RRGGBB`, is left out with a warning. A colour of a level of
 * `drawioSlides.listStyles` may name a colour of the setting, and `readListStyles` gives the value
 * in its place.
 */
import * as fs from "fs";
import * as path from "path";
import { DeckError } from "./deckError";
import { COLOR_NAME, COLOR_VALUE, LIST_KINDS } from "./deckColours";
import { isFile, isPlainObject } from "./deckFiles";
import { JsonWithCommentsError, withoutComments } from "./jsonWithComments";
import { jsonText } from "./textFormats";

export const SETTING_PREFIX = "drawioSlides.";
/** The settings file of a deck, by its path with `/` below the deck folder, which `path.join` reads on every system. */
export const DECK_SETTINGS = ".vscode/settings.json";
export const COLOURS = SETTING_PREFIX + "colors";
const RETIRED_COLOUR_SETTING = SETTING_PREFIX + "colorDefinitions";
const PATH_VARIABLE = /\$\{(deckFolder|workspaceFolder)\}/g;

/** A value read from the settings, with a warning for each entry left out or left as written. */
export interface SettingReading<T> {
	readonly value: T;
	readonly warnings: readonly string[];
}

/** The settings of `.vscode/settings.json` of a deck, or an empty object without the file. */
export function readDeckSettings(deck: string): Record<string, unknown> {
	const file = path.join(deck, DECK_SETTINGS);
	if (!isFile(file)) {
		return {};
	}
	let settings: unknown;
	try {
		settings = JSON.parse(withoutComments(fs.readFileSync(file, "utf8")));
	} catch (error) {
		if (
			error instanceof SyntaxError ||
			error instanceof JsonWithCommentsError
		) {
			throw new DeckError(
				`${file} does not read as JSON with comments: ${error.message}`
			);
		}
		throw error;
	}
	if (!isPlainObject(settings)) {
		throw new DeckError(
			`${file} holds ${jsonText(
				settings
			)}, where an object of settings was expected`
		);
	}
	return settings;
}

/** The default of a setting `drawioSlides.<name>`, from the `package.json` of the extension. */
export function defaultSetting(extensionRoot: string, name: string): unknown {
	const file = path.join(extensionRoot, "package.json");
	const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
	const sections: unknown = manifest?.contributes?.configuration;
	const sectionList = Array.isArray(sections) ? sections : [sections];
	for (const section of sectionList) {
		const declared =
			isPlainObject(section) && isPlainObject(section.properties)
				? section.properties[SETTING_PREFIX + name]
				: undefined;
		if (isPlainObject(declared)) {
			return declared.default;
		}
	}
	throw new DeckError(`${file} declares no setting ${SETTING_PREFIX}${name}`);
}

/**
 * A value of a setting over its default, as VS Code merges them: an object merges key by key
 * into the object of the default, and any other value replaces the default. The default
 * `{"gap": 8, "levels": [1, 2]}` and the value `{"levels": [3]}` give `{"gap": 8, "levels": [3]}`.
 */
export function mergedSetting(defaultValue: unknown, value: unknown): unknown {
	if (isPlainObject(defaultValue) && isPlainObject(value)) {
		const merged: Record<string, unknown> = { ...defaultValue };
		for (const [key, member] of Object.entries(value)) {
			merged[key] = mergedSetting(defaultValue[key], member);
		}
		return merged;
	}
	return value;
}

/** A setting `drawioSlides.<name>` of the settings of a deck merged over its default, or else its default. */
export function slideSetting(
	settings: Record<string, unknown>,
	extensionRoot: string,
	name: string
): unknown {
	const key = SETTING_PREFIX + name;
	const defaultValue = defaultSetting(extensionRoot, name);
	return Object.prototype.hasOwnProperty.call(settings, key)
		? mergedSetting(defaultValue, settings[key])
		: defaultValue;
}

/**
 * A path of a setting, with `${deckFolder}` and `${workspaceFolder}` as the deck folder, and a
 * relative path read from the deck folder.
 */
export function settingPath(deck: string, template: string): string {
	const folder = path.resolve(deck);
	return path.resolve(
		folder,
		template.replace(PATH_VARIABLE, () => folder)
	);
}

/**
 * The colours of the setting `drawioSlides.colors` of a deck, name to `#RRGGBB` in capitals, in
 * the order of the setting, with a warning for each entry that the extension leaves out. Raises
 * `DeckError` for settings that still hold `drawioSlides.colorDefinitions`, the TeX files of
 * colours that the setting replaced, and for a setting that is no object.
 */
export function readDeckColours(
	deck: string,
	settings: Record<string, unknown>,
	extensionRoot: string
): SettingReading<Map<string, string>> {
	const file = path.join(deck, DECK_SETTINGS);
	if (
		Object.prototype.hasOwnProperty.call(settings, RETIRED_COLOUR_SETTING)
	) {
		const given = settings[RETIRED_COLOUR_SETTING];
		const files = (Array.isArray(given) ? given : [given]).map((entry) =>
			settingPath(deck, String(entry))
		);
		throw new DeckError(
			`${file} holds the setting ${RETIRED_COLOUR_SETTING}, whose colours the setting ${COLOURS} has taken over. The command Import Colours from TeX, given ${
				files.join(" and ") || "the TeX files"
			}, writes them into ${COLOURS}, and the build stops while the settings hold ${RETIRED_COLOUR_SETTING}.`
		);
	}
	const setting = slideSetting(settings, extensionRoot, "colors");
	if (!isPlainObject(setting)) {
		throw new DeckError(
			`${COLOURS} of ${file} holds ${jsonText(
				setting
			)}, where an object of names and colours was expected`
		);
	}
	const colours = new Map<string, string>();
	const warnings = new Array<string>();
	for (const [name, value] of Object.entries(setting)) {
		if (!COLOR_NAME.test(name)) {
			warnings.push(
				`${COLOURS} names a colour ${jsonText(
					name
				)}, which is not letters and digits that start with a letter, so the colour is left out`
			);
		} else if (typeof value !== "string" || !COLOR_VALUE.test(value)) {
			warnings.push(
				`${COLOURS} gives ${name} the value ${jsonText(
					value
				)}, which is not # and six hexadecimal digits, so the colour is left out`
			);
		} else {
			colours.set(name, "#" + value.slice(1).toUpperCase());
		}
	}
	return { value: colours, warnings };
}

/** Whether a colour of a setting is a name, which the values `none` and `#RRGGBB` are not. */
function isColourName(colour: unknown): colour is string {
	return (
		typeof colour === "string" &&
		colour !== "none" &&
		COLOR_NAME.test(colour)
	);
}

/**
 * The setting `drawioSlides.listStyles` of a deck, with the value of each colour of
 * `drawioSlides.colors` that a level names, and a warning for each name that the colours do not
 * define, which stays as written.
 */
export function readListStyles(
	deck: string,
	settings: Record<string, unknown>,
	extensionRoot: string,
	colours: ReadonlyMap<string, string>
): SettingReading<Record<string, unknown>> {
	const styles = slideSetting(settings, extensionRoot, "listStyles");
	if (!isPlainObject(styles)) {
		throw new DeckError(
			`${SETTING_PREFIX}listStyles of ${path.join(
				deck,
				DECK_SETTINGS
			)} holds ${jsonText(styles)}, where an object was expected`
		);
	}
	const resolved: Record<string, unknown> = { ...styles };
	const unknown = new Set<string>();
	for (const kind of LIST_KINDS) {
		const levels = styles[kind];
		if (!Array.isArray(levels)) {
			continue;
		}
		resolved[kind] = levels.map((level: unknown) => {
			if (!isPlainObject(level) || typeof level.color !== "string") {
				return level;
			}
			const color = colours.get(level.color) ?? level.color;
			if (isColourName(color)) {
				unknown.add(color);
			}
			return { ...level, color };
		});
	}
	return {
		value: resolved,
		warnings: [...unknown]
			.sort()
			.map(
				(name) =>
					`${SETTING_PREFIX}listStyles names the colour ${name}, which ${COLOURS} does not define, so the value stays as written`
			),
	};
}
