import { ConfigurationTarget, SecretStorage, Uri, workspace } from "vscode";

/**
 * The draw.io configuration of the editor: the `config` setting holds any
 * option of the draw.io configuration (as in Extras > Configuration of the
 * draw.io app), and the Configuration dialog of the editor edits it.
 *
 * - The extension sets the options in RESERVED_CONFIG_KEYS itself. The
 *   setting cannot change them and the dialog hides them.
 * - The options in SETTING_CONFIG_KEYS have a setting of their own. If that
 *   setting is set, it wins over the option in the `config` setting of the
 *   same or a lower scope (the workspace settings win over the user
 *   settings), and the dialog stores the option in that setting.
 * - The dialog stores the API keys in SECRET_CONFIG_KEYS in the secret
 *   storage of VS Code instead of the settings.
 * - The options in MERGED_CONFIG_KEYS are lists that the extension adds its
 *   own entries to.
 * - The dialog changes the user settings only. It hides the options that the
 *   workspace settings set, as they win over the user settings (and so that
 *   no personal option, such as an API key, ends up in the workspace).
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

export const SECRET_CONFIG_KEYS: readonly string[] = ["claudeApiKey", "geminiApiKey", "gptApiKey"];

// Prefix of the keys of the API keys in the secret storage
const SECRET_PREFIX = `${extensionId}.config.`;

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

// The keys of a config object without the reserved and unsafe keys
function configKeys(value: ConfigObject): string[] {
	return Object.keys(value).filter((key) =>
		!isUnsafeKey(key) && !RESERVED_CONFIG_KEYS.includes(key));
}

/**
 * The settings of the draw.io configuration of a document.
 */
export interface ConfigState {
	/** The `config` setting (all scopes) without reserved and unsafe keys. */
	userConfig: ConfigObject;
	/** The values of the settings of SETTING_CONFIG_KEYS that are set. */
	setSettings: ConfigObject;
	/** The `config` setting in the user settings, as it is. */
	globalConfig: ConfigObject;
	/** The settings of SETTING_CONFIG_KEYS in the user settings. */
	globalSettings: ConfigObject;
	/** The options that the workspace settings set (in `config` or their setting). */
	workspaceKeys: string[];
}

/**
 * Reads the settings of the draw.io configuration of the given document.
 * Folder settings of a multi-root workspace are left out, as the settings
 * are not resource settings (in a single folder they are the workspace
 * settings).
 */
export function readConfigState(uri: Uri | undefined): ConfigState {
	const settings = workspace.getConfiguration(extensionId, uri);
	const state: ConfigState = {
		userConfig: {},
		setSettings: {},
		globalConfig: {},
		globalSettings: {},
		workspaceKeys: [],
	};

	const value = settings.get(CONFIG_SETTING);

	if (isConfigObject(value)) {
		for (const key of configKeys(value)) {
			state.userConfig[key] = value[key];
		}
	}

	const config = settings.inspect<unknown>(CONFIG_SETTING);
	const globalConfig = config?.globalValue;
	const workspaceConfig = config?.workspaceValue;

	if (isConfigObject(globalConfig)) {
		state.globalConfig = globalConfig;
	}

	// Restricted Mode ignores the config setting of the workspace
	const workspaceConfigKeys = (workspace.isTrusted !== false &&
		isConfigObject(workspaceConfig)) ? configKeys(workspaceConfig) : [];
	state.workspaceKeys.push(...workspaceConfigKeys);

	for (const key of SETTING_CONFIG_KEYS) {
		const result = settings.inspect(key);

		if (result?.globalValue !== undefined) {
			state.globalSettings[key] = result.globalValue;
		}

		if (result?.workspaceValue !== undefined && !state.workspaceKeys.includes(key)) {
			state.workspaceKeys.push(key);
		}

		// The option in the config setting of the workspace wins over a
		// setting in the user settings
		if (result?.workspaceValue !== undefined || (result?.globalValue !== undefined &&
			!workspaceConfigKeys.includes(key))) {
			state.setSettings[key] = settings.get(key);
		}
	}

	return state;
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
	const state = readConfigState(uri);

	return mergeUserConfig(hostConfig, state.userConfig, state.setSettings,
		forcedConfig);
}

/**
 * The API keys of the Configuration dialog in the secret storage. Errors of
 * the secret storage (eg. no keyring) leave the keys out.
 */
export async function readConfigSecrets(storage: SecretStorage): Promise<ConfigObject> {
	const result: ConfigObject = {};

	for (const key of SECRET_CONFIG_KEYS) {
		try {
			const value = await storage.get(SECRET_PREFIX + key);

			if (value !== undefined) {
				result[key] = JSON.parse(value);
			}
		} catch (e) {
			console.error(`Could not read the Draw.io configuration option ${key}`, e);
		}
	}

	return result;
}

/**
 * Returns the configuration for draw.io (see mergeUserConfig) with the API
 * keys of the secret storage, which win over the user settings, and adds the
 * configuration for the Configuration dialog, which hides the reserved
 * options and those of the workspace settings.
 */
