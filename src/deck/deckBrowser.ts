/**
 * The headless browser that exports the pages, takes the pictures of the embedded pages and
 * prints the PDF, driven through `playwright-core`, which brings no browser of its own.
 *
 * A browser at a path that the caller gives is the one the build launches. Without a path, the
 * build launches the first of the following that starts: the Chromium that Playwright installs
 * into its cache, Google Chrome and Microsoft Edge, the last two through the channels of
 * Playwright, and then the programs of `PATH_PROGRAMS` that the PATH holds, in that order.
 * Playwright's Chromium comes first, because it is the revision that the version of
 * `playwright-core` was made for, so two machines with it draw the pages alike. The programs of
 * the PATH serve a Linux whose package manager installs Chromium or Chrome outside the places that
 * the channels of Playwright look in, such as NixOS.
 *
 * The browser runs with the sandbox of Chromium, because the build loads pages of other servers
 * for the pictures of the embedded pages. A browser that does not start with its sandbox, such
 * as on a Linux without user namespaces, starts again without it, with a warning.
 *
 * `playwright-core` is loaded at the first launch, so that the activation of the extension, which
 * imports this module through the commands, does not load it. The signal handlers of Playwright
 * stay off, so that a Ctrl-C reaches the `AbortSignal` of the command line, which stops the build
 * and closes the browser.
 */
import * as fs from "fs";
import * as path from "path";
import type { Browser, LaunchOptions } from "playwright-core";
import { BuildReporter, reportWarnings } from "./buildEvents";
import { DeckError, failureText } from "./deckError";

/** Which browser the build launches. */
export interface BrowserChoice {
	/** The executable of a Chrome, an Edge or a Chromium, which the build then launches alone. */
	readonly executablePath?: string;
	/**
	 * The folders searched for `PATH_PROGRAMS`, in the form of the variable PATH, which is the PATH
	 * of this process by default.
	 */
	readonly searchPath?: string;
}

/** No browser started, with the reason of each one tried. */
export class BrowserNotFound extends DeckError {}

/** A launch of Chromium by Playwright with the options. */
export type BrowserLaunch = (options: LaunchOptions) => Promise<Browser>;

/** A browser that Playwright launches without a path, by its channel, and its name. */
const CHANNELS: readonly { channel: string | undefined; name: string }[] = [
	{ channel: undefined, name: "Playwright's Chromium" },
	{ channel: "chrome", name: "Google Chrome" },
	{ channel: "msedge", name: "Microsoft Edge" },
];

/** The programs of a Chromium or a Chrome that the build looks for on the PATH, in this order. */
export const PATH_PROGRAMS: readonly string[] = [
	"chromium",
	"chromium-browser",
	"google-chrome",
	"google-chrome-stable",
];

/**
 * The most milliseconds that a program of the PATH may take to start, in place of the three
 * minutes of Playwright. After a timeout, `playwright-core` 1.64.1 waits up to 30 more seconds for
 * the program to close before it kills it, so the build gives up on a program that starts no
 * browser after about a minute.
 */
export const PATH_PROGRAM_TIMEOUT_MS = 30000;

/** The words of Chromium and of Playwright when the sandbox of Chromium cannot start. */
const SANDBOX_FAILURE = /sandbox/i;

const LAUNCH_OPTIONS: LaunchOptions = {
	handleSIGINT: false,
	handleSIGTERM: false,
	handleSIGHUP: false,
};

function firstLine(error: unknown): string {
	return failureText(error).split("\n")[0];
}

async function playwrightLaunch(options: LaunchOptions): Promise<Browser> {
	const { chromium } = await import("playwright-core");
	return chromium.launch(options);
}

function isExecutableFile(file: string): boolean {
	try {
		fs.accessSync(file, fs.constants.X_OK);
		return fs.statSync(file).isFile();
	} catch {
		return false;
	}
}

