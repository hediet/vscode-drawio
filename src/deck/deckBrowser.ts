/**
 * The headless browser that exports the pages, takes the pictures of the embedded pages and
 * prints the PDF, driven through `playwright-core`, which brings no browser of its own.
 *
 * A browser at a path that the caller gives is the one the build launches. Without a path, the
 * build launches the first of the following that starts: the Chromium that Playwright installs
 * into its cache, Google Chrome and Microsoft Edge, the last two through the channels of
 * Playwright. Playwright's Chromium comes first, because it is the revision that the version of
 * `playwright-core` was made for, so two machines with it draw the pages alike.
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
import type { Browser, LaunchOptions } from "playwright-core";
import { BuildReporter, reportWarnings } from "./buildEvents";
import { DeckError, failureText } from "./deckError";

/** Which browser the build launches. */
export interface BrowserChoice {
	/** The executable of a Chrome, an Edge or a Chromium, which the build then launches alone. */
	readonly executablePath?: string;
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

/** Launches the headless browser of the choice. Raises `BrowserNotFound` when none starts. */
export async function launchBrowser(
	choice: BrowserChoice = {},
	reporter?: BuildReporter
): Promise<Browser> {
	if (choice.executablePath !== undefined) {
		try {
			return await launchWithSandbox(
				playwrightLaunch,
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
	const failures = new Array<string>();
	for (const { channel, name } of CHANNELS) {
		try {
			return await launchWithSandbox(
				playwrightLaunch,
				{ ...LAUNCH_OPTIONS, channel },
				name,
				reporter
			);
		} catch (error) {
			failures.push(`${name}: ${firstLine(error)}`);
		}
	}
	throw new BrowserNotFound(
		`no browser started. ${failures.join(
			". "
		)}. Install Chromium through Playwright, or give the path of a Chrome, an Edge or a Chromium.`
	);
}
