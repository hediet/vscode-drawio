/**
 * The entry of `dist/cli.js`, the command line of the build of a deck, as `deck/commandLine.ts`
 * says. The folder of the extension is the folder above `dist/`, so that the command line of an
 * installed version reads the viewer, the plugins and the templates of that version.
 */
import * as path from "path";
import * as readline from "readline";
import { Confirmation, ExitStatus, runCommandLine } from "./deck/commandLine";

/** A question on the terminal, answered yes by `y` or `yes`. */
const askOnTerminal: Confirmation = (question) =>
	new Promise((resolve) => {
		const terminal = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
		});
		terminal.question(question, (answer) => {
			terminal.close();
			resolve(/^y(es)?$/i.test(answer.trim()));
		});
	});

const controller = new AbortController();
// The first Ctrl-C stops the build at its next page or ends the watch, and a second one ends the
// process at once.
process.once("SIGINT", () => {
	controller.abort();
	process.once("SIGINT", () => process.exit(ExitStatus.INTERRUPTED));
});

runCommandLine(
	process.argv.slice(2),
	process.env,
	path.resolve(__dirname, ".."),
	{
		out: (line) => console.log(line),
		err: (line) => console.error(line),
	},
	controller.signal,
	process.stdin.isTTY ? askOnTerminal : undefined
).then(
	(status) => {
		process.exitCode = status;
	},
	(error) => {
		console.error(error);
		process.exitCode = ExitStatus.STOPPED;
	}
);
