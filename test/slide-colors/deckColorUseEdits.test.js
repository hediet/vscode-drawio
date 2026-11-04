const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { loadTsModule, useStandIn } = require("../loadTsModule");
const standIn = require("../vscodeStandIn");
const { folderWith, page, drawing } = require("../deck/deckHelpers");

useStandIn("vscode", standIn.vscode);
const useEdits = loadTsModule("DrawioClient/deckColorUseEdits.ts");
const { RefusedColorEdit } = loadTsModule("DrawioClient/deckColorEdits.ts");

const cell = (id, style, value = "") =>
	`<mxCell id="${id}" parent="1" style="${style}" value="${value}" vertex="1"><mxGeometry width="10" height="10" as="geometry" /></mxCell>`;
const edge = (id, style) =>
	`<mxCell id="${id}" edge="1" parent="1" style="${style}"><mxGeometry relative="1" as="geometry" /></mxCell>`;
const math = 'pageWidth="1920" pageHeight="1080" math="1"';
const NEW_UNDO_HISTORY = "The editor of each open drawing of the deck then starts a new undo history.";
const colors = new Map([
	["red", "#B20000"],
	["blue", "#0000FF"],
]);

/**
 * A deck whose first section links the fill and the outline of a box, an edge and a text to red
 * and names red in two formulas, whose second section names blue alone, and whose template links
 * a font to red.
 */
function deck() {
	const folder = folderWith({
		"sections/1-a.drawio.xml": drawing(
			page(
				"a-1",
				cell("box", "fillColor=#B20000;deckFillColor=red;strokeColor=#B20000;deckStrokeColor=red;") +
					edge("e", "endArrow=none;strokeColor=#B20000;deckStrokeColor=red;") +
					cell("t", "text;html=1;", "&lt;span data-deck-color=&quot;red&quot; style=&quot;color: rgb(178, 0, 0);&quot;&gt;r&lt;/span&gt;") +
					cell("f", "text;html=1;", "\\(\\textcolor{red}{x} + \\colorbox{red}{y}\\)"),
				math
			)
		),
		"sections/2-b.drawio.xml": drawing(page("b-1", cell("f", "text;", "\\(\\textcolor{blue}{x}\\)"), math)),
		"templates/layouts.drawio.xml": drawing(page("title", cell("t", "text;fontColor=#B20000;deckFontColor=red;"))),
	});
	const files = ["sections/1-a.drawio.xml", "sections/2-b.drawio.xml", "templates/layouts.drawio.xml"].map((file) => path.join(folder, file));
	return { folder, files, texts: () => files.map((file) => fs.readFileSync(file, "utf8")) };
}

/** A write of the settings that records when it ran among the edits of the files. */
function settingsWriter(state) {
	return async () => {
		state.executed.push(["writeSettings", state.appliedEdits.length]);
	};
}

