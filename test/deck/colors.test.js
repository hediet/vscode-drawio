const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { loadTsModule } = require("../loadTsModule");
const { extensionRoot, folderWith } = require("./deckHelpers");

const tex = loadTsModule("deck/texDefinitions.ts");
const settings = loadTsModule("deck/deckSettings.ts");
const conversion = loadTsModule("deck/colorSettings.ts");
const config = loadTsModule("deck/colorConfig.ts");

const plain = (value) => JSON.parse(JSON.stringify(value));

test("each model of \\definecolor converts as xcolor converts it", () => {
	assert.deepEqual(
		[
			["rgb", "0.7, 0.0, 0.0"],
			["rgb", "0.3,0.5,0.1"],
			["RGB", "12, 200, 255"],
			["HTML", " a1B2c3 "],
			["gray", "0.85"],
			["Gray", "7"],
			["cmy", "0.5, 0.1, 0"],
			["cmyk", "0.1, 0.2, 0.3, 0.25"],
			["rgb", "1, 2"],
			["hsb", "0.5, 0.5, 0.5"],
			["rgb", "a, b, c"],
		].map(([model, values]) => tex.colorValue(model, values)),
		[
			"#b20000",
			"#4c801a",
			"#0cc8ff",
			"#a1b2c3",
			"#d9d9d9",
			"#777777",
			"#80e6ff",
			"#a68c73",
			undefined,
			undefined,
			undefined,
		]
	);
});

test("the colors of a TeX text keep their comments, and the definitions the setting cannot hold are problems", () => {
	const read = tex.readCommentedColors(
		[
			"% Written by the command Export Colors to TeX of Draw.io Slides from drawioSlides.colors of x.",
			"% The reds.",
			"\\definecolor{dpred}{rgb}{0.7, 0.0, 0.0} % the loss",
			"",
			"\\definecolor{bad-name}{HTML}{000000}",
			"\\definecolor{dpred}{HTML}{000000}\\definecolor{odd}{hsb}{1,1,1}",
			"\\newcommand{\\x}{y}",
			"% The end.",
			"",
		].join("\n")
	);
	assert.deepEqual(plain(read.colors), {
		members: [
			{
				key: "dpred",
				value: "#B20000",
				comments: ["The reds."],
				trailing: "the loss",
			},
		],
		closingComments: [null, "The end."],
	});
	assert.deepEqual(plain(read.problems), [
		'line 5 defines "bad-name", which is not letters and digits that start with a letter',
		"line 6 defines dpred a second time",
		"line 6 defines odd in the model hsb with values that are not converted",
	]);
	assert.deepEqual(plain(read.otherLines), [7]);
	assert.throws(
		() =>
			tex.readColorFileText("x.tex", "\\definecolor{a-b}{HTML}{000000}"),
		/x.tex holds colors that drawioSlides.colors cannot hold/
	);
});

test("colors write back as \\definecolor lines in the model HTML", () => {
	const colors = tex.readCommentedColors(
		"% A.\n\\definecolor{a}{rgb}{0,0.5,0} % first\n\n% B.\n\\definecolor{b}{HTML}{abcdef}\n"
	).colors;
	assert.equal(
		tex.colorLines(colors),
		"% A.\n\\definecolor{a}{HTML}{008000} % first\n\n% B.\n\\definecolor{b}{HTML}{ABCDEF}\n"
	);
	assert.equal(
		tex.colorDefinition("dpgreen", "#008000"),
		"\\definecolor{dpgreen}{RGB}{0,128,0}"
	);
});

test("the commands that MathJax lacks read from mathjax-commands.tex of the extension", () => {
	const file = path.join(
		extensionRoot,
		"drawio-custom-plugins/slides/mathjax-commands.tex"
	);
	const commands = tex.readMissingCommands(
		file,
		fs.readFileSync(file, "utf8")
	);
	assert.ok(commands.size > 0);
	const [name, body] = [...commands][0];
	assert.equal(tex.commandDefinition(name, body), `\\def\\${name}{${body}}`);
	assert.throws(
		() =>
			tex.readMissingCommands(
				"m.tex",
				"% a comment\n\\newcommand{\\x}{y}\n"
			),
		/m.tex holds .* which is no \\def of one command/
	);
});

