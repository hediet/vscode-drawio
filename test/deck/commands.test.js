const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");
const { loadTsModule, useStandIn } = require("../loadTsModule");
const standIn = require("../vscodeStandIn");
const { extensionRoot, folderWith, page, drawing } = require("./deckHelpers");

useStandIn("vscode", standIn.vscode);
const { DeckSetUpFeature } = loadTsModule(
	"features/DeckSetUpFeature/DeckSetUpFeature.ts"
);
const { DeckBuildFeature } = loadTsModule(
	"features/DeckBuildFeature/DeckBuildFeature.ts"
);
const browser = loadTsModule("deck/deckBrowser.ts");

const setUp = new DeckSetUpFeature(standIn.log, extensionRoot);
const builds = new DeckBuildFeature(standIn.log, extensionRoot);
after(() => {
	setUp.dispose();
	builds.dispose();
});

const { Uri, TabInputCustom } = standIn.vscode;
const { runCommand, resetState, messagesOf, lastMessageOf, loggedText } =
	standIn;

/**
 * The deck `test/fixtures/constructs/deck/` holds a link to a page, to an address, with
 * `linkTarget="_self"`, to a hidden page, to an action of the editor and on an edge, and links in
 * a label. It also holds videos, present, missing, outside the deck and with a space, a `#` and an
 * accented letter in the name, with a wrong `fit` and wrong times of the bar, embedded pages,
 * present, missing and outside the deck, with files beside them, a picture of `assets/` and a
 * missing one, a link in a hidden layer, a page with a formula and typesetting off, an unknown
 * colour, a repeated slide name, the steps 1, 2 and 4, a duplicated page id, a page ending in
 * `-hide`, and two backup slides with `%slide%/%slides%`. `expected-deck.json` is the deck of its
 * HTML file without the SVGs, and `expected-warnings.txt` the warnings of its build. Both come
 * from the build of the extension, and equal those of the Python build of the draw.io
 * presentation framework on the same deck.
 */
const FIXTURE = path.resolve(__dirname, "../fixtures/constructs");

/** Whether a headless browser starts on this machine, which the builds below need. */
const browserStarts = browser.launchBrowser().then(
	async (launched) => {
		await launched.close();
		return true;
	},
	() => false
);

function isGitInstalled() {
	return (
		childProcess.spawnSync("git", ["--version"], { stdio: "ignore" })
			.status === 0
	);
}

/** A new empty folder in the temporary folder of the system. */
function emptyFolder() {
	return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "deck-")));
}

/** A copy of the fixture deck, with the third section file in CRLF line breaks. */
function fixtureCopy() {
	const folder = emptyFolder();
	fs.cpSync(FIXTURE, folder, { recursive: true });
	const third = path.join(folder, "deck/sections/3-backup-slides.drawio.xml");
	fs.writeFileSync(
		third,
		fs.readFileSync(third, "utf8").replace(/\n/g, "\r\n")
	);
	return path.join(folder, "deck");
}

/** The files of the folder, relative to it, with `.git/` as one entry. */
function listFiles(folder) {
	const walk = (relative) =>
		fs
			.readdirSync(path.join(folder, relative), { withFileTypes: true })
			.flatMap((entry) => {
				const child = path.join(relative, entry.name);
				if (entry.name === ".git") {
					return [".git/"];
				}
				return entry.isDirectory() ? walk(child) : [child];
			});
	return walk("").sort();
}

/** A deck of one section file with two pages. */
function smallDeck(files = {}) {
	return folderWith({
		"package.json": JSON.stringify({ config: { title: "Small talk" } }),
		"sections/1-start.drawio.xml": drawing(
			page(
				"title-1",
				'<mxCell id="t" parent="1" style="text;html=1;" value="Hello" vertex="1"><mxGeometry x="10" y="10" width="400" height="80" as="geometry" /></mxCell>'
			),
			page("body-1")
		),
		...files,
	});
}

