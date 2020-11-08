import { GitHub, context } from "@actions/github";
import { exec } from "@actions/exec";
import { getChangelog } from "./shared";

export async function run(): Promise<void> {
	const version = getChangelog().latestVersion;
	if (version.kind === "unreleased") {
		return;
	}

	await exec("yarn", [
		"vsce",
		"publish",
		"--packagePath",
		"./vscode-drawio.vsix",
		"--pat",
		process.env.MARKETPLACE_TOKEN!,
	]);

	const gitTag = `v${version.version}`;
	console.log(`Creating a version tag "${gitTag}".`);
	const api = new GitHub(process.env.GH_TOKEN!);
	await api.git.createRef({
		...context.repo,
		ref: `refs/tags/${gitTag}`,
		sha: context.sha,
	});

	console.log("Uploading to open-vsx...");
	await exec("yarn", [
		"ovsx",
		"publish",
		"./vscode-drawio.vsix",
		"-p",
		process.env.OPEN_VSX_TOKEN!,
	]);
}
