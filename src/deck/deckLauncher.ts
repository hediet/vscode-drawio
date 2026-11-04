/**
 * The launcher of the command line in a presentation, `drawio-slides.cjs`, which the extension
 * keeps in `deck-templates/` and copies into each presentation. The launcher runs `dist/cli.js`
 * of the newest installed version of the extension, so that the scripts of the `package.json` of
 * a presentation name no version and keep working after an update of the extension.
 */
import * as path from "path";

/** The folder of the extension that holds the template, the starting palette and the launcher. */
export const TEMPLATE_FOLDER = "deck-templates";
/** The launcher, by its name in `deck-templates/` and in a presentation. */
export const DECK_LAUNCHER = "drawio-slides.cjs";
/** The command line that each script of the `package.json` of a presentation starts with. */
export const DECK_COMMAND_LINE = `node ${DECK_LAUNCHER}`;

export function launcherFile(extensionRoot: string): string {
	return path.join(extensionRoot, TEMPLATE_FOLDER, DECK_LAUNCHER);
}