export function mergeDrawioConfig(
	hostConfig: ConfigObject,
	state: ConfigState,
	secrets: ConfigObject = {}
): ConfigObject {
	const userConfig: ConfigObject = { ...state.userConfig };

	for (const key of Object.keys(secrets)) {
		if (SECRET_CONFIG_KEYS.includes(key) && !state.workspaceKeys.includes(key)) {
			userConfig[key] = secrets[key];
		}
	}

	const result = mergeUserConfig(hostConfig, userConfig, state.setSettings);

	result.configurationEditor = {
		config: getDialogConfig(state, secrets),
		excludedKeys: RESERVED_CONFIG_KEYS.concat(state.workspaceKeys),
	};

	return result;
}

// Whether the dialog shows and changes the given option
function isDialogKey(key: string, state: ConfigState): boolean {
	return !isUnsafeKey(key) && !RESERVED_CONFIG_KEYS.includes(key) &&
		!state.workspaceKeys.includes(key);
}

/**
 * The configuration that the Configuration dialog shows: the `config` setting
 * and the settings of SETTING_CONFIG_KEYS in the user settings and the API
 * keys, without the options of the workspace settings.
 */
export function getDialogConfig(
	state: ConfigState,
	secrets: ConfigObject = {}
): ConfigObject {
	const result: ConfigObject = {};

	for (const source of [state.globalConfig, secrets, state.globalSettings]) {
		for (const key of Object.keys(source)) {
			if (isDialogKey(key, state)) {
				result[key] = source[key];
			}
		}
	}

	return result;
}

export interface SettingUpdate {
	key: string;
	/** undefined resets the setting */
	value: unknown;
}

/**
 * The changes of the user settings for the configuration of the Configuration
 * dialog: options of SETTING_CONFIG_KEYS go to their setting (and a setting
 * whose option was removed is reset), and the other options go to the
 * `config` setting, which keeps the options that the dialog does not show.
 * Reserved options, unsafe keys and the options of the workspace settings are
 * left as they are, and API keys move to the secret storage (see
 * getSecretUpdates).
 */
export function getSettingUpdates(
	config: ConfigObject,
	state: ConfigState
): SettingUpdate[] {
	const updates: SettingUpdate[] = [];

	for (const key of SETTING_CONFIG_KEYS) {
		if (!isDialogKey(key, state)) {
			continue;
		}

		const current = state.globalSettings[key];

		if (key in config) {
			if (current === undefined || !isSameValue(config[key], current)) {
				updates.push({ key, value: config[key] });
			}
		} else if (current !== undefined) {
			updates.push({ key, value: undefined });
		}
	}

	// Also moves the options of SETTING_CONFIG_KEYS out of the config setting
	const newConfig: ConfigObject = {};

	for (const key of Object.keys(state.globalConfig)) {
		if (!isUnsafeKey(key) && !isDialogKey(key, state)) {
			newConfig[key] = state.globalConfig[key];
		}
	}

	for (const key of Object.keys(config)) {
		if (isDialogKey(key, state) && !SETTING_CONFIG_KEYS.includes(key) &&
			!SECRET_CONFIG_KEYS.includes(key)) {
			newConfig[key] = config[key];
		}
	}

	if (!isSameValue(newConfig, state.globalConfig)) {
		updates.push({
			key: CONFIG_SETTING,
			value: (Object.keys(newConfig).length > 0) ? newConfig : undefined,
		});
	}

	return updates;
}

/**
 * The changes of the secret storage for the API keys of the configuration of
 * the Configuration dialog (undefined deletes a key), except those of the
 * workspace settings.
 */
export function getSecretUpdates(
	config: ConfigObject,
	state: ConfigState,
	secrets: ConfigObject
): SettingUpdate[] {
	const updates: SettingUpdate[] = [];

	for (const key of SECRET_CONFIG_KEYS) {
		if (!isDialogKey(key, state)) {
			continue;
		} else if (key in config) {
			if (secrets[key] === undefined || !isSameValue(config[key], secrets[key])) {
				updates.push({ key, value: config[key] });
			}
		} else if (secrets[key] !== undefined) {
			updates.push({ key, value: undefined });
		}
	}

	return updates;
}

/**
 * Stores the configuration of the Configuration dialog in the user settings,
 * and the API keys in the secret storage first, so that no key is removed
 * from the settings if the secret storage fails. Returns the numbers of the
 * settings and API keys that changed.
 */
export async function applyDialogConfig(
	uri: Uri | undefined,
	config: unknown,
	storage: SecretStorage
): Promise<{ settings: number; secrets: number }> {
	if (!isConfigObject(config)) {
		return { settings: 0, secrets: 0 };
	}

	const state = readConfigState(uri);
	const secretUpdates = getSecretUpdates(config, state, await readConfigSecrets(storage));

	for (const update of secretUpdates) {
		if (update.value === undefined) {
			await storage.delete(SECRET_PREFIX + update.key);
		} else {
			await storage.store(SECRET_PREFIX + update.key, JSON.stringify(update.value));
		}
	}

	const updates = getSettingUpdates(config, state);
	const settings = workspace.getConfiguration(extensionId, uri);

	for (const update of updates) {
		await settings.update(update.key, update.value, ConfigurationTarget.Global);
	}

	return { settings: updates.length, secrets: secretUpdates.length };
}
