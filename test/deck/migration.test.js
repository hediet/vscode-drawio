const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { loadTsModule } = require("../loadTsModule");
const { extensionRoot, folderWith, page, drawing } = require("./deckHelpers");

const migration = loadTsModule("deck/deckMigration.ts");
const setUp = loadTsModule("deck/deckSetUp.ts");
const commandLine = loadTsModule("deck/commandLine.ts");
const { ExitStatus } = commandLine;

const plain = (value) => JSON.parse(JSON.stringify(value));

/** The `package.json` of a deck of the framework, as `build-slides.py init` wrote it. */
const frameworkPackage = `{
  "name": "a-talk",
  "private": true,
  "config": {
    "title": "A talk"
  },
  "scripts": {
    "build": "python3 '../tools/draw-io/build-slides.py' build",
    "watch": "python3 '../tools/draw-io/build-slides.py' watch",
    "pdf": "python3 '/home/someone/framework/tools/draw-io/build-slides.py' pdf --outline",
    "html": "EXPORT_FRESH=1 python3 ../tools/draw-io/build-slides.py html",
    "lint": "prettier --check .",
    "both": "npm run build && python3 ../tools/draw-io/build-slides.py check"
  },
  "devDependencies": {
    "prettier": "^3.0.0"
  }
}
`;

const frameworkDeck = () =>
	folderWith({
		"package.json": frameworkPackage,
		"sections/1-opening.drawio.xml": drawing(page("title-slide-1")),
	});

test("a script of the Python build becomes a script of the launcher with its options and variables", () => {
	assert.equal(
		migration.launcherCommand(
			"python3 '../tools/draw-io/build-slides.py' build"
		),
		"node drawio-slides.cjs build"
	);
	assert.equal(
		migration.launcherCommand(
			'EXPORT_FRESH=1 python3 -B "/a b/tools/draw-io/build-slides.py" pdf --outline'
		),
		"EXPORT_FRESH=1 node drawio-slides.cjs pdf --outline"
	);
	assert.equal(migration.launcherCommand("prettier --check ."), undefined);
	assert.equal(
		migration.launcherCommand(
			"npm run build && python3 build-slides.py check"
		),
		undefined
	);
});

test("the plan lists the launcher and each script, and names a script that it leaves", () => {
	const folder = frameworkDeck();
	const plan = migration.planMigration(folder, extensionRoot);
	assert.equal(migration.isMigrationNeeded(plan), true);
	assert.equal(plan.launcher, migration.LauncherState.MISSING);
	assert.deepEqual(
		plain(plan.scripts.map((change) => [change.name, change.to])),
		[
			["build", "node drawio-slides.cjs build"],
			["watch", "node drawio-slides.cjs watch"],
			["pdf", "node drawio-slides.cjs pdf --outline"],
			["html", "EXPORT_FRESH=1 node drawio-slides.cjs html"],
		]
	);
	assert.deepEqual(plain(plan.leftByHand), ["both"]);
	const lines = migration.migrationLines(plan);
	assert.equal(lines[0], "drawio-slides.cjs: copied from the extension");
	assert.equal(lines.length, 5);
	assert.equal(
		fs.readFileSync(path.join(folder, "package.json"), "utf8"),
		frameworkPackage
	);
});

test("the move copies the launcher and changes the scripts alone, in the layout of the file", () => {
	const folder = frameworkDeck();
	const result = migration.migrateDeck(folder, extensionRoot);
	const text = fs.readFileSync(path.join(folder, "package.json"), "utf8");
	assert.equal(
		text,
		frameworkPackage
			.replace(
				"python3 '../tools/draw-io/build-slides.py' build",
				"node drawio-slides.cjs build"
			)
			.replace(
				"python3 '../tools/draw-io/build-slides.py' watch",
				"node drawio-slides.cjs watch"
			)
			.replace(
				"python3 '/home/someone/framework/tools/draw-io/build-slides.py' pdf --outline",
				"node drawio-slides.cjs pdf --outline"
			)
			.replace(
				"EXPORT_FRESH=1 python3 ../tools/draw-io/build-slides.py html",
				"EXPORT_FRESH=1 node drawio-slides.cjs html"
			)
	);
	assert.deepEqual(
		fs.readFileSync(path.join(folder, "drawio-slides.cjs")),
		fs.readFileSync(setUp.launcherFile(extensionRoot))
	);
	assert.equal(result.lines.length, 5);
	assert.match(
		result.warnings[0],
		/the script both of package.json names build-slides.py/
	);
	const again = migration.planMigration(folder, extensionRoot);
	assert.equal(migration.isMigrationNeeded(again), false);
	assert.equal(again.launcher, migration.LauncherState.CURRENT);
	assert.match(
		migration.migrateDeck(folder, extensionRoot).lines[0],
		/runs no script of build-slides.py, so nothing changes/
	);
});

