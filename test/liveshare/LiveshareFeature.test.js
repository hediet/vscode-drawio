const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("typescript");

// Follows the harness pattern of test/codeblock-editor/markdownCodeBlockEditor.test.js:
// transpile the TypeScript source and load it with mocked module imports.
function loadLiveshareFeature(getApiCalls) {
	const filename = path.resolve(
		__dirname,
		"../../src/features/LiveshareFeature/LiveshareFeature.ts"
	);
	const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2020,
		},
	}).outputText;
	const exports = {};
	const requireModule = (name) => {
		if (name === "vsls") {
			return {
				getApi: async () => {
					getApiCalls.count++;
					return null;
				},
			};
		}
		if (name === "@hediet/std/disposable") {
			return {
				Disposable: { fn: () => ({ track: (x) => x }) },
			};
		}
		if (name === "../../utils/autorunTrackDisposables") {
			return { autorunTrackDisposables: () => ({}) };
		}
		if (name === "../../utils/fromResource") {
			return { fromResource: () => ({ current: () => undefined }) };
		}
		if (name === "./LiveshareSession") {
			return { LiveshareSession: class {} };
		}
		// Type-only imports (Config, DrawioEditorService) are elided by the
		// transpiler; return an empty module if one is requested anyway.
		return {};
	};
	const silentConsole = { ...console, warn: () => {}, error: () => {} };
	vm.runInNewContext(
		source,
		{ exports, require: requireModule, console: silentConsole },
		{ filename }
	);
	return exports;
}

async function flushAsync() {
	await new Promise((resolve) => setImmediate(resolve));
	await new Promise((resolve) => setImmediate(resolve));
}

test("does not load the Live Share API when enableLiveshare is disabled", async () => {
	const getApiCalls = { count: 0 };
	const { LiveshareFeature } = loadLiveshareFeature(getApiCalls);
	new LiveshareFeature({}, { liveshareEnabled: false });
	await flushAsync();
	assert.equal(getApiCalls.count, 0);
});

test("loads the Live Share API when enableLiveshare is enabled (default behaviour)", async () => {
	const getApiCalls = { count: 0 };
	const { LiveshareFeature } = loadLiveshareFeature(getApiCalls);
	new LiveshareFeature({}, { liveshareEnabled: true });
	await flushAsync();
	assert.equal(getApiCalls.count, 1);
});
