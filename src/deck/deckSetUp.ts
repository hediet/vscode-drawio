/**
 * The writing of a new deck and of the settings of a deck, from the template and the starting
 * palette in `deck-templates/` of the extension.
 *
 * `initDeck` starts a presentation as a git repository of its own: a section file with the
 * starting pages of the template, a `package.json` of the commands of the deck and of the key
 * `config`, the launcher `drawio-slides.cjs` that the commands run, the lines that the
 * `.gitignore` of the folder lacks, `templates/slides.drawio.xml` and `.vscode/settings.json` with
 * the colors of the starting palette. `writeVscodeSettings` and
 * `copyMissingTemplates` set up the editor for a presentation that lacks its settings.
 *
 * The settings associate `.drawio.xml` with the editor of the extension, set `drawioSlides.slides`,
 * with which the extension loads the plugins of the slides, name the files in `templates/` of the
 * presentation in `drawioSlides.templates`, and give `drawioSlides.colors` the colors and the
 * comments of the starting palette, without the header of the palette, the comment lines before its
 * first blank line.
 *
 * Yujun Huang grants an additional permission for this file under section 7 of the GNU General
 * Public License, version 3, in LICENSE-EXCEPTION.md of Draw.io Slides.
 */
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { DeckError } from "./deckError";
import {
	DECK_COMMAND_LINE,
	DECK_LAUNCHER,
	launcherFile,
	TEMPLATE_FOLDER,
} from "./deckLauncher";
import { migrationOffer } from "./deckMigration";
import {
	DIAGRAM,
	PACKAGE,
	PAGE_NAME,
	sectionFileName,
	SINGLE_FILE,
	SLIDES_DIR,
	slug,
} from "./deckFiles";
import { COLORS, DECK_SETTINGS, SETTING_PREFIX } from "./deckSettings";
import { CommentedObject, withMemberObject } from "./jsonWithComments";
import { readColorFileText } from "./texDefinitions";
import { jsonText } from "./textFormats";

export { DECK_COMMAND_LINE, DECK_LAUNCHER, launcherFile, TEMPLATE_FOLDER };

const TEMPLATE = "slide-format.drawio.xml";
/** The colors that a new deck starts with in its setting `drawioSlides.colors`. */
const STARTING_PALETTE = "color-definitions.tex";
/** The folder of a presentation that holds its copies of the template files. */
export const DECK_TEMPLATES = "templates";
/** The copy of the template in a presentation, from which the editor inserts a slide. */
export const DECK_TEMPLATE = "slides.drawio.xml";
/**
 * The files, by their paths with `/` below the deck folder, that stop the start of a presentation
 * in a folder that holds one, beside its `package.json` and the slides that its `config` names.
 */
export const FILES_THAT_STOP_A_START: readonly string[] = [
	DECK_SETTINGS,
	`${DECK_TEMPLATES}/${DECK_TEMPLATE}`,
	DECK_LAUNCHER,
];
/** The pages of the template a new presentation starts with, in this order. */
export const STARTER_PAGES = [
	"title-slide-1",
	"section-divider-1",
	"title-and-body-1",
] as const;
/** The commands of the `package.json` of a presentation, each named after the mode it runs. */
export const DECK_COMMANDS = [
	"build",
	"watch",
	"pdf",
	"html",
	"outline",
	"check",
] as const;
/**
 * The lines of the `.gitignore` of a new presentation: what the build and macOS write into its
 * folder, and the settings of Claude Code for one machine alone, which a session started in the
 * presentation writes.
 */
export const DECK_IGNORED = [
	"build/",
	".DS_Store",
	".claude/settings.local.json",
] as const;
/**
 * The color settings of a color configuration that `writeVscodeSettings` writes. The extension
 * names the colors of `drawioSlides.colors` in the picker by itself, so `colorNames` and
 * `presetColors` stay out.
 */
const COLOR_SETTINGS = ["customColorSchemes"] as const;

/** A text that the set-up writes, with the warnings of the reading of its sources. */
export interface SetUpResult {
	/** The lines that say what was written. */
	readonly lines: readonly string[];
	readonly warnings: readonly string[];
}

/** What `initDeck` starts a presentation with. */
export interface InitOptions {
	/** The folder of the presentation, which may not exist yet. */
	readonly project: string;
	/** The folder of the extension, which holds `deck-templates/`. */
	readonly extensionRoot: string;
	/** The title, or else the name of the folder. */
	readonly title?: string;
	readonly slidesDir?: string;
	readonly deck?: string;
}

export function templateFile(extensionRoot: string): string {
	return path.join(extensionRoot, TEMPLATE_FOLDER, TEMPLATE);
}

/**
 * The colors of the starting palette with their comments, without the header of the file, the
 * comment lines before its first blank line, which describe the file and no color.
 */
