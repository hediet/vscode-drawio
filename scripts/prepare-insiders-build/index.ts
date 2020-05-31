import { writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { getChangelog } from "../shared";

function readJsonFile(fileName: string): any {
	const content = readFileSync(fileName, { encoding: "utf-8" });
	return JSON.parse(content);
}

export async function run(): Promise<void> {
	const result = execSync("git status", { encoding: "utf-8" });
	if (result.indexOf("working tree clean") === -1) {
		throw new Error("Working tree is not clean!");
	}

	const v = getChangelog().latestVersion;
	let prerelease: boolean;
	let version: string;
	if (v.kind === "unreleased") {
		console.log(
			"No need to prepare for insiders - version is not released."
		);
		prerelease = false;
		version = "unreleased";
	} else if (!v.version.prerelease) {
		console.log(
			"No need to prepare for insiders - version is not a prerelease."
		);
		prerelease = false;
		version = v.version.toString();
	} else {
		prerelease = true;
		version = v.version.with({ prerelease: null }).toString();
	}

	const packageJson = readJsonFile(join(__dirname, "../../package.json"));

	const patchPackageJson = readJsonFile(
		join(__dirname, "./package-insiders-build.json")
	);

	if (prerelease) {
		Object.assign(packageJson, patchPackageJson);
	}
	Object.assign(packageJson, { version });

	writeFileSync(
		join(__dirname, "../../package.json"),
		JSON.stringify(packageJson, undefined, 4)
	);

	if (prerelease) {
		let content = readFileSync(
			join(__dirname, "./README_INSIDERS_BUILD.md"),
			{
				encoding: "utf-8",
			}
		);
		const commitSha = execSync("git rev-parse HEAD", {
			encoding: "utf-8",
		}).trim();
		content = content.replace(/\$commit-sha\$/g, commitSha);
		writeFileSync(join(__dirname, "../../README.md"), content);
	}
}
