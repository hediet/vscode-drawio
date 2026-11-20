// The section Deck styles in the draw.io editor of the submodule, driven headless through the
// browser of the build: the plugins of the slides load into the editor as the extension loads them,
// and the window stands in for the extension, which receives the edits that the section sends.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { after, test } = require("node:test");
const { loadTsModule } = require("../loadTsModule");
const { extensionRoot } = require("./deckHelpers");

const browser = loadTsModule("deck/deckBrowser.ts");
const styles = loadTsModule("deck/deckStyles.ts");
const rules = styles.loadDeckStyleRules(
	path.join(extensionRoot, "drawio-custom-plugins", "slides", "deck-style-rules.js")
);

const WEBAPP = path.join(extensionRoot, "drawio", "src", "main", "webapp");
const PLUGINS = path.join(extensionRoot, "drawio-custom-plugins", "slides");
const TYPES = {
	".html": "text/html",
	".js": "text/javascript",
	".css": "text/css",
	".svg": "image/svg+xml",
	".png": "image/png",
	".json": "application/json",
	".xml": "application/xml",
	".txt": "text/plain",
};

// A functionality wire and a resource wire of a co-design diagram: the dot of each is tangent to
// the border of the box it is attached to, through the negative spacing with fixedPointSpacing=1.
const FUNCTIONALITY =
	"edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;html=1;strokeColor=#008000;deckStrokeColor=dpgreen;strokeWidth=3;startArrow=none;endArrow=circle;endFill=1;endSize=3;targetPerimeterSpacing=-1.5;fixedPointSpacing=1;";
const RESOURCE =
	"edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;html=1;strokeColor=#B30000;deckStrokeColor=dpred;strokeWidth=3;dashed=1;dashPattern=1 1.5;startArrow=circle;startFill=1;startSize=3;sourcePerimeterSpacing=-1.5;endArrow=none;fixedPointSpacing=1;";
const BOX = "rounded=1;absoluteArcSize=1;arcSize=18;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#000000;strokeWidth=3;";

function escaped(text) {
	return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function box(id, x, y) {
	return `<mxCell id="${id}" value="${id}" style="${escaped(BOX)}" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="200" height="100" as="geometry"/></mxCell>`;
}

function vertex(id, style, x, y) {
	return `<mxCell id="${id}" value="${id}" style="${escaped(style)}" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="120" height="120" as="geometry"/></mxCell>`;
}

function wire(id, style, source, target, exitAndEntry) {
	return (
		`<mxCell id="${id}" value="${id}" style="${escaped(style + exitAndEntry)}" edge="1" parent="1" source="${source}" target="${target}">` +
		`<mxGeometry x="-0.2" y="10" relative="1" as="geometry"><mxPoint as="offset" x="5" y="-20"/></mxGeometry></mxCell>`
	);
}

const DIAGRAM =
	'<mxfile><diagram id="p" name="page-1"><mxGraphModel pageWidth="1920" pageHeight="1080"><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
	box("a", 100, 100) +
	box("b", 500, 100) +
	box("c", 100, 400) +
	box("d", 500, 400) +
	wire("f1", FUNCTIONALITY, "a", "b", "exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;") +
	wire("f2", FUNCTIONALITY, "c", "d", "exitX=1;exitY=0.25;exitDx=0;exitDy=0;entryX=0;entryY=0.75;entryDx=0;entryDy=0;") +
	wire("r1", RESOURCE, "b", "d", "exitX=0.5;exitY=1;exitDx=0;exitDy=0;entryX=0.5;entryY=0;entryDx=0;entryDy=0;") +
	vertex("e1", "ellipse;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#000000;strokeWidth=3;", 900, 100) +
	vertex("e2", "whiteSpace=wrap;html=1;shape=ellipse;perimeter=ellipsePerimeter;fillColor=none;rotation=30;", 900, 400) +
	"</root></mxGraphModel></diagram></mxfile>";

/** A server of the files of draw.io and of the plugins of the slides, on a free port. */
function serveEditor() {
	const server = http.createServer((request, response) => {
		const url = new URL(request.url, "http://localhost");
		const [root, relative] = url.pathname.startsWith("/slides/")
			? [PLUGINS, url.pathname.slice("/slides/".length)]
			: [WEBAPP, url.pathname.slice(1) || "index.html"];
		const file = path.resolve(root, decodeURIComponent(relative));
		if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
			response.writeHead(404);
			response.end();
			return;
		}
		response.writeHead(200, {
			"Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream",
		});
		fs.createReadStream(file).pipe(response);
	});
	return new Promise((resolve) =>
		server.listen(0, "127.0.0.1", () => resolve(server))
	);
}

