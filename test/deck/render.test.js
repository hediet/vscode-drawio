const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { test } = require("node:test");
const { loadTsModule } = require("../loadTsModule");
const { extensionRoot, folderWith, page, drawing } = require("./deckHelpers");

const formats = loadTsModule("deck/textFormats.ts");
const slideExport = loadTsModule("deck/slideExport.ts");
const htmlDeck = loadTsModule("deck/htmlDeck.ts");
const files = loadTsModule("deck/deckFiles.ts");
const { labelPieces } = loadTsModule("deck/labelPieces.ts");
const languageCheck = loadTsModule("deck/languageCheck.ts");
const pictures = loadTsModule("deck/deckPictures.ts");
const build = loadTsModule("deck/deckBuild.ts");

test("JSON on one line writes a float with its point and every character outside ASCII escaped", () => {
	const { JsonFloat } = formats;
	assert.equal(
		formats.compactJsonText({
			a: new JsonFloat(1),
			b: [new JsonFloat(0.25), new JsonFloat(960), new JsonFloat(1e16)],
			c: "é< ",
			d: true,
			e: 3,
		}),
		'{"a":1.0,"b":[0.25,960.0,1e+16],"c":"\\u00e9<\\u2028","d":true,"e":3}'
	);
});

test("a path is quoted and an address unquoted as Python's urllib.parse does", () => {
	assert.equal(
		formats.quoteUrlPath("assets/my file (1)!*'é.mp4"),
		"assets/my%20file%20%281%29%21%2A%27%C3%A9.mp4"
	);
	assert.equal(formats.unquoteUrl("a%20b%E9%2Fc%zz%C3%A9"), "a b�/c%zzé");
});

test("a text file is read with its line breaks as new lines", () => {
	const folder = folderWith({ "a.txt": "one\r\ntwo\rthree\n" });
	assert.equal(
		formats.readTextFile(path.join(folder, "a.txt")),
		"one\ntwo\nthree\n"
	);
});

test("an SVG is made light: the light colour of each pair, a light scheme and a white page", () => {
	assert.equal(
		slideExport.firstOfLightDark(
			'fill="light-dark(rgb(0, 136, 43), #fff)" x light-dark(#000,#111) light-dark(a'
		),
		'fill="rgb(0, 136, 43)" x #000 '
	);
	assert.equal(
		slideExport.lightSvg(
			'<?xml version="1.0"?>\n<svg width="1" style="color-scheme: light dark; background: none"><g fill="light-dark(#000, #fff)"/></svg>'
		),
		'<?xml version="1.0"?>\n<svg width="1" style="background-color: #ffffff; color-scheme: light;"><g fill="#000"/></svg>'
	);
	assert.equal(
		slideExport.lightSvg('<svg width="1"><g/></svg>'),
		'<svg width="1" style="background-color: #ffffff; color-scheme: light;"><g/></svg>'
	);
});

test("the SVGs of pages beyond the last are removed, and the others stay", () => {
	const folder = folderWith({
		"slide-01.svg": "",
		"slide-02.svg": "",
		"slide-03.svg": "",
		"other.svg": "",
	});
	slideExport.removeSlidesBeyond(folder, 2);
	assert.deepEqual(fs.readdirSync(folder).sort(), [
		"other.svg",
		"slide-01.svg",
		"slide-02.svg",
	]);
	assert.equal(slideExport.slideFileName(7), "slide-07.svg");
});

