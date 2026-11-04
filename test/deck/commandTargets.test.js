const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { loadTsModule } = require("../loadTsModule");
const { folderWith } = require("./deckHelpers");

const targets = loadTsModule("features/DeckBuildFeature/deckCommandTargets.ts");
const plain = (value) => JSON.parse(JSON.stringify(value));

test("the deck of a path is the nearest folder at or above it with a package.json, up to the workspace folder", () => {
	const workspace = folderWith({
		"talks/a/package.json": "{}",
		"talks/a/sections/1-x.drawio.xml": "",
		"notes/b.txt": "",
	});
	const deck = path.join(workspace, "talks", "a");
	assert.equal(
		targets.deckFolderAbove(path.join(deck, "sections"), workspace),
		deck
	);
	assert.equal(targets.deckFolderAbove(deck, workspace), deck);
	assert.equal(
		targets.deckFolderAbove(path.join(workspace, "notes"), workspace),
		undefined
	);
	fs.writeFileSync(path.join(workspace, "package.json"), "{}");
	assert.equal(
		targets.deckFolderAbove(path.join(workspace, "notes"), workspace),
		workspace
	);
	assert.equal(
		targets.deckFolderAbove(
			path.join(workspace, "notes"),
			path.join(workspace, "notes")
		),
		undefined
	);
});

test("a cell is found by its id inside its page, and a missing cell gives the start of its page", () => {
	const text = [
		"<mxfile>",
		'  <diagram id="a" name="a-1">',
		'    <mxGraphModel><root><mxCell id="2" value="x" /></root></mxGraphModel>',
		"  </diagram>",
		'  <diagram id="2" name="b-1">',
		'    <mxGraphModel><root><mxCell id="2" value="y" />',
		'    <UserObject label="z" id="a&amp;b"><mxCell /></UserObject></root></mxGraphModel>',
		"  </diagram>",
		"</mxfile>",
	].join("\r\n");
	assert.deepEqual(plain(targets.cellPlace(text, 1, "2")), {
		line: 5,
		character: 32,
		length: 6,
	});
	assert.deepEqual(plain(targets.cellPlace(text, 1, "a&b")), {
		line: 6,
		character: 26,
		length: 12,
	});
	assert.deepEqual(plain(targets.cellPlace(text, 0, "9")), {
		line: 1,
		character: 2,
		length: 8,
	});
	assert.deepEqual(plain(targets.cellPlace(text, 5, "2")), {
		line: 0,
		character: 0,
		length: 0,
	});
});

test("an issue of the check reads with its kind, its suggestions and its place", () => {
	const issue = {
		slide: 4,
		pageName: "plan-2",
		cellId: "7",
		file: "/x/sections/1-a.drawio.xml",
		pagePosition: 1,
		otherSlides: 2,
		isSpelling: true,
		message: "Possible spelling mistake found.",
		fixes: ["plan", "plane"],
		context: "the [plann] of the talk",
	};
	assert.equal(
		targets.issueText(issue),
		'Spelling: Possible spelling mistake found. Suggestions: plan, plane. In "the [plann] of the talk", on slide 4 and 2 other slides, page plan-2, cell 7.'
	);
	assert.equal(
		targets.issueText({
			...issue,
			isSpelling: false,
			fixes: [],
			otherSlides: 0,
		}),
		'Grammar or style: Possible spelling mistake found. In "the [plann] of the talk", on slide 4, page plan-2, cell 7.'
	);
	assert.equal(
		targets.progressText({
			step: "export of the pages",
			done: 3,
			total: 81,
		}),
		"export of the pages 3/81"
	);
	assert.equal(
		targets.progressText({ step: "PDF", done: 1, total: 1 }),
		"PDF"
	);
});
