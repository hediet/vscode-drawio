import { autorun, computed, observable } from "mobx";
import {
	ColorTheme,
	ColorThemeKind,
	commands,
	ConfigurationTarget,
	env,
	Memento,
	Uri,
	window,
	workspace,
} from "vscode";
import { Style, ColorScheme, DrawioLibraryData } from "./DrawioClient";
import { BufferImpl } from "./utils/buffer";
import { mapObject } from "./utils/mapObject";
import { SimpleTemplate } from "./utils/SimpleTemplate";
import {
	serializerWithDefault,
	VsCodeSetting,
} from "./vscode-utils/VsCodeSetting";
import * as packageJson from "../package.json";

const extensionId = "hediet.vscode-drawio";
const experimentalFeaturesEnabled = "vscode-drawio.experimentalFeaturesEnabled";

export async function setContext(
	key: string,
	value: string | boolean
): Promise<void> {
	return (await commands.executeCommand("setContext", key, value)) as any;
}

export class Config {
	public readonly packageJson: {
		version: string;
		versionName?: string;
		name: string;
		feedbackUrl?: string;
	} = packageJson;

	public get feedbackUrl(): Uri | undefined {
		if (this.packageJson.feedbackUrl) {
			return Uri.parse(this.packageJson.feedbackUrl);
		}
		return undefined;
	}

	public get isInsiders() {
		return (
			this.packageJson.name === "vscode-drawio-insiders-build" ||
			process.env.DEV === "1"
		);
	}

	@observable.ref
	private _vscodeTheme: ColorTheme;

	public get vscodeTheme(): ColorTheme {
		return this._vscodeTheme;
	}

	constructor(private readonly globalState: Memento) {
		autorun(() => {
			setContext(
				experimentalFeaturesEnabled,
				this.experimentalFeaturesEnabled
			);
		});

		this._vscodeTheme = window.activeColorTheme;
		window.onDidChangeActiveColorTheme((theme) => {
			this._vscodeTheme = theme;
		});
	}

	public getDiagramConfig(uri: Uri): DiagramConfig {
		return new DiagramConfig(uri, this, this.globalState);
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

	public get canAskForFeedback(): boolean {
		if (
			this.getInternalConfig().versionLastAskedForFeedback ===
			this.packageJson.version
		) {
			return false;
		}
		const secondsIn20Minutes = 60 * 20;
		if (
			this.getInternalConfig().thisVersionUsageTimeInSeconds <
			secondsIn20Minutes
		) {
			return false;
		}
		return true;
	}

	public async markAskedToTest(): Promise<void> {
		await this.updateInternalConfig((config) => ({
			...config,
			versionLastAskedForFeedback: this.packageJson.version,
		}));
	}

	private readonly _knownPlugins = new VsCodeSetting<
		{ pluginId: string; fingerprint: string; allowed: boolean }[]
	>(`${extensionId}.knownPlugins`, {
		serializer: serializerWithDefault<any>([]),
		// Don't use workspace settings here!
		target: ConfigurationTarget.Global,
	});

	public isPluginAllowed(
		pluginId: string,
		fingerprint: string
	): boolean | undefined {
		const data = this._knownPlugins.get();
		const entry = data.find(
			(d) => d.pluginId === pluginId && d.fingerprint === fingerprint
		);
		if (!entry) {
			return undefined;
		}
		return entry.allowed;
	}

	public async addKnownPlugin(
		pluginId: string,
		fingerprint: string,
		allowed: boolean
	): Promise<void> {
		const plugins = [...this._knownPlugins.get()].filter(
			(p) => p.pluginId !== pluginId || p.fingerprint !== fingerprint
		);

		plugins.push({ pluginId, fingerprint, allowed });
		await this._knownPlugins.set(plugins);
	}

	public getUsageTimeInSeconds(): number {
		return this.getInternalConfig().totalUsageTimeInSeconds;
	}

	public getUsageTimeOfThisVersionInSeconds(): number {
		return this.getInternalConfig().thisVersionUsageTimeInSeconds;
	}

	public addUsageTime10Seconds(): void {
		this.updateInternalConfig((config) => {
			if (config.currentVersion !== this.packageJson.version) {
				config.currentVersion = this.packageJson.version;
				config.thisVersionUsageTimeInSeconds = 0;
			}

			return {
				...config,
				totalUsageTimeInSeconds: config.totalUsageTimeInSeconds + 10,
				thisVersionUsageTimeInSeconds:
					config.thisVersionUsageTimeInSeconds + 10,
			};
		});
	}

	public markAskedForSponsorship(): void {
		this.updateInternalConfig((c) => ({
			...c,
			dateTimeLastAskedForSponsorship: new Date().toDateString(),
			totalUsageTimeLastAskedForSponsorshipInSeconds:
				c.totalUsageTimeInSeconds,
		}));
	}

	public get canAskForSponsorship(): boolean {
		const c = this.getInternalConfig();
		if (c.dateTimeLastAskedForSponsorship) {
			const d = new Date(c.dateTimeLastAskedForSponsorship);
			const msPerDay = 1000 * 60 * 60 * 24;
			const minTimeBetweenAskingMs = 180 * msPerDay;
			if (new Date().getTime() - d.getTime() < minTimeBetweenAskingMs) {
				return false;
			}
		}
		let usageTimeSinceLastAskedForSponsorship = c.totalUsageTimeInSeconds;
		if (c.totalUsageTimeLastAskedForSponsorshipInSeconds !== undefined) {
			usageTimeSinceLastAskedForSponsorship -=
				c.totalUsageTimeLastAskedForSponsorshipInSeconds;
		}
		const secondsIn1Hr = 60 * 60;
		const minUsageTime = secondsIn1Hr;
		if (usageTimeSinceLastAskedForSponsorship < minUsageTime) {
			return false;
		}

		return true;
	}

	private getInternalConfig(): InternalConfig {
		return (
			this.globalState.get<InternalConfig>("config") || {
				totalUsageTimeInSeconds: 0,
				thisVersionUsageTimeInSeconds: 0,
				versionLastAskedForFeedback: undefined,
				dateTimeLastAskedForSponsorship: undefined,
				currentVersion: this.packageJson.version,
				totalUsageTimeLastAskedForSponsorshipInSeconds: 0,
			}
		);
	}

	private async setInternalConfig(config: InternalConfig): Promise<void> {
		await this.globalState.update("config", config);
	}

	private async updateInternalConfig(
		update: (oldConfig: InternalConfig) => InternalConfig
	): Promise<void> {
		const config = this.getInternalConfig();
		const updated = update(config);
		await this.setInternalConfig(updated);
	}
}

interface InternalConfig {
	totalUsageTimeInSeconds: number;
	thisVersionUsageTimeInSeconds: number;
	currentVersion: string;
	versionLastAskedForFeedback: string | undefined;
	dateTimeLastAskedForSponsorship: string | undefined;
	totalUsageTimeLastAskedForSponsorshipInSeconds: number | undefined;
}

export class DiagramConfig {
	//#region Styles

