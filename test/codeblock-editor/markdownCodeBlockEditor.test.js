const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("typescript");

function loadModule(relativePath, requireModule = require, globals = {}) {
	const filename = path.resolve(__dirname, "../../src", relativePath);
	const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
	}).outputText;
	const exports = {};
	vm.runInNewContext(source, { exports, require: requireModule, ...globals }, { filename });
	return exports;
}

function loadProvider(settings = {}, language = "en", followHostTheme = true) {
	const vscode = {
		workspace: { getConfiguration: () => ({ get: (key, fallback) => settings[key] ?? fallback }) },
		Uri: { joinPath: (base, ...parts) => new URL(parts.join("/"), base) },
	};
	const module = loadModule("codeblock-editor/markdownCodeBlockEditor.ts", name => {
		if (name === "vscode") { return vscode; }
		if (name === "../DrawioClient") { return { simpleDrawioLibrary: value => value }; }
		if (name === "../vscodeShortcuts") { return { VSCODE_PASSTHROUGH_KEYS: [] }; }
		if (name === "../inline-editor/diagramParser") { return loadModule("inline-editor/diagramParser.ts"); }
		if (name === "./protocol") { return loadModule("codeblock-editor/protocol.ts"); }
		return require(name);
	});
	return module.createMarkdownCodeBlockEditorsApi(
		{ extensionUri: new URL("https://extension.test/") },
		{ getDiagramConfig: () => ({
			mode: { kind: "offline" }, customLibraries: [], localStorage: {},
			resolvedTheme: { getDarkDrawioValue: () => "auto", getAppearanceDrawioValue: () => "0" },
			appearanceFollowsSystem: followHostTheme, drawioLanguage: language,
		}) },
		{ appendLine() {} },
	).apiV2.getProvider("drawio");
}

const request = { providerId: "drawio", language: "drawio", documentUri: new URL("file:///document.md") };

test("resolves packaged resources through API v2 without a nested offline iframe", async () => {
	const descriptor = await loadProvider().resolve(request, { isCancellationRequested: false });
	assert.equal(descriptor.content.baseUri.href, "https://extension.test/drawio/src/main/webapp");
	assert.match(descriptor.content.html, /src="\.\.\/\.\.\/\.\.\/\.\.\/dist\/codeblock-editor\/guest\.js"/);
	assert.match(descriptor.content.html, /href="styles\/grapheditor\.css"/);
	assert.doesNotMatch(descriptor.content.html, /<iframe|127\.0\.0\.1/);
	assert.equal(descriptor.contentType, "text");
	const config = JSON.parse(descriptor.content.html.match(/id="drawio-codeblock-config">([^<]+)<\/script>/)[1]);
	assert.equal(config.drawioConfig.noAutoFocus, true);
	assert.equal(config.drawioConfig.noResizers, true);
	assert.match(config.drawioConfig.css, /\.geToolbarContainer \{ box-shadow:none !important; \}/);
});

test("preserves fence options, explicit appearance and safe configuration encoding", async () => {
	const descriptor = await loadProvider({ diagramPadding: 12 }, 'en</script><script>', false).resolve(
		{ ...request, language: "drawio locked height=360" }, { isCancellationRequested: false },
	);
	const config = JSON.parse(descriptor.content.html.match(/id="drawio-codeblock-config">([^<]+)<\/script>/)[1]);
	assert.equal(config.urlParams.lang, 'en</script><script>');
	assert.equal(config.followHostTheme, false);
	assert.equal(config.locked, true);
	assert.equal(config.diagramPadding, 12);
	assert.equal(descriptor.initialHeight, 360);
	assert.doesNotMatch(descriptor.content.html, /en<\/script>/);
});

test("does not resolve a cancelled request", async () => {
	assert.equal(await loadProvider().resolve(request, { isCancellationRequested: true }), undefined);
});

test("live host themes preserve content and focus, and dispose their observer", async () => {
	let scheme = "dark";
	let dark = false;
	let readonlyListener;
	let themeChanged;
	let disposed = false;
	let focusCount = 0;
	let focused = false;
	const config = {
		mode: { kind: "offline" }, followHostTheme: true, urlParams: {},
		drawioConfig: { noAutoFocus: true }, localStorage: {}, passThroughKeys: [],
		locked: false, fixedHeight: null, diagramPadding: 28,
	};
	const element = { textContent: JSON.stringify(config), classList: { toggle() {}, remove() {}, add() {} } };
	const document = {
		getElementById: () => element, createElement: () => ({}),
		head: { appendChild: script => queueMicrotask(() => script.onload?.()) },
		documentElement: { clientWidth: 800 },
		baseURI: "https://resources.test/drawio/",
		hasFocus: () => focused,
	};
	const window = {
		addEventListener() {}, dispatchEvent() {},
		setTimeout: () => 1, clearTimeout() {},
		focus: () => { focusCount++; },
		Editor: { isDarkMode: () => dark },
		EditorUi: { prototype: { init() {} } },
		mxUrlConverter: { prototype: {} },
		mxCellEditor: { prototype: { focusContainer: () => { focusCount++; } } },
		App: { main: () => window.mxCellEditor.prototype.focusContainer() },
	};
	loadModule("codeblock-editor/guest/main.ts", name => {
		if (name === "../protocol") { return loadModule("codeblock-editor/protocol.ts"); }
		assert.equal(name, "@vscode/web-editors");
		return { WebEditorClient: { connect: async () => ({
			getContent: () => "<mxfile/>", getReadOnly: () => true,
			onDidChangeContent() {},
			onDidChangeReadOnly: listener => { readonlyListener = listener; },
			applyEdits: () => assert.fail("theme or readonly changes must not edit content"),
			dispose() {},
		}) } };
	}, {
		window, document, console, Event,
		getComputedStyle: () => ({ colorScheme: scheme }),
		ResizeObserver: class { observe() {} },
		MutationObserver: class {
			constructor(listener) { themeChanged = listener; }
			observe() {}
			disconnect() { disposed = true; }
		},
	});
	await new Promise(resolve => setImmediate(resolve));
	const session = window.drawioCodeBlockSession;
	session.editorUi = { editor: { graph: { setEnabled() {} } }, setDarkMode: value => { dark = value; } };
	session.onDrawioEvent({ event: "load" });
	assert.equal(dark, true);
	assert.equal(focusCount, 0);
	focused = true;
	window.mxCellEditor.prototype.focusContainer();
	assert.equal(focusCount, 1, "normal focus restoration must work after user interaction");
	focused = false;
	window.mxCellEditor.prototype.focusContainer();
	assert.equal(focusCount, 1, "background restoration must not steal host focus");
	scheme = "light";
	themeChanged();
	assert.equal(dark, false);
	readonlyListener({ readOnly: false });
	readonlyListener({ readOnly: true });
	assert.equal(focusCount, 1);
	session.dispose();
	assert.equal(disposed, true);
});

module.exports = { loadProvider, request };
