import * as fs from "fs";
import * as jsoncParser from "jsonc-parser";
import * as path from "path";

/**
 * The script of the draw.io presentation framework whose modes `init` and `vscode` set up a deck,
 * as a path below the folder of the framework.
 */
export const BUILD_SCRIPT = "tools/draw-io/build-slides.py";

// The files of a deck by the names that `build-slides.py` and its `deck_files.py` give them.
const PACKAGE = "package.json";
const SLIDES_DIR = "sections";
const SINGLE_FILE = "slides.drawio.xml";
const SETTINGS = ".vscode/settings.json";
const DECK_TEMPLATE = "templates/slides.drawio.xml";
const GITIGNORE = ".gitignore";
const FIRST_SECTION_FILE = /^1-.*\.drawio\.xml$/;
/** The ending of a file that the build reads as a section, as `deck_files.read_folder` does. */
const SECTION_FILE_SUFFIX = ".drawio.xml";

/** The modes of `build-slides.py` that set up a folder, by their names on its command line. */
export enum SetUpMode {
	Init = "init",
	Vscode = "vscode",
}

/** What a folder holds of a presentation, which decides how the folder is set up. */
export enum DeckFolderState {
	/** Neither slides nor a file that `init` refuses to replace, so `init` starts a presentation. */
	WithoutPresentation = "withoutPresentation",
	/** No presentation, and files that `init` refuses to replace. */
	FilesInTheWay = "filesInTheWay",
	/** A presentation without `.vscode/settings.json`, which `vscode` writes. */
	PresentationWithoutSettings = "presentationWithoutSettings",
	/** A presentation with `.vscode/settings.json`. */
	SetUp = "setUp",
}

export type DeckFolderSurvey =
	| { readonly state: DeckFolderState.WithoutPresentation }
	| {
			readonly state: DeckFolderState.FilesInTheWay;
			/** The paths relative to the folder, in the order in which `init` checks them. */
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
 * under the default names, as `build-slides.py` reads them.
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
		...[SETTINGS, DECK_TEMPLATE].filter((name) =>
			fs.existsSync(path.join(folder, name))
		),
	];
	return filesInTheWay.length > 0
		? { state: DeckFolderState.FilesInTheWay, filesInTheWay }
		: { state: DeckFolderState.WithoutPresentation };
}

/** A file that a mode of `build-slides.py` writes, with what it holds, for the confirmation before the run. */
export interface WrittenFile {
	/** The path relative to the folder of the presentation, or else an absolute path. */
	readonly path: string;
	readonly content: string;
}

/** The files that `init` writes into a folder without a presentation, as its docstring names them. */
export function filesWrittenByInit(
	folder: string,
	script: string
): readonly WrittenFile[] {
	const repository = repositoryOf(path.dirname(script));
	return [
		{
			path: `${SLIDES_DIR}/1-<title>.drawio.xml`,
			content: "the first section, named after the title, with the starting pages of the template",
		},
		{ path: PACKAGE, content: "the commands of the deck and its title" },
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
		...(repository !== undefined && isStrictlyInside(repository, folder)
			? [
					{
						path: path.join(repository, GITIGNORE),
						content: "a line that leaves out the folder, unless git ignores the folder already",
					},
			  ]
			: []),
	];
}

/**
 * The files that `vscode` writes into a presentation without `.vscode/settings.json`, as its
 * docstring names them.
 */
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

/** The build script of a folder of the framework, or undefined when the folder holds none. */
export function findBuildScript(frameworkFolder: string): string | undefined {
	const script = path.join(frameworkFolder, BUILD_SCRIPT);
	return path.isAbsolute(frameworkFolder) && isFile(script) ? script : undefined;
}

/**
 * Whether the folder is the repository of the build script, the root of the framework, where
 * `init` refuses to start a presentation.
 */
export function isRepositoryOfScript(folder: string, script: string): boolean {
	const repository = repositoryOf(path.dirname(script));
	return repository !== undefined && repository === fs.realpathSync(folder);
}

/** A path with a leading `~` read as the home folder. */
export function withHomeExpanded(folder: string, home: string): string {
	if (folder === "~") {
		return home;
	}
	return folder.startsWith("~/") ? path.join(home, folder.slice(2)) : folder;
}

/** The first section file that `init` writes, or undefined when the slides folder holds none. */
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

/**
 * The reason with which `build-slides.py` stopped, the last line that it wrote to the standard
 * error, which holds the message of its `SystemExit` or the exception of a crash.
 */
export function refusalOf(stderr: string): string | undefined {
	return stderr
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "")
		.pop();
}

function deckConfig(folder: string): { slidesDir: string; deck: string } {
	const config = packageConfig(path.join(folder, PACKAGE));
	const slidesDir = config["slides-dir"];
	const deck = config["deck"];
	return {
		slidesDir: typeof slidesDir === "string" && slidesDir !== "" ? slidesDir : SLIDES_DIR,
		deck: typeof deck === "string" && deck !== "" ? deck : SINGLE_FILE,
	};
}

function packageConfig(file: string): Record<string, unknown> {
	if (!isFile(file)) {
		return {};
	}
	try {
		const config: unknown = JSON.parse(fs.readFileSync(file, "utf8")).config;
		return isPlainObject(config) ? config : {};
	} catch {
		return {};
	}
}

function settingsLoadSlidePlugins(file: string): boolean {
	const settings: unknown = isFile(file)
		? jsoncParser.parse(fs.readFileSync(file, "utf8"), [], {
				allowTrailingComma: true,
		  })
		: undefined;
	return isPlainObject(settings) && settings["drawioSlides.slides"] === true;
}

/** The folder holding `.git` that contains the path, with symbolic links resolved, or undefined. */
function repositoryOf(folder: string): string | undefined {
	const resolved = fs.realpathSync(folder);
	if (fs.existsSync(path.join(resolved, ".git"))) {
		return resolved;
	}
	const parent = path.dirname(resolved);
	return parent === resolved ? undefined : repositoryOf(parent);
}

/** Whether `inner` lies below `outer`, with symbolic links resolved, so that two names of one folder count as one. */
function isStrictlyInside(outer: string, inner: string): boolean {
	const relative = path.relative(fs.realpathSync(outer), fs.realpathSync(inner));
	return (
		relative !== "" &&
		relative.split(path.sep)[0] !== ".." &&
		!path.isAbsolute(relative)
	);
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