test("the rules of the list markers come from list-marker-rules.js of the extension", () => {
	const css = slideExport.listMarkerCss(
		path.join(
			extensionRoot,
			"drawio-custom-plugins/slides/list-marker-rules.js"
		),
		{ bulleted: [{ marker: "•", color: "#FF0000" }], numbered: [] }
	);
	assert.match(css, /#FF0000/);
});

test("a label of HTML splits into its text, its tags and its formulas as Python's html.parser splits it", () => {
	const cases = [
		["x <!-- note --> y", [{ text: "x  y" }]],
		["a < b and c > d", [{ text: "a < b and c > d" }]],
		[
			"<br/>line<br>two",
			[
				{ markup: "<br/>", interpretAs: "\n\n" },
				{ text: "line" },
				{ markup: "<br>", interpretAs: "\n\n" },
				{ text: "two" },
			],
		],
		["text &amp; &nbsp;more &rarr; &amp", [{ text: "text &  more → &" }]],
		["unclosed <b", [{ text: "unclosed <b" }]],
		[
			"<script>var a = '<b>';</script>after",
			[
				{ markup: "<script>", interpretAs: "" },
				{ text: "var a = '<b>';" },
				{ markup: "</script>", interpretAs: "" },
				{ text: "after" },
			],
		],
		["</ b>odd</>", [{ markup: "</b>", interpretAs: "" }, { text: "odd" }]],
		[
			'a<b c="d>e">f</b>',
			[
				{ text: "a" },
				{ markup: '<b c="d>e">', interpretAs: "" },
				{ text: "f" },
				{ markup: "</b>", interpretAs: "" },
			],
		],
		[
			"\\(x^2\\) and $$y$$ in <b>text</b>\nnext",
			[
				{ markup: "\\(x^2\\)", interpretAs: "noun" },
				{ text: " and " },
				{ markup: "$$y$$", interpretAs: "noun" },
				{ text: " in " },
				{ markup: "<b>", interpretAs: "" },
				{ text: "text" },
				{ markup: "</b>", interpretAs: "" },
				{ markup: "\n", interpretAs: "\n\n" },
				{ text: "next" },
			],
		],
	];
	for (const [label, pieces] of cases) {
		assert.deepEqual(labelPieces(label, true, true, "noun"), pieces, label);
	}
	assert.deepEqual(labelPieces("<b>a</b>\nb", false, false, "noun"), [
		{ text: "<b>a</b>\nb" },
	]);
});

test("the context of an issue shows the tags and formulas as they read, cut at 40 characters", () => {
	const pieces = labelPieces(
		"<b>The cat sat</b> on teh mat \\(x\\) with a very long tail of words after it that goes on",
		true,
		true,
		"noun"
	);
	assert.equal(
		languageCheck.plainContext(pieces, 27, 3),
		"The cat sat on teh m[at ]noun with a very long tail of words afte..."
	);
});

/** An SVG of a page with a link to another page inside the text of a label. */
const svg = (target) =>
	`<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg"><a xlink:href="data:page/id,${target}">go</a></svg>\n`;

function htmlFixture() {
	const outside = folderWith({
		"plot.html": '<script src="lib.js"></script>',
		"lib.js": "",
	});
	const folder = folderWith({
		"assets/clip.mp4": "video",
		"assets/plot.html":
			'<script src="plot.js"></script><img src=missing.png>',
		"assets/plot.js": "",
		"build/slides/slide-01.svg": svg("second"),
		"build/slides/slide-02.svg": svg("gone"),
		"build/media/assets/old.mp4": "old",
		"build/media/.deck-media.json": JSON.stringify({
			"deck.html": ["assets/old.mp4"],
		}),
		"sections/1-start.drawio.xml": drawing(
			page(
				"first",
				'<UserObject id="v" video="assets/clip.mp4" fit="zoom" autoplay="1"><mxCell parent="1" vertex="1"><mxGeometry x="10" y="20" width="300" height="200" as="geometry" /></mxCell></UserObject>' +
					'<UserObject id="l" link="data:page/id,second"><mxCell parent="1" vertex="1"><mxGeometry x="1" y="2" width="3" height="4" as="geometry" /></mxCell></UserObject>' +
					'<UserObject id="e" link="https://example.org"><mxCell parent="1" edge="1"><mxGeometry relative="1" as="geometry" /></mxCell></UserObject>'
			),
			page(
				"second",
				'<UserObject id="p" html="assets/plot.html" barHideDelay="2"><mxCell parent="1" vertex="1"><mxGeometry width="960" height="540.5" as="geometry" /></mxCell></UserObject>' +
					`<UserObject id="o" html="${path.join(
						outside,
						"plot.html"
					)}"><mxCell parent="1" vertex="1"><mxGeometry width="10" height="10" as="geometry" /></mxCell></UserObject>` +
					'<UserObject id="m" video="assets/none.mp4"><mxCell parent="1" vertex="1"><mxGeometry width="10" height="10" as="geometry" /></mxCell></UserObject>'
			)
		),
	});
	return { folder, outside };
}

test("the HTML file holds the deck as JSON, copies its media and removes what the deck no longer uses", () => {
	const { folder, outside } = htmlFixture();
	const pages = files.shownPages(
		files.readSectionFolder(path.join(folder, "sections"))
	);
	const result = htmlDeck.writeHtmlDeck({
		target: path.join(folder, "build", "deck.html"),
		title: "Talk <1>",
		project: folder,
		svgFolder: path.join(folder, "build", "slides"),
		pages,
		sections: files.deckOutline(pages),
		width: 1920,
		height: 1080,
		extensionRoot,
	});
	const page = fs.readFileSync(
		path.join(folder, "build", "deck.html"),
		"utf8"
	);
	assert.match(page, /<title>Talk &lt;1&gt;<\/title>/);
	const json = page.match(
		/<script type="application\/json" id="deck">(.*)<\/script>/
	)[1];
	assert.doesNotMatch(json, /</);
	assert.match(
		json,
		/"videos":\[\{"cell":"v","rectangle":\{"x":10\.0,"y":20\.0,"width":300\.0,"height":200\.0\},"source":"media\/assets\/clip\.mp4","autoplay":true,"loop":false,"muted":false,"fit":"contain","bar_hide_delay":0\.0,"bar_fade_out":0\.25\}\]/
	);
	assert.match(
		json,
		/"links":\[\{"cell":"l","rectangle":\{[^}]*\},"href":"#2","opens_new_tab":false\}\]/
	);
	assert.match(json, /"bar_hide_delay":2\.0/);
	assert.match(json, /href=\\"#2\\"/);
	const deck = JSON.parse(json);
	assert.equal(deck.total, 2);
	assert.equal(
		deck.pages[1].embeds[1].source.startsWith("media/outside/"),
		true
	);
	assert.deepEqual(result.warnings, [
		'page 1, "first": the cell e is no vertex, such as an edge, and the HTML file follows the link of a vertex alone',
		'page 1, "first": the cell v has fit=zoom, which is none of contain, stretch, crop, so it shows as contain',
		'page 2, "second": a label links to the page gone, which the deck does not show',
		'page 2, "second": the video assets/none.mp4 of the cell m does not exist',
	]);
	assert.match(
		result.lines[0],
		/written: 2 pages, 1 links, 1 videos, 2 embedded pages, 2 files beside the pages$/
	);
	assert.match(
		result.lines[1],
		/removed assets\/old\.mp4, which the deck no longer uses$/
	);
	const media = path.join(folder, "build", "media");
	assert.equal(fs.existsSync(path.join(media, "assets", "old.mp4")), false);
	assert.equal(fs.existsSync(path.join(media, "assets", "plot.js")), true);
	const list = JSON.parse(
		fs.readFileSync(path.join(media, ".deck-media.json"), "utf8")
	)["deck.html"];
	assert.deepEqual(list.slice(0, 3), [
		"assets/clip.mp4",
		"assets/plot.html",
		"assets/plot.js",
	]);
	assert.equal(list.length, 5);
	assert.equal(
		list.every((file) => !file.includes(outside)),
		true
	);
});

