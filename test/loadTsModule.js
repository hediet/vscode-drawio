const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

/** The exports of each module loaded, by its file, so that two modules that import a third share it. */
const loaded = new Map();
/** The modules that a test puts in the place of a module that Node cannot load, such as `vscode`, by their names. */
const standIns = new Map();

/**
 * The exports of a TypeScript module of `src/`, transpiled to CommonJS and run in this context, so
 * that a test of `node:test` reads it without a build. An import of another module of `src/` by a
 * relative path loads that module in the same way, an import of a module given to `useStandIn`
 * gets the stand-in, and any other import is a module of Node or of `node_modules/`.
 */
function loadTsModule(relativePath) {
	return loadFile(path.resolve(__dirname, "../src", relativePath));
}

function loadFile(filename) {
	if (loaded.has(filename)) {
		return loaded.get(filename).exports;
	}
	const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
		compilerOptions: {
			module: ts.ModuleKind.CommonJS,
			target: ts.ScriptTarget.ES2020,
		},
	}).outputText;
	const module = { exports: {} };
	loaded.set(filename, module);
	const run = vm.compileFunction(
		source,
		["exports", "require", "module", "__filename", "__dirname"],
		{
			filename,
		}
	);
	run(
		module.exports,
		requireFrom(path.dirname(filename)),
		module,
		filename,
		path.dirname(filename)
	);
	return module.exports;
}

/** The `require` of a module in the folder: a relative path names a TypeScript module beside it. */
function requireFrom(folder) {
	return (id) => {
		if (standIns.has(id)) {
			return standIns.get(id);
		}
		if (id.startsWith(".")) {
			const file = path.resolve(folder, id);
			const candidates = [file + ".ts", path.join(file, "index.ts")];
			const found = candidates.find((candidate) =>
				fs.existsSync(candidate)
			);
			if (found !== undefined) {
				return loadFile(found);
			}
		}
		return require(id);
	};
}

/** Puts the exports in the place of the module of the name for every module loaded afterwards. */
function useStandIn(id, exports) {
	standIns.set(id, exports);
}

module.exports = { loadTsModule, useStandIn };
