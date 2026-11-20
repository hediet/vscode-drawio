const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { loadTsModule } = require("../loadTsModule");
const { extensionRoot, folderWith, page, drawing } = require("./deckHelpers");

const build = loadTsModule("deck/deckBuild.ts");
const browser = loadTsModule("deck/deckBrowser.ts");
const events = loadTsModule("deck/buildEvents.ts");

/** Whether a headless browser starts on this machine, which the tests below need. */
const browserStarts = browser.launchBrowser().then(
	async (launched) => {
		await launched.close();
		return true;
	},
	() => false
);

const math = 'pageWidth="1920" pageHeight="1080" math="1"';

function smallDeck() {
	return folderWith({
		"package.json": JSON.stringify({ config: { title: "Small talk" } }),
		".vscode/settings.json":
			'{ "drawSlidesCode.colors": { "accent": "#004D80" } }',
		"sections/1-start.drawio.xml": drawing(
			page(
				"title-1",
				'<mxCell id="t" parent="1" style="text;html=1;" value="\\(\\textcolor{accent}{x^2}\\) %slide%/%slides%" vertex="1"><mxGeometry x="10" y="10" width="400" height="80" as="geometry" /></mxCell>',
				math
			),
			page(
				"list-1",
				'<mxCell id="l" parent="1" style="text;html=1;" value="&lt;ul&gt;&lt;li&gt;one&lt;/li&gt;&lt;/ul&gt;" vertex="1"><mxGeometry x="10" y="10" width="400" height="80" as="geometry" /></mxCell>'
			),
			page("gone-hide")
		),
	});
}

