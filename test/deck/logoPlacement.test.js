const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { PNG } = require("pngjs");
const { loadTsModule } = require("../loadTsModule");
const { folderWith, page, drawing } = require("./deckHelpers");

const logos = loadTsModule("deck/logoPlacement.ts");
const commandLine = loadTsModule("deck/commandLine.ts");
const { extensionRoot } = require("./deckHelpers");

/** A PNG of the size, transparent apart from an opaque rectangle of the colour. */
function pngFile(folder, name, width, height, box, colour) {
	const png = new PNG({ width, height });
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const inside =
				x >= box.left &&
				x < box.right &&
				y >= box.top &&
				y < box.bottom;
			png.data.set(
				inside ? [...colour, 255] : [0, 0, 0, 0],
				(y * width + x) * 4
			);
		}
	}
	const file = path.join(folder, name);
	fs.writeFileSync(file, PNG.sync.write(png));
	return file;
}

function pictureOfCell(text, cellId) {
	const data = new RegExp(
		`<mxCell id="${cellId}"[^>]*image=data:image/png,([^;]+);`
	).exec(text)[1];
	return PNG.sync.read(Buffer.from(data, "base64"));
}

test("the logos are cropped, resampled, spread with equal gaps and written in place or added", () => {
	const folder = folderWith({
		"sections/1-a.drawio.xml": drawing(
			page(
				"title-slide-1",
				'\n        <mxCell id="old-logo" parent="1" style="shape=image;" value="" vertex="1">\n          <mxGeometry x="1" y="2" width="3" height="4" as="geometry"/>\n        </mxCell>\n      '
			),
			page("other-1")
		),
	});
	const wide = pngFile(
		folder,
		"wide.png",
		60,
		30,
		{ left: 10, right: 50, top: 5, bottom: 25 },
		[200, 20, 40]
	);
	const square = pngFile(
		folder,
		"square.png",
		20,
		20,
		{ left: 0, right: 20, top: 0, bottom: 20 },
		[0, 0, 255]
	);
	const section = path.join(folder, "sections/1-a.drawio.xml");
	const lines = logos.placeLogos(section, "title-slide-1", [
		{ cellId: "old-logo", file: wide },
		{ cellId: "new-logo", file: square },
	]);
	assert.deepEqual(lines, [
		"old-logo at x 160.0, 200.0 wide and 100.0 high",
		"new-logo at x 1660.0, 100.0 wide and 100.0 high",
		"gap between two logos: 1300.0",
	]);
	const text = fs.readFileSync(section, "utf8");
	assert.match(
		text,
		/<mxCell id="old-logo" parent="1" style="shape=image;html=1;imageAspect=1;aspect=fixed;image=data:image\/png,/
	);
	assert.match(
		text,
		/<mxGeometry height="100" width="200" x="160" y="875" as="geometry"\/>/
	);
	assert.match(text, /<mxCell id="new-logo" parent="1" /);
	assert.equal(text.match(/id="old-logo"/g).length, 1);
	assert.ok(text.indexOf("new-logo") < text.indexOf('name="other-1"'));
	const picture = pictureOfCell(text, "old-logo");
	assert.equal(picture.width, 600);
	assert.equal(picture.height, 300);
	assert.deepEqual([...picture.data.subarray(0, 4)], [200, 20, 40, 255]);
});

test("a missing page, a missing logo and a transparent logo stop the placement with the reason", () => {
	const folder = folderWith({
		"a.drawio.xml": drawing(page("title-slide-1")),
	});
	const empty = pngFile(
		folder,
		"empty.png",
		4,
		4,
		{ left: 0, right: 0, top: 0, bottom: 0 },
		[0, 0, 0]
	);
	const file = path.join(folder, "a.drawio.xml");
	assert.throws(
		() => logos.placeLogos(file, "nothing-1", []),
		/has no page named nothing-1/
	);
	assert.throws(
		() =>
			logos.placeLogos(file, "title-slide-1", [
				{ cellId: "x", file: path.join(folder, "gone.png") },
			]),
		/the logo .*gone\.png does not exist/
	);
	assert.throws(
		() =>
			logos.placeLogos(file, "title-slide-1", [
				{ cellId: "x", file: empty },
			]),
		/has no pixel that is not transparent/
	);
});

test("the mode place-logos reads the logos and the row from the command line", async () => {
	const folder = folderWith({
		"a.drawio.xml": drawing(page("title-slide-1")),
	});
	const logo = pngFile(
		folder,
		"logo.png",
		10,
		10,
		{ left: 0, right: 10, top: 0, bottom: 10 },
		[9, 9, 9]
	);
	const out = [];
	const err = [];
	const status = await commandLine.runCommandLine(
		[
			"place-logos",
			path.join(folder, "a.drawio.xml"),
			"title-slide-1",
			`one=${logo}`,
			"--height",
			"50",
			"--left",
			"100",
			"--scale",
			"2",
		],
		{},
		extensionRoot,
		{ out: (line) => out.push(line), err: (line) => err.push(line) },
		new AbortController().signal
	);
	assert.equal(status, commandLine.ExitStatus.DONE);
	assert.deepEqual(out, [
		"one at x 100.0, 50.0 wide and 50.0 high",
		"gap between two logos: 1610.0",
	]);
	const wrong = await commandLine.runCommandLine(
		["place-logos", "a.drawio.xml", "title-slide-1", "no-file"],
		{},
		extensionRoot,
		{ out: () => {}, err: (line) => err.push(line) },
		new AbortController().signal
	);
	assert.equal(wrong, commandLine.ExitStatus.USAGE);
	assert.match(err[err.length - 1], /no-file is no <cell id>=<logo file>/);
});
