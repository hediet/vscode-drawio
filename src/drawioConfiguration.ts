import { ConfigurationTarget, Uri, workspace } from "vscode";

/**
 * The draw.io configuration of the editor: the `config` setting holds any
 * option of the draw.io configuration (as in Extras > Configuration of the
 * draw.io app), and the Configuration dialog of the editor edits it.
 *
 * - The extension sets the options in RESERVED_CONFIG_KEYS itself. The
 *   setting cannot change them and the dialog hides them.
 * - The options in SETTING_CONFIG_KEYS have a setting of their own. If that
 *   setting is set, it wins over the option in the `config` setting, and
 *   the dialog stores the option in that setting.
 * - The options in MERGED_CONFIG_KEYS are lists that the extension adds its
 *   own entries to.
 */
const extensionId = "hediet.vscode-drawio";

export const CONFIG_SETTING = "config";

export const RESERVED_CONFIG_KEYS: readonly string[] = [
	"compact",
	"compressXml",
	"configurationEditor",
	"defaultLibraries",
	"libraries",
	"noAutoFocus",
	"passThroughKeys",
	"passiveScroll",
	"settingsName",
	"suppressNewWindows",
];

export const SETTING_CONFIG_KEYS: readonly string[] = [
	"colorNames",
	"customColorSchemes",
	"customFonts",
	"defaultEdgeStyle",
	"defaultVertexStyle",
	"globalVars",
	"presetColors",
	"showConnectHandle",
	"showLinkIcons",
	"showTooltipIcons",
	"simpleLabels",
	"styles",
	"zoomFactor",
];

export const MERGED_CONFIG_KEYS: readonly string[] = ["hideMenuItems", "hideMenus"];

export type ConfigObject = Record<string, unknown>;

export function isConfigObject(value: unknown): value is ConfigObject {
	return value != null && typeof value === "object" && !Array.isArray(value);
}

function isUnsafeKey(key: string): boolean {
	return key === "__proto__" || key === "constructor" || key === "prototype";
}

// JSON with sorted keys, so that the order of the options does not matter
function stableStringify(value: unknown): string {
	if (Array.isArray(value)) {
		return "[" + value.map(stableStringify).join(",") + "]";
	} else if (isConfigObject(value)) {
		return "{" + Object.keys(value).sort().map((key) =>
			JSON.stringify(key) + ":" + stableStringify(value[key])).join(",") + "}";
	}

	return JSON.stringify(value) ?? "undefined";
}

function isSameValue(a: unknown, b: unknown): boolean {
	return stableStringify(a) === stableStringify(b);
}

/**
 * Where the setting with the given ID (in the extension's section) is set,
 * from the most specific scope, or undefined if it has its default value.
 */
export function getSettingTarget(
	key: string,
	uri: Uri | undefined
): ConfigurationTarget | undefined {
	const result = workspace.getConfiguration(extensionId, uri).inspect(key);

	if (result == null) {
		return undefined;
	} else if (result.workspaceFolderValue !== undefined) {
		return ConfigurationTarget.WorkspaceFolder;
	} else if (result.workspaceValue !== undefined) {
		return ConfigurationTarget.Workspace;
	} else if (result.globalValue !== undefined) {
		return ConfigurationTarget.Global;
	}

	return undefined;
}

/**
 * The `config` setting, without the reserved options and unsafe keys.
 */
export function getUserConfig(uri: Uri | undefined): ConfigObject {
	const value = workspace.getConfiguration(extensionId, uri).get(CONFIG_SETTING);
	const result: ConfigObject = {};

	if (isConfigObject(value)) {
		for (const key of Object.keys(value)) {
			if (!isUnsafeKey(key) && !RESERVED_CONFIG_KEYS.includes(key)) {
				result[key] = value[key];
			}
		}
	}

	return result;
}

/**
 * The values of the settings of SETTING_CONFIG_KEYS that are set.
 */
export function getSetSettings(uri: Uri | undefined): ConfigObject {
	const config = workspace.getConfiguration(extensionId, uri);
	const result: ConfigObject = {};

	for (const key of SETTING_CONFIG_KEYS) {
		if (getSettingTarget(key, uri) !== undefined) {
			result[key] = config.get(key);
		}
	}

	return result;
}

// The entries of both lists, the first list first
function mergeLists(first: unknown, second: unknown[]): unknown[] {
	const list = Array.isArray(first) ? first : [];

	return list.concat(second.filter((v) => !list.includes(v)));
}

/**
 * Returns the host's configuration (with the values of all settings) with the
 * options of the `config` setting, except the reserved options and the
 * options whose own setting is set, and then the forced options of the host,
 * which win over the setting (eg. the options an inline editor needs). Lists
 * in MERGED_CONFIG_KEYS get the entries of all of them.
 */
