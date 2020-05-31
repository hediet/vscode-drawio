import { GitHub, context } from "@actions/github";
import { exec } from "@actions/exec";
import { getChangelog, readPackageJson } from "./shared";

export async function run(): Promise<void> {
	const version = getChangelog().latestVersion;
	if (version.kind === "unreleased" || version.releaseDate) {
		return;
	}

	if (readPackageJson().name !== "vscode-drawio-insiders-build") {
		throw new Error("Disabled: " + readPackageJson().name);
	}

	await exec("yarn", [
		"vsce",
		"--packagePath",
		"./vscode-drawio.vsix",
		"--pat",
		process.env.MARKETPLACE_TOKEN!,
	]);

	const gitTag = `v${version}`;
	console.log(`Creating a version tag "${gitTag}".`);
	const api = new GitHub(process.env.GH_TOKEN!);
	await api.git.createRef({
		...context.repo,
		ref: `refs/tags/${gitTag}`,
		sha: context.sha,
	});
}