test("a setting of the deck merges over the default of package.json key by key", () => {
	assert.deepEqual(
		plain(
			settings.mergedSetting({ gap: 8, levels: [1, 2] }, { levels: [3] })
		),
		{ gap: 8, levels: [3] }
	);
	assert.equal(settings.mergedSetting({ gap: 8 }, null), null);
	const deck = folderWith({
		".vscode/settings.json":
			'{\n  // x\n  "drawioSlides.listStyles": {"itemGap": "4px"},\n}\n',
	});
	const styles = settings.slideSetting(
		settings.readDeckSettings(deck),
		extensionRoot,
		"listStyles"
	);
	assert.equal(styles.itemGap, "4px");
	assert.ok(Array.isArray(styles.bulleted));
	assert.throws(
		() => settings.defaultSetting(extensionRoot, "noSuchSetting"),
		/declares no setting drawioSlides.noSuchSetting/
	);
});

test("the colors of a deck leave out an entry that is no color, and the list styles take their values", () => {
	const deck = folderWith({
		".vscode/settings.json": JSON.stringify({
			"drawioSlides.colors": {
				accent: "#004d80",
				"bad-name": "#000000",
				grey: "grey",
				text: "#000000",
			},
			"drawioSlides.listStyles": {
				bulleted: [
					{ color: "accent" },
					{ color: "missing" },
					{ color: "none" },
					"odd",
				],
			},
		}),
	});
	const deckSettings = settings.readDeckSettings(deck);
	const colors = settings.readDeckColors(deck, deckSettings, extensionRoot);
	assert.deepEqual(
		[...colors.value],
		[
			["accent", "#004D80"],
			["text", "#000000"],
		]
	);
	assert.equal(colors.warnings.length, 2);
	const styles = settings.readListStyles(
		deck,
		deckSettings,
		extensionRoot,
		colors.value
	);
	assert.deepEqual(plain(styles.value.bulleted), [
		{ color: "#004D80" },
		{ color: "missing" },
		{ color: "none" },
		"odd",
	]);
	assert.deepEqual(plain(styles.warnings), [
		"drawioSlides.listStyles names the color missing, which drawioSlides.colors does not define, so the value stays as written",
	]);
});

test("a deck that still holds drawioSlides.colorDefinitions stops with the command that converts it", () => {
	const deck = folderWith({
		".vscode/settings.json":
			'{"drawioSlides.colorDefinitions": "${deckFolder}/colors.tex"}',
	});
	assert.throws(
		() =>
			settings.readDeckColors(
				deck,
				settings.readDeckSettings(deck),
				extensionRoot
			),
		(error) =>
			error.message.includes("Import Colors from TeX") &&
			error.message.includes(path.join(deck, "colors.tex"))
	);
	assert.equal(
		settings.settingPath(deck, "${workspaceFolder}/a/../b.tex"),
		path.join(deck, "b.tex")
	);
	assert.equal(settings.settingPath(deck, "/x/y.tex"), "/x/y.tex");
});

test("colors convert from TeX files into the setting and back with their comments", () => {
	const folder = folderWith({
		"one.tex":
			"% The reds.\n\\definecolor{dpred}{rgb}{0.7,0,0} % the loss\n% after one\n",
		"two.tex": "\\definecolor{other}{HTML}{123456}\n",
		"again.tex": "\\definecolor{other}{HTML}{000000}\n",
		".vscode/settings.json":
			'{\n  // The editor.\n  "drawioSlides.slides": true\n}\n',
	});
	const files = ["one.tex", "two.tex"].map((name) => path.join(folder, name));
	conversion.importColorsFromTex(folder, files);
	const written = fs.readFileSync(
		path.join(folder, ".vscode/settings.json"),
		"utf8"
	);
	assert.equal(
		written,
		'{\n  // The editor.\n  "drawioSlides.slides": true,\n  "drawioSlides.colors": {\n    // The reds.\n    "dpred": "#B20000", // the loss\n    // after one\n\n    "other": "#123456"\n  }\n}\n'
	);
	const exported = path.join(folder, "out.tex");
	conversion.exportColorsToTex(folder, exported);
	assert.equal(
		fs.readFileSync(exported, "utf8"),
		"% Written by the command Export Colors to TeX of Draw.io Slides from drawioSlides.colors of .vscode/settings.json.\n% The reds.\n\\definecolor{dpred}{HTML}{B20000} % the loss\n% after one\n\n\\definecolor{other}{HTML}{123456}\n"
	);
	conversion.importColorsFromTex(folder, [exported]);
	assert.equal(
		fs.readFileSync(path.join(folder, ".vscode/settings.json"), "utf8"),
		written
	);
	assert.throws(
		() =>
			conversion.importColorsFromTex(folder, [
				...files,
				path.join(folder, "again.tex"),
			]),
		/again.tex defines other, which an earlier file defines already/
	);
});