export function mergeUserConfig(
	hostConfig: ConfigObject,
	userConfig: ConfigObject,
	setSettings: ConfigObject,
	forcedConfig: ConfigObject = {}
): ConfigObject {
	const result: ConfigObject = { ...hostConfig };

	for (const key of Object.keys(userConfig)) {
		const value = userConfig[key];

		if (isUnsafeKey(key) || RESERVED_CONFIG_KEYS.includes(key) ||
			key in setSettings) {
			continue;
		} else if (MERGED_CONFIG_KEYS.includes(key) && Array.isArray(value)) {
			result[key] = mergeLists(result[key], value);
		} else {
			result[key] = value;
		}
	}

	for (const key of Object.keys(forcedConfig)) {
		const value = forcedConfig[key];

		if (MERGED_CONFIG_KEYS.includes(key) && Array.isArray(value)) {
			result[key] = mergeLists(value, (Array.isArray(result[key]) ?
				result[key] : []) as unknown[]);
		} else {
			result[key] = value;
		}
	}

	return result;
}

/**
 * The host's configuration with the `config` setting of the given document
 * and the forced options (see mergeUserConfig), without the Configuration
 * dialog. For the editors that build their configuration themselves.
 */
export function withConfigSetting(
	uri: Uri | undefined,
	hostConfig: ConfigObject,
	forcedConfig: ConfigObject = {}
): ConfigObject {
	return mergeUserConfig(hostConfig, getUserConfig(uri), getSetSettings(uri),
		forcedConfig);
}

/**
 * Returns the configuration for draw.io (see mergeUserConfig) and adds the
 * configuration for the Configuration dialog.
 */
export function mergeDrawioConfig(
	hostConfig: ConfigObject,
	userConfig: ConfigObject,
	setSettings: ConfigObject
): ConfigObject {
	const result = mergeUserConfig(hostConfig, userConfig, setSettings);

	result.configurationEditor = {
		config: getDialogConfig(userConfig, setSettings),
		excludedKeys: RESERVED_CONFIG_KEYS,
	};

	return result;
}

/**
 * The configuration that the Configuration dialog shows: the `config`
 * setting and the settings of SETTING_CONFIG_KEYS that are set.
 */
export function getDialogConfig(
	userConfig: ConfigObject,
	setSettings: ConfigObject
): ConfigObject {
	return { ...userConfig, ...setSettings };
}

export interface SettingUpdate {
	key: string;
	value: unknown;
	target: ConfigurationTarget;
}

/**
 * The setting changes for the configuration of the Configuration dialog:
 * options of SETTING_CONFIG_KEYS go to their setting (and a set setting
 * whose option was removed is reset), and the other options go to the
 * `config` setting. Reserved options and unsafe keys are dropped. Settings
 * are written where they are set, or to the user settings.
 */
export function getSettingUpdates(
	config: ConfigObject,
	userConfig: ConfigObject,
	setSettings: ConfigObject,
	getTarget: (key: string) => ConfigurationTarget | undefined
): SettingUpdate[] {
	const updates: SettingUpdate[] = [];
	const newUserConfig: ConfigObject = {};

	for (const key of Object.keys(config)) {
		if (!isUnsafeKey(key) && !RESERVED_CONFIG_KEYS.includes(key) &&
			!SETTING_CONFIG_KEYS.includes(key)) {
			newUserConfig[key] = config[key];
		}
	}

	for (const key of SETTING_CONFIG_KEYS) {
		const isSet = key in setSettings;

		if (key in config) {
			if (!isSet || !isSameValue(config[key], setSettings[key])) {
				updates.push({ key, value: config[key],
					target: getTarget(key) ?? ConfigurationTarget.Global });
			}
		} else if (isSet) {
			updates.push({ key, value: undefined,
				target: getTarget(key) ?? ConfigurationTarget.Global });
		}
	}

	// Also moves the options of SETTING_CONFIG_KEYS out of the config setting
	if (!isSameValue(newUserConfig, userConfig)) {
		updates.push({
			key: CONFIG_SETTING,
			value: (Object.keys(newUserConfig).length > 0) ? newUserConfig : undefined,
			target: getTarget(CONFIG_SETTING) ?? ConfigurationTarget.Global,
		});
	}

	return updates;
}

/**
 * Stores the configuration of the Configuration dialog in the settings.
 * Returns the number of settings that changed.
 */
export async function applyDialogConfig(
	uri: Uri | undefined,
	config: unknown
): Promise<number> {
	if (!isConfigObject(config)) {
		return 0;
	}

	const updates = getSettingUpdates(config, getUserConfig(uri),
		getSetSettings(uri), (key) => getSettingTarget(key, uri));
	const settings = workspace.getConfiguration(extensionId, uri);

	for (const update of updates) {
		await settings.update(update.key, update.value, update.target);
	}

	return updates.length;
}
