/**
 * The command line of the build of a deck, `dist/cli.js`, which runs one mode on a deck folder,
 * so that an agent, a script or a CI job builds a deck without VS Code. The scripts of the
 * `package.json` of a deck run it through the launcher `drawslidescode.cjs`, as `deckSetUp.ts` says.
 *
 *     node dist/cli.js init ../my-talk --title "My talk"   a new presentation, as a repository
 *     node dist/cli.js build                               build/<folder>.html and .pdf
 *     node dist/cli.js from-tex colors.tex --project ../my-talk
 *     node dist/cli.js migrate ../old-talk --yes               the scripts of a deck of the
 *                                                            framework moved to the launcher
 *
 * The environment variables of the build are read here alone, and become the options of the
 * modes, as `ENVIRONMENT` lists them.
 */
import * as path from "path";
import { parseArgs } from "util";
import { BuildCancelled, BuildReporter } from "./buildEvents";
import { importColorsFromTex, exportColorsToTex } from "./colorSettings";
import { writeColorConfiguration } from "./colorConfig";
import {
	buildDeck,
	buildDeckHtml,
	buildDeckPdf,
	checkDeck,
	CheckOptions,
	embedDeckPictures,
	reportDeckOutline,
	watchDeck,
	WatchOptions,
} from "./deckBuild";
import { DeckError } from "./deckError";
import {
	isMigrationNeeded,
	migrateDeck,
	migrationLines,
	planMigration,
} from "./deckMigration";
import { initDeck, setUpEditor } from "./deckSetUp";
import { LogoRow, placeLogos, TITLE_SLIDE_ROW } from "./logoPlacement";
import { screenshotSlides } from "./slideScreenshots";

/** The modes of the command line, by their names on it. */
export enum CommandLineMode {
	INIT = "init",
	VSCODE = "vscode",
	BUILD = "build",
	HTML = "html",
	PDF = "pdf",
	WATCH = "watch",
	OUTLINE = "outline",
	CHECK = "check",
	FROM_TEX = "from-tex",
	TO_TEX = "to-tex",
	EMBED_PICTURES = "embed-pictures",
	COLOR_CONFIG = "color-config",
	MIGRATE = "migrate",
	PLACE_LOGOS = "place-logos",
	SCREENSHOTS = "screenshots",
}

/** The exit status of a run: done, stopped with a reason, a wrong command line, or interrupted. */
export enum ExitStatus {
	DONE = 0,
	STOPPED = 1,
	USAGE = 2,
	INTERRUPTED = 130,
}

/** The environment variables that the command line reads, each with the option it sets. */
export const ENVIRONMENT = {
	/** The folder of the extension, such as a clone of it, in place of the folder of `dist/cli.js`. */
	extension: "DRAWSLIDESCODE_EXTENSION",
	/** The draw.io viewer of the export, as a path or an address. */
	viewer: "DRAWIO_VIEWER",
	/** `1` exports every page again, without the cache. */
	fresh: "EXPORT_FRESH",
	/** The pages that export at once. */
	workers: "EXPORT_WORKERS",
	/** The most milliseconds that a page may take to be ready for its export. */
	pageWait: "PAGE_WAIT",
	/** The milliseconds after the load of an embedded page before its picture. */
	snapshotWait: "SNAPSHOT_WAIT",
	/** The most milliseconds that an embedded page may take to load. */
	snapshotLoadWait: "SNAPSHOT_LOAD_WAIT",
	/** The address of the LanguageTool server of the check. */
	languageTool: "LANGUAGETOOL_SERVER",
} as const;