export function startingPalette(extensionRoot: string): {
	colors: CommentedObject;
	warnings: readonly string[];
} {
	const file = path.join(extensionRoot, TEMPLATE_FOLDER, STARTING_PALETTE);
	const { colors, warnings } = readColorFileText(
		file,
		fs.readFileSync(file, "utf8")
	);
	const [first, ...rest] = colors.members;
	if (first === undefined || !first.comments.includes(null)) {
		return { colors, warnings };
	}
	const own = first.comments.slice(first.comments.indexOf(null) + 1);
	return {
		colors: {
			...colors,
			members: [{ ...first, comments: own }, ...rest],
		},
		warnings,
	};
}

/** A color configuration of the editor in plain JSON, such as `make-color-config` writes. */
export function readColorConfiguration(file: string): Record<string, unknown> {
	if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
		throw new DeckError(`the color configuration ${file} does not exist`);
	}
	try {
		return JSON.parse(fs.readFileSync(file, "utf8"));
	} catch (error) {
		throw new DeckError(
			`the color configuration ${file} does not read as plain JSON: ${
				(error as Error).message
			}. A file with comments reads only after they are removed.`
		);
	}
}

/**
 * The text of `.vscode/settings.json` of a presentation. The setting `drawioSlides.colors` takes
 * the colors of the palette with their comments, which JSON alone cannot hold, so
 * `withMemberObject` adds it to the text.
 */
export function vscodeSettingsText(
	palette: CommentedObject,
	configuration: Record<string, unknown> = {}
): string {
	const settings: Record<string, unknown> = {
		"workbench.editorAssociations": {
			"*.drawio.xml": "drawioSlides.textEditor",
		},
		"files.associations": { "*.drawio.xml": "drawio" },
		[SETTING_PREFIX + "slides"]: true,
		// The templates of the presentation, named here although the defaults of the extension
		// name the same files, so that the settings say where they are.
		[SETTING_PREFIX + "templates"]: [
			`\${deckFolder}/${DECK_TEMPLATES}/*.drawio.xml`,
		],
	};
	for (const name of COLOR_SETTINGS) {
		if (Object.prototype.hasOwnProperty.call(configuration, name)) {
			settings[SETTING_PREFIX + name] = configuration[name];
		}
	}
	return withMemberObject(jsonText(settings, 2) + "\n", COLORS, palette);
}

/**
 * Writes `.vscode/settings.json` of a presentation, and returns its path. Raises `DeckError` when
 * the file exists, which the set-up does not replace.
 */
export function writeVscodeSettings(
	project: string,
	palette: CommentedObject,
	colorConfiguration?: string
): string {
	const target = path.join(project, DECK_SETTINGS);
	if (fs.existsSync(target)) {
		throw new DeckError(
			`${target} exists. Add the settings that the set-up writes to it by hand.`
		);
	}
	const configuration =
		colorConfiguration === undefined
			? {}
			: readColorConfiguration(colorConfiguration);
	const text = vscodeSettingsText(palette, configuration);
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.writeFileSync(target, text, "utf8");
	return target;
}

/** Copies the template into `templates/` of a presentation when it lacks it, and returns the copies. */
export function copyMissingTemplates(
	project: string,
	extensionRoot: string
): string[] {
	const target = path.join(project, DECK_TEMPLATES, DECK_TEMPLATE);
	if (fs.existsSync(target)) {
		return [];
	}
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.copyFileSync(templateFile(extensionRoot), target);
	return [target];
}

/**
 * Writes `.vscode/settings.json` of an existing presentation, then copies the template into its
 * `templates/` when it lacks it, which the settings name. A refused write of the settings copies
 * nothing. A presentation whose scripts run the Python build of the framework gets a line that
 * offers the move to the launcher, which `migrateDeck` of `deckMigration.ts` makes.
 */
export function setUpEditor(
	project: string,
	extensionRoot: string,
	colorConfiguration?: string
): SetUpResult {
	const folder = path.resolve(project);
	const palette = startingPalette(extensionRoot);
	const settings = writeVscodeSettings(
		folder,
		palette.colors,
		colorConfiguration
	);
	const copies = copyMissingTemplates(folder, extensionRoot);
	const offer = migrationOffer(folder, extensionRoot);
	return {
		lines: [
			`${settings} written`,
			...copies.map(
				(copy) => `${copy} copied from ${templateFile(extensionRoot)}`
			),
			...(offer === undefined ? [] : [offer]),
		],
		warnings: palette.warnings,
	};
}

/** The text of the `.gitignore` of a presentation with the lines of `DECK_IGNORED` that it lacks after its own. */
export function withDeckIgnored(existing: string): string {
	const lines = existing.split(/\r?\n/);
	const lacking = DECK_IGNORED.filter((line) => !lines.includes(line));
	if (lacking.length === 0) {
		return existing;
	}
	const separator = existing === "" || existing.endsWith("\n") ? "" : "\n";
	return existing + separator + lacking.map((line) => line + "\n").join("");
}

/** The pages of the template by their names. */
function templatePages(extensionRoot: string): Map<string, string> {
	const text = fs.readFileSync(templateFile(extensionRoot), "utf8");
	return new Map(
		(text.match(DIAGRAM) ?? []).map((diagram): [string, string] => [
			PAGE_NAME.exec(diagram)?.[1] ?? "",
			diagram,
		])
	);
}

