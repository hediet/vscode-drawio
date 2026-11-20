const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { loadTsModule, useStandIn } = require("../loadTsModule");
const standIn = require("../vscodeStandIn");
const { folderWith, page, drawing } = require("../deck/deckHelpers");

useStandIn("vscode", standIn.vscode);
const useEdits = loadTsModule("DrawioClient/deckStyleUseEdits.ts");
const slideSettings = loadTsModule("DrawioClient/slideSettings.ts");
const styles = loadTsModule("deck/deckStyles.ts");
const rules = styles.loadDeckStyleRules(
	path.resolve(__dirname, "../../drawio-custom-plugins/slides/deck-style-rules.js")
);

const WIRE = "strokeColor=#008000;deckStrokeColor=dpgreen;strokeWidth=3;endArrow=circle;endFill=1;endSize=3;targetPerimeterSpacing=-1.5;fixedPointSpacing=1;";
const edge = (id, style) =>
	`<mxCell id="${id}" edge="1" parent="1" source="a" target="b" style="${style}"><mxGeometry relative="1" as="geometry" /></mxCell>`;
const box = (id, style) =>
	`<mxCell id="${id}" vertex="1" parent="1" style="${style}"><mxGeometry width="10" height="10" as="geometry" /></mxCell>`;

/**
 * A deck with a style of wires in its settings, whose first section links two wires to it, one of
 * them with a font size of its own, whose second section links a box to a style of rectangles, and
 * whose template links one more wire.
 */
function deck() {
	const folder = folderWith({
		".vscode/settings.json": `{
  "drawSlidesCode.slides": true,
  // The styles of the co-design diagrams.
  "drawSlidesCode.deckStyles": {
    "rectangles": {
      "box": "rounded=1;strokeWidth=3;"
    },
    "wires": {
      // A functionality.
      "functionality": "${WIRE}"
    }
  }
}
`,
		"sections/1-a.drawio.xml": drawing(
			page(
				"a-1",
				edge("w1", WIRE + "exitX=1;exitY=0.5;deckStyle=functionality;") +
					edge("w2", WIRE + "fontSize=20;entryX=0;entryY=0.5;deckStyle=functionality;") +
					edge("w3", WIRE)
			)
		),
		"sections/2-b.drawio.xml": drawing(page("b-1", box("b", "rounded=1;strokeWidth=3;deckStyle=box;"))),
		"templates/layouts.drawio.xml": drawing(page("t", edge("w4", WIRE + "deckStyle=functionality;"))),
	});
	const files = ["sections/1-a.drawio.xml", "sections/2-b.drawio.xml", "templates/layouts.drawio.xml"].map((file) =>
		path.join(folder, file)
	);
	const deckStyles = {
		rectangles: { box: "rounded=1;strokeWidth=3;" },
		wires: { functionality: WIRE },
	};
	return { folder, files, deckStyles, read: (file) => fs.readFileSync(path.join(folder, file), "utf8") };
}

function configOf(folder) {
	return { uri: standIn.vscode.Uri.file(path.join(folder, "sections", "1-a.drawio.xml")) };
}

/** The edit as the extension writes it: the check and the write of the settings, then the files. */
async function write(edit, { folder, files, deckStyles }) {
	const settingsWrite = await slideSettings.plannedStyleSettingsWrite(configOf(folder), edit, rules);
	return useEdits.writeDeckStyleEditWithUses(edit, files, deckStyles, rules, settingsWrite);
}

