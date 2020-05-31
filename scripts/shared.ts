import { readFileSync } from "fs";
import { join } from "path";
import { SemanticVersion } from "@hediet/semver";

export function readTextFileSync(fileName: string): string {
	return readFileSync(fileName, { encoding: "utf-8" });
}

export function readPackageJson(): { version: string; name: string } {
	return JSON.parse(readTextFileSync(join(__dirname, "../package.json")));
}

export function getChangelog(): Changelog {
	return new Changelog(readTextFileSync(join(__dirname, "../CHANGELOG.md")));
}

export class Changelog {
	private readonly regex = /## \[(.*?)\]([ \t]*-[ \t]*(.*))?/;
	public get latestVersion():
		| {
				kind: "released";
				version: SemanticVersion;
				releaseDate: Date | undefined;
		  }
		| { kind: "unreleased" } {
		const result = this.regex.exec(this.src);
		if (!result) {
			throw new Error("Invalid changelog");
		}
		if (result[1].toLowerCase() === "unreleased") {
			return { kind: "unreleased" };
		}

		let date: Date | undefined;
		if (result[3]) {
			date = new Date(result[3].trim());
		}
		return {
			kind: "released",
			version: SemanticVersion.parse(result[1]),
			releaseDate: date,
		};
	}

	constructor(private src: string) {}

	public setLatestVersion(
		newVersion: SemanticVersion,
		releaseDate: Date | undefined
	): void {
		let dateStr = "";
		if (releaseDate !== undefined) {
			const year = releaseDate.getUTCFullYear();
			const day = releaseDate.getUTCDate();
			const month = releaseDate.getUTCMonth() + 1;
			dateStr = ` - ${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
		}
		this.src = this.src.replace(
			this.regex,
			`## [${newVersion.toString()}]${dateStr}`
		);
	}

	public toString(): string {
		return this.src;
	}
}

function pad(num: number, size: number): string {
	let s = num + "";
	while (s.length < size) s = "0" + s;
	return s;
}
