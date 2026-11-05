const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { loadTsModule } = require("../loadTsModule");
const { extensionRoot, folderWith } = require("./deckHelpers");

const setUp = loadTsModule("deck/deckSetUp.ts");
const settings = loadTsModule("deck/deckSettings.ts");
const json = loadTsModule("deck/jsonWithComments.ts");

const plain = (value) => JSON.parse(JSON.stringify(value));

test("the starting palette leaves out its header and keeps the comments of its colors", () => {
	const { colors, warnings } = setUp.startingPalette(extensionRoot);
	assert.deepEqual(plain(warnings), []);
	assert.equal(colors.members[0].key, "red");
	assert.deepEqual(plain(colors.members[0].comments), []);
	assert.ok(
		colors.members.every((member) => /^#[0-9A-F]{6}$/.test(member.value))
	);
});

test("the settings of a deck associate the editor, load the slides and hold the palette and the swatches", () => {
	const palette = {
		members: [
			{ key: "accent", value: "#004D80", comments: ["The markers."] },
		],
		closingComments: [],
	};
	const text = setUp.vscodeSettingsText(palette, {
		customColorSchemes: [[{ fill: "accent" }]],
		colorNames: { "000000": "Black" },
	});
	const span = json.objectLayout(text).values.get("drawSlidesCode.colors");
	assert.deepEqual(
		plain(json.readCommentedObject(text, span[0], span[1])),
		plain(palette)
	);
	const parsed = JSON.parse(json.withoutComments(text));
	assert.deepEqual(Object.keys(parsed), [
		"workbench.editorAssociations",
		"files.associations",
		"drawSlidesCode.slides",
		"drawSlidesCode.templates",
		"drawSlidesCode.customColorSchemes",
		"drawSlidesCode.colors",
	]);
	assert.deepEqual(parsed["drawSlidesCode.templates"], [
		"${deckFolder}/templates/*.drawio.xml",
	]);
});

test("a new deck is a repository with its first section, its commands, its settings and its template", () => {
	const project = path.join(
		folderWith({ ".gitignore": "notes/" }),
		"my-talk"
	);
	fs.mkdirSync(project);
	fs.writeFileSync(path.join(project, ".gitignore"), "notes/\n.DS_Store");
	const result = setUp.initDeck({
		project,
		extensionRoot,
		title: "My Talk [1]",
	});
	assert.deepEqual(plain(result.lines), [
		"sections/1-my-talk.drawio.xml written with the pages title-slide-1, section-divider-1, title-and-body-1",
		`package.json, drawslidescode.cjs and .vscode/settings.json written, and ${project} is a git repository of its own`,
	]);
	const section = fs.readFileSync(
		path.join(project, "sections/1-my-talk.drawio.xml"),
		"utf8"
	);
	assert.deepEqual(
		[...section.matchAll(/<diagram [^>]*name="([^"]*)"/g)].map(
			(match) => match[1]
		),
		["title-slide-1", "section-divider-1", "title-and-body-1"]
	);
	assert.equal(
		fs.readFileSync(path.join(project, "package.json"), "utf8"),
		setUp.deckPackageText(
			"My Talk [1]",
			"sections",
			"slides.drawio.xml",
			"node drawslidescode.cjs"
		)
	);
	const manifest = JSON.parse(
		fs.readFileSync(path.join(project, "package.json"), "utf8")
	);
	assert.deepEqual(manifest.config, { title: "My Talk [1]" });
	assert.equal(manifest.scripts.build, "node drawslidescode.cjs build");
	assert.equal(
		fs.readFileSync(path.join(project, "drawslidescode.cjs"), "utf8"),
		fs.readFileSync(setUp.launcherFile(extensionRoot), "utf8")
	);
	assert.equal(
		fs.readFileSync(path.join(project, ".gitignore"), "utf8"),
		"notes/\n.DS_Store\nbuild/\n.claude/settings.local.json\n"
	);
	assert.ok(fs.existsSync(path.join(project, ".git")));
	assert.equal(
		fs.readFileSync(
			path.join(project, "templates/slides.drawio.xml"),
			"utf8"
		),
		fs.readFileSync(setUp.templateFile(extensionRoot), "utf8")
	);
	assert.equal(
		settings.readDeckSettings(project)["drawSlidesCode.slides"],
		true
	);
});

test("a deck at other names keeps them in config", () => {
	assert.deepEqual(
		JSON.parse(
			setUp.deckPackageText("Talk", "parts", "talk.drawio.xml", "x")
		).config,
		{
			title: "Talk",
			"slides-dir": "parts",
			deck: "talk.drawio.xml",
		}
	);
});

test("a folder that holds a presentation or its files is refused before anything is written", () => {
	const refusal = (files) =>
		setUp.initRefusal(folderWith(files), "sections", "slides.drawio.xml");
	assert.match(
		refusal({ "package.json": "{}" }),
		/already holds a presentation/
	);
	assert.match(
		refusal({ "sections/1-a.drawio.xml": "" }),
		/already holds a presentation/
	);
	assert.match(
		refusal({ ".vscode/settings.json": "{}" }),
		/settings.json exists/
	);
	assert.match(
		refusal({ "templates/slides.drawio.xml": "" }),
		/slides.drawio.xml exists/
	);
	assert.equal(refusal({ "notes.md": "" }), undefined);
	const file = path.join(folderWith({ "a-file": "" }), "a-file");
	assert.match(
		setUp.initRefusal(
			path.join(file, "talk"),
			"sections",
			"slides.drawio.xml"
		),
		/is a file/
	);
	const folder = folderWith({ "package.json": "{}" });
	assert.throws(
		() =>
			setUp.initDeck({
				project: folder,
				extensionRoot,
			}),
		/already holds a presentation/
	);
	assert.deepEqual(fs.readdirSync(folder), ["package.json"]);
});

test("the editor of a presentation is set up once, and the template is copied when it lacks it", () => {
	const project = folderWith({ "sections/1-a.drawio.xml": "" });
	const result = setUp.setUpEditor(project, extensionRoot);
	assert.equal(result.lines.length, 2);
	assert.ok(fs.existsSync(path.join(project, ".vscode/settings.json")));
	assert.throws(
		() => setUp.setUpEditor(project, extensionRoot),
		/settings.json exists/
	);
	assert.deepEqual(setUp.copyMissingTemplates(project, extensionRoot), []);
	assert.equal(
		setUp.withDeckIgnored(
			"build/\n.DS_Store\n.claude/settings.local.json\n"
		),
		"build/\n.DS_Store\n.claude/settings.local.json\n"
	);
});