const browserStarts = browser.launchBrowser().then(
	(launched) => launched,
	() => undefined
);

after(async () => {
	await (await browserStarts)?.close();
});

/**
 * Opens the editor on the diagram with the plugins of the styles and the colors, and returns the
 * page with the edits that the section sends in `window.sentEdits`.
 */
async function openEditor(launched, baseUrl, deckStyles) {
	const page = await launched.newPage({ viewport: { width: 1400, height: 900 } });
	await page.addInitScript(() => {
		// The window stands in for the extension, as the opener of the editor.
		window.opener = window;
		window.sentEdits = [];
		window.addEventListener("message", (event) => {
			if (typeof event.data === "string" && event.data.includes('"drawSlidesCodeEditStyle"')) {
				window.sentEdits.push(JSON.parse(event.data));
			}
		});
	});
	// Without offline=1, draw.io installs Draw.loadPlugin, and stealth=1 keeps it off the network.
	await page.goto(
		`${baseUrl}/index.html?embed=1&proto=json&spin=0&stealth=1&pwa=0&lang=en&dev=0&ui=kennedy`
	);
	await page.waitForFunction(() => typeof window.Draw === "object" && window.Draw.loadPlugin);
	await page.evaluate((settings) => {
		window.drawSlidesCodeSettings = settings;
	}, {
		colors: [
			{ name: "dpgreen", value: "#008000" },
			{ name: "dpred", value: "#B30000" },
		],
		colorLinks: {
			keys: Object.fromEntries(
				Object.entries(loadTsModule("deck/deckColors.ts").COLOR_LINK_KEYS).map(
					([key, { link }]) => [key, link]
				)
			),
			textAttribute: "data-deck-color",
		},
		styles: deckStyles,
	});
	for (const plugin of [
		"slide-settings.js",
		"deck-color-links.plugin.js",
		"deck-colors-section.plugin.js",
		"deck-style-rules.js",
		"deck-styles-section.plugin.js",
	]) {
		await page.addScriptTag({ url: `${baseUrl}/slides/${plugin}` });
	}
	await page.addScriptTag({
		content: "Draw.loadPlugin(function (ui) { window.testUi = ui; });",
	});
	await page.waitForFunction(() => window.testUi !== undefined);
	await page.evaluate((diagram) => {
		window.testUi.setFileData(diagram);
		// draw.io in embed mode shows its page after the handshake with its opener, which the
		// test leaves out.
		for (const element of [document.body, ...document.body.children]) {
			element.style.visibility = "visible";
		}
		window.testUi.format.refresh();
	}, DIAGRAM);
	await page.waitForFunction(() => window.testUi.editor.graph.getModel().getCell("f1") != null);
	return page;
}

/** Sends the styles to the editor as the extension does after a change of the setting. */
async function sendStyles(page, deckStyles) {
	await page.evaluate((given) => {
		window.postMessage(
			JSON.stringify({ action: "drawSlidesCodeSettings", settings: { styles: given } }),
			"*"
		);
	}, deckStyles);
	await page.waitForFunction(
		(count) => window.drawSlidesCodeSettings.styles.length === count,
		deckStyles.length
	);
}

/** Renames the style through the button ✎ of its tile and the rename dialog of draw.io. */
async function rename(section, page, name, newName) {
	await section.locator(`[data-deck-style="${name}"] button:text("✎")`).click();
	const field = page.locator(".geDialog input").first();
	await field.fill(newName);
	await field.press("Enter");
}

