const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { loadTsModule } = require("../loadTsModule");
const { folderWith, page, drawing } = require("./deckHelpers");

const assembly = loadTsModule("deck/deckAssembly.ts");
const files = loadTsModule("deck/deckFiles.ts");

const plain = (value) => JSON.parse(JSON.stringify(value));
const label = (id, text) =>
	`<mxCell id="${id}" parent="1" value="${text}" vertex="1"><mxGeometry width="10" height="10" as="geometry" /></mxCell>`;
const math = 'pageWidth="1280.5" pageHeight="720" math="1"';

function deckWith(sections, extra = {}) {
	return folderWith({
		...Object.fromEntries(
			Object.entries(sections).map(([name, pages]) => [
				`sections/${name}`,
				drawing(...pages),
			])
		),
		...extra,
	});
}

const inputs = (project, overrides = {}) => ({
	project,
	colors: new Map([["dpgreen", "#008000"]]),
	missingCommands: new Map([["fatsemi", "\\mathbin{\\unicode{x2A1F}}"]]),
	pictures: new Map(),
	...overrides,
});

test("the slide number and the total fill in, and a backup slide shows the total with the backup slides", () => {
	const project = deckWith({
		"1-talk.drawio.xml": [
			page("a-1", label("n", "%slide%/%slides%")),
			page("a-2", label("n", "%slide%/%slides%")),
			page("b-1-hide"),
		],
		"2-backup-slides.drawio.xml": [
			page("c-1", label("n", "%slide%/%slides%")),
		],
	});
	const { slides, source, hidden } = assembly.readDeckSlides(
		project,
		assembly.deckOptions(project)
	);
	assert.equal(source, "sections");
	assert.equal(assembly.hiddenLine(hidden), "1 page hidden: b-1-hide");
	const assembled = assembly.assembleDeck(slides, inputs(project));
	assert.deepEqual(
		[...assembled.text.matchAll(/value="([^"]*)"/g)].map(
			(match) => match[1]
		),
		["1/1", "1/1", "2/1-2"]
	);
	assert.ok(
		assembled.text.startsWith(
			'<mxfile host="Draw.io Slides" pages="3">\n  <diagram id="a-1"'
		)
	);
	assert.ok(assembled.text.endsWith("</diagram>\n</mxfile>\n"));
	assert.deepEqual(plain(assembled.pages[0]), {
		name: "a-1",
		width: 1920,
		height: 1080,
	});
	assert.equal(assembled.total, 1);
});

test("a page with formulas gets the definitions it lacks in a layer of its own before its other layers", () => {
	const project = deckWith({
		"1-a.drawio.xml": [
			page(
				"x-1",
				label(
					"f",
					"\\(\\textcolor{dpgreen}{F} \\fatsemi \\color{nosuch}{G} \\color{red}{H}\\)"
				) +
					'<mxCell id="defs" parent="0" value="Equation colors" />' +
					label("own", "\\definecolor{other}{HTML}{000000}").replace(
						'parent="1"',
						'parent="defs"'
					) +
					label("g", "\\textcolor{other}{y}"),
				math
			),
		],
	});
	const { slides } = assembly.readDeckSlides(
		project,
		assembly.deckOptions(project)
	);
	const assembled = assembly.assembleDeck(slides, inputs(project));
	assert.ok(
		assembled.text.includes(
			'<mxCell id="0" /><mxCell id="page-1-build-definitions" parent="0" style="locked=1;" value="Equation colors, added by the build" />' +
				'<mxCell id="page-1-build-definitions-label" parent="page-1-build-definitions" style="text;html=1;strokeColor=none;fillColor=none;align=left;verticalAlign=top;whiteSpace=nowrap;overflow=visible;fontSize=1;" ' +
				'value="\\(\\definecolor{dpgreen}{RGB}{0,128,0}\\def\\fatsemi{\\mathbin{\\unicode{x2A1F}}}\\)" vertex="1">'
		)
	);
	assert.deepEqual(plain(assembled.pages[0]), {
		name: "x-1",
		width: 1280,
		height: 720,
	});
	assert.deepEqual(plain(assembled.warnings), [
		'slide 1, "x-1", colors formulas with nosuch, which neither the page nor the setting drawioSlides.colors defines',
	]);
});