test("the files that a page names in src and href are those that exist beside it", () => {
	const folder = folderWith({
		"page.html": `<script src="a.js"></script><link href='b.css'><img src=c%20d.png><a href="https://x.org/e.js"></a><img src="/abs.png"><img src="missing.png">`,
		"a.js": "",
		"b.css": "",
		"c d.png": "",
	});
	assert.deepEqual(
		htmlDeck.namedPageFiles(path.join(folder, "page.html")),
		["a.js", "b.css", "c d.png"].map((name) => path.join(folder, name))
	);
});

test("the pictures of assets/ are written into the slide files as data, and a missing one is named", () => {
	const folder = folderWith({
		"assets/a.png": "png",
		"sections/1-start.drawio.xml": drawing(
			page(
				"first",
				'<mxCell id="i" parent="1" style="shape=image;image=assets/a.png;" vertex="1" />' +
					'<mxCell id="j" parent="1" style="shape=image;image=assets/b.png;" vertex="1" />'
			)
		),
	});
	const first = pictures.embedSlideFilePictures(
		folder,
		"sections",
		"slides.drawio.xml"
	);
	assert.deepEqual(first.lines, [
		"sections/1-start.drawio.xml: 1 picture written as data",
	]);
	assert.deepEqual(first.warnings, [
		"assets/b.png does not exist, so its cells stay as they are",
	]);
	const text = fs.readFileSync(
		path.join(folder, "sections/1-start.drawio.xml"),
		"utf8"
	);
	assert.match(
		text,
		/image=data:image\/png,cG5n;assetSource=assets\/a\.png;/
	);
	assert.deepEqual(
		pictures.embedSlideFilePictures(folder, "sections", "slides.drawio.xml")
			.lines,
		[]
	);
});

