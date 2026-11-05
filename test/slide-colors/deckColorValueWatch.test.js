const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { loadTsModule, useStandIn } = require("../loadTsModule");
const standIn = require("../vscodeStandIn");
const { folderWith, page, drawing } = require("../deck/deckHelpers");

useStandIn("vscode", standIn.vscode);
const { DeckColorValueWatch, WRITE_COLOR_VALUES } = loadTsModule("DrawioClient/deckColorValueWatch.ts");

const cell = (id, style) =>
	`<mxCell id="${id}" parent="1" style="${style}" value="" vertex="1"><mxGeometry width="10" height="10" as="geometry" /></mxCell>`;

/** The time that the watch takes to read the files, ask and write after a change of the settings. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 20));

/**
 * A deck whose two section files link a fill to red and a line to blue, with a watch whose colors
 * are `colors.current`, which a test changes before it tells the listeners.
 */
function watchedDeck() {
	const folder = folderWith({
		"sections/1-a.drawio.xml": drawing(page("a-1", cell("box", "fillColor=#B20000;deckFillColor=red;"))),
		"sections/2-b.drawio.xml": drawing(page("b-1", cell("line", "strokeColor=#0000FF;deckStrokeColor=blue;"))),
	});
	const files = ["sections/1-a.drawio.xml", "sections/2-b.drawio.xml"].map((file) => path.join(folder, file));
	const colors = {
		current: new Map([
			["red", "#B20000"],
			["blue", "#0000FF"],
		]),
	};
	const watch = new DeckColorValueWatch(
		standIn.vscode.Uri.file(folder),
		() => colors.current,
		async () => files,
		() => {}
	);
	const changeColors = (entries) => {
		colors.current = new Map(entries);
		standIn.changeConfiguration("drawSlidesCode.colors", Object.fromEntries(entries));
	};
	return { files, watch, changeColors, texts: () => files.map((file) => fs.readFileSync(file, "utf8")) };
}

test("a new value by hand asks once, and Write writes the new values into the linked uses of the deck", async () => {
	const state = standIn.resetState({ answers: { information: [WRITE_COLOR_VALUES] } });
	const { files, watch, changeColors, texts } = watchedDeck();
	changeColors([
		["red", "#00AA00"],
		["blue", "#000080"],
	]);
	await settled();
	assert.deepEqual(standIn.messagesOf("information").map(({ text, buttons }) => ({ text, buttons })), [
		{
			text: "drawSlidesCode.colors gives red and blue new values. Write the new values into the shapes, the lines and the texts linked to these colors in 2 drawing files of the deck?",
			buttons: ["Write"],
		},
	]);
	const [first, second] = texts();
	assert.match(first, /fillColor=#00AA00;deckFillColor=red;/);
	assert.match(second, /strokeColor=#000080;deckStrokeColor=blue;/);
	assert.deepEqual(state.saved, files);
	watch.dispose();
});

test("a new value by hand that the question leaves unanswered changes no file", async () => {
	standIn.resetState({ answers: { information: [undefined] } });
	const { watch, changeColors, texts } = watchedDeck();
	const before = texts();
	changeColors([
		["red", "#00AA00"],
		["blue", "#0000FF"],
	]);
	await settled();
	assert.match(standIn.lastMessageOf("information").text, /^drawSlidesCode\.colors gives red a new value\. .* in 1 drawing file of the deck\?$/);
	assert.deepEqual(texts(), before);
	watch.dispose();
});

test("a new value from the section Deck colors, a value that the files already hold and a rename by hand ask nothing", async () => {
	standIn.resetState();
	const { watch, changeColors } = watchedDeck();
	await watch.whileSectionEdits(async () => {
		changeColors([
			["red", "#00AA00"],
			["blue", "#0000FF"],
		]);
		await settled();
	});
	await settled();
	changeColors([
		["red", "#B20000"],
		["blue", "#0000FF"],
	]);
	await settled();
	assert.deepEqual(standIn.messagesOf("information"), []);
	changeColors([
		["crimson", "#B20000"],
		["blue", "#0000FF"],
	]);
	await settled();
	assert.deepEqual(standIn.messagesOf("information"), []);
	watch.dispose();
	assert.deepEqual(standIn.state().configurationListeners, []);
});
