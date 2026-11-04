/**
 * What a build tells its caller while it runs, and how the caller stops it.
 *
 * A build reports each line that the command line prints to its standard output, each warning,
 * and the progress of each step, through the callbacks of `BuildReporter`, so that the command
 * line prints them and a command of the extension writes them into its output channel and its
 * notification of progress. The caller stops a build through an `AbortSignal`, and the build
 * then stops at the next page and raises `BuildCancelled`.
 */
import { DeckError } from "./deckError";

/** The steps of a build that report their progress. */
export enum BuildStep {
	PAGE_PICTURES = "pictures of the embedded pages",
	EXPORT = "export of the pages",
	HTML = "HTML file",
	PDF = "PDF",
	LANGUAGE_CHECK = "language check",
}

/** The progress of a step: the units done, such as pages, out of the units of the step. */
export interface BuildProgress {
	readonly step: BuildStep;
	readonly done: number;
	readonly total: number;
}

/** An issue of the language check, at the first place where its label shows. */
export interface LanguageIssue {
	/** The number of the slide, as the deck shows it. */
	readonly slide: number;
	readonly pageName: string;
	readonly cellId: string;
	/** The section file or the multi-page file that holds the page. */
	readonly file: string;
	/** The place of the page among the pages of its file, from 0. */
	readonly pagePosition: number;
	/** The number of the other slides that show the same label. */
	readonly otherSlides: number;
	readonly isSpelling: boolean;
	readonly message: string;
	/** The first replacements that LanguageTool suggests, at most five. */
	readonly fixes: readonly string[];
	/** The text around the issue, with the issue marked. */
	readonly context: string;
}

/** The callbacks through which a build reports, each optional. */
export interface BuildReporter {
	/** A line that the command line prints to its standard output, such as the count line. */
	readonly onLine?: (line: string) => void;
	/** A warning, which the command line prints after `warning: ` to its standard error. */
	readonly onWarning?: (warning: string) => void;
	readonly onProgress?: (progress: BuildProgress) => void;
	/** An issue of the language check, which also reaches `onLine` as two lines. */
	readonly onIssue?: (issue: LanguageIssue) => void;
	/** A build of the watch that failed, with the reason, after which the watch goes on. */
	readonly onFailure?: (reason: string) => void;
}

/** A build that its caller stopped. */
export class BuildCancelled extends DeckError {
	constructor() {
		super("the build was cancelled");
	}
}

/** Raises `BuildCancelled` when the signal has been aborted. */
export function throwIfCancelled(signal: AbortSignal | undefined): void {
	if (signal?.aborted) {
		throw new BuildCancelled();
	}
}

export function reportLine(
	reporter: BuildReporter | undefined,
	line: string
): void {
	reporter?.onLine?.(line);
}

export function reportWarnings(
	reporter: BuildReporter | undefined,
	warnings: readonly string[]
): void {
	warnings.forEach((warning) => reporter?.onWarning?.(warning));
}

export function reportProgress(
	reporter: BuildReporter | undefined,
	step: BuildStep,
	done: number,
	total: number
): void {
	reporter?.onProgress?.({ step, done, total });
}
