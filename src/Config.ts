import { workspace } from "vscode";
import { Disposable } from "@hediet/std/disposable";

const extensionId = "hediet.vscode-drawio";
const drawioOfflineKey = `${extensionId}.offline`;
const drawioUrlKey = `${extensionId}.online-url`;
const drawioThemeKey = `${extensionId}.theme`;

export class Config {
	public dispose = Disposable.fn();

	private _useOfflineMode!: boolean;
	private _drawioUrl!: string;
	private _drawioTheme!: string | "automatic";

	public get drawioUrl(): string {
		return this._drawioUrl;
	}

	public get useOfflineMode(): boolean {
		return this._useOfflineMode;
	}

	public get drawioTheme(): string | "automatic" {
		return this._drawioTheme;
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
	}
}
