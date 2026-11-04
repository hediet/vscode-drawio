const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

/** The folder of the extension, which holds `package.json` and `deck-templates/`. */
const extensionRoot = path.resolve(__dirname, "../..");

/** A new folder in the temporary folder of the system with the files given, each a path and its text. */
function folderWith(files) {
	const folder = fs.realpathSync(
		fs.mkdtempSync(path.join(os.tmpdir(), "deck-"))
	);
	for (const [file, text] of Object.entries(files)) {
		fs.mkdirSync(path.dirname(path.join(folder, file)), {
			recursive: true,
		});
		fs.writeFileSync(path.join(folder, file), text);
	}
	return folder;
}

/** A page of draw.io with the name, the cells inside its root and the attributes of its model. */
function page(name, cells = "", model = 'pageWidth="1920" pageHeight="1080"') {
	return (
		`<diagram id="${name}" name="${name}"><mxGraphModel ${model}><root>` +
		`<mxCell id="0" /><mxCell id="1" parent="0" />${cells}</root></mxGraphModel></diagram>`
	);
}

/** A file of draw.io with the pages. */
function drawing(...pages) {
	return `<mxfile>\n${pages
		.map((text) => "  " + text + "\n")
		.join("")}</mxfile>\n`;
}

module.exports = { extensionRoot, folderWith, page, drawing };