export const USAGE = `usage: node cli.js <mode> [folder] [options]

Builds a draw.io presentation into one HTML file and one PDF, with the draw.io of the
extension DrawSlidesCode. The folder of the presentation is the working directory, unless the
folder or --project names another.

modes:
  init             start a presentation in a new folder, as a git repository of its own
  vscode           write .vscode/settings.json of a presentation for the editor
  build            write build/<folder>.html and build/<folder>.pdf
  html             write build/<folder>.html alone
  pdf              write build/<folder>.pdf alone
  watch            write the HTML file again after every save, until Ctrl-C
  outline          print the sections, the slides and their pages
  check            check the spelling and the grammar with LanguageTool, exit status 1 on an issue
  embed-pictures   write the pictures of assets/ into the slide files as data, for the editor
  from-tex <file.tex>...   write the \\definecolor lines of the files into drawSlidesCode.colors
  to-tex <file.tex>        write drawSlidesCode.colors into a TeX file
  color-config <drawing> --out <file>   write a color configuration of the colors of a drawing
  migrate          copy the launcher drawslidescode.cjs into a presentation whose package.json
                   runs build-slides.py of the framework, and rewrite those scripts to run it,
                   after a confirmation, or at once with --yes
  place-logos <section file> <page name> <cell id>=<logo.png>...
                   write a row of logos, from left to right, into the page
  screenshots --out <folder>   write a PNG of each built slide and contact sheets of twelve

options:
  --project <folder>     the folder of the presentation, in place of the folder argument
  --title <title>        the title, from config.title of package.json, or the folder's name
  --slides-dir <folder>  the folder of one file per section, from config.slides-dir, or sections
  --deck <file>          a multi-page file, read when the slides folder is absent, from
                         config.deck, or slides.drawio.xml
  --outline              for build, html, pdf and watch, print the outline as well
  --html <file>          for build, html and watch, the HTML file, build/<folder>.html by default
  --pdf <file>           for build and pdf, the PDF, build/<folder>.pdf by default
  --interval <seconds>   for watch, the seconds between two looks at the slides, 1 by default
  --browser <path>       the Chrome, Edge or Chromium of the export, in place of the first that
                         starts of Playwright's Chromium, Google Chrome and Microsoft Edge
  --colors <file>       for vscode, a color configuration of the editor, as color-config writes
  --out <file>           for color-config, the file to write, of \\definecolor lines for .tex
  --definecolor <file>   for color-config, a TeX file whose \\definecolor lines name colors,
                         which may be given more than once
  --least <count>        for color-config, leave out a color used fewer times, 8 by default
  --yes                  for migrate, make the changes without asking
  --height <px>          for place-logos, the height of each logo on the slide, 100 by default
  --centre-y <px>        for place-logos, the line the logos are centred on, 925 by default
  --left <px>, --right <px>   for place-logos, the ends of the row, 160 and 1760 by default
  --scale <factor>       for place-logos, the height of each picture over its height on the
                         slide, 3 by default

environment:
  ${ENVIRONMENT.extension}  the folder of the extension, such as a clone of it
  ${ENVIRONMENT.viewer}  ${ENVIRONMENT.fresh}=1  ${ENVIRONMENT.workers}  ${ENVIRONMENT.pageWait}
  ${ENVIRONMENT.snapshotWait}  ${ENVIRONMENT.snapshotLoadWait}  ${ENVIRONMENT.languageTool}`;

/** Where a run writes: the lines of its standard output and of its standard error. */
export interface CommandLineOutput {
	readonly out: (line: string) => void;
	readonly err: (line: string) => void;
}

/** The parts of the command line, with the options that the modes take. */
export interface CommandLine {
	readonly mode: CommandLineMode;
	/** The arguments after the mode, such as the folder or the TeX files. */
	readonly operands: readonly string[];
	readonly project: string;
	readonly title?: string;
	readonly slidesDir?: string;
	readonly deck?: string;
	readonly isOutlineReported: boolean;
	readonly htmlFile?: string;
	readonly pdfFile?: string;
	readonly intervalMs?: number;
	readonly browser?: string;
	readonly colors?: string;
	readonly out?: string;
	readonly definitionFiles: readonly string[];
	readonly least: number;
	readonly isConfirmed: boolean;
	readonly logoRow: LogoRow;
	readonly isHelp: boolean;
}

/** A command line that names no mode, an unknown option or a value of the wrong kind. */
export class UsageError extends DeckError {}

const OPTIONS = {
	project: { type: "string" },
	title: { type: "string" },
	"slides-dir": { type: "string" },
	deck: { type: "string" },
	outline: { type: "boolean" },
	html: { type: "string" },
	pdf: { type: "string" },
	interval: { type: "string" },
	browser: { type: "string" },
	colors: { type: "string" },
	out: { type: "string" },
	definecolor: { type: "string", multiple: true },
	least: { type: "string" },
	yes: { type: "boolean" },
	height: { type: "string" },
	"centre-y": { type: "string" },
	left: { type: "string" },
	right: { type: "string" },
	scale: { type: "string" },
	help: { type: "boolean", short: "h" },
} as const;

/** The modes whose arguments after the mode are files rather than the folder of the deck. */
const FILE_OPERANDS: ReadonlySet<CommandLineMode> = new Set([
	CommandLineMode.FROM_TEX,
	CommandLineMode.TO_TEX,
	CommandLineMode.COLOR_CONFIG,
	CommandLineMode.PLACE_LOGOS,
]);

