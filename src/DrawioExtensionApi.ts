import { Extension, extensions, Uri } from "vscode";

/**
 * Returns all extensions that have been registered as draw.io extensions.
 * These extensions must set `"isDrawioExtension": true` in their package.json.
 * @returns Array of DrawioExtension instances for each registered draw.io extension.
 */
export function getDrawioExtensions(): DrawioExtension[] {
	return extensions.all
		.filter(
			(e) =>
				(e.packageJSON as DrawioExtensionJsonManifest)
					.isDrawioExtension === true
		)
		.map((e) => new DrawioExtension(e));
}

/**
 * Represents a draw.io extension that can provide plugins for the draw.io editor.
 * Extension developers should implement the DrawioExtensionApi interface and register their extension
 * by setting `"isDrawioExtension": true` in their package.json.
 */
export class DrawioExtension {
	constructor(private readonly api: Extension<DrawioExtensionApi>) {}

	/**
	 * Retrieves draw.io plugins provided by this extension.
	 * @param context - The document context for which plugins are requested.
	 * @returns A promise that resolves to an array of plugin objects, each containing jsCode to be executed in the draw.io editor.
	 */
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

/**
 * Manifest interface for draw.io extensions.
 * Extensions must include this structure in their package.json to be recognized as draw.io extensions.
 * @example
 * // In your extension's package.json:
 * {
 *   "name": "my-drawio-plugin",
 *   "isDrawioExtension": true,
 *   "main": "./out/extension.js"
 * }
 */
export interface DrawioExtensionJsonManifest {
	/**
	 * Set to `true` in your package.json so that your extension gets loaded when a draw.io file is opened.
	 */
	isDrawioExtension?: boolean;
}

/**
 * Public API interface that draw.io extensions must implement.
 * Your extension should export an object conforming to this interface as its main export.
 * The draw.io extension will call the `getDrawioPlugins` method to retrieve custom plugins.
 * @example
 * // In your extension.ts:
 * export function activate(context: vscode.ExtensionContext) {
 *   return {
 *     drawioExtensionV1: {
 *       getDrawioPlugins: async (context) => {
 *         return [{ jsCode: 'console.log("Hello from my plugin!")' }];
 *       }
 *     }
 *   };
 * }
 */
export interface DrawioExtensionApi {
	/**
	 * Version 1 of the draw.io extension API.
	 */
	drawioExtensionV1?: {
		/**
		 * Returns draw.io plugins for the given document context.
		 * @param context - The document context (currently only contains the URI of the document).
		 * @returns A promise that resolves to an array of plugin objects.
		 */
		getDrawioPlugins?: (
			context: DocumentContext
		) => Promise<{ jsCode: string }[]>;
	};
}

/**
 * Context information about the document for which plugins are requested.
 * Currently only contains the URI of the document being edited.
 */
export interface DocumentContext {
	/**
	 * The URI of the document being edited in the draw.io editor.
	 */
	uri: Uri;
}
