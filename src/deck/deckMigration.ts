/**
 * The move of a presentation of the draw.io presentation framework to the launcher of the
 * extension. Such a presentation runs the Python build of the framework in the scripts of its
 * `package.json`, as in `python3 '../tools/draw-io/build-slides.py' build`. The move copies the
 * launcher `drawslidescode.cjs` into the presentation and rewrites each such script to
 * `node drawslidescode.cjs <mode>`, with the options that the script gave after the mode. The key
 * `config` and every other key of `package.json` stay, and so do the layout and the order of the
 * file, because only the values of the rewritten scripts change.
 *
 * Yujun Huang grants an additional permission for this file under section 7 of the GNU General
 * Public License, version 3, in LICENSE-EXCEPTION.md of DrawSlidesCode.
 */
import * as fs from "fs";
import * as jsoncParser from "jsonc-parser";
import * as path from "path";
import { DeckError } from "./deckError";
import { isFile, isPlainObject, PACKAGE } from "./deckFiles";
import { DECK_COMMAND_LINE, DECK_LAUNCHER, launcherFile } from "./deckLauncher";
import type { SetUpResult } from "./deckSetUp";

/**
 * A script that runs the Python build: the assignments of environment variables before it, the
 * interpreter, the path of `build-slides.py`, quoted or not, and the mode with its options.
 */
const PYTHON_BUILD_SCRIPT =
	/^(\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*)python3?(?:\s+-[A-Za-z]+)*\s+('[^']*build-slides\.py'|"[^"]*build-slides\.py"|\S*build-slides\.py)(?=\s|$)([\s\S]*)$/;
/** A script that names the Python build somewhere other than at its start, which moves by hand. */
const NAMES_PYTHON_BUILD = /build-slides\.py/;

/** A script of `package.json` whose command the move replaces. */
export interface ScriptChange {
	readonly name: string;
	readonly from: string;
	readonly to: string;
}

/** What the presentation holds of the launcher, against the launcher of the extension. */
export enum LauncherState {
	MISSING = "missing",
	OUTDATED = "outdated",
	CURRENT = "current",
}

/** The changes that the move makes to a presentation, before it makes them. */
export interface DeckMigration {
	readonly project: string;
	readonly scripts: readonly ScriptChange[];
	readonly launcher: LauncherState;
	/** The scripts that name `build-slides.py` in a form that the move does not rewrite. */
	readonly leftByHand: readonly string[];
}

/** The command of a script with the Python build replaced by the launcher, or undefined. */
export function launcherCommand(command: string): string | undefined {
	const match = PYTHON_BUILD_SCRIPT.exec(command);
	if (match === null) {
		return undefined;
	}
	const [, assignments, , rest] = match;
	return `${assignments}${DECK_COMMAND_LINE}${rest}`;
}

function readScripts(packageFile: string): Record<string, unknown> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(fs.readFileSync(packageFile, "utf8"));
	} catch (error) {
		throw new DeckError(
			`${packageFile} does not read as JSON: ${(error as Error).message}`
		);
	}
	if (!isPlainObject(parsed)) {
		throw new DeckError(`${packageFile} holds no JSON object`);
	}
	const scripts = parsed.scripts;
	return isPlainObject(scripts) ? scripts : {};
}

function launcherState(project: string, extensionRoot: string): LauncherState {
	const own = path.join(project, DECK_LAUNCHER);
	if (!isFile(own)) {
		return LauncherState.MISSING;
	}
	return fs
		.readFileSync(own)
		.equals(fs.readFileSync(launcherFile(extensionRoot)))
		? LauncherState.CURRENT
		: LauncherState.OUTDATED;
}