/** A LanguageTool server on this machine that answers every label with one issue on its first word. */
function languageToolStub() {
	const requests = [];
	const server = http.createServer((request, response) => {
		let body = "";
		request.on("data", (chunk) => (body += chunk));
		request.on("end", () => {
			const form = new URLSearchParams(body);
			requests.push({
				annotation: JSON.parse(form.get("data")).annotation,
				language: form.get("language"),
				disabledRules: form.get("disabledRules"),
			});
			response.end(
				JSON.stringify({
					matches: [
						{
							message: "Possible spelling mistake found.",
							offset: 0,
							length: 4,
							replacements: [{ value: "Then" }, { value: "The" }],
							rule: { category: { id: "TYPOS" } },
						},
					],
				})
			);
		});
	});
	return new Promise((resolve) =>
		server.listen(0, "127.0.0.1", () => resolve({ server, requests }))
	);
}

test("the check sends each distinct label once and reports its issues with the first slide", async () => {
	const { server, requests } = await languageToolStub();
	try {
		const label = (id, text) =>
			`<mxCell id="${id}" parent="1" style="text;html=1;" value="${text}" vertex="1" />`;
		const folder = folderWith({
			"language-check-words.txt": "# names\nZyxw\n",
			"sections/1-start.drawio.xml": drawing(
				page(
					"intro-1",
					label("a", "Thsi is &lt;b&gt;bold&lt;/b&gt;") +
						label("n", "%slide%")
				),
				page("intro-2", label("a", "Thsi is &lt;b&gt;bold&lt;/b&gt;")),
				page("names", label("b", "Zyxw wrote it"))
			),
		});
		const lines = [];
		const issues = await build.checkDeck({
			project: folder,
			extensionRoot,
			languageTool: `http://127.0.0.1:${server.address().port}/`,
			reporter: { onLine: (line) => lines.push(line) },
		});
		assert.equal(issues, 1);
		assert.equal(requests.length, 2);
		assert.deepEqual(requests[0].annotation, [
			{ text: "Thsi is " },
			{ markup: "<b>", interpretAs: "" },
			{ text: "bold" },
			{ markup: "</b>", interpretAs: "" },
		]);
		assert.equal(requests[0].language, "en-US");
		assert.deepEqual(lines, [
			"slide 1, intro-1, cell a: spelling: Possible spelling mistake found.; Then, The",
			"    [Thsi] is bold",
			`1 issues in 2 distinct labels of 3 pages, checked by LanguageTool at http://127.0.0.1:${
				server.address().port
			}`,
		]);
	} finally {
		server.close();
	}
});

test("the check names the server when it does not answer", async () => {
	const folder = folderWith({
		"sections/1-start.drawio.xml": drawing(
			page(
				"intro",
				'<mxCell id="a" parent="1" value="Hello" vertex="1" />'
			)
		),
	});
	await assert.rejects(
		build.checkDeck({
			project: folder,
			extensionRoot,
			languageTool: "http://127.0.0.1:9",
		}),
		/LanguageTool did not answer at http:\/\/127\.0\.0\.1:9 \(.*\); start it with brew services start languagetool/
	);
});

test("the check names the refused connections when localhost does not answer", async () => {
	const closed = await new Promise((resolve) => {
		const server = net.createServer().listen(0, "localhost", () => {
			const { port } = server.address();
			server.close(() => resolve(port));
		});
	});
	const folder = folderWith({
		"sections/1-start.drawio.xml": drawing(
			page(
				"intro",
				'<mxCell id="a" parent="1" value="Hello" vertex="1" />'
			)
		),
	});
	await assert.rejects(
		build.checkDeck({
			project: folder,
			extensionRoot,
			languageTool: `http://localhost:${closed}`,
		}),
		(error) =>
			error.message.startsWith(
				`LanguageTool did not answer at http://localhost:${closed} (connect ECONNREFUSED `
			) && !error.message.includes("()")
	);
});

test("the text of a failure joins the errors of an AggregateError, and names the code of an error without a message", () => {
	const { failureText } = loadTsModule("deck/deckError.ts");
	const refused = (address) =>
		Object.assign(new Error(`connect ECONNREFUSED ${address}`), {
			code: "ECONNREFUSED",
		});
	assert.equal(
		failureText(
			Object.assign(new Error(""), {
				code: "ECONNREFUSED",
				errors: [refused("::1:9"), refused("127.0.0.1:9")],
			})
		),
		"connect ECONNREFUSED ::1:9; connect ECONNREFUSED 127.0.0.1:9"
	);
	assert.equal(
		failureText(Object.assign(new Error(""), { code: "ECONNRESET" })),
		"ECONNRESET"
	);
	assert.equal(failureText(new Error("stopped")), "stopped");
	assert.equal(failureText("a text"), "a text");
});
