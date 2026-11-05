const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { loadTsModule } = require("../loadTsModule");
const { extensionRoot, folderWith, page, drawing } = require("./deckHelpers");

const commandLine = loadTsModule("deck/commandLine.ts");
const setUp = loadTsModule("deck/deckSetUp.ts");
const { CommandLineMode, ExitStatus } = commandLine;

const plain = (value) => JSON.parse(JSON.stringify(value));

/** Runs the command line on the arguments, and returns its exit status and what it printed. */
async function run(args, environment = {}) {
	const out = [];
	const err = [];
	const status = await commandLine.runCommandLine(
		args,
		environment,
		extensionRoot,
		{ out: (line) => out.push(line), err: (line) => err.push(line) },
		new AbortController().signal
	);
	return { status, out, err };
}

const deck = () =>
	folderWith({
		"package.json": JSON.stringify({ config: { title: "A talk" } }),
		"sections/1-opening.drawio.xml": drawing(
			page("title-slide-1"),
			page("plan-1"),
			page("plan-2"),
			page("draft-1-hide")
		),
		"sections/2-backup-slides.drawio.xml": drawing(page("proof-1")),
	});

test("the mode, the folder and the options of the command line are read as build-slides.py read them", () => {
	const line = commandLine.parseCommandLine([
		"build",
		"../talk",
		"--outline",
		"--html=out.html",
		"--pdf",
		"out.pdf",
		"--interval",
		"0.5",
		"--browser",
		"/opt/chrome",
	]);
	assert.equal(line.mode, CommandLineMode.BUILD);
	assert.equal(line.project, "../talk");
	assert.equal(line.isOutlineReported, true);
	assert.equal(line.htmlFile, "out.html");
	assert.equal(line.pdfFile, "out.pdf");
	assert.equal(line.intervalMs, 500);
	assert.equal(line.browser, "/opt/chrome");
	assert.equal(
		commandLine.parseCommandLine(["outline", "a", "--project", "b"])
			.project,
		"b"
	);
	assert.equal(commandLine.parseCommandLine(["outline"]).project, ".");
	const fromTex = commandLine.parseCommandLine([
		"from-tex",
		"a.tex",
		"b.tex",
		"--project",
		"talk",
	]);
	assert.deepEqual(plain(fromTex.operands), ["a.tex", "b.tex"]);
	assert.equal(fromTex.project, "talk");
	assert.equal(
		commandLine.parseCommandLine(["to-tex", "a.tex"]).project,
		"."
	);
	const config = commandLine.parseCommandLine([
		"color-config",
		"deck.drawio.xml",
		"--out",
		"c.json",
		"--definecolor",
		"a.tex",
		"--definecolor",
		"b.tex",
		"--least",
		"3",
	]);
	assert.deepEqual(plain(config.definitionFiles), ["a.tex", "b.tex"]);
	assert.equal(config.least, 3);
});

test("a wrong command line is refused with the usage and exit status 2", async () => {
	for (const args of [
		[],
		["publish"],
		["build", "a", "b"],
		["build", "--frobnicate"],
		["watch", "--interval", "soon"],
		["to-tex"],
		["color-config", "deck.drawio.xml"],
	]) {
		const { status, err } = await run(args);
		assert.equal(status, ExitStatus.USAGE, args.join(" "));
		assert.match(err.join("\n"), /^usage: node cli.js/, args.join(" "));
		assert.match(err[err.length - 1], /^error: /, args.join(" "));
	}
	const help = await run(["--help"]);
	assert.equal(help.status, ExitStatus.DONE);
	assert.match(help.out[0], /from-tex/);
});