test("a launcher that differs from that of the extension is replaced, and the plan says so", () => {
	const folder = frameworkDeck();
	fs.writeFileSync(
		path.join(folder, "drawio-slides.cjs"),
		"// an old launcher\n"
	);
	const plan = migration.planMigration(folder, extensionRoot);
	assert.equal(plan.launcher, migration.LauncherState.OUTDATED);
	assert.match(
		migration.migrationLines(plan)[0],
		/replaced by the launcher of the extension/
	);
	migration.migrateDeck(folder, extensionRoot);
	assert.deepEqual(
		fs.readFileSync(path.join(folder, "drawio-slides.cjs")),
		fs.readFileSync(setUp.launcherFile(extensionRoot))
	);
});

test("the set-up of the editor of a deck of the framework offers the move", () => {
	const folder = frameworkDeck();
	const result = setUp.setUpEditor(folder, extensionRoot);
	assert.match(
		result.lines[result.lines.length - 1],
		/runs build-slides.py of the draw.io presentation framework in 4 scripts\. The mode migrate/
	);
	assert.equal(
		fs.readFileSync(path.join(folder, "package.json"), "utf8"),
		frameworkPackage
	);
	const plainDeck = folderWith({
		"package.json": JSON.stringify({
			scripts: { build: "node drawio-slides.cjs build" },
		}),
		"sections/1-opening.drawio.xml": drawing(page("title-slide-1")),
	});
	const lines = setUp.setUpEditor(plainDeck, extensionRoot).lines;
	assert.ok(lines.every((line) => !line.includes("migrate")));
});

/** Runs the command line with the confirmation given, and returns its exit status and output. */
async function run(args, confirm) {
	const out = [];
	const err = [];
	const status = await commandLine.runCommandLine(
		args,
		{},
		extensionRoot,
		{ out: (line) => out.push(line), err: (line) => err.push(line) },
		new AbortController().signal,
		confirm
	);
	return { status, out, err };
}

test("the mode migrate lists the changes and makes them only after a yes or with --yes", async () => {
	const unasked = frameworkDeck();
	const refused = await run(["migrate", unasked]);
	assert.equal(refused.status, ExitStatus.STOPPED);
	assert.match(refused.out[0], /The move of .* to the launcher changes:/);
	assert.match(refused.err[0], /run migrate again with --yes/);
	assert.equal(fs.existsSync(path.join(unasked, "drawio-slides.cjs")), false);

	const declined = await run(["migrate", unasked], async () => false);
	assert.equal(declined.status, ExitStatus.DONE);
	assert.equal(declined.out[declined.out.length - 1], "nothing changed");
	assert.equal(
		fs.readFileSync(path.join(unasked, "package.json"), "utf8"),
		frameworkPackage
	);

	const questions = [];
	const accepted = await run(["migrate", unasked], async (question) => {
		questions.push(question);
		return true;
	});
	assert.equal(accepted.status, ExitStatus.DONE);
	assert.deepEqual(questions, ["Make the changes? [y/N] "]);
	assert.equal(fs.existsSync(path.join(unasked, "drawio-slides.cjs")), true);

	const confirmed = frameworkDeck();
	const forced = await run(["migrate", "--yes", "--project", confirmed]);
	assert.equal(forced.status, ExitStatus.DONE);
	assert.match(
		JSON.parse(
			fs.readFileSync(path.join(confirmed, "package.json"), "utf8")
		).scripts.build,
		/^node drawio-slides\.cjs build$/
	);
	const nothing = await run(["migrate", confirmed]);
	assert.equal(nothing.status, ExitStatus.DONE);
	assert.match(nothing.out[0], /nothing changes/);
});
