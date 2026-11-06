const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("typescript");

function loadModule(relativePath, requireModule = require) {
	const filename = path.resolve(__dirname, "../../src", relativePath);
	const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
	}).outputText;
	const exports = {};
	vm.runInNewContext(source, { exports, require: requireModule, Buffer, console }, { filename });
	return exports;
}

const shortcuts = loadModule("vscodeShortcuts.ts");
const parser = loadModule("inline-editor/diagramParser.ts");
const sections = loadModule("inline-editor/markdownSections.ts");
const { createLocalServer } = loadModule("inline-editor/localServer.ts", (name) =>
	name === "../vscodeShortcuts" ? shortcuts : require(name)
);

// Values made in the module's context have other prototypes
const plain = (value) => JSON.parse(JSON.stringify(value));

function textSections(text, imageBaseUri) {
	const lines = sections.splitLines(text);
	const env = sections.createRenderEnv(text, imageBaseUri);
	return sections.buildTextSections(lines, 0, lines.length - 1, env);
}

// ── Diagram blocks ──

test("new diagrams get distinct page ids", () => {
	const ids = new Set();
	for (let i = 0; i < 50; i++) {
		const id = parser.extractDiagramId(parser.createEmptyDiagram());
		assert.match(id, /^[0-9A-Za-z_-]{20}$/);
		ids.add(id);
	}
	assert.equal(ids.size, 50);
});

function diagram(id, label) {
	return `<mxfile><diagram id="${id}"><mxGraphModel><root><mxCell id="${label}"/></root></mxGraphModel></diagram></mxfile>`;
}

function markdownWith(...xmls) {
	return xmls.map((xml) => "```drawio\n" + xml + "\n```").join("\n\nText\n\n");
}

test("a save goes to the block at its index when copies share the page id", () => {
	const blocks = parser.findDiagramBlocks(markdownWith(diagram("same", "a"), diagram("same", "b")));
	assert.equal(parser.locateDiagramBlock(blocks, 1, "same"), blocks[1]);
	assert.equal(parser.locateDiagramBlock(blocks, 0, "same"), blocks[0]);
});

test("a save follows its page id when blocks were added before it", () => {
	const blocks = parser.findDiagramBlocks(markdownWith(diagram("new", "x"), diagram("mine", "a")));
	assert.equal(parser.locateDiagramBlock(blocks, 0, "mine"), blocks[1]);
});

test("an ambiguous block is not guessed", () => {
	const blocks = parser.findDiagramBlocks(markdownWith(diagram("other", "x"), diagram("dup", "a"), diagram("dup", "b")));
	assert.equal(parser.locateDiagramBlock(blocks, 0, "dup"), null);
});

test("the XML the editor last saw identifies a block without a page id", () => {
	const plain = "<mxGraphModel><root><mxCell id=\"0\"/></root></mxGraphModel>";
	const blocks = parser.findDiagramBlocks(markdownWith(diagram("new", "x"), plain));
	assert.equal(parser.locateDiagramBlock(blocks, 0, null, plain), blocks[1]);
	assert.equal(parser.locateDiagramBlock(blocks, 5, null), null);
});

// ── Text sections ──

test("every top-level Markdown block is one section on its exact lines", () => {
	const text = "# Title\nIntro line one\nline two\n\n- a\n\n- b\n\n```js\nx\n\ny\n```\n";
	const result = textSections(text);
	assert.deepEqual(
		plain(result.map((s) => [s.startLine, s.endLine, s.markdown])),
		[
			[0, 0, "# Title"],
			[1, 2, "Intro line one\nline two"],
			[4, 6, "- a\n\n- b"],
			[8, 12, "```js\nx\n\ny\n```"],
		]
	);
	assert.match(result[1].html, /^<p>Intro line one\nline two<\/p>/);
});

test("Windows line endings don't end up in the sections", () => {
	const result = textSections("one\r\ntwo\r\n\r\nthree\r\n");
	assert.deepEqual(plain(result.map((s) => s.markdown)), ["one\ntwo", "three"]);
});

test("tables, task lists and strikethrough render", () => {
	const [table, list] = textSections("| a | b |\n|---|---|\n| 1 | 2 |\n\n- [ ] open\n- [x] done ~~old~~\n");
	assert.match(table.html, /<table>[\s\S]*<td>1<\/td>/);
	assert.match(list.html, /<li class="task-list-item"><input type="checkbox" disabled> open/);
	assert.match(list.html, /<input type="checkbox" disabled checked> done <s>old<\/s>/);
});

test("relative images resolve against the document folder, raw HTML is shown as text", () => {
	const [img, html] = textSections("![x](img/a.png) ![y](https://e.com/b.png)\n\n<b onclick=\"x()\">hi</b>\n", "https://webview/doc");
	assert.match(img.html, /src="https:\/\/webview\/doc\/img\/a.png"/);
	assert.match(img.html, /src="https:\/\/e.com\/b.png"/);
	assert.match(html.html, /&lt;b onclick=/);
});

test("link references resolve across sections", () => {
	const [para] = textSections("See [the docs][d].\n\n[d]: https://example.com\n");
	assert.match(para.html, /<a href="https:\/\/example.com">the docs<\/a>/);
});

test("only URLs with a scheme become links", () => {
	const [para] = textSections("Draw.io and notes.md, see https://example.com\n");
	assert.match(para.html, /^<p>Draw.io and notes.md, see <a href="https:\/\/example.com">/);
});

test("front matter is shown as source", () => {
	const [front, heading] = textSections("---\ntitle: x\n---\n# Hi\n");
	assert.deepEqual(plain([front.startLine, front.endLine]), [0, 2]);
	assert.match(front.html, /<pre class="front-matter">/);
	assert.equal(heading.markdown, "# Hi");
});

test("an edited block is found at its line, nearby, or not at all", () => {
	const lines = ["a", "", "p", "q", "", "p", "q"];
	assert.equal(sections.locateLines(lines, 2, ["p", "q"]), 2);
	assert.equal(sections.locateLines(lines, 4, ["p", "q"]), 5);
	assert.equal(sections.locateLines(lines, 3, ["p", "q"]), 2);
	assert.equal(sections.locateLines(lines, 2, ["p", "x"]), -1);
});

// ── Forwarded messages ──

test("only the pass-through commands and web links are forwarded", () => {
	assert.ok(shortcuts.VSCODE_PASSTHROUGH_COMMANDS.has("workbench.action.files.save"));
	assert.ok(!shortcuts.VSCODE_PASSTHROUGH_COMMANDS.has("workbench.action.terminal.new"));
	assert.ok(shortcuts.isExternalLink("https://example.com"));
	assert.ok(shortcuts.isExternalLink("mailto:a@b.c"));
	assert.ok(!shortcuts.isExternalLink("file:///etc/passwd"));
	assert.ok(!shortcuts.isExternalLink("vscode://some.extension/run"));
});

// ── Local server ──

test("concurrent starts of the local server all get its port", async () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "drawio-webapp-"));
	const server = createLocalServer(root);
	try {
		const [a, b] = await Promise.all([server.start(), server.start()]);
		assert.equal(typeof a, "number");
		assert.equal(a, b);
		assert.equal(server.port, a);
	} finally {
		server.stop();
		fs.rmSync(root, { recursive: true, force: true });
	}
});
