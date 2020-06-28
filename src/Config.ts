import { workspace, Uri, env, commands, window, ColorThemeKind } from "vscode";
import { computed, autorun } from "mobx";
import { DrawioLibraryData } from "./DrawioInstance";
import { VsCodeSetting, serializerWithDefault } from "./utils/VsCodeSetting";
import { mapObject } from "./utils/mapObject";
import { SimpleTemplate } from "./utils/SimpleTemplate";

const extensionId = "hediet.vscode-drawio";
const experimentalFeaturesEnabled = "vscode-drawio.experimentalFeaturesEnabled";

export async function setContext(
	key: string,
	value: string | boolean
): Promise<void> {
	return (await commands.executeCommand("setContext", key, value)) as any;
}

export class Config {
	constructor() {
		autorun(() => {
			setContext(
				experimentalFeaturesEnabled,
				this.experimentalFeaturesEnabled
			);
		});
	}

	public getConfig(uri: Uri): DiagramConfig {
		return new DiagramConfig(uri);
	}

	private readonly _experimentalFeatures = new VsCodeSetting(
		`${extensionId}.enableExperimentalFeatures`,
		{
			serializer: serializerWithDefault<boolean>(false),
		}
	);

	public get experimentalFeaturesEnabled(): boolean {
		return this._experimentalFeatures.get();
	}
}

export class DiagramConfig {
	// #region Theme

	private readonly _theme = new VsCodeSetting(`${extensionId}.theme`, {
		scope: this.uri,
		serializer: serializerWithDefault("automatic"),
	});

	@computed
	public get theme(): string {
		const theme = this._theme.get();

		if (theme !== "automatic") {
			return theme;
		}

		return {
			[ColorThemeKind.Light]: "Kennedy",
			[ColorThemeKind.Dark]: "dark",
			[ColorThemeKind.HighContrast]: "Kennedy",
		}[window.activeColorTheme.kind];
	}

	public async setTheme(value: string): Promise<void> {
		await this._theme.set(value);
	}

	// #endregion

	// #region Mode

	private readonly _useOfflineMode = new VsCodeSetting(
		`${extensionId}.offline`,
		{
			scope: this.uri,
			serializer: serializerWithDefault(true),
		}
	);

	private readonly _onlineUrl = new VsCodeSetting(
		`${extensionId}.online-url`,
		{
			scope: this.uri,
			serializer: serializerWithDefault("https://embed.diagrams.net/"),
		}
	);

	@computed
	public get mode(): { kind: "offline" } | { kind: "online"; url: string } {
		if (this._useOfflineMode.get()) {
			return { kind: "offline" };
		} else {
			return { kind: "online", url: this._onlineUrl.get() };
		}
	}

	// #endregion

	// #region Code Link Activated

	private readonly _codeLinkActivated = new VsCodeSetting(
		`${extensionId}.codeLinkActivated`,
		{
			scope: this.uri,
			serializer: serializerWithDefault(false),
		}
	);

	public get codeLinkActivated(): boolean {
		return this._codeLinkActivated.get();
	}

	public setCodeLinkActivated(value: boolean): Promise<void> {
		return this._codeLinkActivated.set(value);
	}

	// #endregion

	// #region Local Storage

	private readonly _localStorage = new VsCodeSetting<Record<string, string>>(
		`${extensionId}.local-storage`,
		{
			scope: this.uri,
			serializer: {
				deserialize: (value) => {
					if (typeof value === "object") {
						// stringify setting
						// https://github.com/microsoft/vscode/issues/98001
						mapObject(value, (item) =>
							typeof item === "string"
								? item
								: JSON.stringify(item)
						);
						return mapObject(value, (item) =>
							typeof item === "string"
								? item
								: JSON.stringify(item)
						);
					} else {
						const str = new Buffer(value || "", "base64").toString(
							"utf-8"
						);
						return JSON.parse(str);
					}
				},
				serializer: (val) => {
					function tryJsonParse(val: string): string | any {
						try {
							return JSON.parse(val);
						} catch (e) {
							return val;
						}
					}

					if (process.env.DEV === "1") {
						// jsonify obj
						const val2 = mapObject(val, (item) =>
							tryJsonParse(item)
						);
						return val2;
					}

					return Buffer.from(JSON.stringify(val), "utf-8").toString(
						"base64"
					);
				},
			},
		}
	);

	public get localStorage(): Record<string, string> {
		return this._localStorage.get();
	}

	public setLocalStorage(value: Record<string, string>): void {
		this._localStorage.set(value);
	}

	//#endregion

	// #region Custom Libraries

	private readonly _customLibraries = new VsCodeSetting<
		DrawioCustomLibrary[]
	>(`${extensionId}.customLibraries`, {
		scope: this.uri,
		serializer: serializerWithDefault<any[]>([]),
	});

	@computed
	public get customLibraries(): Promise<DrawioLibraryData[]> {
		const normalizeLib = async (
			lib: DrawioCustomLibrary
		): Promise<DrawioLibraryData> => {
			function parseJson(json: string): unknown {
				return JSON.parse(json);
			}

			function parseXml(xml: string): unknown {
				const parse = require("xml-parser-xo");
				const parsedXml = parse(xml);
				return JSON.parse(parsedXml.root.children[0].content);
			}

			let data: DrawioLibraryData["data"];
			if ("json" in lib) {
				data = { kind: "value", value: parseJson(lib.json) };
			} else if ("xml" in lib) {
				data = {
					kind: "value",
					value: parseXml(lib.xml),
				};
			} else if ("file" in lib) {
				const file = this.evaluateTemplate(lib.file);
				const buffer = await workspace.fs.readFile(Uri.file(file));
				const content = Buffer.from(buffer).toString("utf-8");
				if (file.endsWith(".json")) {
					data = {
						kind: "value",
						value: parseJson(content),
					};
				} else {
					data = {
						kind: "value",
						value: parseXml(content),
					};
				}
			} else {
				data = { kind: "url", url: lib.url };
			}

			return {
				libName: lib.libName,
				entryId: lib.entryId,
				data,
			};
		};

		return Promise.all(
			this._customLibraries.get().map((lib) => normalizeLib(lib))
		);
	}

	private evaluateTemplate(template: string): string {
		const tpl = new SimpleTemplate(template);
		return tpl.render({
			workspaceFolder: () => {
				const workspaceFolder = workspace.getWorkspaceFolder(this.uri);
				if (!workspaceFolder) {
					throw new Error(
						"No workspace is opened - '${workspaceFolder} cannot be used'!"
					);
				}
				return workspaceFolder.uri.fsPath;
			},
		});
	}

	// #endregion

	// #region Custom Fonts

	private readonly _customFonts = new VsCodeSetting<string[]>(
		`${extensionId}.customFonts`,
		{
			scope: this.uri,
			serializer: serializerWithDefault<string[]>([]),
		}
	);

	@computed
	public get customFonts(): string[] {
		return this._customFonts.get();
	}

	// #endregion

	constructor(public readonly uri: Uri) {}

	@computed
	public get language(): string {
		const lang = env.language.split("-")[0].toLowerCase();
		return lang;
	}
}

type DrawioCustomLibrary = (
	| {
			xml: string;
	  }
	| {
			url: string;
	  }
	| {
			json: string;
	  }
	| {
			file: string;
	  }
) & { libName: string; entryId: string };