/** The style, the terminals, the geometry, the points and the label of each wire, as the editor holds and draws them. */
function wireStates(page) {
	return page.evaluate(() => {
		const graph = window.testUi.editor.graph;
		const model = graph.getModel();
		return Object.fromEntries(
			["f1", "f2", "r1"].map((id) => {
				const cell = model.getCell(id);
				const state = graph.view.getState(cell);
				return [
					id,
					{
						style: model.getStyle(cell),
						source: model.getTerminal(cell, true).id,
						target: model.getTerminal(cell, false).id,
						geometry: mxUtils.getXml(new mxCodec().encode(cell.geometry)),
						points: state.absolutePoints.map((point) => [
							Math.round(point.x * 100) / 100,
							Math.round(point.y * 100) / 100,
						]),
						label: [state.text.bounds.x, state.text.bounds.y].map(Math.round),
					},
				];
			})
		);
	});
}

/** The edits that the section has sent, once there are as many as the count. */
async function sentEdits(page, count) {
	await page.waitForFunction((expected) => window.sentEdits.length >= expected, count);
	return page.evaluate(() => window.sentEdits);
}

function select(page, ids) {
	return page.evaluate((selected) => {
		const graph = window.testUi.editor.graph;
		graph.setSelectionCells(selected.map((id) => graph.getModel().getCell(id)));
		window.testUi.format.refresh();
	}, ids);
}

const GEOMETRY_KEY = /(?:^|;)((?:exit|entry)(?:X|Y|Dx|Dy|Perimeter)=[^;]*)/g;
const geometryKeys = (style) => [...style.matchAll(GEOMETRY_KEY)].map(([, entry]) => entry).sort();

test("a wire style saved, given and updated in the editor keeps the terminals, the geometry, the drawn ends and the label of every wire", async (t) => {
	const launched = await browserStarts;
	if (launched === undefined) {
		t.skip("no headless browser starts on this machine");
		return;
	}
	const server = await serveEditor();
	const baseUrl = `http://127.0.0.1:${server.address().port}`;
	try {
		const page = await openEditor(launched, baseUrl, []);
		const before = await wireStates(page);

		// New style from selection on the functionality wire f1.
		await select(page, ["f1"]);
		const section = page.locator('.geFormatSection:has(.geCollapsibleTitle:text("Deck styles"))');
		await section.locator('[data-deck-style-kind="wire"] button:text("New style from selection")').click();
		const [saved] = await sentEdits(page, 1);
		assert.equal(saved.operation, "set");
		assert.equal(saved.kind, "wire");
		assert.equal(saved.name, "wire1");
		assert.deepEqual(geometryKeys(saved.style), []);
		assert.equal(saved.style, rules.appearanceOf(FUNCTIONALITY));
		await sendStyles(page, [{ kind: "wire", name: "wire1", style: saved.style }]);

		// The same for the resource wire r1, which the extension saves as resourceWire.
		await select(page, ["r1"]);
		await section.locator('[data-deck-style-kind="wire"] button:text("New style from selection")').click();
		const resource = (await sentEdits(page, 2))[1];
		await sendStyles(page, [
			{ kind: "wire", name: "wire1", style: saved.style },
			{ kind: "wire", name: "wire2", style: resource.style },
		]);

		// The functionality wire f2 takes wire1 with a click on its tile.
		await select(page, ["f2"]);
		await section.locator('[data-deck-style="wire1"] button.geColorBtn').click();
		const given = await wireStates(page);
		for (const id of ["f1", "f2", "r1"]) {
			assert.equal(given[id].source, before[id].source);
			assert.equal(given[id].target, before[id].target);
			assert.equal(given[id].geometry, before[id].geometry);
			assert.deepEqual(given[id].points, before[id].points, `the ends of ${id}`);
			assert.deepEqual(given[id].label, before[id].label, `the label of ${id}`);
			assert.deepEqual(geometryKeys(given[id].style), geometryKeys(before[id].style));
		}
		assert.match(given.f1.style, /deckStyle=wire1;$/);
		assert.match(given.f2.style, /deckStyle=wire1;$/);
		assert.match(given.r1.style, /deckStyle=wire2;$/);
		// draw.io draws the Format panel again after the change of the model, and the tile of the
		// style of the selected wire then has a frame.
		await page.waitForFunction(() =>
			[...document.querySelectorAll('[data-deck-style="wire1"]')].some(
				(tile) => tile.style.borderColor === "rgb(41, 182, 242)"
			)
		);

		// The dot of f1 grows, f1 now differs from wire1, and Update redefines wire1 from f1.
		await page.evaluate(() => {
			const graph = window.testUi.editor.graph;
			graph.setCellStyles("endSize", "5", [graph.getModel().getCell("f1")]);
		});
		await select(page, ["f1"]);
		assert.match(await section.textContent(), /The wire differs from wire1 in endSize\./);
		const undoBefore = await page.evaluate(() => window.testUi.editor.undoManager.history.length);
		await section.locator('button:text("Update")').click();
		const updated = await wireStates(page);
		assert.match(updated.f2.style, /endSize=5;/);
		assert.equal(updated.r1.style, given.r1.style);
		for (const id of ["f1", "f2"]) {
			assert.equal(updated[id].geometry, before[id].geometry);
			assert.deepEqual(updated[id].points, before[id].points, `the ends of ${id} after the update`);
			assert.deepEqual(updated[id].label, before[id].label, `the label of ${id} after the update`);
			assert.match(updated[id].style, /targetPerimeterSpacing=-1\.5;fixedPointSpacing=1;/);
		}
		assert.equal(
			await page.evaluate(() => window.testUi.editor.undoManager.history.length),
			undoBefore + 1
		);
		const update = (await sentEdits(page, 3))[2];
		assert.deepEqual(update, {
			event: "drawSlidesCodeEditStyle",
			operation: "set",
			kind: "wire",
			name: "wire1",
			style: saved.style.replace("endSize=3", "endSize=5"),
		});
		await page.close();
	} finally {
		server.close();
	}
});