/** The first folder of the path and its parents that exists. */
function existingAncestor(folder: string): string {
	return fs.existsSync(folder)
		? folder
		: existingAncestor(path.dirname(folder));
}

function isGitInstalled(): boolean {
	try {
		execFileSync("git", ["--version"], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

/**
 * The reason why `initDeck` refuses the folder, or undefined. Every check runs before the first
 * file is written, so a refused start leaves the folder as it was.
 */
export function initRefusal(
	project: string,
	slidesDir: string,
	deck: string
): string | undefined {
	const sections = path.join(project, slidesDir);
	const ancestor = existingAncestor(project);
	if (!fs.statSync(ancestor).isDirectory()) {
		return `${ancestor} is a file, so the set-up cannot make the folder ${project}`;
	}
	if (
		fs.existsSync(path.join(project, PACKAGE)) ||
		fs.existsSync(path.join(project, deck)) ||
		(fs.existsSync(sections) &&
			fs.statSync(sections).isDirectory() &&
			fs.readdirSync(sections).length > 0)
	) {
		return `${project} already holds a presentation, and the set-up starts one only in a new folder`;
	}
	for (const file of FILES_THAT_STOP_A_START) {
		if (fs.existsSync(path.join(project, file))) {
			return `${path.join(
				project,
				file
			)} exists, and the set-up starts a presentation only in a new folder`;
		}
	}
	if (!isGitInstalled()) {
		return "git is not installed, and the set-up makes the presentation a repository";
	}
	return undefined;
}

/** The text of the first section file: the starting pages of the template. */
function firstSectionText(extensionRoot: string): string {
	const pages = templatePages(extensionRoot);
	const missing = STARTER_PAGES.filter((name) => !pages.has(name));
	if (missing.length > 0) {
		throw new DeckError(
			`the template ${templateFile(
				extensionRoot
			)} has no page ${missing.join(", ")}`
		);
	}
	return (
		`<mxfile host="Draw.io Slides" pages="${STARTER_PAGES.length}">\n` +
		STARTER_PAGES.map((name) => "  " + pages.get(name)!.trim() + "\n").join(
			""
		) +
		"</mxfile>\n"
	);
}

/**
 * The text of the `package.json` of a new presentation: its name, the key `config` with the
 * title and each fact that is not at its default, and a command per mode of `DECK_COMMANDS`.
 */
export function deckPackageText(
	title: string,
	slidesDir: string,
	deck: string,
	commandLine: string
): string {
	const config: Record<string, string> = { title };
	if (slidesDir !== SLIDES_DIR) {
		config["slides-dir"] = slidesDir;
	}
	if (deck !== SINGLE_FILE) {
		config.deck = deck;
	}
	const scripts = Object.fromEntries(
		DECK_COMMANDS.map((mode) => [mode, `${commandLine} ${mode}`])
	);
	return (
		jsonText({ name: slug(title), private: true, config, scripts }, 2) +
		"\n"
	);
}

/**
 * Starts a presentation as a git repository of its own, and returns what was written. Raises
 * `DeckError` with the reason of `initRefusal`, before any file is written.
 */
export function initDeck(options: InitOptions): SetUpResult {
	const project = path.resolve(options.project);
	const slidesDir = options.slidesDir || SLIDES_DIR;
	const deck = options.deck || SINGLE_FILE;
	const refusal = initRefusal(project, slidesDir, deck);
	if (refusal !== undefined) {
		throw new DeckError(refusal);
	}
	const palette = startingPalette(options.extensionRoot);
	const section = firstSectionText(options.extensionRoot);
	const sections = path.join(project, slidesDir);
	fs.mkdirSync(sections, { recursive: true });
	const realProject = fs.realpathSync(project);
	if (!fs.existsSync(path.join(realProject, ".git"))) {
		execFileSync("git", ["init", "-q", "-b", "main", realProject], {
			stdio: "ignore",
		});
	}
	const title = options.title || path.basename(realProject);
	const first = path.join(sections, sectionFileName(1, slug(title)));
	fs.writeFileSync(first, section, "utf8");
	fs.writeFileSync(
		path.join(realProject, PACKAGE),
		deckPackageText(title, slidesDir, deck, DECK_COMMAND_LINE),
		"utf8"
	);
	fs.copyFileSync(
		launcherFile(options.extensionRoot),
		path.join(realProject, DECK_LAUNCHER)
	);
	const gitignore = path.join(realProject, ".gitignore");
	const existing = fs.existsSync(gitignore)
		? fs.readFileSync(gitignore, "utf8")
		: "";
	fs.writeFileSync(gitignore, withDeckIgnored(existing), "utf8");
	copyMissingTemplates(realProject, options.extensionRoot);
	const settings = writeVscodeSettings(realProject, palette.colors);
	return {
		lines: [
			`${path.relative(
				realProject,
				first
			)} written with the pages ${STARTER_PAGES.join(", ")}`,
			`package.json, ${DECK_LAUNCHER} and ${path.relative(
				realProject,
				settings
			)} written, and ${realProject} is a git repository of its own`,
		],
		warnings: palette.warnings,
	};
}