test("the export refuses a setting entry that is no color", () => {
	const folder = folderWith({
		".vscode/settings.json": '{"drawioSlides.colors": {"a": "red"}}',
	});
	assert.throws(
		() => conversion.exportColorsToTex(folder, path.join(folder, "x.tex")),
		/holds entries that are no name/
	);
});

test("a color is named after its hue, and a grey by its chroma", () => {
	assert.deepEqual(
		[
			"#dae8fc",
			"#8b959e",
			"#004d80",
			"#b20000",
			"#008000",
			"#ffffff",
			"#111111",
			"#f4f5f6",
			"#ff00ff",
			"#00ffff",
		].map(config.hueName),
		[
			"Blue",
			"Grey",
			"Blue",
			"Red",
			"Green",
			"White",
			"Black",
			"White",
			"Magenta",
			"Cyan",
		]
	);
});

test("the configuration names the colors of a drawing, most used first", () => {
	const drawingText =
		'style="fillColor=#004D80;strokeColor=#004d80;fontColor=#ffffff" style="fillColor=#004d80" ' +
		'value="&lt;font color=&quot;#b20000&quot;&gt;" value="\\textcolor{#B20000}{x}" style="color: #00ff00"';
	const counts = config.countColors(drawingText);
	assert.deepEqual(
		[...counts],
		[
			["#004d80", 3],
			["#ffffff", 1],
			["#b20000", 2],
			["#00ff00", 1],
		]
	);
	const names = config.nameColors(counts, new Map([["#b20000", "dpred"]]));
	assert.deepEqual([...names].sort(), [
		["#004d80", "Blue"],
		["#00ff00", "Green"],
		["#b20000", "dpred"],
		["#ffffff", "White"],
	]);
	assert.deepEqual(
		[...config.familyNames("Blue", ["#004d80", "#0000ff"])],
		[
			["#004d80", "Blue 004D80"],
			["#0000ff", "Blue 0000FF"],
		]
	);
	assert.equal(config.texName("Blue 004D80"), "blue004d80");
	assert.deepEqual(
		plain(config.swatchRows(["#ffffff", "#004d80", "#eeeeaa"])),
		[
			[
				{ fill: "#004d80", stroke: "#004d80", font: "#ffffff" },
				{ fill: "#eeeeaa", stroke: "#eeeeaa", font: "#000000" },
			],
			[
				{ fill: "none", stroke: "#004d80", font: "#004d80" },
				{ fill: "none", stroke: "#eeeeaa", font: "#eeeeaa" },
			],
		]
	);
	const folder = folderWith({
		"deck.drawio.xml": drawingText,
		"names.tex": "\\definecolor{dpred}{HTML}{B20000}\n",
	});
	const written = config.writeColorConfiguration(
		path.join(folder, "deck.drawio.xml"),
		path.join(folder, "colors.json"),
		[path.join(folder, "names.tex")],
		2
	);
	assert.deepEqual(
		JSON.parse(fs.readFileSync(path.join(folder, "colors.json"), "utf8"))
			.colorNames,
		{ "004D80": "Blue", B20000: "dpred" }
	);
	assert.equal(written.lines[0], "2 colors of 4 kept, 5 uses");
	const definitions = config.makeColorConfiguration(
		path.join(folder, "deck.drawio.xml"),
		"x.tex",
		[path.join(folder, "names.tex")],
		2
	);
	assert.equal(
		definitions.text.split("\n").slice(1).join("\n"),
		"\\definecolor{blue}{HTML}{004D80}\n\\definecolor{dpred}{HTML}{B20000}\n"
	);
});
