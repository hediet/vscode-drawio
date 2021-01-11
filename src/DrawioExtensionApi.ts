import { Extension, extensions, Uri } from "vscode";

export function getDrawioExtensions(): DrawioExtension[] {
	return extensions.all
		.filter(
			(e) =>
				(e.packageJSON as DrawioExtensionJsonManifest)
					.isDrawioExtension === true
		)
		.map((e) => new DrawioExtension(e));
}

export class DrawioExtension {
	constructor(private readonly api: Extension<DrawioExtensionApi>) {}

	public async getDrawioPlugins(
		context: DocumentContext
	): Promise<{ jsCode: string }[]> {
		if (!this.api.isActive) {
			await this.api.activate();
		}
		const { drawioExtensionV1 } = this.api.exports;
		if (drawioExtensionV1) {
			const { getDrawioPlugins } = drawioExtensionV1;
			if (getDrawioPlugins) {
				return await getDrawioPlugins.apply(drawioExtensionV1, [
					context,
				]);
			}
		}
		return [];
	}
}

export interface DrawioExtensionJsonManifest {
	// Set `"isDrawioExtension": true` in your package.json
	// so that your extension gets loaded when a draw.io file is opened.
	isDrawioExtension?: boolean;
}

// Implement this API in your public extension API.
export interface DrawioExtensionApi {
	drawioExtensionV1?: {
		getDrawioPlugins?: (
			context: DocumentContext
		) => Promise<{ jsCode: string }[]>;
	};
}

export interface DocumentContext {
	uri: Uri;
}
