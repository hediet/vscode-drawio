import { writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

function readJsonFile(fileName: string): any {
	const content = readFileSync(fileName, { encoding: "utf-8" });
	return JSON.parse(content);
}

function patchJson() {
	const result = execSync("git status", { encoding: "utf-8" });
	if (result.indexOf("working tree clean") === -1) {
		throw new Error("Working tree is not clean!");
	}

	const packageJson = readJsonFile(join(__dirname, "../package.json"));
	const patchPackageJson = readJsonFile(
		join(__dirname, "./package-insiders-build.json")
	);

	Object.assign(packageJson, patchPackageJson);

	writeFileSync(
		join(__dirname, "../package.json"),
		JSON.stringify(packageJson, undefined, 4)
	);

	let content = readFileSync(join(__dirname, "./README_INSIDERS_BUILD.md"), {
		encoding: "utf-8",
	});

	const commitSha = execSync("git rev-parse HEAD", {
		encoding: "utf-8",
	}).trim();
	content = content.replace(/\$commit-sha\$/g, commitSha);

	writeFileSync(join(__dirname, "../README.md"), content);
}

patchJson();