	private readonly _styles = new VsCodeSetting(`${extensionId}.styles`, {
		scope: this.uri,
		serializer: serializerWithDefault<Style[]>([]),
	});

	@computed
	public get styles(): Style[] {
		return this._styles.get();
	}

	//#endregion

	//#region Custom Color Schemes

	private readonly _customColorSchemes = new VsCodeSetting(
		`${extensionId}.customColorSchemes`,
		{
			scope: this.uri,
			serializer: serializerWithDefault<ColorScheme[][]>([]),
		}
	);

	@computed
	public get customColorSchemes(): ColorScheme[][] {
		return this._customColorSchemes.get();
	}

	//#endregion

	//#region Default Vertex Style

	private readonly _defaultVertexStyle = new VsCodeSetting(
		`${extensionId}.defaultVertexStyle`,
		{
			scope: this.uri,
			serializer: serializerWithDefault<Record<string, string>>({}),
		}
	);

	@computed
	public get defaultVertexStyle(): Record<string, string> {
		return this._defaultVertexStyle.get();
	}

	//#endregion

	//#region Default Edge Style

	private readonly _defaultEdgeStyle = new VsCodeSetting(
		`${extensionId}.defaultEdgeStyle`,
		{
			scope: this.uri,
			serializer: serializerWithDefault<Record<string, string>>({}),
		}
	);

	@computed
	public get defaultEdgeStyle(): Record<string, string> {
		return this._defaultEdgeStyle.get();
	}

	//#endregion

	//#region Color Names

	private readonly _colorNames = new VsCodeSetting(
		`${extensionId}.colorNames`,
		{
			scope: this.uri,
			serializer: serializerWithDefault<Record<string, string>>({}),
		}
	);

	@computed
	public get colorNames(): Record<string, string> {
		return this._colorNames.get();
	}

	//#endregion

	//#region Simple Labels

	private readonly _simpleLabels = new VsCodeSetting(
		`${extensionId}.simpleLabels`,
		{
			scope: this.uri,
			serializer: serializerWithDefault<boolean>(false),
		}
	);

	@computed
	public get simpleLabels(): boolean {
		return this._simpleLabels.get();
	}

	//#endregion

	//#region Preset Colors

	private readonly _presetColors = new VsCodeSetting(
		`${extensionId}.presetColors`,
		{
			scope: this.uri,
			serializer: serializerWithDefault<string[]>([]),
		}
	);