test("a rectangle style is listed for a selected rectangle alone, a removal and a rename are sent with the name, and the rename that the extension sends reaches the cells linked since the load on every page", async (t) => {
	const launched = await browserStarts;
	if (launched === undefined) {
		t.skip("no headless browser starts on this machine");
		return;
	}
	const server = await serveEditor();
	const baseUrl = `http://127.0.0.1:${server.address().port}`;
	try {
		const page = await openEditor(launched, baseUrl, [
			{ kind: "rectangle", name: "box", style: rules.appearanceOf(BOX) },
			{ kind: "wire", name: "wire1", style: rules.appearanceOf(FUNCTIONALITY) },
		]);
		const section = page.locator('.geFormatSection:has(.geCollapsibleTitle:text("Deck styles"))');
		await select(page, ["a"]);
		assert.equal(await section.locator("[data-deck-style-kind]").count(), 1);
		assert.equal(await section.locator('[data-deck-style-kind="rectangle"] [data-deck-style]').count(), 1);
		const titles = await page.locator(".geFormatSection > .geCollapsibleTitle").allTextContents();
		assert.equal(titles.indexOf("Deck styles"), titles.indexOf("Deck colors") + 1);
		await section.locator('[data-deck-style="box"] button.geColorBtn').click();
		assert.match(
			await page.evaluate(() => window.testUi.editor.graph.getModel().getCell("a").style),
			/deckStyle=box;$/
		);
		await rename(section, page, "box", "designProblem");
		await select(page, []);
		// With nothing selected, the section sits in the Style tab of the diagram.
		await page.locator('.geFormatContainer >> text="Style"').first().click();
		await section.locator('[data-deck-style="wire1"] button:text("×")').click();
		assert.deepEqual(
			(await sentEdits(page, 2)).map(({ operation, name, newName }) => [operation, name, newName]),
			[
				["rename", "box", "designProblem"],
				["remove", "wire1", undefined],
			]
		);
		// The section sends an edit alone, and the cell linked in this session takes the rename
		// when the extension sends the edit of the linked cells, on its page and on another page.
		assert.match(
			await page.evaluate(() => window.testUi.editor.graph.getModel().getCell("a").style),
			/deckStyle=box;$/
		);
		const renamed = await page.evaluate(() => {
			const ui = window.testUi;
			const other = ui.insertPage();
			const cell = new mxCell("", new mxGeometry(0, 0, 10, 10), "rounded=1;deckStyle=box;");
			cell.vertex = true;
			ui.editor.graph.addCell(cell);
			ui.selectPage(ui.pages[0]);
			window.postMessage(
				JSON.stringify({
					action: "drawSlidesCodeStyleUse",
					edit: { operation: "rename", name: "box", newName: "designProblem" },
				}),
				"*"
			);
			return new Promise((resolve) =>
				setTimeout(() => {
					const styles = [];
					const visit = (node) => {
						if (node == null) {
							return;
						}
						if (typeof node.style === "string" && /deckStyle=/.test(node.style)) {
							styles.push(node.style);
						}
						(node.children || []).forEach(visit);
					};
					ui.pages.forEach((each) => visit(each.root));
					resolve({ styles });
				}, 200)
			);
		});
		assert.equal(renamed.styles.length, 2);
		assert.ok(renamed.styles.every((style) => style.endsWith("deckStyle=designProblem;")));
		await page.close();
	} finally {
		server.close();
	}
});