/** The deck of the HTML file, without the SVGs, and with the folders of `media/outside/` named `<hash>`. */
function deckSummary(htmlFile) {
	const json =
		/<script type="application\/json" id="deck">([\s\S]*?)<\/script>/.exec(
			fs.readFileSync(htmlFile, "utf8")
		)[1];
	const deck = JSON.parse(json.replace(/\\u003c/g, "<"));
	deck.pages.forEach((entry) => delete entry.svg);
	return JSON.parse(
		JSON.stringify(deck).replace(
			/media\/outside\/[0-9a-f]{8}\//g,
			"media/outside/<hash>/"
		)
	);
}

const settle = (milliseconds = 50) =>
	new Promise((resolve) => setTimeout(resolve, milliseconds));

async function until(condition, timeoutMs = 60000) {
	const end = Date.now() + timeoutMs;
	while (!condition()) {
		if (Date.now() > end) {
			throw new Error("timed out");
		}
		await settle(100);
	}
}

/** A port of localhost on which nothing listens. */
function closedPort() {
	return new Promise((resolve) => {
		const server = net.createServer().listen(0, "localhost", () => {
			const { port } = server.address();
			server.close(() => resolve(port));
		});
	});
}

test("the set-up refuses an untrusted workspace and writes nothing", async () => {
	const folder = emptyFolder();
	resetState({ trusted: false, workspaceFolders: [folder] });
	await runCommand("drawioSlides.setUpDeck", Uri.file(folder));
	assert.equal(standIn.state().messages.length, 1);
	assert.match(lastMessageOf("error").text, /only in a trusted workspace/);
	assert.deepEqual(listFiles(folder), []);
});

test("the set-up starts a presentation in an empty folder from the templates of the extension, and opens its first section", async (t) => {
	if (!isGitInstalled()) {
		t.skip("git is not installed");
		return;
	}
	const folder = emptyFolder();
	resetState({
		workspaceFolders: [folder],
		answers: { input: ["My talk"], information: ["Set Up"] },
	});
	await runCommand("drawioSlides.setUpDeck");
	const confirmation = messagesOf("information").find((shown) => shown.modal);
	assert.equal(confirmation.text, `Start a presentation in ${folder}?`);
	assert.match(
		confirmation.detail,
		/^The set-up writes:\n- sections\/1-<title>\.drawio\.xml: .*\n- package\.json: .*\n- drawio-slides\.cjs: .*\n- \.gitignore: .*\n- templates\/slides\.drawio\.xml: .*\n- \.vscode\/settings\.json: .*\n- \.git\/: .*$/
	);
	assert.deepEqual(listFiles(folder), [
		".git/",
		".gitignore",
		".vscode/settings.json",
		"drawio-slides.cjs",
		"package.json",
		"sections/1-my-talk.drawio.xml",
		"templates/slides.drawio.xml",
	]);
	const manifest = JSON.parse(
		fs.readFileSync(path.join(folder, "package.json"), "utf8")
	);
	assert.deepEqual(manifest.config, { title: "My talk" });
	assert.equal(manifest.scripts.build, "node drawio-slides.cjs build");
	const [command, file, viewType] = standIn.state().executed[0];
	assert.equal(command, "vscode.openWith");
	assert.equal(file.fsPath, path.join(folder, "sections/1-my-talk.drawio.xml"));
	assert.equal(viewType, "drawioSlides.textEditor");
	assert.match(
		lastMessageOf("information").text,
		/is started, and its first section 1-my-talk\.drawio\.xml is open\./
	);
});

test("the set-up writes nothing when the title or the confirmation is cancelled", async () => {
	const folder = emptyFolder();
	resetState({ workspaceFolders: [folder], answers: { input: [undefined] } });
	await runCommand("drawioSlides.setUpDeck");
	resetState({
		workspaceFolders: [folder],
		answers: { input: ["Talk"], information: [undefined] },
	});
	await runCommand("drawioSlides.setUpDeck");
	assert.deepEqual(listFiles(folder), []);
	assert.equal(loggedText(), "");
});

