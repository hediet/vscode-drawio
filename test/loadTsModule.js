const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

/**
 * The exports of a TypeScript module of `src/` that imports no `vscode`, transpiled to CommonJS
 * and run in a context of its own, so that a test of `node:test` reads it without a build.
 */
function loadTsModule(relativePath) {
	const filename = path.resolve(__dirname, "../src", relativePath);
	const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
	}).outputText;
	const exports = {};
	vm.runInNewContext(source, { exports, require }, { filename });
	return exports;
}

module.exports = { loadTsModule };
