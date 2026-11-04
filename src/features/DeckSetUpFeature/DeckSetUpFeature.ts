import { Disposable } from "@hediet/std/disposable";
import { execFile, ExecFileException } from "child_process";
import * as os from "os";
import * as path from "path";
import {
	commands,
	ConfigurationTarget,
	OutputChannel,
	ProgressLocation,
	Uri,
	window,
	workspace,
} from "vscode";
import { registerFailableCommand } from "../../utils/registerFailableCommand";
import * as deckFolderSetUp from "./deckFolderSetUp";
import { DeckFolderState, SetUpMode } from "./deckFolderSetUp";

const setUpDeckCommand = "drawioSlides.setUpDeck";
const commandTitle = "Set Up a Presentation in This Folder";
const settingSection = "drawioSlides";
const frameworkFolderSetting = "frameworkFolder";
const scriptName = "build-slides.py";
const scriptTimeoutMs = 120_000;
const chooseFolderButton = "Choose Folder…";
const setUpButton = "Set Up";
const showOutputButton = "Show Output";
const openFolderButton = "Open Folder";

/** A command that `build-slides.py` runs, with what to install when it is missing. */
interface RequiredCommand {
	readonly command: string;
	readonly installation: string;
}

const python: RequiredCommand = {
	command: "python3",
	installation: "Python 3, such as from https://www.python.org/downloads/",
};
const git: RequiredCommand = {
	command: "git",
	installation: "git, such as from https://git-scm.com/downloads",
};

interface ScriptRun {
	readonly error: ExecFileException | undefined;
	readonly stdout: string;
	readonly stderr: string;
}

/**
 * The command Set Up a Presentation in This Folder, which runs `build-slides.py` of the draw.io
 * presentation framework on a folder, `init` on a folder without a presentation and `vscode` on
 * a presentation without `.vscode/settings.json`.
 */
export class DeckSetUpFeature {
	public readonly dispose = Disposable.fn();

	constructor(log: OutputChannel) {
		this.dispose.track(
			registerFailableCommand(setUpDeckCommand, (clicked?: Uri) =>
				setUpDeck(log, clicked)
			)
		);
	}
}

/**
 * Sets up the folder clicked in the explorer, or else a workspace folder.
 * A script from a setting runs on the user's files, so the command runs only in a trusted
 * workspace.
 */
