const assert = require("node:assert/strict");
const { test } = require("node:test");
const { loadTsModule } = require("../loadTsModule");
const { folderWith, page, drawing } = require("./deckHelpers");

const links = loadTsModule("deck/deckColorLinks.ts");
const colorFiles = loadTsModule("deck/deckColorFiles.ts");
const assembly = loadTsModule("deck/deckAssembly.ts");

const cell = (id, style, value = "") =>
	`<mxCell id="${id}" parent="1" style="${style}" value="${value}" vertex="1"><mxGeometry width="10" height="10" as="geometry" /></mxCell>`;
const escaped = (html) => html.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const math = 'pageWidth="1920" pageHeight="1080" math="1"';

/** A drawing with a linked fill and line, a linked font, a linked text, an unlinked text and formulas. */
const linkedDrawing = drawing(
	page(
		"a-1",
		cell("box", "rounded=0;fillColor=#B20000;deckFillColor=red;strokeColor=#B20000;deckStrokeColor=red;") +
			cell("label", "text;fontColor=#B20000;deckFontColor=red;") +
			cell(
				"words",
				"text;html=1;",
				escaped('a <span data-deck-color="red" style="color: rgb(178, 0, 0);">red</span> <font data-deck-color="blue" color="#0000FF">blue</font> <span data-deck-color="red">plain</span>')
			) +
			cell("formula", "text;html=1;", "\\(\\textcolor{red}{x} + \\color{red} y + \\colorbox{red}{z} + \\fcolorbox{blue}{red}{w} + \\textcolor{reddish}{v}\\)"),
		math
	)
);

