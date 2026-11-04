const assert = require("node:assert/strict");
const path = require("node:path");
const { test } = require("node:test");
const { loadTsModule } = require("../loadTsModule");
const { folderWith, page, drawing } = require("./deckHelpers");

const files = loadTsModule("deck/deckFiles.ts");
const { DeckError } = loadTsModule("deck/deckError.ts");

/** A deck folder of section files, each a name and its page names. */
function deckWith(sections) {
	return folderWith(
		Object.fromEntries(
			Object.entries(sections).map(([name, pages]) => [
				`sections/${name}`,
				drawing(...pages.map((pageName) => page(pageName))),
			])
		)
	);
}

const pagesOf = (folder) =>
	files.readSectionFolder(path.join(folder, "sections"));

test("a page name gives its slide and its step, and a name without a number is step 1", () => {
	assert.deepEqual(files.splitStep("point-wise-probability-2"), {
		name: "point-wise-probability",
		step: 2,
	});
	assert.deepEqual(files.splitStep("title-slide"), {
		name: "title-slide",
		step: 1,
	});
});

test("the files present in the order of their numbers, and steps of one name share a number", () => {
	const folder = deckWith({
		"10-end.drawio.xml": ["thanks-1"],
		"2-results.drawio.xml": ["plot-1", "plot-2", "table-1"],
		"1-opening.drawio.xml": ["title-slide-1"],
	});
	const pages = pagesOf(folder);
	assert.deepEqual(
		pages.map((found) => found.pageName),
		["title-slide-1", "plot-1", "plot-2", "table-1", "thanks-1"]
	);
	assert.deepEqual(files.numberSlides(pages), {
		numbers: [1, 2, 2, 3, 4],
		total: 4,
	});
});

test("a section file with the line breaks \\r\\n gives the pages of the same file with \\n", () => {
	const cells = '\n        <mxCell id="2" value="a" parent="1" />\n';
	const text = drawing(page("plot-1", cells), page("plot-2"));
	const crlf = folderWith({
		"sections/1-a.drawio.xml": text.replace(/\n/g, "\r\n"),
	});
	const lf = folderWith({ "sections/1-a.drawio.xml": text });
	const diagrams = (folder) =>
		pagesOf(folder).map((found) => [found.pageName, found.diagram]);
	assert.deepEqual(diagrams(crlf), diagrams(lf));
	assert.ok(pagesOf(lf)[0].diagram.includes("\n"));
	assert.ok(pagesOf(crlf).every((found) => !found.diagram.includes("\r")));
});

test("a hidden page takes no number, and the backup slides stay out of the total", () => {
	const folder = deckWith({
		"1-talk.drawio.xml": ["a-1", "b-1-hide", "c-1"],
		"2-backup-slides.drawio.xml": ["d-1", "d-2", "e-1"],
	});
	const pages = files.shownPages(pagesOf(folder));
	assert.deepEqual(
		pages.map((found) => found.pageName),
		["a-1", "c-1", "d-1", "d-2", "e-1"]
	);
	assert.equal(files.mainTotal(pages), 2);
	const outline = files.deckOutline(pages);
	assert.deepEqual(
		outline.map((section) => [
			section.number,
			section.isBackup,
			section.slides.map((slide) => [slide.number, slide.pages]),
		]),
		[
			[
				1,
				false,
				[
					[1, [0]],
					[2, [1]],
				],
			],
			[
				2,
				true,
				[
					[3, [2, 3]],
					[4, [4]],
				],
			],
		]
	);
	assert.deepEqual(files.sectionPages(outline[1]), [2, 3, 4]);
});

test("a slide whose steps run on into the next file is listed in the file where it starts", () => {
	const folder = deckWith({
		"1-a.drawio.xml": ["x-1"],
		"2-b.drawio.xml": ["x-2", "y-1"],
	});
	const outline = files.deckOutline(pagesOf(folder));
	assert.deepEqual(
		outline.map((section) => section.slides.map((slide) => slide.pages)),
		[[[0, 1]], [[2]]]
	);
});

test("a name that comes back and steps out of order are reported", () => {
	const folder = deckWith({
		"1-a.drawio.xml": ["x-1", "y-1", "x-2", "z-2", "z-1"],
	});
	const pages = pagesOf(folder);
	assert.deepEqual([...files.repeatedNames(pages)], [["x", [1, 3]]]);
	assert.deepEqual(
		files
			.stepProblems(pages)
			.map((problem) => ({ ...problem, steps: [...problem.steps] })),
		[
			{ number: 3, name: "x", steps: [2] },
			{ number: 4, name: "z", steps: [2, 1] },
		]
	);
});