async function setUpDeck(
	log: OutputChannel,
	clicked: Uri | undefined
): Promise<void> {
	if (!workspace.isTrusted) {
		window.showErrorMessage(
			`${commandTitle} runs ${scriptName} of the draw.io presentation framework, so the command runs only in a trusted workspace. Trust the workspace with the command Workspaces: Manage Workspace Trust, then run ${commandTitle} again.`
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
			window.showInformationMessage(
				survey.loadsSlidePlugins
					? `${folder} is set up already: it holds a presentation and its .vscode/settings.json.`
					: `${folder} holds a presentation and its .vscode/settings.json, which does not set drawioSlides.slides to true, so the editor loads no plugin of the framework. Add "drawioSlides.slides": true to the file by hand, because ${scriptName} vscode writes only a missing file.`
			);
			return;
		case DeckFolderState.FilesInTheWay:
			window.showErrorMessage(
				`${folder} holds no presentation, and ${scriptName} init starts one only in a folder without ${joinAsInSentence(
					survey.filesInTheWay
				)}. Create a folder for the presentation in it or in another folder, such as my-talk, with New Folder… in the Explorer, then right-click the new folder and run ${commandTitle}.`
			);
			return;
		case DeckFolderState.WithoutPresentation:
			return startDeck(log, folder);
		case DeckFolderState.PresentationWithoutSettings:
			return writeDeckSettings(log, folder);
	}
}

/** Starts a presentation in a folder without one, with `init`. */
async function startDeck(log: OutputChannel, folder: string): Promise<void> {
	const script = await checkCommandsThenFindBuildScript(SetUpMode.Init, [python, git]);
	if (script === undefined) {
		return;
	}
	if (deckFolderSetUp.isRepositoryOfScript(folder, script)) {
		window.showErrorMessage(
			`${folder} is the repository of the draw.io presentation framework, and ${scriptName} init starts a presentation only in a folder of its own. Create a folder for the presentation in it, such as my-talk, then right-click the new folder and run ${commandTitle}.`
		);
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
		SetUpMode.Init,
		deckFolderSetUp.filesWrittenByInit(folder, script)
	);
	if (!confirmed) {
		return;
	}
	const succeeded = await runBuildScript(log, folder, SetUpMode.Init, [
		script,
		SetUpMode.Init,
		folder,
		`--title=${title}`,
	]);
	if (!succeeded) {
		return;
	}
	const first = deckFolderSetUp.firstSectionFile(folder);
	// A window reads the settings of its workspace folders alone, so the section opens only in a
	// window of the folder, where the editor reads the settings that init wrote.
	const opensFirst = first !== undefined && isWorkspaceFolder(folder);
	if (opensFirst) {
		await commands.executeCommand(
			"vscode.openWith",
			Uri.file(first),
			"drawioSlides.textEditor"
		);
	}
	const tools = path.dirname(path.dirname(script));
	showSetUpDone(
		folder,
		`The presentation in ${folder} is started${
			opensFirst ? `, and its first section ${path.basename(first!)} is open` : ""
		}. npm run build in the folder builds it, after npm install in ${tools} once.`
	);
}

/** Writes `.vscode/settings.json` of a presentation without one, with `vscode`. */
async function writeDeckSettings(
	log: OutputChannel,
	folder: string
): Promise<void> {
	const script = await checkCommandsThenFindBuildScript(SetUpMode.Vscode, [python]);
	if (script === undefined) {
		return;
	}
	const writes = deckFolderSetUp.filesWrittenByVscode(folder);
	const confirmed = await confirmSetUp(
		`Set up the presentation in ${folder} for the editor?`,
		SetUpMode.Vscode,
		writes
	);
	if (!confirmed) {
		return;
	}
	const succeeded = await runBuildScript(log, folder, SetUpMode.Vscode, [
		script,
		SetUpMode.Vscode,
		folder,
	]);
	if (succeeded) {
		showSetUpDone(
			folder,
			`The presentation in ${folder} is set up for the editor: ${scriptName} vscode wrote ${joinAsInSentence(
				writes.map((file) => file.path)
			)}.`
		);
	}
}

/**
 * The folder to set up, which is the folder clicked in the explorer, else the one workspace
 * folder, else the workspace folder that the user picks.
 * The folder lies on the disk of this machine, because the script reads and writes it there.
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
						placeHolder: "The workspace folder to set up a presentation in",
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

/**
 * The build script of the framework folder of the setting, after a check that the commands that
 * the mode runs are installed.
 * When the setting names no folder of the framework, the user chooses one, which the user
 * settings then keep.
 */
async function checkCommandsThenFindBuildScript(
	mode: SetUpMode,
	required: readonly RequiredCommand[]
): Promise<string | undefined> {
	const installed = await Promise.all(
		required.map((command) => isInstalled(command.command))
	);
	const missing = required.find((_command, index) => !installed[index]);
	if (missing !== undefined) {
		window.showErrorMessage(
			`${scriptName} ${mode} needs the command ${missing.command}, which VS Code does not find. Install ${missing.installation}, then quit and start VS Code again, so that it finds the command, and run ${commandTitle} again.`
		);
		return undefined;
	}
	const configured = workspace
		.getConfiguration(settingSection)
		.get<string>(frameworkFolderSetting, "");
	if (configured === "") {
		return chooseFrameworkFolder(
			`The setting ${settingSection}.${frameworkFolderSetting} names no folder yet.`
		);
	}
	const frameworkFolder = deckFolderSetUp.withHomeExpanded(configured, os.homedir());
	if (!path.isAbsolute(frameworkFolder)) {
		return chooseFrameworkFolder(
			`The setting ${settingSection}.${frameworkFolderSetting} holds ${configured}, which is neither an absolute path nor a path that starts with ~/.`
		);
	}
	return (
		deckFolderSetUp.findBuildScript(frameworkFolder) ??
		chooseFrameworkFolder(
			`The folder ${configured} of the setting ${settingSection}.${frameworkFolderSetting} holds no ${deckFolderSetUp.BUILD_SCRIPT}.`
		)
	);
}

/** Lets the user choose the folder of the framework until it holds the build script, or cancel. */
async function chooseFrameworkFolder(
	reason: string
): Promise<string | undefined> {
	const choice = await window.showWarningMessage(
		`Choose the folder of the draw.io presentation framework, whose ${deckFolderSetUp.BUILD_SCRIPT} sets up the presentation.`,
		{
			modal: true,
			detail: `${reason} The user settings keep the folder chosen in ${settingSection}.${frameworkFolderSetting}.`,
		},
		chooseFolderButton
	);
	if (choice !== chooseFolderButton) {
		return undefined;
	}
	const picked = await window.showOpenDialog({
		canSelectFiles: false,
		canSelectFolders: true,
		canSelectMany: false,
		openLabel: "Use as Framework Folder",
		title: "The folder of the draw.io presentation framework",
	});
	const folder = picked?.[0]?.fsPath;
	if (folder === undefined) {
		return undefined;
	}
	const script = deckFolderSetUp.findBuildScript(folder);
	if (script === undefined) {
		return chooseFrameworkFolder(
			`The folder ${folder} holds no ${deckFolderSetUp.BUILD_SCRIPT}.`
		);
	}
	await workspace
		.getConfiguration(settingSection)
		.update(frameworkFolderSetting, folder, ConfigurationTarget.Global);
	return script;
}

async function confirmSetUp(
	question: string,
	mode: SetUpMode,
	writes: readonly deckFolderSetUp.WrittenFile[]
): Promise<boolean> {
	const answer = await window.showInformationMessage(
		question,
		{
			modal: true,
			detail: `${scriptName} ${mode} writes:\n${writes
				.map((file) => `- ${file.path}: ${file.content}`)
				.join("\n")}`,
		},
		setUpButton
	);
	return answer === setUpButton;
}

/**
 * Runs the build script, writes its output into the output channel, and shows the reason with
 * which it stopped.
 * The result tells whether the script succeeded.
 */
async function runBuildScript(
	log: OutputChannel,
	folder: string,
	mode: SetUpMode,
	args: readonly string[]
): Promise<boolean> {
	log.appendLine(
		`${python.command} ${args.map((arg) => JSON.stringify(arg)).join(" ")}`
	);
	const run = await window.withProgress(
		{
			location: ProgressLocation.Notification,
			title: `${scriptName} ${mode} on ${folder}`,
		},
		() => runPython(args, folder)
	);
	log.append(run.stdout);
	log.append(run.stderr);
	if (run.error === undefined) {
		return true;
	}
	const reason = run.error.killed
		? `it gave no answer within ${scriptTimeoutMs / 1000} seconds, so the command ended it`
		: deckFolderSetUp.refusalOf(run.stderr) ?? run.error.message;
	window
		.showErrorMessage(`${scriptName} ${mode} stopped: ${reason}`, showOutputButton)
		.then((choice) => {
			if (choice === showOutputButton) {
				log.show();
			}
		});
	return false;
}

function runPython(args: readonly string[], cwd: string): Promise<ScriptRun> {
	return new Promise((resolve) =>
		execFile(
			python.command,
			args,
			{ cwd, timeout: scriptTimeoutMs },
			(error, stdout, stderr) =>
				resolve({ error: error ?? undefined, stdout, stderr })
		)
	);
}

/** The items as in a sentence, `a`, `a and b` or `a, b and c`. */
function joinAsInSentence(items: readonly string[]): string {
	return items.length < 2
		? items.join("")
		: `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function isInstalled(command: string): Promise<boolean> {
	return new Promise((resolve) =>
		execFile(command, ["--version"], (error) => resolve(error === null))
	);
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
