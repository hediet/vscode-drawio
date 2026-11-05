import { Disposable } from "@hediet/std/disposable";
import * as fs from "fs";
import * as path from "path";
import { commands, OutputChannel, Uri, window, workspace } from "vscode";
import { DeckError } from "../../deck/deckError";
import { PACKAGE, SINGLE_FILE, SLIDES_DIR } from "../../deck/deckFiles";
import {
	isMigrationNeeded,
	migrateDeck,
	migrationLines,
	planMigration,
} from "../../deck/deckMigration";
import {
	initDeck,
	initRefusal,
	setUpEditor,
	SetUpResult,
} from "../../deck/deckSetUp";
import { registerFailableCommand } from "../../utils/registerFailableCommand";
import * as deckFolderSetUp from "./deckFolderSetUp";
import { DeckFolderState } from "./deckFolderSetUp";

const setUpDeckCommand = "drawSlidesCode.setUpDeck";
const commandTitle = "Set Up a Presentation in This Folder";
const buildCommandTitle = "DrawSlidesCode: Build the Presentation";
const setUpButton = "Set Up";
const moveButton = "Move to the Launcher";
const showOutputButton = "Show Output";
const openFolderButton = "Open Folder";

/**
 * The command Set Up a Presentation in This Folder, which starts a presentation in a folder
 * without one, and writes `.vscode/settings.json` of a presentation without it, from the
 * templates of the extension in `deck-templates/`.
 */
export class DeckSetUpFeature {
	public readonly dispose = Disposable.fn();

	constructor(log: OutputChannel, extensionRoot: string) {
		this.dispose.track(
			registerFailableCommand(setUpDeckCommand, (clicked?: Uri) =>
				setUpDeck(log, extensionRoot, clicked)
			)
		);
	}
}

/**
 * Sets up the folder clicked in the explorer, or else a workspace folder.
 * The set-up runs git in the folder, so the command runs only in a trusted workspace.
 */
async function setUpDeck(
	log: OutputChannel,
	extensionRoot: string,
	clicked: Uri | undefined
): Promise<void> {
	if (!workspace.isTrusted) {
		window.showErrorMessage(
			`${commandTitle} writes files and runs git in a folder of the workspace, so the command runs only in a trusted workspace. Trust the workspace with the command Workspaces: Manage Workspace Trust, then run ${commandTitle} again.`
		);
		return;
	}
	const folder = await chooseTargetFolder(clicked);
	if (folder === undefined) {
		return;
	}
	const survey = deckFolderSetUp.surveyDeckFolder(folder);
	switch (survey.state) {
		case DeckFolderState.SetUp:
			if (await offerMigration(log, extensionRoot, folder)) {
				if (!survey.loadsSlidePlugins) {
					window.showWarningMessage(
						`${folder}/.vscode/settings.json does not set drawSlidesCode.slides to true, so the editor loads no plugin of the slides. Add "drawSlidesCode.slides": true to the file by hand, because the set-up writes only a missing file.`
					);
				}
				return;
			}
			window.showInformationMessage(
				survey.loadsSlidePlugins
					? `${folder} is set up already: it holds a presentation and its .vscode/settings.json.`
					: `${folder} holds a presentation and its .vscode/settings.json, which does not set drawSlidesCode.slides to true, so the editor loads no plugin of the slides. Add "drawSlidesCode.slides": true to the file by hand, because the set-up writes only a missing file.`
			);
			return;
		case DeckFolderState.FilesInTheWay:
			window.showErrorMessage(
				`${folder} holds no presentation, and the set-up starts one only in a folder without ${joinAsInSentence(
					survey.filesInTheWay
				)}. Create a folder for the presentation in it or in another folder, such as my-talk, with New Folder… in the Explorer, then right-click the new folder and run ${commandTitle}.`
			);
			return;
		case DeckFolderState.WithoutPresentation:
			return startDeck(log, extensionRoot, folder);
		case DeckFolderState.PresentationWithoutSettings:
			return writeDeckSettings(log, extensionRoot, folder);
	}
}