	@computed
	public get presetColors(): string[] {
		return this._presetColors.get();
	}

	//#endregion

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
		}[this.config.vscodeTheme.kind];
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

	// #region resizeImages
	private readonly _resizeImages = new VsCodeSetting(
		`${extensionId}.resizeImages`,
		{
			scope: this.uri,
			serializer: serializerWithDefault<boolean | undefined>(undefined),
		}
	);

	// This is a hack to prevent a reload when we update the setting from local storage
	public isResizeImageUpdating = false;

	public get resizeImages(): boolean | undefined {
		const result = this._resizeImages.get();
		if (result === null) {
			return undefined;
		}
		return result;
	}

	public setResizeImages(value: boolean | undefined): Promise<void> {
		return this._resizeImages.set(value);
	}

	// #endregion

	// #region Local Storage

	public get localStorage(): Record<string, string> {
		const localStorage = this.memento.get<Record<string, string>>(
			`${extensionId}.local-storage`,
			{}
		);

		const resizeImages = this.resizeImages;

		try {
			const drawioConfig = JSON.parse(localStorage[".drawio-config"]);
			drawioConfig.resizeImages = resizeImages;
			localStorage[".drawio-config"] = JSON.stringify(drawioConfig);
		} catch (e) {
			console.error(e);
		}

		return localStorage;
	}

	public setLocalStorage(value: Record<string, string>): void {
		try {
			const drawioConfig = JSON.parse(value[".drawio-config"]) as {
				resizeImages?: boolean;
			};
			if (drawioConfig.resizeImages !== this.resizeImages) {
				this.isResizeImageUpdating = true;
				this.setResizeImages(drawioConfig.resizeImages);
			}
		} catch (e) {
			console.error(e);
		}
		this.memento.update(`${extensionId}.local-storage`, value);
	}

	//#endregion

	private readonly _plugins = new VsCodeSetting<{ file: string }[]>(
		`${extensionId}.plugins`,
		{
			scope: this.uri,
			serializer: serializerWithDefault<any[]>([]),
		}
	);

	public get plugins(): { file: Uri }[] {
		return this._plugins.get().map((entry) => {
			const fullFilePath = this.evaluateTemplate(entry.file, "plugins");
			return { file: Uri.file(fullFilePath) };
		});
	}

	// #region Custom Libraries

	private readonly _customLibraries = new VsCodeSetting<
		DrawioCustomLibrary[]
	>(`${extensionId}.customLibraries`, {
		scope: this.uri,
		serializer: serializerWithDefault<DrawioCustomLibrary[]>([]),
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
				const file = this.evaluateTemplate(
					lib.file,
					"custom libraries"
				);
				const buffer = await workspace.fs.readFile(Uri.file(file));
				const content = BufferImpl.from(buffer).toString("utf-8");
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

	private evaluateTemplate(template: string, context: string): string {
		const tpl = new SimpleTemplate(template);
		return tpl.render({
			workspaceFolder: () => {
				const workspaceFolder = workspace.getWorkspaceFolder(this.uri);
				if (!workspaceFolder) {
					throw new Error(
						`Cannot get workspace folder of opened diagram - '${template}' cannot be evaluated to load ${context}!`
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

	// #region Zoom Factor

	private readonly _zoomFactor = new VsCodeSetting<number>(
		`${extensionId}.zoomFactor`,
		{
			scope: this.uri,
			serializer: serializerWithDefault<number>(1.2),
		}
	);

	@computed
	public get zoomFactor(): number {
		return this._zoomFactor.get();
	}

	// #endregion

	// #region Zoom Wheel

	private readonly _zoomWheel = new VsCodeSetting<boolean>(
		`${extensionId}.zoomWheel`,
		{
			scope: this.uri,
			serializer: serializerWithDefault<boolean>(false),
		}
	);

	@computed
	public get zoomWheel(): boolean {
		return this._zoomWheel.get();
	}

	// #endregion

	// #region Global Variables

	private readonly _globalVars = new VsCodeSetting<object | null>(
		`${extensionId}.globalVars`,
		{
			scope: this.uri,
			serializer: serializerWithDefault<object | null>(null),
		}
	);

	@computed
	public get globalVars(): object | null {
		return this._globalVars.get();
	}

	// #endregion

	constructor(
		public readonly uri: Uri,
		private readonly config: Config,
		private readonly memento: Memento
	) {}

	@computed
	public get drawioLanguage(): string {
		if (env.language.toLowerCase() === "zh-tw") {
			// See https://github.com/hediet/vscode-drawio/issues/231.
			// Seems to be an exception, all other language codes are just the language, not the country.
			return "zh-tw";
		}
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
