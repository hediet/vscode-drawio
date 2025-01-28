import { readFile, writeFile } from "fs/promises";
import { join, resolve } from "path";
import { SemanticVersion } from "@hediet/semver";
import { context } from "@actions/github";
import { exec } from "@actions/exec";
import { readFileSync } from "fs";
import { Changelog } from "./changelog";

const packageJsonPath = resolve(__dirname, "../package.json");

export async function run(): Promise<void> {
	const changeLog = getChangelog();
	const version = changeLog.latestVersion;

	const packageJson = await readJsonFile<{ version: string; preRelease?: boolean }>(packageJsonPath);
	const stableVersion = SemanticVersion.parse(packageJson.version);

	if (version.kind !== 'released' || version.version.toString() !== stableVersion.toString()) {
		throw new Error("Version in package.json does not match latest version in changelog.");
	}

	if (stableVersion.patch !== 0) {
		throw new Error("Patch version must be 0.");
	}

	const gh = new GitHubClient();

	const isPreRelease = !!packageJson.preRelease;

	const stableTag = `v${stableVersion}`;
	const stableGhTagExists = await gh.tagExists(context.repo, stableTag);
	if (!isPreRelease && !stableGhTagExists) {
		await buildAndPublish('stable', stableVersion);
		await gh.createTag(context.repo, stableTag, context.sha);
	} else {
		if (stableGhTagExists) {
			console.log(`GitHub tag for stable version ${stableTag} exists, skipping publish.`);
		}
		if (isPreRelease) {
			console.log("Pre-release version detected, skipping stable");
		}
	}

	const runNumber = process.env.GITHUB_RUN_NUMBER;
	const preReleaseNumber = `${formatDate(new Date())}0${Number(runNumber)}`;
	const previewVersion = stableVersion.with({ patch: Number(preReleaseNumber) });

	const previewTag = `v${previewVersion}`;

	const previewGhTagExists = await gh.tagExists(context.repo, previewTag);
	if (!previewGhTagExists) {
		await buildAndPublish('preRelease', previewVersion);
		await gh.createTag(context.repo, previewTag, context.sha);
	} else {
		console.log(`GitHub tag for preview version ${previewTag} exists, skipping publish.`);
	}
}

async function buildAndPublish(releaseType: 'stable' | 'preRelease', version: SemanticVersion) {
	console.log(`Publishing ${releaseType} version ${version}...`);

	const packageJson = await readJsonFile<any>(packageJsonPath);
	packageJson.version = version.toString();
	packageJson.scripts["package-extension"] =
		releaseType === 'preRelease'
			? "yarn package-extension-preRelease"
			: "yarn package-extension-stable";

	await writeJsonFile(packageJsonPath, packageJson);

	await exec("yarn", ["build"]);
	await exec("yarn", [
		"vsce",
		"publish",
		"--pat",
		process.env.VSCE_PAT!,
		...(releaseType === 'preRelease' ? ['--pre-release'] : [])]
	);
}


function padN(num: number, n: number): string {
	return num.toString().padStart(n, '0');
}

function formatDate(date: Date): string {
	const year = date.getUTCFullYear();
	const month = date.getUTCMonth() + 1;
	const day = date.getUTCDate();

	return `${year}${padN(month, 2)}${padN(day, 2)}`;
}

interface IRepo {
	owner: string;
	repo: string;
}

class GitHubClient {
	private readonly token: string = process.env.GH_TOKEN!;

	private async request(endpoint: string, options: RequestInit = {}) {
		const response = await fetch(`https://api.github.com${endpoint}`, {
			...options,
			headers: {
				...options.headers,
				Authorization: `token ${this.token}`,
				'Content-Type': 'application/json',
			},
		});
		if (!response.ok) {
			throw new Error(`GitHub API request failed: ${response.statusText}`);
		}
		return response.json();
	}

	async tagExists(repo: IRepo, tag: string): Promise<boolean> {
		try {
			await this.request(`/repos/${repo.owner}/${repo.repo}/git/refs/tags/${tag}`);
			return true;
		} catch {
			return false;
		}
	}

	async createTag(repo: IRepo, tag: string, sha: string): Promise<void> {
		await this.request(`/repos/${repo.owner}/${repo.repo}/git/refs`, {
			method: 'POST',
			body: JSON.stringify({
				ref: `refs/tags/${tag}`,
				sha,
			}),
		});
	}
}

async function readJsonFile<T>(path: string): Promise<T> {
	const content = await readFile(path, 'utf-8');
	return JSON.parse(content);
}

async function writeJsonFile(path: string, data: unknown): Promise<void> {
	const content = JSON.stringify(data, null, '\t');
	await writeFile(path, content, 'utf-8');
}

function readTextFileSync(fileName: string): string {
	return readFileSync(fileName, { encoding: "utf-8" });
}

function getChangelog(): Changelog {
	return new Changelog(readTextFileSync(join(__dirname, "../CHANGELOG.md")));
}