test("two files of one section number are refused, and so is a file without its number", () => {
	assert.throws(
		() =>
			pagesOf(
				deckWith({
					"1-a.drawio.xml": ["x-1"],
					"1-b.drawio.xml": ["y-1"],
				})
			),
		(error) =>
			error instanceof DeckError &&
			/1-a.drawio.xml and 1-b.drawio.xml both carry the section number 1/.test(
				error.message
			)
	);
	assert.throws(
		() => pagesOf(deckWith({ "opening.drawio.xml": ["x-1"] })),
		/does not start with its section number/
	);
});

test("a page name is read with its references, and a page without a name is slide-1", () => {
	const pages = files.readPagesOfText(
		'<diagram id="a" name="q&amp;a-1"></diagram><diagram id="b"></diagram>',
		3,
		"questions",
		"x.drawio.xml"
	);
	assert.deepEqual(
		pages.map((found) => [
			found.pageName,
			found.name,
			found.step,
			found.section,
			found.position,
		]),
		[
			["q&a-1", "q&a", 1, 3, 0],
			["slide-1", "slide", 1, 3, 1],
		]
	);
});

test("the key config of package.json gives the facts of a deck, and an option given comes first", () => {
	const folder = folderWith({
		"package.json": JSON.stringify({
			config: { title: "My talk", deck: "talk.drawio.xml" },
		}),
	});
	const config = files.readDeckConfig(folder);
	assert.equal(files.configSetting("title", undefined, config), "My talk");
	assert.equal(
		files.configSetting("deck", undefined, config),
		"talk.drawio.xml"
	);
	assert.equal(
		files.configSetting("deck", "other.drawio.xml", config),
		"other.drawio.xml"
	);
	assert.equal(
		files.configSetting("slides-dir", undefined, config),
		"sections"
	);
	assert.equal(files.configSetting("title", undefined, {}), undefined);
	assert.deepEqual({ ...files.readDeckConfig(folderWith({})) }, {});
});

test("a key of config that the deck cannot hold is refused with its reason", () => {
	const refusal = (config) => () =>
		files.readDeckConfig(
			folderWith({ "package.json": JSON.stringify({ config }) })
		);
	assert.throws(
		refusal({ palette: "x.tex" }),
		/config.palette of .* has moved to the setting drawioSlides.colors/
	);
	assert.throws(
		refusal({ colour: "red" }),
		/holds "colour", which is none of title, slides-dir, deck/
	);
	assert.throws(
		refusal({ title: 3 }),
		/config.title of .* holds 3, where a text was expected/
	);
	assert.throws(refusal([1]), /where an object was expected/);
	assert.throws(
		() => files.readDeckConfig(folderWith({ "package.json": "{" })),
		/does not read as a JSON object/
	);
});

test("the slides folder comes before the multi-page file, and a deck with neither has no location", () => {
	const both = folderWith({
		"sections/1-a.drawio.xml": "",
		"slides.drawio.xml": "",
	});
	assert.deepEqual(
		{ ...files.findSlidesLocation(both, "sections", "slides.drawio.xml") },
		{
			location: path.join(both, "sections"),
			isFolder: true,
		}
	);
	const single = folderWith({ "slides.drawio.xml": "" });
	assert.equal(
		files.findSlidesLocation(single, "sections", "slides.drawio.xml")
			.isFolder,
		false
	);
	assert.equal(
		files.findSlidesLocation(
			folderWith({}),
			"sections",
			"slides.drawio.xml"
		),
		undefined
	);
});

test("a title reads from a name, and a name from a title", () => {
	assert.equal(
		files.titleOf("point-wise-probability"),
		"Point wise probability"
	);
	assert.equal(files.titleOf("-"), "-");
	assert.equal(
		files.slug(
			"Semantics &amp; Algorithms [1, 2] for Multi-Objective Optimization with Priorities"
		),
		"semantics-algorithms-for-multi-objective"
	);
	assert.equal(files.slug("!!!"), "slide");
	assert.equal(files.sectionFileName(2, "results"), "2-results.drawio.xml");
});