test("a deck builds into its SVGs, its HTML file and its PDF, and a second build copies every page from the cache", async (t) => {
	if (!(await browserStarts)) {
		t.skip("no headless browser starts on this machine");
		return;
	}
	const folder = smallDeck();
	const lines = [];
	const warnings = [];
	const reporter = {
		onLine: (line) => lines.push(line),
		onWarning: (warning) => warnings.push(warning),
	};
	const result = await build.buildDeck({
		project: folder,
		extensionRoot,
		reporter,
	});
	assert.deepEqual(warnings, []);
	assert.equal(
		result.htmlFile,
		path.join(folder, "build", path.basename(folder) + ".html")
	);
	assert.equal(lines[0], "1 page hidden: gone-hide");
	assert.match(
		lines.join("\n"),
		/2 pages exported to .*, 0 of them unchanged and copied from the cache/
	);
	const first = fs.readFileSync(
		path.join(folder, "build/slides/slide-01.svg"),
		"utf8"
	);
	assert.match(first, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<svg /);
	assert.match(
		first,
		/style="background-color: #ffffff; color-scheme: light;"/
	);
	assert.doesNotMatch(first, /light-dark\(/);
	assert.match(first, /mjx-container/);
	assert.match(
		fs.readFileSync(path.join(folder, "build/slides/slide-02.svg"), "utf8"),
		/<style>/
	);
	assert.match(
		fs.readFileSync(result.htmlFile, "utf8"),
		/<title>Small talk<\/title>/
	);
	const pdf = fs.readFileSync(result.pdfFile, "latin1");
	assert.match(pdf, /^%PDF-/);
	assert.equal((pdf.match(/\/Type \/Page\b/g) || []).length, 2);

	lines.length = 0;
	await build.buildDeckHtml({ project: folder, extensionRoot, reporter });
	assert.match(
		lines.join("\n"),
		/2 pages exported to .*, 2 of them unchanged and copied from the cache/
	);
	assert.equal(
		fs.readdirSync(path.join(folder, "build/export-cache")).length,
		2
	);
});

test("a build whose signal is aborted stops with BuildCancelled", async (t) => {
	if (!(await browserStarts)) {
		t.skip("no headless browser starts on this machine");
		return;
	}
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(
		build.buildDeckPdf({
			project: smallDeck(),
			extensionRoot,
			signal: controller.signal,
		}),
		(error) => error instanceof events.BuildCancelled
	);
});

test("a browser at a path that does not exist is refused with the path", async () => {
	await assert.rejects(
		browser.launchBrowser({ executablePath: "/nowhere/chrome" }),
		(error) =>
			error instanceof browser.BrowserNotFound &&
			/the browser \/nowhere\/chrome did not start/.test(error.message)
	);
});

/** Whether the tests run on Windows, where a file has no executable bit. */
const isWindows = process.platform === "win32";

/** The name of the file of a program on this platform, which ends in `.exe` on Windows. */
function programFile(name) {
	return isWindows ? `${name}.exe` : name;
}

/** A new folder with the programs given, each a name of a file and whether it is executable. */
function folderWithPrograms(programs) {
	const folder = folderWith(
		Object.fromEntries(Object.keys(programs).map((name) => [name, ""]))
	);
	for (const [name, isExecutable] of Object.entries(programs)) {
		fs.chmodSync(path.join(folder, name), isExecutable ? 0o755 : 0o644);
	}
	return folder;
}

/**
 * A launch that fails with "Executable doesn't exist" except for the executable given, and the
 * options of every call of it.
 */
function launchStartingOnly(executablePath) {
	const calls = [];
	const launch = async (options) => {
		calls.push(options);
		if (
			executablePath === undefined ||
			options.executablePath !== executablePath
		) {
			throw new Error("Executable doesn't exist\nmore");
		}
		return "browser";
	};
	return { launch, calls };
}

test(
	"the programs of the PATH are found in the order of the list, each in the first absolute folder that holds it as an executable file, and a second name of one file is left out",
	{
		skip: isWindows && "the folders of the test are of a Linux or a macOS",
	},
	() => {
		const first = folderWithPrograms({
			chromium: false,
			"google-chrome-stable": true,
		});
		const second = folderWithPrograms({ chromium: true });
		fs.mkdirSync(path.join(second, "chromium-browser"));
		fs.symlinkSync(
			path.join(first, "google-chrome-stable"),
			path.join(second, "google-chrome")
		);
		const third = folderWithPrograms({ "chromium-browser": true });
		const relative = path.relative(
			process.cwd(),
			folderWithPrograms({ chromium: true })
		);
		assert.deepEqual(
			browser.findPathPrograms(
				["", relative, first, second, third].join(":"),
				"linux"
			),
			[
				path.join(second, "chromium"),
				path.join(third, "chromium-browser"),
				path.join(second, "google-chrome"),
			]
		);
		assert.deepEqual(browser.findPathPrograms("", "linux"), []);
	}
);

test("the programs of the PATH on Windows end in .exe, in folders separated by semicolons", () => {
	const folder = folderWithPrograms({ chromium: true, "chromium.exe": true });
	assert.deepEqual(browser.findPathPrograms(`${folder};${folder}`, "win32"), [
		path.join(folder, "chromium.exe"),
	]);
});

test("without a path, the build tries the channels of Playwright, then the programs of the PATH with a shorter timeout, and launches the first that starts", async () => {
	const folder = folderWithPrograms({
		[programFile("chromium")]: true,
		[programFile("chromium-browser")]: true,
		[programFile("google-chrome")]: true,
	});
	const { launch, calls } = launchStartingOnly(
		path.join(folder, programFile("chromium-browser"))
	);
	assert.equal(
		await browser.launchBrowser({ searchPath: folder }, undefined, launch),
		"browser"
	);
	assert.deepEqual(
		calls.map((options) => [
			options.channel,
			options.executablePath,
			options.timeout,
			options.chromiumSandbox,
		]),
		[
			[undefined, undefined, undefined, true],
			["chrome", undefined, undefined, true],
			["msedge", undefined, undefined, true],
			[
				undefined,
				path.join(folder, programFile("chromium")),
				browser.PATH_PROGRAM_TIMEOUT_MS,
				true,
			],
			[
				undefined,
				path.join(folder, programFile("chromium-browser")),
				browser.PATH_PROGRAM_TIMEOUT_MS,
				true,
			],
		]
	);
});

test("when no browser starts, the message gives the reason of each browser tried, with one period after each, and says so when the PATH holds none of the programs", async () => {
	const tried =
		"Playwright's Chromium: Executable doesn't exist. Google Chrome: Executable doesn't exist. Microsoft Edge: Executable doesn't exist.";
	const advice =
		"Install Chromium through Playwright, or give the path of a Chrome, an Edge or a Chromium.";
	await assert.rejects(
		browser.launchBrowser(
			{ searchPath: folderWithPrograms({}) },
			undefined,
			launchStartingOnly().launch
		),
		(error) =>
			error instanceof browser.BrowserNotFound &&
			error.message ===
				`no browser started. ${tried} The PATH holds no chromium, chromium-browser, google-chrome or google-chrome-stable. ${advice}`
	);
	const folder = folderWithPrograms({ [programFile("google-chrome")]: true });
	const program = path.join(folder, programFile("google-chrome"));
	await assert.rejects(
		browser.launchBrowser(
			{ searchPath: folder },
			undefined,
			launchStartingOnly().launch
		),
		(error) =>
			error instanceof browser.BrowserNotFound &&
			error.message ===
				`no browser started. ${tried} ${program}: Executable doesn't exist. ${advice}`
	);
	const timedOut = async () => {
		throw new Error("Timeout 30000ms exceeded.\nmore");
	};
	await assert.rejects(
		browser.launchBrowser({ searchPath: folder }, undefined, timedOut),
		(error) =>
			error instanceof browser.BrowserNotFound &&
			error.message ===
				`no browser started. Playwright's Chromium: Timeout 30000ms exceeded. Google Chrome: Timeout 30000ms exceeded. Microsoft Edge: Timeout 30000ms exceeded. ${program}: Timeout 30000ms exceeded. ${advice}`
	);
});

test("a browser starts with the sandbox of Chromium, and again without it, with a warning, when the sandbox fails", async () => {
	const launches = [];
	const launch = (failure) => async (options) => {
		launches.push(options.chromiumSandbox);
		if (options.chromiumSandbox && failure !== undefined) {
			throw new Error(failure);
		}
		return "browser";
	};
	const warnings = [];
	const reporter = { onWarning: (warning) => warnings.push(warning) };
	assert.equal(
		await browser.launchWithSandbox(launch(), {}, "Chromium", reporter),
		"browser"
	);
	assert.deepEqual(launches, [true]);
	assert.deepEqual(warnings, []);
	launches.length = 0;
	assert.equal(
		await browser.launchWithSandbox(
			launch("browserType.launch: No usable sandbox!\nmore"),
			{},
			"Chromium",
			reporter
		),
		"browser"
	);
	assert.deepEqual(launches, [true, false]);
	assert.deepEqual(warnings, [
		"Chromium did not start with the sandbox of Chromium (browserType.launch: No usable sandbox!), so the build runs it without the sandbox",
	]);
	launches.length = 0;
	await assert.rejects(
		browser.launchWithSandbox(
			launch("Executable doesn't exist"),
			{},
			"Chromium",
			reporter
		),
		/Executable doesn't exist/
	);
	assert.deepEqual(launches, [true]);
});
