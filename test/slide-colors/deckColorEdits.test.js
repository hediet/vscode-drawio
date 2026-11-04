const assert = require("node:assert/strict");
const { test } = require("node:test");
const { loadTsModule } = require("../loadTsModule");

const edits = loadTsModule("DrawioClient/deckColorEdits.ts");

const settings = `{
  "drawioSlides.slides": true,
  "drawioSlides.colors": {
    // The colors of the deck.

    // Text.
    "black": "#000000",
    // The color of the markers of the lists.
    "accent": "#004D80",
    "panel": "#EEF0F2"
  },
  "drawioSlides.listStyles": {
    "bulleted": [
      { "indent": "26px", "marker": "disc", "color": "accent" },
      { "indent": "44px", "marker": "'-  '", "color": "black" }
    ]
  },
  // The swatches.
  "drawioSlides.customColorSchemes": [
    [{ "fill": "accent", "stroke": "accent", "font": "panel" }],
    [{ "fill": "none", "stroke": "black", "font": "accent" }]
  ]
}
`;

const commentLines = (text) => text.split("\n").filter((line) => line.trim().startsWith("//"));

test("set gives an existing color a new value in its place", () => {
	const text = edits.withColorEditInSettings(settings, { operation: "set", name: "accent", value: "#FF0000" });
	assert.equal(text, settings.replace('"accent": "#004D80"', '"accent": "#FF0000"'));
});

test("set adds a new color after the last one", () => {
	const text = edits.withColorEditInSettings(settings, { operation: "set", name: "color1", value: "#123456" });
	assert.match(text, /"panel": "#EEF0F2",\n    "color1": "#123456"\n  \}/);
	assert.deepEqual(commentLines(text), commentLines(settings));
});

test("set adds the setting to a file without it", () => {
	const text = edits.withColorEditInSettings('{\n\t// Other settings.\n\t"a": 1\n}\n', { operation: "set", name: "accent", value: "#004D80" });
	assert.equal(text, '{\n\t// Other settings.\n\t"a": 1,\n\t"drawioSlides.colors": {\n\t\t"accent": "#004D80"\n\t}\n}\n');
});

test("remove takes the color out and keeps every comment", () => {
	const text = edits.withColorEditInSettings(settings, { operation: "remove", name: "black" });
	assert.doesNotMatch(text, /"black": "#000000"/);
	assert.deepEqual(commentLines(text), commentLines(settings));
	assert.deepEqual(Object.keys(JSON.parse(stripComments(text))["drawioSlides.colors"]), ["accent", "panel"]);
});

test("remove of the last color takes the comma before it", () => {
	const text = edits.withColorEditInSettings(settings, { operation: "remove", name: "panel" });
	assert.match(text, /"accent": "#004D80"\n  \},/);
	assert.deepEqual(commentLines(text), commentLines(settings));
});

test("remove of the one color leaves an empty object", () => {
	const text = edits.withColorEditInSettings('{\n  "drawioSlides.colors": {\n    // Only.\n    "x": "#000000"\n  }\n}\n', { operation: "remove", name: "x" });
	assert.equal(text, '{\n  "drawioSlides.colors": {\n    // Only.\n  }\n}\n');
});

test("rename renames the color in its place and where the list styles and the swatches name it", () => {
	const text = edits.withColorEditInSettings(settings, { operation: "rename", name: "accent", newName: "brand" });
	const value = JSON.parse(stripComments(text));
	assert.deepEqual(Object.keys(value["drawioSlides.colors"]), ["black", "brand", "panel"]);
	assert.equal(value["drawioSlides.colors"].brand, "#004D80");
	assert.equal(value["drawioSlides.listStyles"].bulleted[0].color, "brand");
	assert.equal(value["drawioSlides.listStyles"].bulleted[1].color, "black");
	assert.deepEqual(value["drawioSlides.customColorSchemes"], [
		[{ fill: "brand", stroke: "brand", font: "panel" }],
		[{ fill: "none", stroke: "black", font: "brand" }],
	]);
	assert.deepEqual(commentLines(text), commentLines(settings));
	assert.equal(text.split("\n").length, settings.split("\n").length);
});