test("the set-up writes the settings of a presentation without them, and then says that it is set up", async () => {
	const folder = smallDeck();
	resetState({ workspaceFolders: [folder], answers: { information: ["Set Up"] } });
	await runCommand("drawioSlides.setUpDeck");
	assert.match(
		messagesOf("information")[0].detail,
		/^The set-up writes:\n- \.vscode\/settings\.json: .*\n- templates\/slides\.drawio\.xml: .*$/
	);
	assert.ok(fs.existsSync(path.join(folder, ".vscode/settings.json")));
	assert.match(
		lastMessageOf("information").text,
		/is set up for the editor: the set-up wrote \.vscode\/settings\.json and templates\/slides\.drawio\.xml\.$/
	);
	resetState({ workspaceFolders: [folder] });
	await runCommand("drawioSlides.setUpDeck");
	assert.match(lastMessageOf("information").text, /is set up already/);
});

test("the set-up names the files in the way of a start, the launcher among them", async () => {
	const folder = folderWith({ "drawio-slides.cjs": "", "package.json": "{}" });
	resetState({ workspaceFolders: [folder] });
	await runCommand("drawioSlides.setUpDeck");
	assert.match(
		lastMessageOf("error").text,
		/holds no presentation, and the set-up starts one only in a folder without package\.json and drawio-slides\.cjs\./
	);
});

/** A presentation whose scripts run the Python build of the framework, with its settings. */
function frameworkDeck() {
	const manifest = JSON.stringify(
		{
			private: true,
			scripts: {
				build: "python3 '../tools/draw-io/build-slides.py' build",
				check: "python3 '../tools/draw-io/build-slides.py' check",
			},
			config: { title: "Old talk" },
		},
		null,
		2
	);
	return {
		manifest,
		folder: smallDeck({
			"package.json": manifest,
			".vscode/settings.json": '{ "drawioSlides.slides": true }\n',
		}),
	};
}

test("the set-up offers a presentation of the framework the move to the launcher, and the move keeps config", async () => {
	const { folder, manifest } = frameworkDeck();
	resetState({
		workspaceFolders: [folder],
		answers: {
			information: [
				(text) =>
					/Move them to the launcher/.test(text)
						? "Move to the Launcher"
						: undefined,
			],
		},
	});
	await runCommand("drawioSlides.setUpDeck", Uri.file(folder));
	await settle();
	const offer = messagesOf("information").find((shown) =>
		/Move them to the launcher/.test(shown.text)
	);
	assert.ok(offer.modal);
	assert.match(offer.detail, /drawio-slides\.cjs: copied from the extension/);
	assert.match(
		offer.detail,
		/script build: python3 '\.\.\/tools\/draw-io\/build-slides\.py' build -> node drawio-slides\.cjs build/
	);
	const moved = JSON.parse(
		fs.readFileSync(path.join(folder, "package.json"), "utf8")
	);
	assert.equal(moved.scripts.check, "node drawio-slides.cjs check");
	assert.deepEqual(moved.config, JSON.parse(manifest).config);
	assert.ok(fs.existsSync(path.join(folder, "drawio-slides.cjs")));
});

test("a declined move to the launcher changes nothing", async () => {
	const { folder, manifest } = frameworkDeck();
	resetState({ workspaceFolders: [folder], answers: { information: [undefined] } });
	await runCommand("drawioSlides.setUpDeck", Uri.file(folder));
	await settle();
	assert.ok(
		messagesOf("information").some((shown) =>
			/Move them to the launcher/.test(shown.text)
		)
	);
	assert.equal(
		fs.readFileSync(path.join(folder, "package.json"), "utf8"),
		manifest
	);
	assert.equal(fs.existsSync(path.join(folder, "drawio-slides.cjs")), false);
});

test("every command on a presentation refuses an untrusted workspace", async () => {
	const folder = smallDeck();
	for (const command of [
		"drawioSlides.buildDeck",
		"drawioSlides.buildDeckHtml",
		"drawioSlides.buildDeckPdf",
		"drawioSlides.watchDeck",
		"drawioSlides.checkDeck",
		"drawioSlides.outlineDeck",
		"drawioSlides.importColoursFromTex",
		"drawioSlides.exportColoursToTex",
	]) {
		resetState({ trusted: false, workspaceFolders: [folder] });
		await runCommand(command);
		assert.equal(standIn.state().messages.length, 1, command);
		assert.match(
			lastMessageOf("error").text,
			/runs only in a trusted workspace/,
			command
		);
	}
	assert.deepEqual(listFiles(folder), [
		"package.json",
		"sections/1-start.drawio.xml",
	]);
});

