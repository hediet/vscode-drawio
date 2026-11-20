const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const { loadTsModule } = require("../loadTsModule");
const { extensionRoot, page, drawing } = require("./deckHelpers");

const styles = loadTsModule("deck/deckStyles.ts");
const rules = styles.loadDeckStyleRules(
	path.join(extensionRoot, "drawio-custom-plugins", "slides", "deck-style-rules.js")
);

// A functionality wire and a resource wire of a co-design diagram, each with its keys of geometry.
const FONT =
	"labelBackgroundColor=none;fontSize=34;fontColor=#000000;fontFamily=STIX Two Text;";
const FUNCTIONALITY_GEOMETRY =
	"exitX=0;exitY=0.5;exitDx=0;exitDy=0;exitPerimeter=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;entryPerimeter=0;";
const FUNCTIONALITY_WIRE =
	"edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;html=1;strokeColor=#008000;deckStrokeColor=dpgreen;strokeWidth=3;startArrow=none;endArrow=circle;endFill=1;endSize=3;" +
	FONT +
	FUNCTIONALITY_GEOMETRY +
	"targetPerimeterSpacing=-1.5;fixedPointSpacing=1;";
const RESOURCE_GEOMETRY =
	"exitX=1.0000;exitY=0.1226;exitDx=0;exitDy=0;exitPerimeter=0;entryX=0.000;entryY=0.690;entryDx=0;entryDy=0;entryPerimeter=0;";
const RESOURCE_WIRE =
	"edgeStyle=none;html=1;rounded=0;strokeColor=#B30000;strokeWidth=3;dashed=1;dashPattern=1 1.5;startArrow=circle;startFill=1;startSize=3;endArrow=none;" +
	RESOURCE_GEOMETRY +
	"deckStrokeColor=dpred;sourcePerimeterSpacing=-1.5;fixedPointSpacing=1;";

const GEOMETRY_KEYS = /(?:^|;)((?:exit|entry)(?:X|Y|Dx|Dy|Perimeter)=[^;]*)/g;
const geometryOf = (style) =>
	[...style.matchAll(GEOMETRY_KEYS)].map(([, entry]) => entry);
const valuesOf = (style) =>
	Object.fromEntries(
		style
			.split(";")
			.filter((part) => part.includes("="))
			.map((part) => [part.slice(0, part.indexOf("=")), part.slice(part.indexOf("=") + 1)])
	);

test("a style saved from a wire holds its keys of appearance and its links to colors, and no key of geometry", () => {
	const saved = rules.appearanceOf(FUNCTIONALITY_WIRE + "rotation=0;deckStyle=old;");
	assert.deepEqual(geometryOf(saved), []);
	assert.equal(valuesOf(saved).deckStrokeColor, "dpgreen");
	assert.equal(valuesOf(saved).targetPerimeterSpacing, "-1.5");
	assert.equal(valuesOf(saved).fixedPointSpacing, "1");
	assert.equal(valuesOf(saved).rotation, undefined);
	assert.equal(valuesOf(saved).deckStyle, undefined);
});

test("a wire given the style of the other kind of wire keeps its geometry, loses the spacing of its old dot and links to the style", () => {
	const functionality = rules.appearanceOf(FUNCTIONALITY_WIRE);
	const given = rules.given(RESOURCE_WIRE, "functionalityWire", functionality);
	assert.deepEqual(geometryOf(given), geometryOf(RESOURCE_WIRE));
	const values = valuesOf(given);
	assert.equal(values.sourcePerimeterSpacing, undefined);
	assert.equal(values.targetPerimeterSpacing, "-1.5");
	assert.equal(values.dashed, undefined);
	assert.equal(values.endArrow, "circle");
	assert.equal(values.deckStrokeColor, "dpgreen");
	assert.equal(values.deckStyle, "functionalityWire");
	assert.deepEqual(rules.differingKeys(given, functionality), []);
});

test("an update of the size of the dot reaches each linked wire and keeps its geometry and its own font size", () => {
	const before = rules.appearanceOf(FUNCTIONALITY_WIRE);
	const after = before.replace("endSize=3", "endSize=5");
	const linked = rules.given(FUNCTIONALITY_WIRE, "functionalityWire", before);
	const smaller = linked.replace("fontSize=34", "fontSize=20");
	assert.deepEqual(rules.differingKeys(smaller, before), ["fontSize"]);
	const updated = rules.updated(smaller, before, after);
	assert.equal(valuesOf(updated).endSize, "5");
	assert.equal(valuesOf(updated).fontSize, "20");
	assert.equal(valuesOf(updated).targetPerimeterSpacing, "-1.5");
	assert.deepEqual(geometryOf(updated), geometryOf(FUNCTIONALITY_WIRE));
	assert.equal(rules.updated(updated, before, after), updated);
});