/** The changes that `migrateDeck` would make to the presentation. */
export function planMigration(
	project: string,
	extensionRoot: string
): DeckMigration {
	const folder = path.resolve(project);
	const packageFile = path.join(folder, PACKAGE);
	if (!isFile(packageFile)) {
		throw new DeckError(`${folder} holds no ${PACKAGE}`);
	}
	const scripts = Object.entries(readScripts(packageFile)).filter(
		(entry): entry is [string, string] => typeof entry[1] === "string"
	);
	const changes = scripts.flatMap(([name, command]) => {
		const replaced = launcherCommand(command);
		return replaced === undefined
			? []
			: [{ name, from: command, to: replaced }];
	});
	const leftByHand = scripts
		.filter(
			([name, command]) =>
				NAMES_PYTHON_BUILD.test(command) &&
				!changes.some((change) => change.name === name)
		)
		.map(([name]) => name);
	return {
		project: folder,
		scripts: changes,
		launcher: launcherState(folder, extensionRoot),
		leftByHand,
	};
}

/** Whether the move changes anything, which it does when a script runs the Python build. */
export function isMigrationNeeded(migration: DeckMigration): boolean {
	return migration.scripts.length > 0;
}

/** The changes of the move, one line each, for the confirmation before the move. */
export function migrationLines(migration: DeckMigration): string[] {
	const launcherLine = {
		[LauncherState.MISSING]: `${DECK_LAUNCHER}: copied from the extension`,
		[LauncherState.OUTDATED]: `${DECK_LAUNCHER}: replaced by the launcher of the extension, which differs from it`,
		[LauncherState.CURRENT]: undefined,
	}[migration.launcher];
	return [
		...(launcherLine === undefined ? [] : [launcherLine]),
		...migration.scripts.map(
			(change) =>
				`${PACKAGE}, script ${change.name}: ${change.from} -> ${change.to}`
		),
	];
}

/** The warnings on the scripts that the move leaves, which name the Python build in another form. */
function leftByHandWarnings(migration: DeckMigration): string[] {
	return migration.leftByHand.map(
		(name) =>
			`the script ${name} of ${PACKAGE} names build-slides.py in a form that the move leaves as it is, so rewrite it by hand to run ${DECK_COMMAND_LINE} <mode>`
	);
}

/**
 * Copies the launcher into the presentation and rewrites the scripts of `package.json` that run
 * the Python build, and returns the changes made. A presentation that runs no Python build is
 * left as it is.
 */
export function migrateDeck(
	project: string,
	extensionRoot: string
): SetUpResult {
	const migration = planMigration(project, extensionRoot);
	const warnings = leftByHandWarnings(migration);
	if (!isMigrationNeeded(migration)) {
		return {
			lines: [
				`${path.join(
					migration.project,
					PACKAGE
				)} runs no script of build-slides.py, so nothing changes`,
			],
			warnings,
		};
	}
	const packageFile = path.join(migration.project, PACKAGE);
	const text = fs.readFileSync(packageFile, "utf8");
	const rewritten = migration.scripts.reduce(
		(current, change) =>
			jsoncParser.applyEdits(
				current,
				jsoncParser.modify(
					current,
					["scripts", change.name],
					change.to,
					{
						formattingOptions: { insertSpaces: true, tabSize: 2 },
					}
				)
			),
		text
	);
	if (migration.launcher !== LauncherState.CURRENT) {
		fs.copyFileSync(
			launcherFile(extensionRoot),
			path.join(migration.project, DECK_LAUNCHER)
		);
	}
	fs.writeFileSync(packageFile, rewritten, "utf8");
	return { lines: migrationLines(migration), warnings };
}

/**
 * The line of the set-up of the editor that offers the move, or undefined when the presentation
 * needs none, which a presentation without a `package.json` that reads as JSON never does.
 */
export function migrationOffer(
	project: string,
	extensionRoot: string
): string | undefined {
	let migration: DeckMigration;
	try {
		migration = planMigration(project, extensionRoot);
	} catch (error) {
		if (error instanceof DeckError) {
			return undefined;
		}
		throw error;
	}
	if (!isMigrationNeeded(migration)) {
		return undefined;
	}
	return `${path.join(
		migration.project,
		PACKAGE
	)} runs build-slides.py of the draw.io presentation framework in ${
		migration.scripts.length
	} scripts. The mode migrate of the command line, or the command Set Up a Presentation in This Folder, copies ${DECK_LAUNCHER} into the presentation and rewrites the scripts to run it, after a confirmation.`;
}