function nonNegativeNumber(option: string, text: string): number {
	const value = Number(text);
	if (text.trim() === "" || !Number.isFinite(value) || value < 0) {
		throw new UsageError(`--${option} ${text} is no number of 0 or more`);
	}
	return value;
}

function optionalNumber(
	option: string,
	text: string | undefined,
	fallback: number
): number {
	return text === undefined ? fallback : nonNegativeNumber(option, text);
}

/** The parts of the arguments after `node cli.js`. Raises `UsageError` on a wrong command line. */
export function parseCommandLine(args: readonly string[]): CommandLine {
	let parsed;
	try {
		parsed = parseArgs({
			args: [...args],
			options: OPTIONS,
			allowPositionals: true,
		});
	} catch (error) {
		throw new UsageError((error as Error).message);
	}
	const { values, positionals } = parsed;
	const [modeName, ...operands] = positionals;
	const isHelp = values.help === true;
	const modes = Object.values(CommandLineMode) as string[];
	if (!isHelp && !modes.includes(modeName)) {
		throw new UsageError(
			modeName === undefined
				? "the command line names no mode"
				: `${modeName} is no mode, which is one of ${modes.join(", ")}`
		);
	}
	const mode = modeName as CommandLineMode;
	if (!FILE_OPERANDS.has(mode) && operands.length > 1) {
		throw new UsageError(
			`${mode} takes one folder, and the command line gives ${operands.join(
				", "
			)}`
		);
	}
	return {
		mode,
		operands,
		project:
			values.project ??
			(FILE_OPERANDS.has(mode) ? undefined : operands[0]) ??
			".",
		title: values.title,
		slidesDir: values["slides-dir"],
		deck: values.deck,
		isOutlineReported: values.outline === true,
		htmlFile: values.html,
		pdfFile: values.pdf,
		intervalMs:
			values.interval === undefined
				? undefined
				: nonNegativeNumber("interval", values.interval) * 1000,
		browser: values.browser,
		colors: values.colors,
		out: values.out,
		definitionFiles: values.definecolor ?? [],
		least:
			values.least === undefined
				? 8
				: Math.floor(nonNegativeNumber("least", values.least)),
		isConfirmed: values.yes === true,
		logoRow: {
			height: optionalNumber(
				"height",
				values.height,
				TITLE_SLIDE_ROW.height
			),
			centreY: optionalNumber(
				"centre-y",
				values["centre-y"],
				TITLE_SLIDE_ROW.centreY
			),
			left: optionalNumber("left", values.left, TITLE_SLIDE_ROW.left),
			right: optionalNumber("right", values.right, TITLE_SLIDE_ROW.right),
			scale: optionalNumber("scale", values.scale, TITLE_SLIDE_ROW.scale),
		},
		isHelp,
	};
}

/** A whole number of an environment variable, or undefined when the variable holds none. */
function wholeNumber(text: string | undefined): number | undefined {
	const value = parseInt(text ?? "", 10);
	return Number.isNaN(value) ? undefined : value;
}

/** The options of the build modes of the command line, with those of the environment variables. */
export function buildOptions(
	line: CommandLine,
	environment: Readonly<Record<string, string | undefined>>,
	extensionRoot: string,
	reporter: BuildReporter,
	signal: AbortSignal
): WatchOptions & CheckOptions {
	return {
		project: path.resolve(line.project),
		extensionRoot: environment[ENVIRONMENT.extension] || extensionRoot,
		given: {
			title: line.title,
			slidesDir: line.slidesDir,
			deck: line.deck,
		},
		htmlFile: line.htmlFile,
		pdfFile: line.pdfFile,
		isOutlineReported: line.isOutlineReported,
		browser: { executablePath: line.browser },
		exportSettings: {
			viewer: environment[ENVIRONMENT.viewer] || undefined,
			isFresh: environment[ENVIRONMENT.fresh] === "1",
			// 0 and a value that is no number give the default.
			workers: wholeNumber(environment[ENVIRONMENT.workers]) || undefined,
			pageWaitMs: wholeNumber(environment[ENVIRONMENT.pageWait]),
		},
		snapshotSettings: {
			settleMs: wholeNumber(environment[ENVIRONMENT.snapshotWait]),
			loadWaitMs: wholeNumber(environment[ENVIRONMENT.snapshotLoadWait]),
		},
		reporter,
		signal,
		intervalMs: line.intervalMs,
		languageTool: environment[ENVIRONMENT.languageTool] || undefined,
	};
}

