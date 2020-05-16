import { workspace, ConfigurationTarget } from "vscode";
import { Disposable } from "@hediet/std/disposable";

const extensionId = "hediet.vscode-drawio";
const drawioOfflineKey = `${extensionId}.offline`;
const drawioUrlKey = `${extensionId}.online-url`;
const drawioThemeKey = `${extensionId}.theme`;
const drawioLocalStorageKey = `${extensionId}.local-storage`;

export class Config {
	public dispose = Disposable.fn();

	private _useOfflineMode!: boolean;
	private _drawioUrl!: string;
	private _drawioTheme!: string | "automatic";
	private _localStorage!: Record<string, string>;

	public get drawioUrl(): string {
		return this._drawioUrl;
	}

	public get useOfflineMode(): boolean {
		return this._useOfflineMode;
	}

	public get drawioTheme(): string | "automatic" {
		return this._drawioTheme;
	}

	public get localStorage(): Record<string, string> {
		return this._localStorage;
	}

	public async setLocalStorage(obj: Record<string, string>): Promise<void> {
		const c = workspace.getConfiguration();

		// jsonify obj
		const val = mapObject(obj, (item) => tryJsonParse(item));

		await c.update(drawioLocalStorageKey, val, ConfigurationTarget.Global);
	}

	constructor() {
		this.updateConfig();
		this.dispose.track(
			workspace.onDidChangeConfiguration(() => {
				this.updateConfig();
			})
		);
	}

	private updateConfig(): void {
		const c = workspace.getConfiguration();
		this._useOfflineMode = c.get<boolean>(drawioOfflineKey, true);
		this._drawioUrl = c.get<string>(drawioUrlKey, "https://www.draw.io/");
		this._drawioTheme = c.get<string>(drawioThemeKey, "automatic");

		const ls = c.get<Record<string, any>>(drawioLocalStorageKey, {});

		// stringify setting
		// https://github.com/microsoft/vscode/issues/98001
		mapObject(ls, (item) =>
			typeof item === "string" ? item : JSON.stringify(item)
		);
		this._localStorage = mapObject(ls, (item) =>
			typeof item === "string" ? item : JSON.stringify(item)
		);
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

function tryJsonParse(val: string): string | any {
	try {
		return JSON.parse(val);
	} catch (e) {
		return val;
	}
}