test("a key beside a link to a color counts as the style's while both link to the same color", () => {
	const style = rules.appearanceOf(FUNCTIONALITY_WIRE);
	const stale = rules
		.given(FUNCTIONALITY_WIRE, "functionalityWire", style)
		.replace("strokeColor=#008000", "strokeColor=#00AA00");
	assert.deepEqual(rules.differingKeys(stale, style), []);
	const recolored = style
		.replace("strokeColor=#008000", "strokeColor=#B30000")
		.replace("deckStrokeColor=dpgreen", "deckStrokeColor=dpred");
	const values = valuesOf(rules.updated(stale, style, recolored));
	assert.equal(values.strokeColor, "#B30000");
	assert.equal(values.deckStrokeColor, "dpred");
});

test("a rectangle is a vertex without a shape or with the shape rect, and an edge is a wire", () => {
	assert.equal(rules.kindOf("rounded=1;whiteSpace=wrap;html=1;", false), "rectangles");
	assert.equal(rules.kindOf("shape=rect;", false), "rectangles");
	assert.equal(rules.kindOf("ellipse;whiteSpace=wrap;", false), null);
	assert.equal(rules.kindOf("text;html=1;", false), null);
	assert.equal(rules.kindOf("shape=image;", false), null);
	assert.equal(rules.kindOf("text;html=1;", true), "wires");
});

test("an edit of a page reaches the cells linked to the style alone, with the style escaped as draw.io writes it", () => {
	const before = rules.appearanceOf(FUNCTIONALITY_WIRE);
	const after = before.replace("endSize=3", "endSize=5");
	const linked = rules.given(FUNCTIONALITY_WIRE, "functionalityWire", before);
	const escaped = (style) => style.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
	const text = drawing(
		page(
			"one",
			`<mxCell id="a" edge="1" parent="1" source="s" target="t" style="${escaped(linked)}"><mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="1" y="2"/></Array></mxGeometry></mxCell>` +
				`<mxCell id="b" edge="1" parent="1" style="${escaped(FUNCTIONALITY_WIRE)}"><mxGeometry relative="1" as="geometry"/></mxCell>` +
				`<mxCell id="c" vertex="1" parent="1" style="rounded=1;deckStyle=box;"><mxGeometry width="10" height="10" as="geometry"/></mxCell>`
		)
	);
	const edited = styles.withStyleUseEditsInDrawing(
		text,
		[{ operation: "update", name: "functionalityWire", before, after }],
		rules
	);
	assert.equal(edited, text.replace(escaped(linked), escaped(rules.updated(linked, before, after))));
	assert.match(edited, /source="s" target="t"/);
	assert.match(edited, /<mxPoint x="1" y="2"\/>/);
	assert.deepEqual(styles.styleUsesInDrawing(edited, "functionalityWire"), {
		rectangles: 0,
		wires: 1,
	});
	assert.deepEqual(styles.styleUsesInDrawing(edited, "box"), { rectangles: 1, wires: 0 });
	const renamed = styles.withStyleUseEditsInDrawing(
		edited,
		[{ operation: "rename", name: "box", newName: "container" }],
		rules
	);
	assert.match(renamed, /style="rounded=1;deckStyle=container;"/);
	const removed = styles.withStyleUseEditsInDrawing(
		renamed,
		[{ operation: "remove", name: "container" }],
		rules
	);
	assert.match(removed, /style="rounded=1;"/);
	assert.deepEqual(
		styles.unknownStyleLinks(renamed, { rectangles: {}, wires: { functionalityWire: before } }),
		["container"]
	);
});

test("the setting gives each kind its styles, and names each entry that it leaves out", () => {
	const { styles: read, problems } = styles.readDeckStyles(
		{
			rectangles: { box: "rounded=1;exitX=0;", "2bad": "x=1;" },
			wires: { box: "dashed=1;", wire: 3 },
			ellipses: {},
		},
		rules
	);
	assert.deepEqual(read, { rectangles: { box: "rounded=1;" }, wires: {} });
	assert.equal(problems.length, 4);
});