test("rename to the same name leaves the text as it is", () => {
	assert.equal(edits.withColorEditInSettings(settings, { operation: "rename", name: "accent", newName: "accent" }), settings);
});

for (const [edit, reason] of [
	[{ operation: "rename", name: "accent", newName: "black" }, /already defines a color black/],
	[{ operation: "rename", name: "accent", newName: "dp-red" }, /"dp-red" is not letters and digits/],
	[{ operation: "rename", name: "accent", newName: "1st" }, /"1st" is not letters and digits/],
	[{ operation: "set", name: "accent", value: "#04D80" }, /"#04D80" of accent is not # and six hexadecimal digits/],
	[{ operation: "set", name: "accent", value: "red" }, /"red" of accent is not #/],
	[{ operation: "set", name: "dp red", value: "#000000" }, /"dp red" is not letters and digits/],
	[{ operation: "remove", name: "gray" }, /defines no color "gray"/],
	[{ operation: "rename", name: "gray", newName: "grey" }, /defines no color "gray"/],
	[{ operation: "recolor", name: "accent" }, /operation "recolor"/],
]) {
	test(`refuses ${JSON.stringify(edit)}`, () => {
		assert.throws(() => edits.withColorEditInSettings(settings, edit), (error) => error.name === "RefusedColorEdit" && reason.test(error.message));
		assert.throws(() => edits.withColorEdit({ black: "#000000", accent: "#004D80" }, edit), reason);
	});
}

test("refuses a file that does not read as JSON with comments", () => {
	assert.throws(() => edits.withColorEditInSettings('{ "a": 1, }}', { operation: "remove", name: "a" }), /does not read as JSON with comments/);
});

test("withColorEdit keeps the order of the setting", () => {
	const colors = { black: "#000000", accent: "#004D80", panel: "#EEF0F2" };
	assert.deepEqual(Object.entries(edits.withColorEdit(colors, { operation: "rename", name: "accent", newName: "brand" })), [
		["black", "#000000"], ["brand", "#004D80"], ["panel", "#EEF0F2"],
	]);
	assert.deepEqual(Object.keys(edits.withColorEdit(colors, { operation: "set", name: "color1", value: "#123456" })), ["black", "accent", "panel", "color1"]);
	assert.deepEqual(Object.keys(edits.withColorEdit(colors, { operation: "remove", name: "black" })), ["accent", "panel"]);
	assert.deepEqual(colors, { black: "#000000", accent: "#004D80", panel: "#EEF0F2" });
});

test("a name of the prototype of an object is a name like any other", () => {
	assert.deepEqual(Object.entries(edits.withColorEdit({ black: "#000000" }, { operation: "set", name: "constructor", value: "#123456" })), [["black", "#000000"], ["constructor", "#123456"]]);
	assert.throws(() => edits.withColorEdit({ black: "#000000" }, { operation: "remove", name: "toString" }), /defines no color "toString"/);
});

test("hasColorsMember tells a file with the setting from one without it", () => {
	assert.equal(edits.hasColorsMember(settings), true);
	assert.equal(edits.hasColorsMember('{ "drawioSlides.slides": true }'), false);
	assert.equal(edits.hasColorsMember(""), false);
});

test("countLabelsNamingColor counts the labels whose formulas name the color", () => {
	const xml = '<mxfile><diagram name="p-1"><mxGraphModel><root>' +
		'<mxCell id="a" value="\\(\\textcolor{accent}{x} + \\color{accent} y\\)" vertex="1"/>' +
		'<mxCell id="b" value="\\(\\colorbox{accent}{z}\\)" vertex="1"/>' +
		'<object id="c" label="\\(\\fcolorbox{black}{accent}{w}\\)"><mxCell vertex="1"/></object>' +
		'<mxCell id="d" value="\\(\\textcolor{accentlight}{x}\\) accent" vertex="1"/>' +
		'</root></mxGraphModel></diagram></mxfile>';
	assert.equal(edits.countLabelsNamingColor(xml, "accent"), 3);
	assert.equal(edits.countLabelsNamingColor(xml, "black"), 1);
	assert.equal(edits.countLabelsNamingColor(xml, "panel"), 0);
});

function stripComments(text) {
	return text.replace(/^\s*\/\/.*$/gm, "");
}
