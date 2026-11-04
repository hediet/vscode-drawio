/**
 * The files of the extension that the build reads, so that the editor and the build draw and
 * check alike: the draw.io viewer that exports the pages, the plugins of the editor in
 * `drawio-custom-plugins/slides/` that the build shares, and the page of the HTML file in
 * `deck-templates/`. Each function takes the folder of the extension, `extensionRoot`, which is
 * the folder of the installed extension or of a clone of the fork with its submodule `drawio`.
 */
import * as path from "path";
import { DeckError } from "./deckError";
import { isFile } from "./deckFiles";
import { TEMPLATE_FOLDER } from "./deckLauncher";

const PLUGIN_FOLDER = path.join("drawio-custom-plugins", "slides");
const VIEWER = path.join(
	"drawio",
	"src",
	"main",
	"webapp",
	"js",
	"viewer-static.min.js"
);
/** The page of the HTML file, whose placeholders the build fills in. */
const HTML_PAGE = "html-deck.html";

/** A file of the extension, which the build stops without. */
function extensionFile(extensionRoot: string, relative: string): string {
	const file = path.join(path.resolve(extensionRoot), relative);
	if (!isFile(file)) {
		throw new DeckError(`${file} is missing`);
	}
	return file;
}

/** A plugin of the editor that the build shares, such as `media-bar.js`. */
export function pluginFile(extensionRoot: string, name: string): string {
	return extensionFile(extensionRoot, path.join(PLUGIN_FOLDER, name));
}

/** The draw.io viewer that the extension bundles, in `webapp/js/` of draw.io. */
export function viewerFile(extensionRoot: string): string {
	return extensionFile(extensionRoot, VIEWER);
}

/** The page of the HTML file of a deck. */
export function htmlPageFile(extensionRoot: string): string {
	return extensionFile(extensionRoot, path.join(TEMPLATE_FOLDER, HTML_PAGE));
}
