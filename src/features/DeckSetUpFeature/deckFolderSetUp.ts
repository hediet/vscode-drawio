import * as fs from "fs";
import * as jsoncParser from "jsonc-parser";
import * as path from "path";
import {
	configSetting,
	PACKAGE,
	readDeckConfigOrDefaults,
	SINGLE_FILE,
	SLIDES_DIR,
	SUFFIX,
} from "../../deck/deckFiles";
import { DECK_SETTINGS as SETTINGS } from "../../deck/deckSettings";
import {
	DECK_LAUNCHER,
	DECK_TEMPLATE as DECK_TEMPLATE_NAME,
	DECK_TEMPLATES,
	FILES_THAT_STOP_A_START,
} from "../../deck/deckSetUp";

// The files of a deck by the names that the build gives them in `src/deck/`.
const DECK_TEMPLATE = `${DECK_TEMPLATES}/${DECK_TEMPLATE_NAME}`;
const GITIGNORE = ".gitignore";
const FIRST_SECTION_FILE = /^1-.*\.drawio\.xml$/;
/** The ending of a file that the build reads as a section. */
const SECTION_FILE_SUFFIX = SUFFIX;

/** What a folder holds of a presentation, which decides how the folder is set up. */
export enum DeckFolderState {
	/** Neither slides nor a file that `initDeck` refuses to replace, so `initDeck` starts a presentation. */
	WithoutPresentation = "withoutPresentation",
	/** No presentation, and files that `initDeck` refuses to replace. */
	FilesInTheWay = "filesInTheWay",
	/** A presentation without `.vscode/settings.json`, which `setUpEditor` writes. */
	PresentationWithoutSettings = "presentationWithoutSettings",
	/** A presentation with `.vscode/settings.json`. */
	SetUp = "setUp",
}

export type DeckFolderSurvey =
	| { readonly state: DeckFolderState.WithoutPresentation }
	| {
			readonly state: DeckFolderState.FilesInTheWay;
			/** The paths relative to the folder, in the order in which `initDeck` checks them. */
			readonly filesInTheWay: readonly string[];
	  }
	| { readonly state: DeckFolderState.PresentationWithoutSettings }
	| {
			readonly state: DeckFolderState.SetUp;
			/** Whether the settings file sets `drawioSlides.slides` to `true`. */
			readonly loadsSlidePlugins: boolean;
	  };

/**
 * The state of a folder.
 * A presentation is a folder that holds its slides, as a slides folder that holds a file ending in
 * .drawio.xml or as a multi-page file, under the names that the key `config` of its `package.json` gives or else
 * under the default names, as the build reads them.
 */
export function surveyDeckFolder(folder: string): DeckFolderSurvey {
	const { slidesDir, deck } = deckConfig(folder);
	const holdsSlides =
		holdsSectionFiles(path.join(folder, slidesDir)) ||
		isFile(path.join(folder, deck));
	if (holdsSlides) {
		const settings = path.join(folder, SETTINGS);
		return fs.existsSync(settings)
			? {
					state: DeckFolderState.SetUp,
					loadsSlidePlugins: settingsLoadSlidePlugins(settings),
			  }
			: { state: DeckFolderState.PresentationWithoutSettings };
	}
	const filesInTheWay = [
		...[PACKAGE, SINGLE_FILE].filter((name) =>
			fs.existsSync(path.join(folder, name))
		),
		...(isNonEmptyFolder(path.join(folder, SLIDES_DIR)) ? [`${SLIDES_DIR}/`] : []),
		...FILES_THAT_STOP_A_START.filter((name) =>
			fs.existsSync(path.join(folder, name))
		),
	];
	return filesInTheWay.length > 0
		? { state: DeckFolderState.FilesInTheWay, filesInTheWay }
		: { state: DeckFolderState.WithoutPresentation };
}

/** A file that the set-up writes, with what it holds, for the confirmation before the set-up. */
export interface WrittenFile {
	/** The path relative to the folder of the presentation, or else an absolute path. */
	readonly path: string;
	readonly content: string;
}

/** The files that `initDeck` writes into a folder without a presentation. */
export function filesWrittenByInit(folder: string): readonly WrittenFile[] {
	return [
		{
			path: `${SLIDES_DIR}/1-<title>.drawio.xml`,
			content: "the first section, named after the title, with the starting pages of the template",
		},
		{ path: PACKAGE, content: "the commands of the deck and its title" },
		{
			path: DECK_LAUNCHER,
			content: "the launcher of the command line of the extension, which the commands run",
		},
		{
			path: GITIGNORE,
			content: fs.existsSync(path.join(folder, GITIGNORE))
				? "the lines that leave out the folder build/ and the files that each machine writes, where it lacks them, after its own lines"
				: "the lines that leave out the folder build/ and the files that each machine writes",
		},
		{ path: DECK_TEMPLATE, content: "the template of the slides" },
		{
			path: SETTINGS,
			content: "the settings of the editor and the colours of the starting palette",
		},
		...(fs.existsSync(path.join(folder, ".git"))
			? []
			: [{ path: ".git/", content: "a git repository of the folder, from git init" }]),
	];
}

/** The files that `setUpEditor` writes into a presentation without `.vscode/settings.json`. */
export function filesWrittenByVscode(folder: string): readonly WrittenFile[] {
	return [
		{
			path: SETTINGS,
			content: "the settings of the editor and the colours of the starting palette",
		},
		...(fs.existsSync(path.join(folder, DECK_TEMPLATE))
			? []
			: [{ path: DECK_TEMPLATE, content: "the template of the slides" }]),
	];
}

/** The first section file that `initDeck` writes, or undefined when the slides folder holds none. */
export function firstSectionFile(folder: string): string | undefined {
	const sections = path.join(folder, SLIDES_DIR);
	if (!isNonEmptyFolder(sections)) {
		return undefined;
	}
	const first = fs
		.readdirSync(sections)
		.filter((name) => FIRST_SECTION_FILE.test(name))
		.sort()[0];
	return first === undefined ? undefined : path.join(sections, first);
}

/** Where the slides of the folder are, as the build reads `config`, or the default places. */
function deckConfig(folder: string): { slidesDir: string; deck: string } {
	const config = readDeckConfigOrDefaults(folder);
	return {
		slidesDir: configSetting("slides-dir", undefined, config) ?? SLIDES_DIR,
		deck: configSetting("deck", undefined, config) ?? SINGLE_FILE,
	};
}

function settingsLoadSlidePlugins(file: string): boolean {
	const settings: unknown = isFile(file)
		? jsoncParser.parse(fs.readFileSync(file, "utf8"), [], {
				allowTrailingComma: true,
		  })
		: undefined;
	return isPlainObject(settings) && settings["drawioSlides.slides"] === true;
}

export function isFolder(folder: string): boolean {
	return fs.existsSync(folder) && fs.statSync(folder).isDirectory();
}

function isFile(file: string): boolean {
	return fs.existsSync(file) && fs.statSync(file).isFile();
}

/** Whether the folder holds a file that the build reads as a section. */
function holdsSectionFiles(folder: string): boolean {
	return (
		isFolder(folder) &&
		fs.readdirSync(folder).some((name) => name.endsWith(SECTION_FILE_SUFFIX))
	);
}

function isNonEmptyFolder(folder: string): boolean {
	return isFolder(folder) && fs.readdirSync(folder).length > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