test("the environment variables of the build become the options of the modes", () => {
	const line = commandLine.parseCommandLine(["build", "talk"]);
	const options = commandLine.buildOptions(
		line,
		{
			DRAWIO_SLIDES_EXTENSION: "/clone",
			DRAWIO_VIEWER:
				"https://viewer.diagrams.net/js/viewer-static.min.js",
			EXPORT_FRESH: "1",
			EXPORT_WORKERS: "0",
			PAGE_WAIT: "20000",
			SNAPSHOT_WAIT: "100",
			SNAPSHOT_LOAD_WAIT: "abc",
			LANGUAGETOOL_SERVER: "http://localhost:8010",
		},
		extensionRoot,
		{},
		new AbortController().signal
	);
	assert.equal(options.project, path.resolve("talk"));
	assert.equal(options.extensionRoot, "/clone");
	assert.deepEqual(plain(options.exportSettings), {
		viewer: "https://viewer.diagrams.net/js/viewer-static.min.js",
		isFresh: true,
		pageWaitMs: 20000,
	});
	assert.deepEqual(plain(options.snapshotSettings), { settleMs: 100 });
	assert.equal(options.languageTool, "http://localhost:8010");
	const bare = commandLine.buildOptions(
		line,
		{ EXPORT_FRESH: "yes" },
		extensionRoot,
		{},
		new AbortController().signal
	);
	assert.equal(bare.extensionRoot, extensionRoot);
	assert.equal(bare.exportSettings.isFresh, false);
	assert.equal(bare.languageTool, undefined);
});

test("outline prints the hidden pages, the count line and the outline of the deck", async () => {
	const folder = deck();
	const { status, out, err } = await run(["outline", folder]);
	assert.equal(status, ExitStatus.DONE);
	assert.deepEqual(err, []);
	assert.deepEqual(out, [
		"1 page hidden: draft-1-hide",
		"4 pages assembled from sections: 2 slides on 3 pages, and 1 backup slides on 1 pages",
		"1 Opening, pages 1-3",
		"  1/2       title-slide                                      page 1",
		"  2/2       plan                                             pages 2-3, 2 steps",
		"2 Backup slides (backup), pages 4-4",
		"  3/2-3     proof                                            page 4",
	]);
});

test("a deck that the build refuses stops with its reason and exit status 1", async () => {
	const empty = folderWith({ "notes.md": "" });
	const { status, err } = await run(["outline", "--project", empty]);
	assert.equal(status, ExitStatus.STOPPED);
	assert.match(err[0], /holds neither sections\/ nor slides.drawio.xml/);
	const refused = await run(["init", deck()]);
	assert.equal(refused.status, ExitStatus.STOPPED);
	assert.match(refused.err[0], /already holds a presentation/);
});

test("init starts a presentation whose commands run the launcher, and vscode sets up an existing one", async () => {
	const project = path.join(folderWith({}), "my-talk");
	const { status, out } = await run(["init", project, "--title", "My talk"]);
	assert.equal(status, ExitStatus.DONE);
	assert.match(out[out.length - 1], /^next, in .*my-talk: npm run build/);
	const manifest = JSON.parse(
		fs.readFileSync(path.join(project, "package.json"), "utf8")
	);
	assert.deepEqual(manifest.config, { title: "My talk" });
	assert.equal(manifest.scripts.check, "node drawio-slides.cjs check");
	assert.ok(fs.existsSync(path.join(project, "drawio-slides.cjs")));
	const outline = await run(["outline", project]);
	assert.equal(outline.status, ExitStatus.DONE);
	assert.match(outline.out[0], /^3 pages assembled from sections: 3 slides/);
	const existing = folderWith({
		"sections/1-a.drawio.xml": drawing(page("a-1")),
	});
	const editor = await run(["vscode", existing]);
	assert.equal(editor.status, ExitStatus.DONE);
	assert.deepEqual(editor.out, [
		`${path.join(existing, ".vscode", "settings.json")} written`,
		`${path.join(
			existing,
			"templates",
			"slides.drawio.xml"
		)} copied from ${setUp.templateFile(extensionRoot)}`,
	]);
});