test("an update writes the style into the settings and the change into every linked wire of the sections and the templates", async () => {
	const given = deck();
	const boxes = given.read("sections/2-b.drawio.xml");
	standIn.resetState({ workspaceFolders: [given.folder] });
	const after = WIRE.replace("endSize=3", "endSize=5");
	const written = await write({ operation: "set", kind: "wires", name: "functionality", style: after }, given);
	assert.deepEqual(written, { operation: "update", name: "functionality", before: WIRE, after });
	const settings = given.read(".vscode/settings.json");
	assert.match(settings, /\/\/ A functionality\.\n\s*"functionality": "[^"]*endSize=5;/);
	assert.match(settings, /\/\/ The styles of the co-design diagrams\./);
	const section = given.read("sections/1-a.drawio.xml");
	assert.match(section, /id="w1"[^>]*endSize=5;[^"]*exitX=1;exitY=0\.5;deckStyle=functionality;/);
	assert.match(section, /id="w2"[^>]*endSize=5;[^"]*fontSize=20;entryX=0;entryY=0\.5;deckStyle=functionality;/);
	assert.match(section, /id="w3"[^>]*endSize=3;/);
	assert.match(given.read("templates/layouts.drawio.xml"), /id="w4"[^>]*endSize=5;/);
	assert.equal(given.read("sections/2-b.drawio.xml"), boxes);
});

test("a removal asks with the count of the linked cells, Cancel changes nothing, and Delete keeps the keys without the link", async () => {
	const given = deck();
	const before = given.read("sections/1-a.drawio.xml");
	const state = standIn.resetState({ workspaceFolders: [given.folder], answers: { warning: [undefined] } });
	assert.equal(await write({ operation: "remove", name: "functionality" }, given), undefined);
	assert.equal(given.read("sections/1-a.drawio.xml"), before);
	const [question] = state.messages;
	assert.match(JSON.stringify(question), /Delete the style functionality\?/);
	assert.match(JSON.stringify(question), /3 wires link to functionality/);

	standIn.resetState({ workspaceFolders: [given.folder], answers: { warning: [useEdits.DELETE_STYLE] } });
	assert.deepEqual(await write({ operation: "remove", name: "functionality" }, given), {
		operation: "remove",
		name: "functionality",
	});
	assert.doesNotMatch(given.read(".vscode/settings.json"), /"functionality"/);
	const section = given.read("sections/1-a.drawio.xml");
	assert.doesNotMatch(section, /deckStyle=functionality/);
	assert.match(section, /id="w1"[^>]*endSize=3;[^"]*exitX=1;exitY=0\.5;"/);
});

test("a rename renames the links and counts them in a message, and a name of the other kind is refused before any write", async () => {
	const given = deck();
	const state = standIn.resetState({ workspaceFolders: [given.folder] });
	await write({ operation: "rename", name: "box", newName: "designProblem" }, given);
	assert.match(given.read(".vscode/settings.json"), /"designProblem": "rounded=1;strokeWidth=3;"/);
	assert.match(given.read("sections/2-b.drawio.xml"), /deckStyle=designProblem;/);
	assert.match(JSON.stringify(state.messages), /The style box is now designProblem, in 1 rectangle of the drawing files of the deck\./);
	const settings = given.read(".vscode/settings.json");
	await assert.rejects(
		write({ operation: "set", kind: "wires", name: "designProblem", style: "dashed=1;" }, given),
		{ name: "RefusedStyleEdit" }
	);
	assert.equal(given.read(".vscode/settings.json"), settings);
});

test("the live settings of the editor list the styles of each kind in the order of the setting, and name each entry left out", () => {
	const { settings, problems } = slideSettings.readLiveSlideSettings(
		{
			colors: { dpgreen: "#008000" },
			listStyles: { bulleted: [], numbered: [] },
			listMarkers: [],
			customColorSchemes: [],
			presetColors: [],
			colorNames: {},
			deckStyles: {
				wires: { functionality: WIRE + "exitX=1;", resource: "dashed=1;" },
				rectangles: { "1box": "rounded=1;" },
			},
		},
		[],
		rules
	);
	assert.deepEqual(settings.styles, {
		rectangles: [],
		wires: [
			{ name: "functionality", style: WIRE },
			{ name: "resource", style: "dashed=1;" },
		],
	});
	assert.deepEqual(problems, [
		'drawSlidesCode.deckStyles.rectangles names a style "1box", which is not letters and digits that start with a letter, so the style is left out.',
	]);
});
