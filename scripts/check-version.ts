import { readPackageJson } from "./shared";

export async function run(): Promise<void> {
	const packageJson = readPackageJson();
	if (packageJson.version !== "0.0.1") {
		throw new Error(
			`Version must be "0.0.1", but was "${packageJson.version}"`
		);
	}
}
