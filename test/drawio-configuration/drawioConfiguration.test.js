const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("typescript");

const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 };

/**
 * Loads src/drawioConfiguration.ts with a vscode stub whose settings are
 * {key: {globalValue, workspaceValue, workspaceFolderValue}} of the
 * extension's section. Updates are recorded in the returned array.
 */
function load(settings = {}) {
	const updates = [];
	const vscode = {
		ConfigurationTarget,
		workspace: {
			getConfiguration: () => ({
				inspect: (key) => settings[key] || {},
				get: (key) => {
					const s = settings[key] || {};
					return s.workspaceFolderValue ?? s.workspaceValue ?? s.globalValue;
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

test("merges the config setting into the host's configuration", () => {
	const { module } = load();
	const host = { compressXml: false, zoomFactor: 1.2, simpleLabels: false,
		hideMenuItems: ["print", "exit"], noAutoFocus: true };
	const user = { zoomWheel: false, zoomFactor: 1.5, simpleLabels: true,
		compressXml: true, noAutoFocus: false, hideMenuItems: ["exit", "pageSetup"] };
	const result = plain(module.mergeDrawioConfig(host, user, { simpleLabels: false }));

	assert.equal(result.zoomWheel, false, "adds an option");
	assert.equal(result.zoomFactor, 1.5, "option wins over the default of its setting");
	assert.equal(result.simpleLabels, false, "set setting wins over the option");
	assert.equal(result.compressXml, false, "reserved option stays");
	assert.equal(result.noAutoFocus, true, "reserved option stays");
	assert.deepEqual(result.hideMenuItems, ["print", "exit", "pageSetup"], "lists are merged");
	assert.deepEqual(result.configurationEditor.config,
		{ ...user, simpleLabels: false }, "dialog shows the options and the set settings");
	assert.ok(result.configurationEditor.excludedKeys.includes("compressXml"));
	assert.ok(result.configurationEditor.excludedKeys.includes("configurationEditor"));
});

test("leaves the host's configuration as it is without options", () => {
	const { module } = load();
	const host = { compressXml: false, zoomFactor: 1.2, customFonts: [] };
	const result = plain(module.mergeDrawioConfig(host, {}, {}));
	delete result.configurationEditor;

	assert.deepEqual(result, host);
});

test("reads the config setting without reserved options and unsafe keys", () => {
	const { module } = load({
		config: { globalValue: JSON.parse('{"zoomWheel": false, "compressXml": true, "__proto__": {"x": 1}}') },
		zoomFactor: { workspaceValue: 1.4 },
		customFonts: {},
	});

	assert.deepEqual(plain(module.getUserConfig(undefined)), { zoomWheel: false });
	assert.deepEqual(plain(module.getSetSettings(undefined)), { zoomFactor: 1.4 });
	assert.equal(module.getSettingTarget("zoomFactor", undefined), ConfigurationTarget.Workspace);
	assert.equal(module.getSettingTarget("customFonts", undefined), undefined);
});

test("splits the dialog's configuration into the settings", () => {
	const { module } = load();
	const targets = { customFonts: ConfigurationTarget.Workspace };
	const getTarget = (key) => targets[key];

	// New option in the config setting
	assert.deepEqual(plain(module.getSettingUpdates({ zoomWheel: false }, {}, {}, getTarget)),
		[{ key: "config", value: { zoomWheel: false }, target: ConfigurationTarget.Global }]);

	// Option with a setting of its own goes to that setting
	assert.deepEqual(plain(module.getSettingUpdates({ zoomFactor: 1.5 }, {}, {}, getTarget)),
		[{ key: "zoomFactor", value: 1.5, target: ConfigurationTarget.Global }]);

	// Removed option resets its setting where it is set
	assert.deepEqual(plain(module.getSettingUpdates({}, {}, { customFonts: ["Arial"] }, getTarget)),
		[{ key: "customFonts", target: ConfigurationTarget.Workspace }]);

	// Unchanged configuration in another order changes nothing
	assert.deepEqual(plain(module.getSettingUpdates(
		{ customFonts: ["Arial"], zoomWheel: false, defaultFonts: ["A", "B"] },
		{ defaultFonts: ["A", "B"], zoomWheel: false }, { customFonts: ["Arial"] }, getTarget)), []);

	// An option in the config setting moves to its own setting
	assert.deepEqual(plain(module.getSettingUpdates({ zoomFactor: 1.5 }, { zoomFactor: 1.5 }, {}, getTarget)),
		[{ key: "zoomFactor", value: 1.5, target: ConfigurationTarget.Global },
			{ key: "config", target: ConfigurationTarget.Global }]);

	// Reserved options and unsafe keys are dropped
	assert.deepEqual(plain(module.getSettingUpdates(
		JSON.parse('{"compressXml": true, "libraries": [], "__proto__": {"x": 1}, "a": 1}'), {}, {}, getTarget)),
		[{ key: "config", value: { a: 1 }, target: ConfigurationTarget.Global }]);
});

test("stores the dialog's configuration", async () => {
	const { module, updates } = load({
		config: { workspaceValue: { zoomWheel: true } },
		showTooltipIcons: { globalValue: true },
	});

	assert.equal(await module.applyDialogConfig(undefined, [1, 2]), 0, "no config object");
	assert.equal(await module.applyDialogConfig(undefined, { zoomWheel: false }), 2);
	assert.deepEqual(plain(updates), [
		{ key: "showTooltipIcons", target: ConfigurationTarget.Global },
		{ key: "config", value: { zoomWheel: false }, target: ConfigurationTarget.Workspace },
	]);
});
