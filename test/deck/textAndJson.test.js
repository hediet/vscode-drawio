const assert = require("node:assert/strict");
const { test } = require("node:test");
const { loadTsModule } = require("../loadTsModule");

const text = loadTsModule("deck/textFormats.ts");
const json = loadTsModule("deck/jsonWithComments.ts");

test("references of XML read as characters, and the five special characters write as references", () => {
	assert.equal(
		text.unescapeHtml("a &amp;b&lt;&#x41;&#66;&nbsp;&unknown;"),
		"a &b<AB &unknown;"
	);
	assert.equal(
		text.escapeHtml(`<a href="x">'&'</a>`),
		"&lt;a href=&quot;x&quot;&gt;&#x27;&amp;&#x27;&lt;/a&gt;"
	);
});

test("the lines of a text leave out the empty line after the last break", () => {
	assert.deepEqual(text.splitLines("a\r\nb\rc\n"), ["a", "b", "c"]);
	assert.deepEqual(text.splitLines("a\n\nb"), ["a", "", "b"]);
	assert.deepEqual(text.splitLines(""), []);
});

test("JSON keeps the order of a map, escapes what is not printable ASCII, and spaces its separators", () => {
	const value = {
		b: [1, "é"],
		a: new Map([
			["999999", 1],
			["000000", 2],
		]),
		none: {},
	};
	assert.equal(
		text.jsonText(value),
		'{"b": [1, "\\u00e9"], "a": {"999999": 1, "000000": 2}, "none": {}}'
	);
	assert.equal(
		text.jsonText({ a: [1, 2], b: [] }, 1),
		'{\n "a": [\n  1,\n  2\n ],\n "b": []\n}'
	);
	assert.equal(text.jsonText("\u007f"), '"\\u007f"');
});

test("a half rounds to the even neighbour", () => {
	assert.deepEqual(
		[0.5, 1.5, 2.5, 76.5, 76.6, 2.4999].map(text.roundHalfToEven),
		[0, 2, 2, 76, 77, 2]
	);
});

test("a number prints in fixed notation from 1e-4 to below 1e16, and as an exponent otherwise", () => {
	assert.deepEqual(
		[
			960, 0.0001, 0.00001, 1e16, 123456789012345.6, 2.5, 1e-7, 5e22, -3,
		].map(text.floatText),
		[
			"960.0",
			"0.0001",
			"1e-05",
			"1e+16",
			"123456789012345.6",
			"2.5",
			"1e-07",
			"5e+22",
			"-3.0",
		]
	);
});

const settings = `{
  // The editor.
  "drawioSlides.slides": true,
  "drawioSlides.colors": {
    // The text.

    "black": "#000000", // the darkest
    /* The panels,
       light first. */
    "panel": "#EEF0F2",
    // After the last.
  },
}
`;

test("a commented object keeps its comments, its blank lines and its trailing comments", () => {
	const span = json.objectLayout(settings).values.get("drawioSlides.colors");
	const colors = json.readCommentedObject(settings, span[0], span[1]);
	assert.deepEqual(JSON.parse(JSON.stringify(colors)), {
		members: [
			{
				key: "black",
				value: "#000000",
				comments: ["The text.", null],
				trailing: "the darkest",
			},
			{
				key: "panel",
				value: "#EEF0F2",
				comments: ["The panels,", "light first."],
			},
		],
		closingComments: ["After the last."],
	});
});

test("a member object replaces the value of its key and keeps every other comment", () => {
	const written = json.withMemberObject(settings, "drawioSlides.colors", {
		members: [
			{
				key: "accent",
				value: "#004D80",
				comments: ["the markers", null, ""],
			},
		],
		closingComments: [],
	});
	assert.equal(
		written,
		`{
  // The editor.
  "drawioSlides.slides": true,
  "drawioSlides.colors": {
    // the markers

    //
    "accent": "#004D80"
  },
}
`
	);
});

test("a member object goes last after a comma, or into an empty object", () => {
	const colors = {
		members: [{ key: "a", value: "#000000", comments: [] }],
		closingComments: [],
	};
	assert.equal(
		json.withMemberObject('{\n  "x": 1 // one\n}\n', "c", colors),
		'{\n  "x": 1, // one\n  "c": {\n    "a": "#000000"\n  }\n}\n'
	);
	assert.equal(
		json.withMemberObject("{\n}\n", "c", colors),
		'{\n  "c": {\n    "a": "#000000"\n  }\n}\n'
	);
	assert.equal(
		json.withMemberObject("{ // nothing yet\n}", "c", colors),
		'{\n  "c": {\n    "a": "#000000"\n  } // nothing yet\n}'
	);
});

test("comments and trailing commas become spaces, so the plain JSON keeps the places", () => {
	const plain = json.withoutComments(settings);
	assert.equal(plain.length, settings.length);
	assert.equal(JSON.parse(plain)["drawioSlides.slides"], true);
});

test("a text that is no object of JSON with comments is refused with the place of the fault", () => {
	assert.throws(() => json.objectLayout("[1]"), /holds no object/);
	assert.throws(
		() => json.objectLayout('{"a": "b\n"}'),
		/does not end on its line/
	);
	assert.throws(() => json.objectLayout('{"a": {'), /does not end/);
});