/** The reporter of the command line: lines to the standard output, warnings to the standard error. */
function commandLineReporter(output: CommandLineOutput): BuildReporter {
	return {
		onLine: output.out,
		onWarning: (warning) => output.err(`warning: ${warning}`),
		onFailure: (reason) => output.err(`build failed: ${reason}`),
	};
}

function report(
	output: CommandLineOutput,
	result: { lines?: readonly string[]; warnings: readonly string[] }
): void {
	result.lines?.forEach(output.out);
	result.warnings.forEach((warning) => output.err(`warning: ${warning}`));
}

/** A question that the user answers with yes or no, such as on a terminal. */
export type Confirmation = (question: string) => Promise<boolean>;

/**
 * Moves a presentation of the framework to the launcher, after the changes are printed and
 * confirmed. Without `--yes` and without a terminal to ask on, the run changes nothing.
 */
async function migrate(
	line: CommandLine,
	options: WatchOptions & CheckOptions,
	output: CommandLineOutput,
	confirm: Confirmation | undefined
): Promise<ExitStatus> {
	const migration = planMigration(options.project, options.extensionRoot);
	if (!isMigrationNeeded(migration)) {
		report(output, migrateDeck(options.project, options.extensionRoot));
		return ExitStatus.DONE;
	}
	output.out(`The move of ${migration.project} to the launcher changes:`);
	migrationLines(migration).forEach((change) => output.out(`  ${change}`));
	if (!line.isConfirmed) {
		if (confirm === undefined) {
			output.err(
				"nothing changed: run migrate again with --yes to make the changes"
			);
			return ExitStatus.STOPPED;
		}
		if (!(await confirm("Make the changes? [y/N] "))) {
			output.out("nothing changed");
			return ExitStatus.DONE;
		}
	}
	const result = migrateDeck(options.project, options.extensionRoot);
	report(output, {
		lines: ["the changes are made"],
		warnings: result.warnings,
	});
	return ExitStatus.DONE;
}

/** The logos of the operands of place-logos after the section file and the page name. */
function logoOperands(
	operands: readonly string[]
): { cellId: string; file: string }[] {
	return operands.map((operand) => {
		const separator = operand.indexOf("=");
		if (separator <= 0 || separator === operand.length - 1) {
			throw new UsageError(`${operand} is no <cell id>=<logo file>`);
		}
		return {
			cellId: operand.slice(0, separator),
			file: path.resolve(operand.slice(separator + 1)),
		};
	});
}

/** What a mode reads: the command line, the options of the build, the output and the confirmation. */
interface ModeRun {
	readonly line: CommandLine;
	readonly options: WatchOptions & CheckOptions;
	readonly output: CommandLineOutput;
	readonly confirm: Confirmation | undefined;
}

/** A mode of the command line, which returns its exit status. */
type ModeAction = (run: ModeRun) => Promise<ExitStatus> | ExitStatus;

function initMode({ line, options, output }: ModeRun): ExitStatus {
	report(
		output,
		initDeck({
			project: options.project,
			extensionRoot: options.extensionRoot,
			title: line.title,
			slidesDir: line.slidesDir,
			deck: line.deck,
		})
	);
	output.out(
		`next, in ${options.project}: npm run build. Open the folder in VS Code to edit the slides.`
	);
	return ExitStatus.DONE;
}

function vscodeMode({ line, options, output }: ModeRun): ExitStatus {
	report(
		output,
		setUpEditor(
			options.project,
			options.extensionRoot,
			line.colors === undefined ? undefined : path.resolve(line.colors)
		)
	);
	return ExitStatus.DONE;
}

/** A mode that runs a step of the build, and is done when the step returns. */
function buildStepMode(
	step: (options: WatchOptions & CheckOptions) => unknown
): ModeAction {
	return async ({ options }) => {
		await step(options);
		return ExitStatus.DONE;
	};
}

async function checkMode({ options }: ModeRun): Promise<ExitStatus> {
	return (await checkDeck(options)) > 0 ? ExitStatus.STOPPED : ExitStatus.DONE;
}

function fromTexMode({ line, options, output }: ModeRun): ExitStatus {
	if (line.operands.length === 0) {
		throw new UsageError("from-tex takes at least one TeX file");
	}
	const result = importColorsFromTex(options.project, line.operands);
	report(output, { lines: [result.line], warnings: result.warnings });
	return ExitStatus.DONE;
}