test("a formula on a page without mathematical typesetting and a missing picture are warned of", () => {
	const project = deckWith({
		"1-a.drawio.xml": [
			page("x-1", label("f", "$$x$$")),
			page(
				"x-1",
				'<mxCell id="p" parent="1" style="image=assets/gone.png" vertex="1" />'
			),
			page("y-3"),
		],
	});
	const { slides } = assembly.readDeckSlides(
		project,
		assembly.deckOptions(project)
	);
	assert.deepEqual(
		plain(assembly.assembleDeck(slides, inputs(project)).warnings),
		[
			'slide 1, "x", has the steps 1, 1 in page order, where 1 to 2 was expected',
			'slide 2, "y", has the steps 3 in page order, where 1 to 1 was expected',
			'slide 1, "x-1", holds a formula and has mathematical typesetting off, so the formula shows as raw text. Switch on Extras > Mathematical Typesetting on that page.',
			'slide 1, "x-1", names the picture assets/gone.png, which does not exist',
		]
	);
});

test("a deck without its slides is refused, and a deck of one file is read as one section", () => {
	assert.throws(
		() =>
			assembly.readDeckSlides(
				folderWith({}),
				assembly.deckOptions(folderWith({}))
			),
		/holds neither sections\/ nor slides.drawio.xml/
	);
	const single = folderWith({
		"talk.drawio.xml": drawing(page("a-1"), page("b-1")),
		"package.json": JSON.stringify({
			config: { deck: "talk.drawio.xml", title: "Talk" },
		}),
	});
	const options = assembly.deckOptions(single);
	assert.deepEqual(plain(options), {
		title: "Talk",
		slidesDir: "sections",
		deck: "talk.drawio.xml",
	});
	const { slides, source } = assembly.readDeckSlides(single, options);
	assert.equal(source, "talk.drawio.xml");
	assert.equal(slides.length, 2);
	assert.throws(
		() => assembly.assembleDeck([], inputs(single)),
		/holds no pages/
	);
});

test("the outline counts the pages and lists each slide with its number as the deck shows it", () => {
	const project = deckWith({
		"1-opening.drawio.xml": [
			page("title-slide-1"),
			page("partial-orders-1"),
			page("partial-orders-2"),
		],
		"2-backup-slides.drawio.xml": [page("section-backup-1")],
	});
	const { slides } = assembly.readDeckSlides(
		project,
		assembly.deckOptions(project)
	);
	const sections = files.deckOutline(slides);
	assert.equal(
		assembly.countLine(sections, "sections"),
		"4 pages assembled from sections: 2 slides on 3 pages, and 1 backup slides on 1 pages"
	);
	assert.deepEqual(assembly.outlineLines(sections, 2), [
		"1 Opening, pages 1-3",
		"  1/2       title-slide                                      page 1",
		"  2/2       partial-orders                                   pages 2-3, 2 steps",
		"2 Backup slides (backup), pages 4-4",
		"  3/2-3     section-backup                                   page 4",
	]);
	assert.deepEqual(plain(assembly.pdfOutline(sections)), [
		{ level: 1, page: 1, title: "1 Opening" },
		{ level: 2, page: 1, title: "1 Title slide" },
		{ level: 2, page: 2, title: "2 Partial orders" },
		{ level: 3, page: 2, title: "Step 1, page 2" },
		{ level: 3, page: 3, title: "Step 2, page 3" },
		{ level: 1, page: 4, title: "2 Backup slides" },
		{ level: 2, page: 4, title: "3 Section backup" },
	]);
	assert.ok(
		assembly
			.pdfOutlineText(sections)
			.startsWith('[\n {\n  "level": 1,\n  "page": 1,')
	);
});

test("the assembly writes the assembled deck and the outline into build/", () => {
	const project = deckWith({ "1-a.drawio.xml": [page("a-1")] });
	const { slides } = assembly.readDeckSlides(
		project,
		assembly.deckOptions(project)
	);
	const written = assembly.writeAssembly(slides, inputs(project));
	assert.equal(
		written.file,
		path.join(project, "build", "assembled.drawio.xml")
	);
	assert.equal(fs.readFileSync(written.file, "utf8"), written.assembled.text);
	assert.equal(
		JSON.parse(fs.readFileSync(written.outlineFile, "utf8")).length,
		2
	);
});