test("a value of a color goes into each linked key and each linked text of the color, and the formulas stay", () => {
	const text = colorFiles.withColorUseEditInDrawing(linkedDrawing, { operation: "set", name: "red", value: "#00AA00" });
	assert.match(text, /style="rounded=0;fillColor=#00AA00;deckFillColor=red;strokeColor=#00AA00;deckStrokeColor=red;"/);
	assert.match(text, /style="text;fontColor=#00AA00;deckFontColor=red;"/);
	assert.match(text, /data-deck-color=&quot;red&quot; style=&quot;color: #00AA00;&quot;/);
	assert.match(text, /&lt;span data-deck-color=&quot;red&quot;&gt;plain/);
	assert.match(text, /&lt;font data-deck-color=&quot;blue&quot; color=&quot;#0000FF&quot;&gt;/);
	assert.match(text, /\\textcolor\{red\}\{x\}/);
});

test("a rename renames the links, the linked texts and the formulas of the color alone", () => {
	const text = colorFiles.withColorUseEditInDrawing(linkedDrawing, { operation: "rename", name: "red", newName: "crimson" });
	assert.match(text, /fillColor=#B20000;deckFillColor=crimson;strokeColor=#B20000;deckStrokeColor=crimson;/);
	assert.match(text, /fontColor=#B20000;deckFontColor=crimson;/);
	assert.match(text, /data-deck-color=&quot;crimson&quot; style=&quot;color: rgb\(178, 0, 0\);&quot;/);
	assert.match(text, /\\textcolor\{crimson\}\{x\} \+ \\color\{crimson\} y \+ \\colorbox\{crimson\}\{z\} \+ \\fcolorbox\{blue\}\{crimson\}\{w\} \+ \\textcolor\{reddish\}\{v\}/);
	assert.match(text, /data-deck-color=&quot;blue&quot;/);
});

test("a removal gives each linked use and each formula the last value and takes the links out", () => {
	const text = colorFiles.withColorUseEditInDrawing(linkedDrawing, { operation: "remove", name: "red", value: "#B20000" });
	assert.match(text, /style="rounded=0;fillColor=#B20000;strokeColor=#B20000;"/);
	assert.match(text, /style="text;fontColor=#B20000;"/);
	assert.match(text, /a &lt;span style=&quot;color: #B20000;&quot;&gt;red&lt;\/span&gt;/);
	assert.match(text, /&lt;span&gt;plain&lt;\/span&gt;/);
	assert.doesNotMatch(text, /deck[A-Z][A-Za-z]*=red|data-deck-color=&quot;red/);
	assert.match(text, /\\textcolor\[RGB\]\{178,0,0\}\{x\} \+ \\color\[RGB\]\{178,0,0\} y \+ \\colorbox\[RGB\]\{178,0,0\}\{z\} \+ \\fcolorbox\{blue\}\[RGB\]\{178,0,0\}\{w\} \+ \\textcolor\{reddish\}\{v\}/);
	assert.match(text, /&lt;font data-deck-color=&quot;blue&quot; color=&quot;#0000FF&quot;&gt;/);
});

test("a removal writes a frame of a framed box with the model of its background", () => {
	const text = colorFiles.withColorUseEditInDrawing(
		drawing(page("a-1", cell("f", "text;", "\\(\\fcolorbox{red}{blue}{a} \\fcolorbox{red}{red}{b}\\)"), math)),
		{ operation: "remove", name: "red", value: "#B20000" }
	);
	assert.match(text, /\\fcolorbox\[RGB\]\{178,0,0\}\[named\]\{blue\}\{a\} \\fcolorbox\[RGB\]\{178,0,0\}\{178,0,0\}\{b\}/);
});

test("a page that defines the color itself keeps the formulas that name it, and its links follow", () => {
	const own = drawing(
		page(
			"a-1",
			'<mxCell id="defs" parent="0" value="Equation colors" />' +
				'<mxCell id="d" parent="defs" value="\\(\\definecolor{red}{RGB}{255,0,0}\\)" vertex="1" />' +
				cell("f", "text;fillColor=#B20000;deckFillColor=red;", "\\(\\textcolor{red}{x}\\)"),
			math
		)
	);
	const removed = colorFiles.withColorUseEditInDrawing(own, { operation: "remove", name: "red", value: "#B20000" });
	assert.match(removed, /\\textcolor\{red\}\{x\}/);
	assert.match(removed, /style="text;fillColor=#B20000;"/);
	const renamed = colorFiles.withColorUseEditInDrawing(own, { operation: "rename", name: "red", newName: "crimson" });
	assert.match(renamed, /\\textcolor\{red\}\{x\}/);
	assert.match(renamed, /deckFillColor=crimson/);
	assert.deepEqual({ ...colorFiles.colorUsesInDrawing(own, "red") }, { shape: 0, line: 0, text: 1, formula: 0 });
});

test("the uses of a color count each linked cell once by its kind, the linked texts with a color and the color arguments of formulas", () => {
	assert.deepEqual({ ...colorFiles.colorUsesInDrawing(linkedDrawing, "red") }, { shape: 1, line: 0, text: 2, formula: 4 });
	assert.deepEqual({ ...colorFiles.colorUsesInDrawing(linkedDrawing, "blue") }, { shape: 0, line: 0, text: 1, formula: 1 });
	assert.deepEqual({ ...colorFiles.colorUsesInDrawing(linkedDrawing, "green") }, { shape: 0, line: 0, text: 0, formula: 0 });
});

test("an edit that touches no use leaves the text as it was", () => {
	assert.equal(colorFiles.withColorUseEditInDrawing(linkedDrawing, { operation: "set", name: "green", value: "#00FF00" }), linkedDrawing);
	assert.equal(colorFiles.withColorUseEditInDrawing(linkedDrawing, { operation: "remove", name: "green", value: "#00FF00" }), linkedDrawing);
});

test("the build draws each linked use in the current value, and names a link to an unknown color", () => {
	const { page: linked, unknown } = links.withLinkedColorValues(
		page("a-1", cell("box", "fillColor=#B20000;deckFillColor=red;strokeColor=#000000;deckStrokeColor=gone;") +
			cell("t", "text;html=1;", escaped('<span data-deck-color="red" style="color: rgb(178, 0, 0);">r</span>'))),
		new Map([["red", "#00AA00"]])
	);
	assert.match(linked, /fillColor=#00AA00;deckFillColor=red;strokeColor=#000000;deckStrokeColor=gone;/);
	assert.match(linked, /style=&quot;color: #00AA00;&quot;/);
	assert.deepEqual([...unknown], ["gone"]);
});

test("the assembly gives the linked uses the colors of the setting and warns of a link to an unknown color", () => {
	const project = folderWith({
		"sections/1-talk.drawio.xml": drawing(page("a-1", cell("box", "fillColor=#B20000;deckFillColor=dpgreen;") + cell("c", "fillColor=#123456;deckFillColor=gone;"))),
	});
	const { slides } = assembly.readDeckSlides(project, assembly.deckOptions(project));
	const assembled = assembly.assembleDeck(slides, {
		project,
		colors: new Map([["dpgreen", "#008000"]]),
		missingCommands: new Map(),
		pictures: new Map(),
	});
	assert.match(assembled.text, /fillColor=#008000;deckFillColor=dpgreen;/);
	assert.match(assembled.text, /fillColor=#123456;deckFillColor=gone;/);
	assert.deepEqual(assembled.warnings, [
		'slide 1, "a-1", links colors to gone, which the setting drawSlidesCode.colors does not define, so they keep the values beside the links',
		'slide 1, "a-1", holds #B20000 beside a link to dpgreen, #008000, and draws #008000',
	]);
});

test("the section files of a deck are its slides folder, or else its multi-page file, as its configuration names them", () => {
	const sections = folderWith({
		"package.json": '{"config": {"slides-dir": "parts"}}',
		"parts/2-b.drawio.xml": drawing(),
		"parts/1-a.drawio.xml": drawing(),
		"parts/notes.txt": "",
	});
	assert.deepEqual(colorFiles.deckSectionFiles(sections).map((file) => file.slice(sections.length + 1)), ["parts/1-a.drawio.xml", "parts/2-b.drawio.xml"]);
	const single = folderWith({ "slides.drawio.xml": drawing() });
	assert.deepEqual(colorFiles.deckSectionFiles(single).map((file) => file.slice(single.length + 1)), ["slides.drawio.xml"]);
	assert.deepEqual(colorFiles.deckSectionFiles(folderWith({ "a.txt": "" })), []);
});

test("a box with a linked fill, gradient, outline and font counts as one shape, and an edge as one line", () => {
	const text = drawing(
		page(
			"a-1",
			cell("box", "fillColor=#B20000;deckFillColor=red;gradientColor=#B20000;deckGradientColor=red;strokeColor=#B20000;deckStrokeColor=red;fontColor=#B20000;deckFontColor=red;") +
				'<mxCell id="e" edge="1" parent="1" style="endArrow=none;strokeColor=#B20000;deckStrokeColor=red;fontColor=#B20000;deckFontColor=red;"><mxGeometry relative="1" as="geometry" /></mxCell>' +
				'<UserObject label="" link="https://example.com" id="u"><mxCell edge="1" parent="1" style="strokeColor=#B20000;deckStrokeColor=red;"><mxGeometry relative="1" as="geometry" /></mxCell></UserObject>'
		)
	);
	assert.deepEqual({ ...colorFiles.colorUsesInDrawing(text, "red") }, { shape: 1, line: 2, text: 0, formula: 0 });
});

test("the forms of a framed box that a removal writes stay readable to a later count, rename, removal and build", () => {
	const framed = drawing(page("a-1", cell("f", "text;html=1;", "\\(\\fcolorbox{red}{blue}{x} + \\color[named]{red} y + \\fcolorbox[named]{red}{blue}{z}\\)"), math));
	const withoutRed = colorFiles.withColorUseEditInDrawing(framed, { operation: "remove", name: "red", value: "#B20000" });
	assert.match(withoutRed, /\\fcolorbox\[RGB\]\{178,0,0\}\[named\]\{blue\}\{x\} \+ \\color\[RGB\]\{178,0,0\} y \+ \\fcolorbox\[RGB\]\{178,0,0\}\[named\]\{blue\}\{z\}/);
	assert.equal(colorFiles.colorUsesInDrawing(withoutRed, "blue").formula, 2);
	const renamed = colorFiles.withColorUseEditInDrawing(withoutRed, { operation: "rename", name: "blue", newName: "navy" });
	assert.match(renamed, /\\fcolorbox\[RGB\]\{178,0,0\}\[named\]\{navy\}\{x\}/);
	const withoutBlue = colorFiles.withColorUseEditInDrawing(withoutRed, { operation: "remove", name: "blue", value: "#0000FF" });
	assert.match(withoutBlue, /\\fcolorbox\[RGB\]\{178,0,0\}\[RGB\]\{0,0,255\}\{x\}/);
	assert.equal(colorFiles.colorUsesInDrawing(withoutBlue, "blue").formula, 0);
	const blueFirst = colorFiles.withColorUseEditInDrawing(framed, { operation: "remove", name: "blue", value: "#0000FF" });
	assert.match(blueFirst, /\\fcolorbox\{red\}\[RGB\]\{0,0,255\}\{x\}/);
	assert.equal(colorFiles.colorUsesInDrawing(blueFirst, "red").formula, 3);
	const pageOf = (text) => text.match(/<diagram[\s\S]*<\/diagram>/)[0];
	assert.deepEqual(assembly.missingDefinitions(pageOf(withoutRed), new Map([["blue", "#1F4E9A"]]), new Map()), {
		definitions: "\\definecolor{blue}{RGB}{31,78,154}",
		unknown: [],
	});
	const accent = pageOf(drawing(page("a-1", cell("f", "text;html=1;", "\\(\\fcolorbox[RGB]{178,0,0}[named]{accent}{x}\\)"), math)));
	assert.deepEqual(assembly.missingDefinitions(accent, new Map(), new Map()).unknown, ["accent"]);
});

test("the edits and the counts read the formulas alone, between the delimiters that MathJax reads", () => {
	const label = "Type \\textcolor{red}{x} to color x, \\[\\textcolor{red}{a}\\] and \\begin{align}\\color{red} b\\end{align} and $$\\colorbox{red}{c}$$ and \\(\\textcolor{ red }{d}\\)";
	const text = drawing(page("a-1", cell("f", "text;html=1;", label), math));
	assert.equal(colorFiles.colorUsesInDrawing(text, "red").formula, 3);
	const removed = colorFiles.withColorUseEditInDrawing(text, { operation: "remove", name: "red", value: "#B20000" });
	assert.ok(removed.includes(
		"Type \\textcolor{red}{x} to color x, \\[\\textcolor[RGB]{178,0,0}{a}\\] and \\begin{align}\\color[RGB]{178,0,0} b\\end{align} and $$\\colorbox[RGB]{178,0,0}{c}$$ and \\(\\textcolor{ red }{d}\\)"
	));
});

test("the assembly warns of a formula in display brackets or an environment on a page with mathematical typesetting off", () => {
	for (const label of ["\\[x^2\\]", "\\begin{align}x\\end{align}"]) {
		const project = folderWith({ "sections/1-talk.drawio.xml": drawing(page("a-1", cell("f", "text;html=1;", label))) });
		const { slides } = assembly.readDeckSlides(project, assembly.deckOptions(project));
		const { warnings } = assembly.assembleDeck(slides, { project, colors: new Map(), missingCommands: new Map(), pictures: new Map() });
		assert.deepEqual(warnings, [
			'slide 1, "a-1", holds a formula and has mathematical typesetting off, so the formula shows as raw text. Switch on Extras > Mathematical Typesetting on that page.',
		]);
	}
});

test("the build warns of a value beside a link that differs from its color, written as a hex value or in rgb()", () => {
	const { differing } = links.withLinkedColorValues(
		page(
			"a-1",
			cell("same", "fillColor=#b20000;deckFillColor=red;") +
				cell("other", "fillColor=#00AA00;deckFillColor=red;") +
				cell("t", "text;html=1;", escaped('<span data-deck-color="red" style="color: rgb(178, 0, 0);">r</span><span data-deck-color="red" style="color: rgb(0, 0, 255);">b</span>'))
		),
		new Map([["red", "#B20000"]])
	);
	assert.deepEqual(differing, [
		{ written: "#00AA00", name: "red", value: "#B20000" },
		{ written: "rgb(0, 0, 255)", name: "red", value: "#B20000" },
	]);
});