function toTexMode({ line, options, output }: ModeRun): ExitStatus {
	if (line.operands.length !== 1) {
		throw new UsageError("to-tex takes one TeX file");
	}
	const result = exportColorsToTex(options.project, line.operands[0]);
	report(output, { lines: [result.line], warnings: result.warnings });
	return ExitStatus.DONE;
}

function colorConfigMode({ line, output }: ModeRun): ExitStatus {
	if (line.operands.length !== 1 || line.out === undefined) {
		throw new UsageError("color-config takes one drawing and the option --out");
	}
	report(
		output,
		writeColorConfiguration(
			line.operands[0],
			line.out,
			line.definitionFiles,
			line.least
		)
	);
	return ExitStatus.DONE;
}

function placeLogosMode({ line, output }: ModeRun): ExitStatus {
	const [sectionFile, pageName, ...logos] = line.operands;
	if (logos.length === 0) {
		throw new UsageError(
			"place-logos takes a section file, a page name and at least one <cell id>=<logo file>"
		);
	}
	placeLogos(
		path.resolve(sectionFile),
		pageName,
		logoOperands(logos),
		line.logoRow
	).forEach(output.out);
	return ExitStatus.DONE;
}

async function screenshotsMode({
	line,
	options,
	output,
}: ModeRun): Promise<ExitStatus> {
	if (line.out === undefined) {
		throw new UsageError("screenshots takes the option --out <folder>");
	}
	output.out(
		await screenshotSlides({
			project: options.project,
			outdir: line.out,
			browser: options.browser,
			reporter: options.reporter,
			signal: options.signal,
		})
	);
	return ExitStatus.DONE;
}

/** The action of each mode of the command line. */
const MODE_ACTIONS: Readonly<Record<CommandLineMode, ModeAction>> = {
	[CommandLineMode.INIT]: initMode,
	[CommandLineMode.VSCODE]: vscodeMode,
	[CommandLineMode.BUILD]: buildStepMode(buildDeck),
	[CommandLineMode.HTML]: buildStepMode(buildDeckHtml),
	[CommandLineMode.PDF]: buildStepMode(buildDeckPdf),
	[CommandLineMode.WATCH]: buildStepMode(watchDeck),
	[CommandLineMode.OUTLINE]: buildStepMode(reportDeckOutline),
	[CommandLineMode.CHECK]: checkMode,
	[CommandLineMode.EMBED_PICTURES]: buildStepMode(embedDeckPictures),
	[CommandLineMode.FROM_TEX]: fromTexMode,
	[CommandLineMode.TO_TEX]: toTexMode,
	[CommandLineMode.COLOR_CONFIG]: colorConfigMode,
	[CommandLineMode.MIGRATE]: ({ line, options, output, confirm }) =>
		migrate(line, options, output, confirm),
	[CommandLineMode.PLACE_LOGOS]: placeLogosMode,
	[CommandLineMode.SCREENSHOTS]: screenshotsMode,
};

/**
 * Runs the command line on its arguments after `node cli.js`, and returns the exit status. A
 * stop of the build prints its reason, and the signal interrupts a build or ends a watch. The
 * confirmation asks before migrate changes a presentation, and is undefined without a terminal.
 */
export async function runCommandLine(
	args: readonly string[],
	environment: Readonly<Record<string, string | undefined>>,
	extensionRoot: string,
	output: CommandLineOutput,
	signal: AbortSignal,
	confirm?: Confirmation
): Promise<ExitStatus> {
	let line: CommandLine;
	try {
		line = parseCommandLine(args);
	} catch (error) {
		output.err(USAGE);
		output.err(`error: ${(error as Error).message}`);
		return ExitStatus.USAGE;
	}
	if (line.isHelp) {
		output.out(USAGE);
		return ExitStatus.DONE;
	}
	const options = buildOptions(
		line,
		environment,
		extensionRoot,
		commandLineReporter(output),
		signal
	);
	try {
		return await MODE_ACTIONS[line.mode]({ line, options, output, confirm });
	} catch (error) {
		if (error instanceof BuildCancelled) {
			output.err(error.message);
			return ExitStatus.INTERRUPTED;
		}
		if (error instanceof UsageError) {
			output.err(USAGE);
			output.err(`error: ${error.message}`);
			return ExitStatus.USAGE;
		}
		if (error instanceof DeckError) {
			output.err(error.message);
			return ExitStatus.STOPPED;
		}
		throw error;
	}
}
