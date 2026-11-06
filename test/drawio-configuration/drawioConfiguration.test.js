const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("typescript");

const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 };

/**
 * Loads src/drawioConfiguration.ts with a vscode stub whose settings are
 * {key: {globalValue, workspaceValue}} of the extension's section. Like VS
 * Code, get merges object values of both scopes, inspect also reports the
 * workspace value as the folder value (single-folder workspace), and the
 * workspace value of the config setting is ignored in Restricted Mode.
 * Updates are recorded in the returned array.
 */
function load(settings = {}, { isTrusted = true } = {}) {
	const updates = [];
	const isObject = (v) => v != null && typeof v === "object" && !Array.isArray(v);
	const vscode = {
		ConfigurationTarget,
		workspace: {
			isTrusted,
			getConfiguration: () => ({
				inspect: (key) => {
					const s = settings[key] || {};
					return { globalValue: s.globalValue, workspaceValue: s.workspaceValue,
						workspaceFolderValue: s.workspaceValue };
				},
				get: (key) => {
					const s = settings[key] || {};
					const workspaceValue = (key === "config" && !isTrusted) ? undefined : s.workspaceValue;

					return (isObject(s.globalValue) && isObject(workspaceValue)) ?
						{ ...s.globalValue, ...workspaceValue } : workspaceValue ?? s.globalValue;
				},
				update: async (key, value, target) => {
					updates.push({ key, value, target });
				},
			}),
		},
	};
	const filename = path.resolve(__dirname, "../../src/drawioConfiguration.ts");
	const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
	}).outputText;
	const exports = {};
	vm.runInNewContext(source, { exports, require: (name) => (name === "vscode") ? vscode : require(name) },
		{ filename });

	return { module: exports, updates };
}

// Values from the VM context have other prototypes
function plain(value) {
	return JSON.parse(JSON.stringify(value));
}

function state(values = {}) {
	return { userConfig: {}, setSettings: {}, globalConfig: {}, globalSettings: {}, workspaceKeys: [],
		...values };
}

test("merges the config setting into the host's configuration", () => {
	const user = { zoomWheel: false, zoomFactor: 1.5, simpleLabels: true,
		compressXml: true, noAutoFocus: false, hideMenuItems: ["exit", "pageSetup"] };
	const { module } = load({ config: { globalValue: user }, simpleLabels: { globalValue: false } });
	const host = { compressXml: false, zoomFactor: 1.2, simpleLabels: false,
		hideMenuItems: ["print", "exit"], noAutoFocus: true };
	const result = plain(module.mergeDrawioConfig(host, module.readConfigState(undefined)));

	assert.equal(result.zoomWheel, false, "adds an option");
	assert.equal(result.zoomFactor, 1.5, "option wins over the default of its setting");
	assert.equal(result.simpleLabels, false, "set setting wins over the option");
	assert.equal(result.compressXml, false, "reserved option stays");
	assert.equal(result.noAutoFocus, true, "reserved option stays");
	assert.deepEqual(result.hideMenuItems, ["print", "exit", "pageSetup"], "lists are merged");
	assert.deepEqual(result.configurationEditor.config, { zoomWheel: false, zoomFactor: 1.5,
		simpleLabels: false, hideMenuItems: ["exit", "pageSetup"] }, "dialog shows the options and the set settings");
	assert.ok(result.configurationEditor.excludedKeys.includes("compressXml"));
	assert.ok(result.configurationEditor.excludedKeys.includes("configurationEditor"));
});

test("forced options of the host win over the config setting", () => {
	const { module } = load();
	const result = plain(module.mergeUserConfig(
		{ zoomFactor: 1.2, hideMenuItems: ["print"] },
		{ zoomWheel: false, css: "x", passiveScroll: false, hideMenuItems: ["pageSetup"] },
		{},
		{ css: "editor", passiveScroll: true, hideMenuItems: ["exit"] }));

	assert.deepEqual(result, { zoomFactor: 1.2, zoomWheel: false, css: "editor", passiveScroll: true,
		hideMenuItems: ["exit", "print", "pageSetup"] });
});

test("leaves the host's configuration as it is without options", () => {
	const { module } = load();
	const host = { compressXml: false, zoomFactor: 1.2, customFonts: [] };
	const result = plain(module.mergeDrawioConfig(host, module.readConfigState(undefined)));
	delete result.configurationEditor;

	assert.deepEqual(result, host);
});