/**
 * The files of the programs of `PATH_PROGRAMS` in the folders of the search path, in the order of
 * `PATH_PROGRAMS`. Each program is the first executable file of its name in the order of the
 * folders, as a shell finds it, with `.exe` after the name on Windows. A program whose real file
 * an earlier program shares is left out, because it would fail in the same way. A folder that is
 * empty or relative, which a shell reads from the current folder, is left out, so that the folder
 * that a build runs in cannot put a program in the place of the browser.
 */
export function findPathPrograms(
	searchPath: string,
	platform: NodeJS.Platform = process.platform
): string[] {
	const isWindows = platform === "win32";
	const platformPath = isWindows ? path.win32 : path.posix;
	const folders = searchPath
		.split(platformPath.delimiter)
		.filter((folder) => folder !== "" && platformPath.isAbsolute(folder));
	const realFiles = new Set<string>();
	const programs = new Array<string>();
	for (const name of PATH_PROGRAMS) {
		const fileName = isWindows ? `${name}.exe` : name;
		const file = folders
			.map((folder) => path.join(folder, fileName))
			.find(isExecutableFile);
		if (file === undefined) {
			continue;
		}
		const realFile = fs.realpathSync(file);
		if (!realFiles.has(realFile)) {
			realFiles.add(realFile);
			programs.push(file);
		}
	}
	return programs;
}

/** The names joined as a list in a sentence with the word, such as "a, b or c". */
function joinedNames(names: readonly string[], word: string): string {
	return names.length < 2
		? names.join("")
		: `${names.slice(0, -1).join(", ")} ${word} ${names[names.length - 1]}`;
}

/**
 * Launches the browser with its sandbox, and again without it when the first launch failed on the
 * sandbox, after a warning that names the browser and the reason.
 */
export async function launchWithSandbox(
	launch: BrowserLaunch,
	options: LaunchOptions,
	name: string,
	reporter: BuildReporter | undefined
): Promise<Browser> {
	try {
		return await launch({ ...options, chromiumSandbox: true });
	} catch (error) {
		const reason = firstLine(error);
		if (!SANDBOX_FAILURE.test(failureText(error))) {
			throw error;
		}
		const browser = await launch({ ...options, chromiumSandbox: false });
		reportWarnings(reporter, [
			`${name} did not start with the sandbox of Chromium (${reason}), so the build runs it without the sandbox`,
		]);
		return browser;
	}
}

/**
 * Launches the headless browser of the choice through the launch, which is that of Playwright
 * outside the tests. Raises `BrowserNotFound` when none starts.
 */
export async function launchBrowser(
	choice: BrowserChoice = {},
	reporter?: BuildReporter,
	launch: BrowserLaunch = playwrightLaunch
): Promise<Browser> {
	if (choice.executablePath !== undefined) {
		try {
			return await launchWithSandbox(
				launch,
				{ ...LAUNCH_OPTIONS, executablePath: choice.executablePath },
				choice.executablePath,
				reporter
			);
		} catch (error) {
			throw new BrowserNotFound(
				`the browser ${
					choice.executablePath
				} did not start: ${firstLine(error)}`
			);
		}
	}
	const programs = findPathPrograms(
		choice.searchPath ?? process.env.PATH ?? ""
	);
	const candidates: { options: LaunchOptions; name: string }[] = [
		...CHANNELS.map(({ channel, name }) => ({
			options: { ...LAUNCH_OPTIONS, channel },
			name,
		})),
		...programs.map((file) => ({
			options: {
				...LAUNCH_OPTIONS,
				executablePath: file,
				timeout: PATH_PROGRAM_TIMEOUT_MS,
			},
			name: file,
		})),
	];
	const failures = new Array<string>();
	for (const { options, name } of candidates) {
		try {
			return await launchWithSandbox(launch, options, name, reporter);
		} catch (error) {
			failures.push(`${name}: ${firstLine(error).replace(/\.$/, "")}`);
		}
	}
	if (programs.length === 0) {
		failures.push(`The PATH holds no ${joinedNames(PATH_PROGRAMS, "or")}`);
	}
	throw new BrowserNotFound(
		`no browser started. ${failures.join(
			". "
		)}. Install Chromium through Playwright, or give the path of a Chrome, an Edge or a Chromium.`
	);
}
