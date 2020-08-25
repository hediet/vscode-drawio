import * as vscode from "vscode";
import { Disposable } from "@hediet/std/disposable";
import { DrawioEditorProviderBinary } from "./DrawioEditorProviderBinary";
import { DrawioEditorProviderText } from "./DrawioEditorProviderText";
import { Config } from "./Config";
import { DrawioWebviewInitializer } from "./DrawioWebviewInitializer";
import { DrawioEditorManager } from "./DrawioEditorManager";
import { LinkCodeWithSelectedNodeService } from "./features/CodeLinkFeature";
import { EditDiagramAsTextFeature } from "./features/EditDiagramAsTextFeature";

export class Extension {
	public readonly dispose = Disposable.fn();
	private readonly log = this.dispose.track(
		vscode.window.createOutputChannel("Drawio Integration Log")
	);

	private readonly config = new Config();
	private readonly editorManager = new DrawioEditorManager(this.config);
	private readonly linkCodeWithSelectedNodeService = this.dispose.track(
		new LinkCodeWithSelectedNodeService(this.editorManager, this.config)
	);
	private readonly editDiagramsAsTextService = this.dispose.track(
		new EditDiagramAsTextFeature(this.editorManager, this.config)
	);
	private readonly drawioWebviewInitializer = new DrawioWebviewInitializer(
		this.config,
		this.log
	);

	constructor() {
		this.dispose.track(
			vscode.window.registerCustomEditorProvider(
				"hediet.vscode-drawio-text",
				new DrawioEditorProviderText(
					this.drawioWebviewInitializer,
					this.editorManager
				),
				{ webviewOptions: { retainContextWhenHidden: true } }
			)
		);

		this.dispose.track(
			vscode.window.registerCustomEditorProvider(
				"hediet.vscode-drawio",
				new DrawioEditorProviderBinary(
					this.drawioWebviewInitializer,
					this.editorManager
				),
				{
					supportsMultipleEditorsPerDocument: false,
					webviewOptions: { retainContextWhenHidden: true },
				}
			)
		);

		this.dispose.track(
			vscode.commands.registerCommand(
				"hediet.vscode-drawio.changeTheme",
				() => this.changeTheme()
			)
		);

		this.dispose.track(
			vscode.commands.registerCommand(
				"hediet.vscode-drawio.convert",
				() => this.convert()
			)
		);

		this.dispose.track(
			vscode.commands.registerCommand("hediet.vscode-drawio.export", () =>
				this.export()
			)
		);
	}

	private async convert(): Promise<void> {
		const activeDrawioEditor = this.editorManager.activeDrawioEditor;
		if (!activeDrawioEditor) {
			return;
		}

		// TODO remove the current format from the selection
		const result = await vscode.window.showQuickPick([
			{
				label: ".drawio.svg",
				description: "Converts the diagram to an editable SVG file",
			},
			{
				label: ".drawio",
				description: "Converts the diagram to a drawio file",
			},

			{
				label: ".drawio.png",
				description: "Converts the diagram to an editable png file",
			},
		]);

		if (!result) {
			return;
		}
		await activeDrawioEditor.convertTo(result.label);
	}

	private async export(): Promise<void> {
		const activeDrawioEditor = this.editorManager.activeDrawioEditor;
		if (!activeDrawioEditor) {
			return;
		}

		// TODO remove the current format from the selection
		const result = await vscode.window.showQuickPick([
			{
				label: ".svg",
				description: "Exports the diagram to a SVG file",
			},
			{
				label: ".png",
				description: "Exports the diagram to a png file",
			},
			{
				label: ".drawio",
				description: "Exports the diagram to a drawio file",
			},
		]);

		if (!result) {
			return;
		}
		await activeDrawioEditor.exportTo(result.label);
	}

	private async changeTheme(): Promise<void> {
		const activeDrawioEditor = this.editorManager.activeDrawioEditor;
		if (!activeDrawioEditor) {
			return;
		}

		let availableThemes = ["automatic", "min", "atlas", "dark", "Kennedy"];

		const originalTheme = activeDrawioEditor.config.theme;
		availableThemes = availableThemes.filter((t) => t !== originalTheme);
		availableThemes.unshift(originalTheme);

		const result = await vscode.window.showQuickPick(
			availableThemes.map((theme) => ({
				label: theme,
				description: `Selects Theme "${theme}"`,
				theme,
			})),
			{
				onDidSelectItem: async (item) => {
					await activeDrawioEditor.config.setTheme(
						(item as any).theme
					);
				},
			}
		);

		if (!result) {
			await activeDrawioEditor.config.setTheme(originalTheme);
			return;
		}

		await activeDrawioEditor.config.setTheme(result.theme);
	}
}