test("reads the settings of the user and of the workspace", () => {
	const settings = {
		config: {
			globalValue: JSON.parse('{"zoomWheel": false, "compressXml": true, "__proto__": {"x": 1}}'),
			workspaceValue: { defaultGridSize: 20 },
		},
		zoomFactor: { workspaceValue: 1.4 },
		showTooltipIcons: { globalValue: true },
		customFonts: {},
	};
	const result = plain(load(settings).module.readConfigState(undefined));

	assert.deepEqual(result.userConfig, { zoomWheel: false, defaultGridSize: 20 }, "both scopes, no reserved keys");
	assert.deepEqual(result.setSettings, { zoomFactor: 1.4, showTooltipIcons: true });
	assert.deepEqual(Object.keys(result.globalConfig), ["zoomWheel", "compressXml", "__proto__"],
		"user settings as they are");
	assert.deepEqual(result.globalSettings, { showTooltipIcons: true });
	assert.deepEqual(result.workspaceKeys, ["defaultGridSize", "zoomFactor"]);

	// Restricted Mode ignores the config setting of the workspace
	const restricted = plain(load(settings, { isTrusted: false }).module.readConfigState(undefined));
	assert.deepEqual(restricted.userConfig, { zoomWheel: false });
	assert.deepEqual(restricted.workspaceKeys, ["zoomFactor"]);
});

test("the dialog shows the user settings without the options of the workspace", () => {
	const { module } = load({
		config: { globalValue: { zoomWheel: false, defaultGridSize: 10, gptApiKey: "k" },
			workspaceValue: { defaultGridSize: 20 } },
		customFonts: { globalValue: ["A"] },
		zoomFactor: { workspaceValue: 1.4, globalValue: 1.3 },
	});
	const result = plain(module.mergeDrawioConfig({}, module.readConfigState(undefined)));

	assert.equal(result.defaultGridSize, 20, "workspace wins");
	assert.equal(result.zoomFactor, undefined, "set setting is in the host's configuration");
	assert.deepEqual(result.configurationEditor.config, { zoomWheel: false, gptApiKey: "k", customFonts: ["A"] });
	assert.ok(result.configurationEditor.excludedKeys.includes("defaultGridSize"));
	assert.ok(result.configurationEditor.excludedKeys.includes("zoomFactor"));
});

test("splits the dialog's configuration into the user settings", () => {
	const { module } = load();
	const updates = (config, values) => plain(module.getSettingUpdates(config, state(values)));

	// New option in the config setting
	assert.deepEqual(updates({ zoomWheel: false }), [{ key: "config", value: { zoomWheel: false } }]);

	// Option with a setting of its own goes to that setting
	assert.deepEqual(updates({ zoomFactor: 1.5 }), [{ key: "zoomFactor", value: 1.5 }]);

	// Removed option resets its setting
	assert.deepEqual(updates({}, { globalSettings: { customFonts: ["Arial"] } }), [{ key: "customFonts" }]);

	// Unchanged configuration in another order changes nothing
	assert.deepEqual(updates({ customFonts: ["Arial"], zoomWheel: false, defaultFonts: ["A", "B"] },
		{ globalConfig: { defaultFonts: ["A", "B"], zoomWheel: false }, globalSettings: { customFonts: ["Arial"] } }), []);

	// An option in the config setting moves to its own setting
	assert.deepEqual(updates({ zoomFactor: 1.5 }, { globalConfig: { zoomFactor: 1.5 } }),
		[{ key: "zoomFactor", value: 1.5 }, { key: "config" }]);

	// Reserved options and unsafe keys of the dialog are dropped, those of the setting kept
	assert.deepEqual(updates(JSON.parse('{"compressXml": false, "libraries": [], "__proto__": {"x": 1}, "a": 1}'),
		{ globalConfig: { compressXml: true } }), [{ key: "config", value: { compressXml: true, a: 1 } }]);

	// Options of the workspace settings are left as they are
	assert.deepEqual(updates({ b: 2 }, { workspaceKeys: ["zoomWheel", "zoomFactor"],
		globalConfig: { zoomWheel: false, b: 1 }, globalSettings: { zoomFactor: 1.3 } }),
		[{ key: "config", value: { zoomWheel: false, b: 2 } }]);
});

test("stores the dialog's configuration in the user settings", async () => {
	const { module, updates } = load({
		config: { globalValue: { x: 1 }, workspaceValue: { zoomWheel: true } },
		showTooltipIcons: { globalValue: true },
		zoomFactor: { workspaceValue: 1.4 },
	});

	assert.equal(await module.applyDialogConfig(undefined, [1, 2]), 0, "no config object");
	assert.equal(await module.applyDialogConfig(undefined, { x: 2 }), 2);
	assert.deepEqual(plain(updates), [
		{ key: "showTooltipIcons", target: ConfigurationTarget.Global },
		{ key: "config", value: { x: 2 }, target: ConfigurationTarget.Global },
	]);
});
