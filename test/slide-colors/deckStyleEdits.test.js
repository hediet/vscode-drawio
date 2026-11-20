const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const { loadTsModule } = require("../loadTsModule");

const edits = loadTsModule("DrawioClient/deckStyleEdits.ts");
const colorEdits = loadTsModule("DrawioClient/deckColorEdits.ts");
const styles = loadTsModule("deck/deckStyles.ts");
const rules = styles.loadDeckStyleRules(
	path.resolve(__dirname, "../../drawio-custom-plugins/slides/deck-style-rules.js")
);

const settings = `{
  "drawSlidesCode.colors": {
    "dpgreen": "#008000"
  },
  // The styles of the co-design diagrams.
  "drawSlidesCode.deckStyles": {
    "rectangle": {
      // A design problem.
      "box": "rounded=1;strokeWidth=3;"
    },
    "wire": {
      "functionalityWire": "strokeColor=#008000;deckStrokeColor=dpgreen;endArrow=circle;endSize=3;"
    }
  }
}
`;

test("a new style goes into its kind with its keys of appearance alone, and the comments stay", () => {
	const edited = edits.withStyleEditInSettings(
		settings,
		{
			operation: "set",
			kind: "rectangle",
			name: "container",
			style: "rounded=1;fillColor=none;exitX=0;rotation=90;deckStyle=box;",
		},
		rules
	);
	assert.match(edited, /\/\/ A design problem\./);
	assert.match(edited, /"container": "rounded=1;fillColor=none;"/);
});

test("a new style string of a style that exists updates its cells from the old string", () => {
	const known = {
		wire: { functionalityWire: "endSize=3;" },
	};
	assert.deepEqual(
		edits.styleUseEditOf(
			{ operation: "set", kind: "wire", name: "functionalityWire", style: "endSize=5;" },
			known
		),
		{ operation: "update", name: "functionalityWire", before: "endSize=3;", after: "endSize=5;" }
	);
	assert.equal(
		edits.styleUseEditOf({ operation: "set", kind: "wire", name: "other", style: "x=1;" }, known),
		undefined
	);
});

test("a rename and a removal keep the other styles and the comments, and a name taken or of another kind is refused", () => {
	const renamed = edits.withStyleEditInSettings(
		settings,
		{ operation: "rename", name: "box", newName: "designProblem" },
		rules
	);
	assert.match(renamed, /\/\/ A design problem\.\n\s*"designProblem": "rounded=1;strokeWidth=3;"/);
	const removed = edits.withStyleEditInSettings(settings, { operation: "remove", name: "box" }, rules);
	assert.doesNotMatch(removed, /"box"/);
	assert.doesNotMatch(removed, /"rectangle"/);
	assert.match(removed, /"drawSlidesCode.deckStyles": \{\s*"wire": \{/);
	assert.match(removed, /"functionalityWire"/);
	assert.throws(
		() =>
			edits.withStyleEditInSettings(
				settings,
				{ operation: "rename", name: "box", newName: "functionalityWire" },
				rules
			),
		{ name: "RefusedStyleEdit" }
	);
	assert.throws(
		() =>
			edits.withStyleEditInSettings(
				settings,
				{ operation: "set", kind: "wire", name: "box", style: "x=1;" },
				rules
			),
		{ name: "RefusedStyleEdit" }
	);
});

test("a rename and a removal of a color reach the styles that link to it", () => {
	const renamed = colorEdits.withColorEditInSettings(settings, {
		operation: "rename",
		name: "dpgreen",
		newName: "functionality",
	});
	assert.match(renamed, /deckStrokeColor=functionality;/);
	const recolored = colorEdits.withColorEditInSettings(settings, {
		operation: "set",
		name: "dpgreen",
		value: "#00AA00",
	});
	assert.match(recolored, /"strokeColor=#00AA00;deckStrokeColor=dpgreen;/);
	const removed = colorEdits.withColorEditInSettings(settings, {
		operation: "remove",
		name: "dpgreen",
	});
	assert.match(removed, /"functionalityWire": "strokeColor=#008000;endArrow=circle;endSize=3;"/);
});