test("the outline of a presentation goes to the output channel, which shows", async () => {
	const folder = smallDeck();
	resetState({ workspaceFolders: [folder] });
	await runCommand("drawioSlides.outlineDeck");
	const lines = loggedText().split("\n").slice(1).filter(Boolean);
	assert.match(lines[0], /^2 pages assembled from sections: 2 slides on 2 pages/);
	assert.equal(standIn.state().shown, 1);
});

test("the import of colours from TeX refuses unsaved settings, asks before it replaces the colours, and the export writes them back", async () => {
	const deck = folderWith({
		"package.json": "{}",
		".vscode/settings.json":
			'{\n  // The editor.\n  "drawioSlides.slides": true,\n  "drawioSlides.colors": {"old": "#000000"}\n}\n',
		"colours.tex":
			"% The accent.\n\\definecolor{accent}{HTML}{004D80}\n\\definecolor{warm}{rgb}{1,0.5,0}\n",
	});
	const settings = path.join(deck, ".vscode/settings.json");
	const tex = path.join(deck, "colours.tex");
	resetState({
		workspaceFolders: [deck],
		textDocuments: [{ uri: Uri.file(settings), isDirty: true }],
		answers: { openDialog: [[tex]] },
	});
	await runCommand("drawioSlides.importColoursFromTex");
	assert.match(
		lastMessageOf("error").text,
		/has unsaved changes, so Import Colours from TeX leaves it as it is/
	);
	resetState({
		workspaceFolders: [deck],
		answers: { openDialog: [[tex]], information: [undefined] },
	});
	await runCommand("drawioSlides.importColoursFromTex");
	assert.match(fs.readFileSync(settings, "utf8"), /"old": "#000000"/);
	resetState({
		workspaceFolders: [deck],
		answers: { openDialog: [[tex]], information: ["Import"] },
	});
	await runCommand("drawioSlides.importColoursFromTex");
	assert.match(
		messagesOf("information").find((shown) => shown.modal).text,
		/^Replace the colours of drawioSlides\.colors in .* with the 2 colours of colours\.tex\?$/
	);
	const text = fs.readFileSync(settings, "utf8");
	assert.match(text, /\/\/ The editor\.\n  "drawioSlides\.slides": true,/);
	assert.match(text, /"accent": "#004D80"/);
	assert.doesNotMatch(text, /"old"/);
	const back = path.join(deck, "back.tex");
	resetState({
		workspaceFolders: [deck],
		answers: { saveDialog: [back], information: ["Open File"] },
	});
	await runCommand("drawioSlides.exportColoursToTex");
	assert.match(
		fs.readFileSync(back, "utf8"),
		/^% Written by the command Export Colours to TeX of Draw\.io Slides from drawioSlides\.colors of \.vscode\/settings\.json\.\n% The accent\.\n\\definecolor\{accent\}\{HTML\}\{004D80\}\n/
	);
	await settle();
	assert.deepEqual(standIn.state().executed.at(-1), ["showTextDocument", back]);
});

test("a build with a browser path that does not start offers the installation and the setting", async () => {
	const folder = smallDeck();
	resetState({
		workspaceFolders: [folder],
		settings: { "drawioSlides.browserPath": "/nowhere/chrome" },
		answers: { error: ["Set the Browser Path"] },
	});
	await runCommand("drawioSlides.buildDeckPdf");
	const stop = lastMessageOf("error");
	assert.match(
		stop.text,
		/^Build the PDF of the Presentation on .* stopped: the browser \/nowhere\/chrome did not start/
	);
	assert.deepEqual(stop.buttons, ["Install Chromium", "Set the Browser Path"]);
	await settle();
	assert.deepEqual(standIn.state().executed[0], [
		"workbench.action.openSettings",
		"drawioSlides.browserPath",
	]);
});

test("the check names the refused connections of a LanguageTool server that does not answer", async () => {
	const port = await closedPort();
	const folder = smallDeck({
		".vscode/settings.json": JSON.stringify({
			"drawioSlides.languageTool": `http://localhost:${port}`,
		}),
	});
	resetState({ workspaceFolders: [folder] });
	await runCommand("drawioSlides.checkDeck");
	const stop = lastMessageOf("error").text;
	assert.ok(
		stop.includes(
			`stopped: LanguageTool did not answer at http://localhost:${port} (connect ECONNREFUSED `
		),
		stop
	);
	assert.equal(standIn.state().progress[0].cancellable, true);
});