test("a removal asks first, and Delete writes the settings and the last value into each use of the deck", async () => {
	const state = standIn.resetState({ answers: { warning: [useEdits.DELETE_COLOR] } });
	const { files, texts } = deck();
	const blueBefore = texts()[1];
	const written = await useEdits.writeDeckColorEditWithUses({ operation: "remove", name: "red" }, files, colors, settingsWriter(state));
	assert.equal(written, true);
	const [question] = standIn.messagesOf("warning");
	assert.equal(question.text, "Delete the color red, #B20000?");
	assert.equal(question.modal, true);
	assert.deepEqual(question.buttons, ["Delete"]);
	assert.equal(
		question.detail,
		`In the drawing files of the deck, 1 shape, 1 line and 2 texts link to red, and formulas name red 2 times. Each use keeps #B20000 in place of the name. ${NEW_UNDO_HISTORY}`
	);
	assert.deepEqual(state.executed, [["writeSettings", 0]]);
	assert.equal(state.appliedEdits.length, 1);
	assert.deepEqual(state.appliedEdits[0].map(({ uri }) => uri.fsPath), [files[0], files[2]]);
	assert.deepEqual(state.saved, [files[0], files[2]]);
	const [first, second, template] = texts();
	assert.match(first, /style="fillColor=#B20000;strokeColor=#B20000;"/);
	assert.match(first, /style="endArrow=none;strokeColor=#B20000;"/);
	assert.match(first, /&lt;span style=&quot;color: #B20000;&quot;&gt;r/);
	assert.match(first, /\\textcolor\[RGB\]\{178,0,0\}\{x\} \+ \\colorbox\[RGB\]\{178,0,0\}\{y\}/);
	assert.equal(second, blueBefore);
	assert.match(template, /style="text;fontColor=#B20000;"/);
});

test("a removal that the question cancels writes nothing", async () => {
	const state = standIn.resetState({ answers: { warning: [undefined] } });
	const { files, texts } = deck();
	const before = texts();
	const written = await useEdits.writeDeckColorEditWithUses({ operation: "remove", name: "red" }, files, colors, settingsWriter(state));
	assert.equal(written, false);
	assert.equal(standIn.messagesOf("warning").length, 1);
	assert.deepEqual(state.executed, []);
	assert.deepEqual(state.appliedEdits, []);
	assert.deepEqual(texts(), before);
});

test("the question before the removal of an unused color says that nothing uses it", async () => {
	standIn.resetState({ answers: { warning: [undefined] } });
	const { files } = deck();
	await useEdits.writeDeckColorEditWithUses({ operation: "remove", name: "green" }, files, new Map([...colors, ["green", "#00FF00"]]), async () => {});
	assert.equal(standIn.lastMessageOf("warning").detail, `No shape, line, text or formula of the drawing files of the deck uses green. ${NEW_UNDO_HISTORY}`);
});

test("a new value goes into the linked uses after the settings, and the formulas keep the name", async () => {
	const state = standIn.resetState();
	const { files, texts } = deck();
	const written = await useEdits.writeDeckColorEditWithUses({ operation: "set", name: "red", value: "#00aa00" }, files, colors, settingsWriter(state));
	assert.equal(written, true);
	assert.deepEqual(standIn.messagesOf("warning", "information"), []);
	assert.deepEqual(state.executed, [["writeSettings", 0]]);
	const [first, , template] = texts();
	assert.match(first, /fillColor=#00AA00;deckFillColor=red;strokeColor=#00AA00;deckStrokeColor=red;/);
	assert.match(first, /color: #00AA00;/);
	assert.match(first, /\\textcolor\{red\}\{x\}/);
	assert.match(template, /fontColor=#00AA00;deckFontColor=red;/);
});

test("a rename renames the links and the formulas in one edit of the files", async () => {
	const state = standIn.resetState();
	const { files, texts } = deck();
	await useEdits.writeDeckColorEditWithUses({ operation: "rename", name: "red", newName: "crimson" }, files, colors, settingsWriter(state));
	assert.equal(state.appliedEdits.length, 1);
	const [first, , template] = texts();
	assert.match(first, /deckFillColor=crimson;strokeColor=#B20000;deckStrokeColor=crimson;/);
	assert.match(first, /data-deck-color=&quot;crimson&quot;/);
	assert.match(first, /\\textcolor\{crimson\}\{x\} \+ \\colorbox\{crimson\}\{y\}/);
	assert.match(template, /deckFontColor=crimson;/);
});

test("an open drawing takes the edit in its document, and a new color edits no file", async () => {
	const state = standIn.resetState();
	const { files, texts } = deck();
	const open = standIn.textDocument(files[0], fs.readFileSync(files[0], "utf8"));
	state.textDocuments.push(open);
	await useEdits.writeDeckColorEditWithUses({ operation: "set", name: "red", value: "#00AA00" }, files, colors, settingsWriter(state));
	assert.match(open.getText(), /fillColor=#00AA00/);
	assert.equal(open.isDirty, false);
	assert.match(texts()[0], /fillColor=#00AA00/);
	standIn.resetState();
	await useEdits.writeDeckColorEditWithUses({ operation: "set", name: "green", value: "#00FF00" }, files, colors, async () => {});
	assert.deepEqual(standIn.state().appliedEdits, []);
});

test("a drawing with changes that are not saved takes the edit in its document, stays unsaved, and a message names it", async () => {
	const state = standIn.resetState({ answers: { warning: [useEdits.DELETE_COLOR] } });
	const { files, texts } = deck();
	const before = texts();
	const unsavedWork = before[0].replace("</root>", cell("user", "rounded=1;") + "</root>");
	const dirty = standIn.textDocument(files[0], unsavedWork, true);
	state.textDocuments.push(dirty);
	const written = await useEdits.writeDeckColorEditWithUses({ operation: "remove", name: "red" }, files, colors, settingsWriter(state));
	assert.equal(written, true);
	assert.deepEqual(state.executed, [["writeSettings", 0]]);
	assert.deepEqual(state.appliedEdits[0].map(({ uri }) => uri.fsPath), [files[0], files[2]]);
	assert.deepEqual(state.saved, [files[2]]);
	assert.equal(dirty.isDirty, true);
	assert.match(dirty.getText(), /<mxCell id="user" parent="1" style="rounded=1;"/);
	assert.match(dirty.getText(), /style="fillColor=#B20000;strokeColor=#B20000;"/);
	assert.equal(texts()[0], before[0]);
	assert.match(texts()[2], /style="text;fontColor=#B20000;"/);
	assert.deepEqual(standIn.messagesOf("information").map(({ text }) => text), [
		`${files[0]} holds the change of the color with its other unsaved changes.`,
	]);
});

test("a drawing changed between the reading of the files and the edit keeps the change and takes the edit in the right place", async () => {
	const state = standIn.resetState();
	const { files } = deck();
	const open = standIn.textDocument(files[0]);
	state.textDocuments.push(open);
	const added = cell("added", "rounded=1;");
	await useEdits.writeDeckColorEditWithUses({ operation: "set", name: "red", value: "#00AA00" }, files, colors, async () => {
		// The editor replaces the whole text of the document after an edit in draw.io.
		open.text = open.text.replace('<mxCell id="box"', added + '<mxCell id="box"');
		open.isDirty = true;
	});
	assert.ok(open.getText().includes(added + '<mxCell id="box" parent="1" style="fillColor=#00AA00;deckFillColor=red;strokeColor=#00AA00;deckStrokeColor=red;"'));
	assert.match(open.getText(), /<mxCell id="e" edge="1" parent="1" style="endArrow=none;strokeColor=#00AA00;deckStrokeColor=red;">/);
	assert.match(open.getText(), /<\/root><\/mxGraphModel><\/diagram>\n<\/mxfile>\n$/);
	assert.equal(open.isDirty, true);
});

test("the drawing files of a deck add each open drawing whose text is XML, once", () => {
	const { deckDrawingFiles } = loadTsModule("deck/deckColorFiles.ts");
	assert.deepEqual(
		deckDrawingFiles(["/d/sections/1-a.drawio.xml"], ["/d/templates/t.drawio.xml"], [
			"/d/sections/1-a.drawio.xml",
			"/d/figures/plot.drawio",
			"/d/figures/old.dio",
			"/d/figures/logo.drawio.png",
			"/d/figures/chart.drawio.svg",
		]),
		["/d/sections/1-a.drawio.xml", "/d/templates/t.drawio.xml", "/d/figures/plot.drawio", "/d/figures/old.dio"]
	);
});

test("a rename reaches an open drawing of the deck outside its slides folder, and a second path to one file edits it once", async () => {
	const state = standIn.resetState();
	const { folder, files } = deck();
	const figure = path.join(folder, "figures/plot.drawio");
	fs.mkdirSync(path.dirname(figure));
	fs.writeFileSync(figure, drawing(page("plot", cell("p", "fillColor=#B20000;deckFillColor=red;") + cell("f", "text;html=1;", "\\(\\textcolor{red}{x}\\)"))));
	const link = path.join(folder, "plot-link.drawio");
	fs.symlinkSync(figure, link);
	const { deckDrawingFiles } = loadTsModule("deck/deckColorFiles.ts");
	await useEdits.writeDeckColorEditWithUses({ operation: "rename", name: "red", newName: "crimson" }, deckDrawingFiles(files, [], [figure, link]), colors, settingsWriter(state));
	assert.deepEqual(state.appliedEdits[0].map(({ uri }) => uri.fsPath), [files[0], files[2], figure]);
	const text = fs.readFileSync(figure, "utf8");
	assert.match(text, /deckFillColor=crimson;/);
	assert.match(text, /\\textcolor\{crimson\}\{x\}/);
});

test("a file that VS Code does not save raises an error that names it", async () => {
	standIn.resetState({ answers: { applyEdit: [false] } });
	const { files } = deck();
	await assert.rejects(
		useEdits.writeDeckColorEditWithUses({ operation: "set", name: "red", value: "#00AA00" }, files, colors, async () => {}),
		new RegExp(`VS Code did not write the uses of the color into ${files[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}, `)
	);
});

test("a new value of a name that the colors do not yet hold, as after a rename sent just before, still reaches its links", async () => {
	standIn.resetState();
	const { files, texts } = deck();
	await useEdits.writeDeckColorEditWithUses({ operation: "rename", name: "red", newName: "crimson" }, files, colors, async () => {});
	await useEdits.writeDeckColorEditWithUses({ operation: "set", name: "crimson", value: "#00AA00" }, files, colors, async () => {});
	assert.match(texts()[0], /fillColor=#00AA00;deckFillColor=crimson;/);
});
