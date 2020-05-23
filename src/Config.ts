import { workspace, ConfigurationTarget, Uri, Disposable, env } from "vscode";
import { fromResource } from "mobx-utils";
import { EventEmitter } from "@hediet/std/events";
import { runInAction, computed } from "mobx";
import * as vscode from "vscode";
import { DrawioLibraryData } from "./DrawioInstance";

const extensionId = "hediet.vscode-drawio";

export class Config {
	public getConfig(uri: Uri): DiagramConfig {
		return new DiagramConfig(uri);
	}
}

export class DiagramConfig {
	private readonly _theme = new VsCodeSetting(`${extensionId}.theme`, {
		scope: this.uri,
		serializer: serializerWithDefault("automatic"),
	});

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
			serializer: serializerWithDefault("https://draw.io"),
		}
	);

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

					if (process.env.NODE_ENV === "development") {
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

	private readonly _customLibraries = new VsCodeSetting<
		DrawioCustomLibrary[]
	>(`${extensionId}.customLibraries`, {
		scope: this.uri,
		serializer: serializerWithDefault<any[]>([]),
	});

	private readonly _customFonts = new VsCodeSetting<string[]>(
		`${extensionId}.customFonts`,
		{
			scope: this.uri,
			serializer: serializerWithDefault<string[]>([]),
		}
	);

	constructor(public readonly uri: Uri) {}

	@computed
	public get mode(): { kind: "offline" } | { kind: "online"; url: string } {
		if (this._useOfflineMode.get()) {
			return { kind: "offline" };
		} else {
			return { kind: "online", url: this._onlineUrl.get() };
		}
	}

	@computed
	public get theme(): string {
		const theme = this._theme.get();

		if (theme !== "automatic") {
			return theme;
		}

		try {
			const ctk = (vscode as any).ColorThemeKind;
			return {
				[ctk.Light]: "Kennedy",
				[ctk.Dark]: "dark",
				[ctk.HighContrast]: "Kennedy",
			}[(vscode as any).window.activeColorTheme.kind];
		} catch (e) {
			// window.activeColorTheme is only supported since VS Code 1.45.
		}
		return "dark";
	}

	public get localStorage(): Record<string, string> {
		return this._localStorage.get();
	}

	public setLocalStorage(value: Record<string, string>): void {
		this._localStorage.set(value);
	}

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

	@computed
	public get customFonts(): string[] {
		return this._customFonts.get();
	}

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

class SimpleTemplate {
	constructor(private readonly str: string) {}

	render(data: Record<string, () => string>): string {
		return this.str.replace(/\$\{([a-zA-Z0-9]+)\}/g, (substr, grp1) => {
			return data[grp1]();
		});
	}
}

export function mapObject<TObj extends Record<string, any>, TResult>(
	obj: TObj,
	map: (item: TObj[keyof TObj], key: string) => TResult
): Record<keyof TObj, TResult> {
	const result: Record<keyof TObj, TResult> = {} as any;

	for (const [key, value] of Object.entries(obj)) {
		result[key as keyof TObj] = map(value as any, key);
	}

	return result;
}

interface Serializer<T> {
	deserialize: (val: any) => T;
	serializer: (val: T) => any;
}

function serializerWithDefault<T>(defaultValue: T): Serializer<T> {
	return {
		deserialize: (val) => (val === undefined ? defaultValue : val),
		serializer: (val) => val,
	};
}

class VsCodeSetting<T> {
	public get T(): T {
		throw new Error();
	}

	public readonly serializer: Serializer<T>;
	public readonly scope: Uri | undefined;
	//public readonly updateTarget: ConfigurationTarget | undefined;
	private readonly settingResource: VsCodeSettingResource;

	public constructor(
		public readonly id: string,
		options: {
			serializer?: Serializer<T>;
			scope?: Uri;
			//updateTarget?: ConfigurationTarget;
		} = {}
	) {
		this.scope = options.scope;
		//this.updateTarget = options.updateTarget;
		this.serializer = options.serializer || {
			deserialize: (val) => val,
			serializer: (val) => val,
		};
		this.settingResource = new VsCodeSettingResource(this.id, this.scope);
	}

	public get(): T {
		const result = this.settingResource.value;
		return this.serializer.deserialize(result);
	}

	public set(value: T): void {
		const value2 = this.serializer.serializer(value);
		const c = workspace.getConfiguration(undefined, this.scope);
		const result = c.inspect(this.id);
		let target: ConfigurationTarget;

		if (
			result &&
			[
				result.workspaceFolderLanguageValue,
				result.workspaceFolderValue,
			].some((i) => i !== undefined)
		) {
			target = ConfigurationTarget.WorkspaceFolder;
		}
		if (
			result &&
			[result.workspaceLanguageValue, result.workspaceValue].some(
				(i) => i !== undefined
			)
		) {
			target = ConfigurationTarget.Workspace;
		} else {
			target = ConfigurationTarget.Global;
		}

		c.update(this.id, value2, target);
	}
}

class VsCodeSettingResource {
	public static onConfigChange = new EventEmitter();

	private subscription: Disposable | undefined;
	private readonly r = fromResource<any>(
		(update) => {
			this.subscription = VsCodeSettingResource.onConfigChange.sub(() => {
				update(this.readValue());
			});
		},
		() => this.subscription!.dispose(),
		this.readValue()
	);

	constructor(
		private readonly id: string,
		private readonly scope: Uri | undefined
	) {}

	private readValue(): any {
		return workspace.getConfiguration(undefined, this.scope).get(this.id);
	}

	private readonly val = computed(() => JSON.stringify(this.r.current()), {
		name: `VsCodeSettingResource[${this.id}].value`,
		context: this,
	});

	public get value() {
		const v = this.val.get();
		if (v === undefined) {
			return undefined;
		}
		return JSON.parse(v);
	}
}

workspace.onDidChangeConfiguration(() => {
	runInAction("Update Configuration", () => {
		VsCodeSettingResource.onConfigChange.emit();
	});
});
