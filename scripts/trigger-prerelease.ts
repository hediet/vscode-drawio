import { GitHub, context } from "@actions/github";
import { getChangelog } from "./shared";

export async function run(): Promise<void> {
	const changelog = getChangelog();
	if (changelog.latestVersion.kind === "unreleased") {
		console.log("Nothing to publish.");
		return;
	}
	if (changelog.latestVersion.releaseDate !== undefined) {
		console.log(
			`Version "${
				changelog.latestVersion.version
			}" already has been published on ${changelog.latestVersion.releaseDate.toDateString()}.`
		);
		return;
	}

	const prereleaseVersion = changelog.latestVersion.version;
	if (!prereleaseVersion.prerelease) {
		throw new Error(
			`Cannot release directly! Use a prerelease version first!`
		);
	}

	const api = new GitHub(process.env.GH_TOKEN!);
	const prereleaseBranch = `pending-releases/v${prereleaseVersion}`;
	const prereleaseRef = `refs/heads/${prereleaseBranch}`;
	try {
		await api.git.createRef({
			...context.repo,
			ref: prereleaseRef,
			sha: context.sha,
		});
	} catch (e) {
		if (e.toString().indexOf("Reference already exists")) {
			throw new Error(
				`Version "${prereleaseVersion}" has been published already!`
			);
		}
		throw e;
	}

	const releaseVersion = prereleaseVersion.with({ prerelease: null });
	const targetBranch = `releases/v${releaseVersion}`;
	const targetRef = `refs/heads/${targetBranch}`;

	try {
		await api.git.deleteRef({
			...context.repo,
			ref: `heads/${targetBranch}`,
		});
	} catch (e) {
		console.error("Could not delete branch: ", e);
	}

	await api.git.createRef({
		...context.repo,
		ref: targetRef,
		sha: context.sha,
	});

	const d = (
		await api.repos.getContents({
			...context.repo,
			path: "CHANGELOG.md",
			ref: prereleaseRef,
		})
	).data;
	if (Array.isArray(d)) {
		throw new Error("Unexpected result");
	}

	changelog.setLatestVersion(releaseVersion, new Date());

	await api.repos.createOrUpdateFile({
		...context.repo,
		path: "CHANGELOG.md",
		branch: prereleaseBranch,
		sha: d.sha,
		content: Buffer.from(changelog.toString()).toString("base64"),
		message: `Release of version ${releaseVersion}`,
	});

	await api.pulls.create({
		...context.repo,
		base: targetBranch,
		head: prereleaseBranch,
		title: `Release ${prereleaseVersion} as ${releaseVersion}`,
		body:
			`Please vote with **thumbs up** if this build works as expected or **thumbs down** if you found an issue.\n\n` +
			`If you found issues, please describe them so they can be fixed!\n\n` +
			`Once this pull request receives enough thumbs up and no issues are reported, version ${prereleaseVersion} will be released as ${releaseVersion}`,
	});
}