/** Starts a presentation in a folder without one. */
async function startDeck(
	log: OutputChannel,
	extensionRoot: string,
	folder: string
): Promise<void> {
	const refusal = initRefusal(folder, SLIDES_DIR, SINGLE_FILE);
	if (refusal !== undefined) {
		window.showErrorMessage(`${commandTitle} stopped: ${refusal}.`);
		return;
	}
	const title = await window.showInputBox({
		title: commandTitle,
		prompt: `The title of the presentation in ${folder}, which its package.json keeps and its first section file is named after`,
		value: path.basename(folder),
		validateInput: (value) =>
			value.trim() === ""
				? "The title holds at least one character other than a space."
				: undefined,
	});
	if (title === undefined) {
		return;
	}
	const confirmed = await confirmSetUp(
		`Start a presentation in ${folder}?`,
		deckFolderSetUp.filesWrittenByInit(folder)
	);
	if (!confirmed) {
		return;
	}
	const succeeded = runSetUp(log, `start a presentation in ${folder}`, () =>
		initDeck({ project: folder, extensionRoot, title })
	);
	if (!succeeded) {
		return;
	}
	const first = deckFolderSetUp.firstSectionFile(folder);
	// A window reads the settings of its workspace folders alone, so the section opens only in a
	// window of the folder, where the editor reads the settings that the set-up wrote.
	const opensFirst = first !== undefined && isWorkspaceFolder(folder);
	if (opensFirst) {
		// The editor decides at the opening of a drawing whether it loads the slide plugins, so the
		// section opens after VS Code has read the settings file that the set-up wrote.
		await settingsLoadSlides(Uri.file(first!));
		await commands.executeCommand(
			"vscode.openWith",
			Uri.file(first),
			"drawSlidesCode.textEditor"
		);
	}
	showSetUpDone(
		folder,
		`The presentation in ${folder} is started${
			opensFirst
				? `, and its first section ${path.basename(first!)} is open`
				: ""
		}. The command ${buildCommandTitle} builds it, as does npm run build in the folder.`
	);
}

/** Writes `.vscode/settings.json` of a presentation without one. */
async function writeDeckSettings(
	log: OutputChannel,
	extensionRoot: string,
	folder: string
): Promise<void> {
	const writes = deckFolderSetUp.filesWrittenByVscode(folder);
	const confirmed = await confirmSetUp(
		`Set up the presentation in ${folder} for the editor?`,
		writes
	);
	if (!confirmed) {
		return;
	}
	const succeeded = runSetUp(
		log,
		`set up the presentation in ${folder} for the editor`,
		() => setUpEditor(folder, extensionRoot)
	);
	if (succeeded) {
		showSetUpDone(
			folder,
			`The presentation in ${folder} is set up for the editor: the set-up wrote ${joinAsInSentence(
				writes.map((file) => file.path)
			)}.`
		);
		await offerMigration(log, extensionRoot, folder);
	}
}

/**
 * Offers to move a presentation whose scripts run the Python build of the draw.io presentation
 * framework to the launcher of the extension, with a confirmation that lists the changes. The
 * result tells whether the presentation needed the move, whatever the answer.
 */
async function offerMigration(
	log: OutputChannel,
	extensionRoot: string,
	folder: string
): Promise<boolean> {
	if (!fs.existsSync(path.join(folder, PACKAGE))) {
		return false;
	}
	let migration;
	try {
		migration = planMigration(folder, extensionRoot);
	} catch (error) {
		if (!(error instanceof DeckError)) {
			throw error;
		}
		log.appendLine(`${commandTitle}: ${error.message}`);
		return false;
	}
	if (!isMigrationNeeded(migration)) {
		return false;
	}
	const answer = await window.showInformationMessage(
		`The scripts of package.json in ${folder} run build-slides.py of the draw.io presentation framework. Move them to the launcher of the extension, so that npm run builds the presentation without Python?`,
		{
			modal: true,
			detail: `The move changes:\n${migrationLines(migration)
				.map((change) => `- ${change}`)
				.join(
					"\n"
				)}\nThe key config and every other key of package.json stay.`,
		},
		moveButton
	);
	if (answer !== moveButton) {
		return true;
	}
	const succeeded = runSetUp(
		log,
		`move the presentation in ${folder} to the launcher`,
		() => migrateDeck(folder, extensionRoot)
	);
	if (succeeded) {
		window.showInformationMessage(
			`The scripts of package.json in ${folder} run the launcher drawslidescode.cjs now, which the command line of the extension runs.`
		);
	}
	return true;
}

/**
 * Runs a set-up, writes what it wrote and its warnings into the output channel, and shows the
 * reason with which it stopped. The result tells whether the set-up succeeded.
 */