test("from-tex, to-tex and color-config convert the colors of a deck", async () => {
	const folder = folderWith({
		"colors.tex":
			"% The accent.\n\\definecolor{accent}{HTML}{004D80}\n\\definecolor{warm}{rgb}{1,0.5,0}\n",
		"drawing.drawio.xml": drawing(
			page(
				"a-1",
				'<mxCell id="2" style="fillColor=#004D80;" /><mxCell id="3" style="fillColor=#004D80;" />'
			)
		),
	});
	const fromTex = await run([
		"from-tex",
		path.join(folder, "colors.tex"),
		"--project",
		folder,
	]);
	assert.equal(fromTex.status, ExitStatus.DONE);
	assert.match(
		fromTex.out[0],
		/^2 colors of .* written into drawioSlides.colors of /
	);
	const back = path.join(folder, "back.tex");
	const toTex = await run(["to-tex", back, "--project", folder]);
	assert.equal(toTex.status, ExitStatus.DONE);
	assert.match(
		fs.readFileSync(back, "utf8"),
		/% The accent.\n\\definecolor\{accent\}\{HTML\}\{004D80\}\n\\definecolor\{warm\}\{HTML\}\{FF8000\}\n$/
	);
	const out = path.join(folder, "configuration.json");
	const config = await run([
		"color-config",
		path.join(folder, "drawing.drawio.xml"),
		"--out",
		out,
		"--least",
		"2",
		"--definecolor",
		path.join(folder, "colors.tex"),
	]);
	assert.equal(config.status, ExitStatus.DONE);
	assert.equal(config.out[0], "1 colors of 1 kept, 2 uses");
	assert.deepEqual(JSON.parse(fs.readFileSync(out, "utf8")).colorNames, {
		"004D80": "accent",
	});
});

test("the launcher of a deck runs the command line of the newest installed version, or of the folder that DRAWIO_SLIDES_EXTENSION names", () => {
	const home = fs.realpathSync(
		fs.mkdtempSync(path.join(os.tmpdir(), "home-"))
	);
	const extensions = path.join(home, ".vscode", "extensions");
	const stub =
		'console.log(JSON.stringify({ folder: require("path").basename(require("path").dirname(__dirname)), args: process.argv.slice(2) }));\n';
	for (const version of ["0.2.0", "0.10.0", "0.9.1", "0.11.0"]) {
		const folder = path.join(
			extensions,
			`yujunhuang.drawio-slides-${version}`,
			"dist"
		);
		fs.mkdirSync(folder, { recursive: true });
		fs.writeFileSync(path.join(folder, "cli.js"), stub);
	}
	fs.mkdirSync(path.join(extensions, "yujunhuang.drawio-slides-extra"));
	fs.writeFileSync(
		path.join(extensions, ".obsolete"),
		JSON.stringify({ "yujunhuang.drawio-slides-0.11.0": true })
	);
	const project = folderWith({});
	fs.copyFileSync(
		setUp.launcherFile(extensionRoot),
		path.join(project, "drawio-slides.cjs")
	);
	const environment = { PATH: process.env.PATH, HOME: home };
	const launch = (extra) =>
		childProcess.spawnSync(
			process.execPath,
			["drawio-slides.cjs", "build", "--outline"],
			{
				cwd: project,
				env: { ...environment, ...extra },
				encoding: "utf8",
			}
		);
	const newest = launch({});
	assert.equal(newest.status, 0, newest.stderr);
	assert.deepEqual(JSON.parse(newest.stdout), {
		folder: "yujunhuang.drawio-slides-0.10.0",
		args: ["build", "--outline"],
	});
	const named = launch({
		DRAWIO_SLIDES_EXTENSION: path.join(
			extensions,
			"yujunhuang.drawio-slides-0.2.0"
		),
	});
	assert.equal(
		JSON.parse(named.stdout).folder,
		"yujunhuang.drawio-slides-0.2.0"
	);
	const missing = launch({ HOME: folderWith({}) });
	assert.equal(missing.status, 1);
	assert.match(missing.stderr, /yujunhuang.drawio-slides is not installed/);
	// VSCodium keeps its extensions in ~/.vscode-oss/extensions, which the launcher compares with
	// those of VS Code.
	const vscodium = path.join(
		home,
		".vscode-oss",
		"extensions",
		"yujunhuang.drawio-slides-0.12.0",
		"dist"
	);
	fs.mkdirSync(vscodium, { recursive: true });
	fs.writeFileSync(path.join(vscodium, "cli.js"), stub);
	assert.equal(
		JSON.parse(launch({}).stdout).folder,
		"yujunhuang.drawio-slides-0.12.0"
	);
});
