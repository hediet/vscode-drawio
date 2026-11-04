const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { loadTsModule } = require("../loadTsModule");
const { folderWith, page } = require("./deckHelpers");

const xml = loadTsModule("deck/xmlTree.ts");
const cells = loadTsModule("deck/deckCells.ts");
const snapshots = loadTsModule("deck/pageSnapshots.ts");
const pictures = loadTsModule("deck/deckPictures.ts");

const plain = (value) => JSON.parse(JSON.stringify(value));

test("a page read and written back keeps its content, without comments and processing instructions", () => {
	const source =
		'<diagram id="d" name="n"><!-- c --><mxGraphModel a="x&#10;y" b=\'it&apos;s "q"\'>\n  <root>text&amp;more<![CDATA[<raw>]]>\n' +
		'    <mxCell id="0"/><mxCell id="1" parent="0" value="a\tb\nc&gt;"></mxCell><?pi x?>tail</root></mxGraphModel></diagram>';
	assert.equal(
		xml.serializeXml(xml.parseXml(source)),
		'<diagram id="d" name="n"><mxGraphModel a="x&#10;y" b="it\'s &quot;q&quot;">\n  <root>text&amp;more&lt;raw&gt;\n' +
			'    <mxCell id="0" /><mxCell id="1" parent="0" value="a b c&gt;" />tail</root></mxGraphModel></diagram>'
	);
});

test("a text that is no element of XML is refused with the place of the fault", () => {
	assert.throws(
		() => xml.parseXml("<a><b></a>"),
		/the element b ends with the tag of a/
	);
	assert.throws(
		() => xml.parseXml('<a x="1" x="2"/>'),
		/holds the attribute x twice/
	);
	assert.throws(
		() => xml.parseXml("<a>&nbsp;</a>"),
		/the entity &nbsp; is not defined/
	);
	assert.throws(() => xml.parseXml("<a/><b/>"), /goes on after its element/);
});

test("an attribute is set in its place, or else last, on a new element", () => {
	const element = xml.parseXml('<c id="1" style="a" />');
	assert.equal(
		xml.serializeXml(xml.withAttribute(element, "style", "b")),
		'<c id="1" style="b" />'
	);
	assert.equal(
		xml.serializeXml(xml.withAttribute(element, "x", "y")),
		'<c id="1" style="a" x="y" />'
	);
	assert.equal(xml.serializeXml(element), '<c id="1" style="a" />');
});

const embedded = page(
	"plot-1",
	'<mxCell id="group" parent="1" vertex="1"><mxGeometry x="100" y="50" width="10" height="10" as="geometry" /></mxCell>' +
		'<UserObject id="p" html=" assets/plots/surface.html " barFadeOut="x">' +
		'<mxCell parent="group" style="rounded=1;fillColor=#fff;" vertex="1"><mxGeometry x="10" y="20" width="960" height="540.5" as="geometry" /></mxCell></UserObject>' +
		'<object id="v" html="a.html" video="b.mp4"><mxCell parent="1" vertex="1"><mxGeometry width="1" height="1" as="geometry" /></mxCell></object>' +
		'<mxCell id="hidden-layer" parent="0" visible="0" />' +
		'<object id="h" html="hidden.html"><mxCell parent="hidden-layer" vertex="1"><mxGeometry width="1" height="1" as="geometry" /></mxCell></object>'
);

test("a cell of an embedded page lies at the offsets of its groups, and a cell with a video or in a hidden layer is none", () => {
	const problems = [];
	const pages = cells.readCellPages(cells.readCells(embedded), problems);
	assert.deepEqual(plain(pages), [
		{
			cell: "p",
			rectangle: { x: 110, y: 70, width: 960, height: 540.5 },
			source: "assets/plots/surface.html",
			barHideDelay: 0,
			barFadeOut: 0.25,
		},
	]);
	assert.deepEqual(problems, [
		"the cell p has barFadeOut=x, which is no time of 0 s or more, so it takes 0.25",
	]);
});

test("the picture of a page is named after the page and a digest of its address and its size", () => {
	const [found] = snapshots.embeddedPages(xml.parseXml(embedded));
	assert.equal(
		snapshots.snapshotFile("/shots", found),
		"/shots/surface-ea075e8ec82fdfe7.png"
	);
});

test("a cell of an embedded page is drawn as the picture of its page, with a warning for a shape that was not an image", () => {
	const folder = folderWith({ "shot.png": "PNG" });
	const [found] = snapshots.embeddedPages(xml.parseXml(embedded));
	const result = snapshots.withPagePictures(
		embedded,
		new Map([
			[snapshots.snapshotKey(found), path.join(folder, "shot.png")],
		]),
		'slide 1, "plot-1"'
	);
	assert.match(
		result.diagram,
		/<UserObject id="p" html=" assets\/plots\/surface.html " barFadeOut="x"><mxCell parent="group" style="shape=image;image=data:image\/png,UE5H;imageAspect=0;rounded=1;fillColor=#fff;" vertex="1">/
	);
	assert.deepEqual(plain(result.warnings), [
		'slide 1, "plot-1", the cell p of the page assets/plots/surface.html is a rectangle shape, so the builds draw it as a rectangular picture of its page; give it the shape image',
	]);
	assert.equal(
		snapshots.withPagePictures(embedded, new Map(), "x").diagram,
		embedded
	);
	assert.deepEqual(
		plain(
			snapshots.pictureStyle("shape=image;image=old;aspect=fixed", "D")
		),
		{
			style: "shape=image;image=D;imageAspect=0;aspect=fixed;",
		}
	);
});

test("a picture of assets/ is written into its cell as data, once, and a missing file is named", () => {
	const folder = folderWith({ "assets/logo.svg": "<svg/>" });
	const text =
		'<mxCell id="a" style="shape=image;image=assets/logo.svg;" vertex="1" />' +
		'<mxCell id="b" style="image=assets/gone.png" vertex="1" />' +
		'<mxCell id="c" style="rounded=1" vertex="1" />';
	const first = pictures.embedPictures(text, folder);
	assert.equal(first.written, 1);
	assert.deepEqual(plain(first.missing), ["assets/gone.png"]);
	assert.match(
		first.text,
		/style="shape=image;image=data:image\/svg\+xml,PHN2Zy8\+;assetSource=assets\/logo.svg;"/
	);
	const second = pictures.embedPictures(first.text, folder);
	assert.equal(second.written, 0);
	assert.equal(second.text, first.text);
	fs.writeFileSync(path.join(folder, "assets/logo.svg"), "<svg />");
	assert.equal(pictures.embedPictures(first.text, folder).written, 1);
});