function runSetUp(
	log: OutputChannel,
	action: string,
	setUp: () => SetUpResult
): boolean {
	log.appendLine(`${commandTitle}: ${action}`);
	let result: SetUpResult;
	try {
		result = setUp();
	} catch (error) {
		if (!(error instanceof DeckError)) {
			throw error;
		}
		log.appendLine(error.message);
		window
			.showErrorMessage(
				`${commandTitle} stopped: ${error.message}`,
				showOutputButton
			)
			.then((choice) => {
				if (choice === showOutputButton) {
					log.show();
				}
			});
		return false;
	}
	result.lines.forEach((line) => log.appendLine(line));
	result.warnings.forEach((warning) => log.appendLine(`warning: ${warning}`));
	return true;
}

/**
 * The folder to set up, which is the folder clicked in the explorer, else the one workspace
 * folder, else the workspace folder that the user picks.
 * The folder lies on the disk of this machine, because the set-up writes it there.
 */
async function chooseTargetFolder(
	clicked: Uri | undefined
): Promise<string | undefined> {
	const folders = workspace.workspaceFolders ?? [];
	if (clicked === undefined && folders.length === 0) {
		window.showErrorMessage(
			`${commandTitle} sets up a folder of the workspace, and no folder is open. Open a folder with File > Open Folder…, or right-click a folder in the Explorer, and run the command again.`
		);
		return undefined;
	}
	const target =
		clicked ??
		(folders.length === 1
			? folders[0].uri
			: (
					await window.showWorkspaceFolderPick({
						placeHolder:
							"The workspace folder to set up a presentation in",
					})
			  )?.uri);
	if (target === undefined) {
		return undefined;
	}
	if (target.scheme !== "file" || !deckFolderSetUp.isFolder(target.fsPath)) {
		window.showErrorMessage(
			`${commandTitle} sets up a folder on the disk of this machine, and ${target.toString()} is none.`
		);
		return undefined;
	}
	return target.fsPath;
}

async function confirmSetUp(
	question: string,
	writes: readonly deckFolderSetUp.WrittenFile[]
): Promise<boolean> {
	const answer = await window.showInformationMessage(
		question,
		{
			modal: true,
			detail: `The set-up writes:\n${writes
				.map((file) => `- ${file.path}: ${file.content}`)
				.join("\n")}`,
		},
		setUpButton
	);
	return answer === setUpButton;
}

/** The items as in a sentence, `a`, `a and b` or `a, b and c`. */
function joinAsInSentence(items: readonly string[]): string {
	return items.length < 2
		? items.join("")
		: `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * Says that the folder is set up.
 * VS Code reads `.vscode/settings.json` of a workspace folder alone, so the message offers to
 * open a folder that is none.
 */
function showSetUpDone(folder: string, message: string): void {
	if (isWorkspaceFolder(folder)) {
		window.showInformationMessage(message);
		return;
	}
	window
		.showInformationMessage(
			`${message} VS Code reads the .vscode/settings.json of a folder that is open as a workspace folder, so open the folder to edit its slides.`,
			openFolderButton
		)
		.then((choice) => {
			if (choice === openFolderButton) {
				commands.executeCommand("vscode.openFolder", Uri.file(folder), {
					forceNewWindow: true,
				});
			}
		});
}

function isWorkspaceFolder(folder: string): boolean {
	return (workspace.workspaceFolders ?? []).some(
		(workspaceFolder) =>
			path.resolve(workspaceFolder.uri.fsPath) === path.resolve(folder)
	);
}

/** How long the set-up waits for VS Code to read the settings file it wrote. */
const settingsReadTimeoutMs = 5000;

/**
 * Resolves once the settings of the file set `drawSlidesCode.slides` to true, which VS Code reads
 * from a settings file written moments before only after its watcher has seen the file, or after
 * a timeout, after which the drawing opens as it is.
 */
function settingsLoadSlides(file: Uri): Promise<void> {
	const loadsSlides = () =>
		workspace.getConfiguration("drawSlidesCode", file).get<boolean>("slides") === true;
	if (loadsSlides()) {
		return Promise.resolve();
	}
	return new Promise((resolve) => {
		const finish = () => {
			clearTimeout(timer);
			listener.dispose();
			resolve();
		};
		const timer = setTimeout(finish, settingsReadTimeoutMs);
		const listener = workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration("drawSlidesCode.slides", file) && loadsSlides()) {
				finish();
			}
		});
	});
}
