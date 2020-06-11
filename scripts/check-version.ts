import { readPackageJson } from "./shared";

export async function run(): Promise<void> {
	const packageJson = readPackageJson();
	if (packageJson.version !== "999.0.0-alpha") {
		throw new Error(
			`Version must be "999.0.0-alpha", but was "${packageJson.version}"`
		);
	}
}