test("the build of the deck of the active drawing writes the HTML file with the links, the videos, the pages and the warnings of the deck", async (t) => {
	if (!(await browserStarts)) {
		t.skip("no headless browser starts on this machine");
		return;
	}
	const deck = fixtureCopy();
	const section = path.join(deck, "sections/2-results.drawio.xml");
	resetState({
		workspaceFolders: [emptyFolder(), path.dirname(deck)],
		activeTab: new TabInputCustom(Uri.file(section), "drawioSlides.textEditor"),
		answers: { information: ["Open HTML File"] },
	});
	await runCommand("drawioSlides.buildDeckHtml");
	assert.equal(messagesOf("workspaceFolderPick").length, 0);
	const [progress] = standIn.state().progress;
	assert.equal(progress.title, "Building the HTML file of deck");
	assert.equal(progress.cancellable, true);
	assert.ok(progress.reports.includes("export of the pages 10/10"));
	const expectedWarnings = fs
		.readFileSync(path.join(FIXTURE, "expected-warnings.txt"), "utf8")
		.split("\n")
		.filter(Boolean);
	const warnings = loggedText()
		.split("\n")
		.filter((line) => line.startsWith("warning: "));
	// A system without the sandbox of Chromium adds a warning of its own.
	assert.deepEqual(
		warnings.filter((line) => !/without the sandbox$/.test(line)),
		expectedWarnings
	);
	const done = lastMessageOf("information");
	assert.equal(
		done.text,
		`build/deck.html of deck written, with ${warnings.length} warnings in the output.`
	);
	assert.deepEqual(done.buttons, ["Open HTML File", "Show Output"]);
	assert.deepEqual(
		deckSummary(path.join(deck, "build/deck.html")),
		JSON.parse(fs.readFileSync(path.join(FIXTURE, "expected-deck.json"), "utf8"))
	);
	await settle();
	assert.deepEqual(standIn.state().opened, [path.join(deck, "build/deck.html")]);
});

test("a cancel stops a build at a page", async (t) => {
	if (!(await browserStarts)) {
		t.skip("no headless browser starts on this machine");
		return;
	}
	const deck = fixtureCopy();
	resetState({ workspaceFolders: [deck], cancelAfter: 3 });
	await runCommand("drawioSlides.buildDeckHtml");
	assert.equal(
		lastMessageOf("information").text,
		"Build the HTML File of the Presentation on deck was cancelled."
	);
	assert.ok(!fs.existsSync(path.join(deck, "build/deck.html")));
	assert.match(loggedText(), /the build was cancelled/);
});

test("a watch writes the HTML file again after a save, keeps other builds out, and stops", async (t) => {
	if (!(await browserStarts)) {
		t.skip("no headless browser starts on this machine");
		return;
	}
	const deck = fixtureCopy();
	resetState({ workspaceFolders: [deck] });
	await runCommand("drawioSlides.watchDeck");
	assert.match(
		lastMessageOf("information").text,
		/^Watching deck: the HTML file is written again after every save/
	);
	const [item] = standIn.state().statusBarItems;
	assert.equal(item.shown, true);
	assert.deepEqual(item.command.arguments, [deck]);
	const htmlWrites = () =>
		loggedText()
			.split("\n")
			.filter((line) => line.includes("deck.html written")).length;
	await until(() => htmlWrites() === 1);
	await runCommand("drawioSlides.buildDeck");
	assert.match(
		lastMessageOf("warning").text,
		/^deck is watched, so the command leaves it to the watch\./
	);
	const section = path.join(deck, "sections/1-intro.drawio.xml");
	const later = new Date(Date.now() + 2000);
	fs.utimesSync(section, later, later);
	await until(() => htmlWrites() === 2);
	assert.equal(item.texts.at(-1), "$(eye) deck");
	await runCommand("drawioSlides.stopWatchingDeck");
	await until(() => item.disposed);
	assert.match(loggedText(), /Watch the Presentation: .* stopped\n$/);
});