test("an ellipse style is saved from one ellipse and given to another, which keeps its own shape keys, and a tile holds its name and buttons under its preview", async (t) => {
	const launched = await browserStarts;
	if (launched === undefined) {
		t.skip("no headless browser starts on this machine");
		return;
	}
	const server = await serveEditor();
	const baseUrl = `http://127.0.0.1:${server.address().port}`;
	try {
		const page = await openEditor(launched, baseUrl, [
			{ kind: "wire", name: "functionalityWire", style: rules.appearanceOf(FUNCTIONALITY) },
		]);
		const section = page.locator('.geFormatSection:has(.geCollapsibleTitle:text("Deck styles"))');
		await select(page, ["e1", "a"]);
		assert.deepEqual(
			await section.locator("[data-deck-style-kind]").evaluateAll((lists) => lists.map((list) => list.getAttribute("data-deck-style-kind"))),
			["ellipse", "rectangle"]
		);
		await select(page, ["e1"]);
		await section.locator('[data-deck-style-kind="ellipse"] button:text("New style from selection")').click();
		const [saved] = await sentEdits(page, 1);
		assert.deepEqual(saved, {
			event: "drawSlidesCodeEditStyle",
			operation: "set",
			kind: "ellipse",
			name: "ellipse1",
			style: "whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#000000;strokeWidth=3;",
		});
		await sendStyles(page, [
			{ kind: "wire", name: "functionalityWire", style: rules.appearanceOf(FUNCTIONALITY) },
			{ kind: "ellipse", name: "ellipse1", style: saved.style },
		]);
		await select(page, ["e2"]);
		await section.locator('[data-deck-style="ellipse1"] button.geColorBtn').click();
		assert.equal(
			await page.evaluate(() => window.testUi.editor.graph.getModel().getCell("e2").style),
			"whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#000000;strokeWidth=3;shape=ellipse;perimeter=ellipsePerimeter;rotation=30;deckStyle=ellipse1;"
		);
		// The preview of the tile draws an ellipse, and the name and the buttons sit under it, inside the tile.
		await page.waitForFunction(() => document.querySelector('[data-deck-style="ellipse1"] svg ellipse') !== null);
		const boxes = await section.locator('[data-deck-style="ellipse1"]').evaluate((tile) => {
			const box = (element) => {
				const rect = element.getBoundingClientRect();
				return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
			};
			return {
				tile: box(tile),
				preview: box(tile.querySelector("button.geColorBtn")),
				name: box(tile.querySelector(".deckStyleName")),
				buttons: [...tile.querySelectorAll("button:not(.geColorBtn)")].map(box),
			};
		});
		assert.ok(boxes.name.top >= boxes.preview.bottom, "the name is under the preview");
		for (const button of boxes.buttons) {
			assert.ok(button.top >= boxes.name.bottom, "each button is under the name");
		}
		for (const part of [boxes.preview, boxes.name, ...boxes.buttons]) {
			assert.ok(
				part.left >= boxes.tile.left && part.right <= boxes.tile.right && part.bottom <= boxes.tile.bottom,
				"each part is inside the tile"
			);
		}
		await page.close();
	} finally {
		server.close();
	}
});
