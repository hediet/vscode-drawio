const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { loadTsModule } = require("../loadTsModule");

const setUp = loadTsModule("features/DeckSetUpFeature/deckFolderSetUp.ts");
const { DeckFolderState } = setUp;

/** A value of the context of the module as a value of this context, whose objects and arrays `deepEqual` compares. */
const plain = (value) => JSON.parse(JSON.stringify(value));

/** A new folder in the temporary folder of the system with the files given, each a path and its text. */
function folderWith(files) {
	const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "deck-setup-")));
	for (const [file, text] of Object.entries(files)) {
		fs.mkdirSync(path.dirname(path.join(folder, file)), { recursive: true });
		if (file.endsWith("/")) {
			fs.mkdirSync(path.join(folder, file), { recursive: true });
		} else {
			fs.writeFileSync(path.join(folder, file), text);
		}
	}
	return folder;
}

const survey = (folder) => plain(setUp.surveyDeckFolder(folder));
const section = '<mxfile><diagram name="title-slide-1"></diagram></mxfile>\n';
const slideSettings = '{\n  // The slides.\n  "drawioSlides.slides": true,\n}\n';

test("an empty folder holds no presentation", () => {
	assert.deepEqual(survey(folderWith({})), { state: DeckFolderState.WithoutPresentation });
});

test("an empty sections folder and other files leave the folder without a presentation", () => {
	const folder = folderWith({ "sections/": "", "notes.md": "notes\n", ".gitignore": "build/\n" });
	assert.deepEqual(survey(folder), { state: DeckFolderState.WithoutPresentation });
});

test("a folder of section files without settings is a presentation without settings", () => {
	const folder = folderWith({ "package.json": "{}\n", "sections/1-opening.drawio.xml": section });
	assert.deepEqual(survey(folder), { state: DeckFolderState.PresentationWithoutSettings });
});

test("a deck of one multi-page file is a presentation", () => {
	const folder = folderWith({ "slides.drawio.xml": section });
	assert.deepEqual(survey(folder), { state: DeckFolderState.PresentationWithoutSettings });
});

test("the slides folder and the multi-page file of config in package.json name the slides", () => {
	const config = JSON.stringify({ config: { "slides-dir": "parts", deck: "talk.drawio.xml" } });
	assert.deepEqual(survey(folderWith({ "package.json": config, "parts/1-a.drawio.xml": section })), {
		state: DeckFolderState.PresentationWithoutSettings,
	});
	assert.deepEqual(survey(folderWith({ "package.json": config, "talk.drawio.xml": section })), {
		state: DeckFolderState.PresentationWithoutSettings,
	});
	assert.deepEqual(survey(folderWith({ "package.json": config, "parts/": "" })), {
		state: DeckFolderState.FilesInTheWay,
		filesInTheWay: ["package.json"],
	});
});

test("a package.json that does not read as JSON leaves the default names", () => {
	const folder = folderWith({ "package.json": "{ not json", "sections/1-a.drawio.xml": section });
	assert.deepEqual(survey(folder), { state: DeckFolderState.PresentationWithoutSettings });
});

test("a presentation with settings that load the plugins is set up", () => {
	const folder = folderWith({ "sections/1-a.drawio.xml": section, ".vscode/settings.json": slideSettings });
	assert.deepEqual(survey(folder), { state: DeckFolderState.SetUp, loadsSlidePlugins: true });
});

test("a presentation with settings that do not load the plugins is set up, and the survey says so", () => {
	for (const settings of ['{ "drawioSlides.slides": false }', '{ "editor.tabSize": 2 }', "[]", "{ not json"]) {
		const folder = folderWith({ "sections/1-a.drawio.xml": section, ".vscode/settings.json": settings });
		assert.deepEqual(survey(folder), { state: DeckFolderState.SetUp, loadsSlidePlugins: false }, settings);
	}
});

test("a folder without slides lists each file that the set-up refuses to replace, in the order of initDeck", () => {
	const folder = folderWith({
		"package.json": "{}\n",
		".vscode/settings.json": "{}\n",
		"templates/slides.drawio.xml": section,
		"drawio-slides.cjs": "",
	});
	assert.deepEqual(survey(folder), {
		state: DeckFolderState.FilesInTheWay,
		filesInTheWay: ["package.json", ".vscode/settings.json", "templates/slides.drawio.xml", "drawio-slides.cjs"],
	});
});

test("a sections folder that is not empty is in the way when config names another slides folder", () => {
	const folder = folderWith({ "package.json": JSON.stringify({ config: { "slides-dir": "parts" } }), "sections/old.txt": "x" });
	assert.deepEqual(survey(folder).filesInTheWay, ["package.json", "sections/"]);
});

test("the set-up of a new presentation writes its files, and git init only into a folder without .git", () => {
	const paths = (files) => plain(files.map((file) => file.path));
	assert.deepEqual(paths(setUp.filesWrittenByInit(folderWith({}))), [
		"sections/1-<title>.drawio.xml",
		"package.json",
		"drawio-slides.cjs",
		".gitignore",
		"templates/slides.drawio.xml",
		".vscode/settings.json",
		".git/",
	]);
	const repository = folderWith({ ".git/": "", ".gitignore": "build/\n" });
	const written = setUp.filesWrittenByInit(repository);
	assert.deepEqual(paths(written), [
		"sections/1-<title>.drawio.xml",
		"package.json",
		"drawio-slides.cjs",
		".gitignore",
		"templates/slides.drawio.xml",
		".vscode/settings.json",
	]);
	assert.match(written[3].content, /where it lacks them/);
	for (const file of written) {
		assert.ok(file.content.length > 0, file.path);
	}
});

test("a sections folder of TeX files is no presentation and is in the way of the set-up", () => {
	const folder = folderWith({ "sections/introduction.tex": "\\section{Introduction}\n" });
	assert.deepEqual(survey(folder), {
		state: DeckFolderState.FilesInTheWay,
		filesInTheWay: ["sections/"],
	});
});

test("the set-up of an existing presentation writes the settings, and the template only when the presentation lacks it", () => {
	assert.deepEqual(plain(setUp.filesWrittenByVscode(folderWith({ "sections/1-a.drawio.xml": section })).map((file) => file.path)), [
		".vscode/settings.json",
		"templates/slides.drawio.xml",
	]);
	assert.deepEqual(
		plain(setUp.filesWrittenByVscode(folderWith({ "sections/1-a.drawio.xml": section, "templates/slides.drawio.xml": section })).map((file) => file.path)),
		[".vscode/settings.json"]
	);
});

test("firstSectionFile finds the section file of number 1", () => {
	const folder = folderWith({ "sections/2-results.drawio.xml": section, "sections/1-my-talk.drawio.xml": section });
	assert.equal(setUp.firstSectionFile(folder), path.join(folder, "sections/1-my-talk.drawio.xml"));
	assert.equal(setUp.firstSectionFile(folderWith({ "sections/": "" })), undefined);
	assert.equal(setUp.firstSectionFile(folderWith({})), undefined);
});

test("isFolder tells a folder from a file and from a missing path", () => {
	const folder = folderWith({ "a.txt": "a" });
	assert.equal(setUp.isFolder(folder), true);
	assert.equal(setUp.isFolder(path.join(folder, "a.txt")), false);
	assert.equal(setUp.isFolder(path.join(folder, "missing")), false);
});
