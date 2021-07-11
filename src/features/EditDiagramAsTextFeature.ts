import { Disposable } from "@hediet/std/disposable";
import { Config } from "../Config";
import { workspace, commands, window, ViewColumn, TextDocument } from "vscode";
import { DrawioEditorService, DrawioEditor } from "../DrawioEditorService";
import { DrawioFileSystemController } from "../vscode-utils/VirtualFileSystemProvider";
import { registerFailableCommand } from "../utils/registerFailableCommand";

export class EditDiagramAsTextFeature {
	public readonly dispose = Disposable.fn();
	private readonly drawioFsController = this.dispose.track(
		new DrawioFileSystemController()
	);

	private readonly trackedDocuments = new Map<TextDocument, DrawioEditor>();

	constructor(
		private readonly editorManager: DrawioEditorService,
		config: Config
	) {
		if (!config.experimentalFeaturesEnabled) {
			return;
		}

		this.dispose.track([
			workspace.onDidChangeTextDocument((e) => {
				const drawioEditor = this.trackedDocuments.get(e.document);
				if (!drawioEditor) {
					return;
				}

				const doc = DiagramAsTextDocument.parse(e.document.getText());

				drawioEditor.drawioClient.updateVertices(doc.vertexUpdates);
			}),
			workspace.onDidCloseTextDocument((e) => {
				this.trackedDocuments.delete(e);
			}),
		]);

		let isUpdating = false;

		this.dispose.track(
			registerFailableCommand(
				"hediet.vscode-drawio.editDiagramAsText",
				async () => {
					const activeDrawioEditor =
						this.editorManager.activeDrawioEditor;
					if (!activeDrawioEditor) {
						return;
					}

					const { didFileExist, file } =
						this.drawioFsController.getOrCreateFileForUri(
							activeDrawioEditor.uri.with({
								scheme: this.drawioFsController.scheme,
								path:
									activeDrawioEditor.uri.path + ".drawio-txt",
							})
						);

					const updateFile = async () => {
						const nodes =
							await activeDrawioEditor.drawioClient.getVertices();
						isUpdating = true;
						try {
							const doc = new DiagramAsTextDocument(nodes, []);
							file.writeString(doc.toString());
						} finally {
							isUpdating = false;
						}
					};

					await updateFile();

					if (!didFileExist) {
						file.onDidChangeFile(async () => {
							if (isUpdating) {
								return;
							}
							const doc = DiagramAsTextDocument.parse(
								file.readString()
							);
							doc.removeDuplicates();
							activeDrawioEditor.drawioClient.addVertices(
								doc.newVertices
							);
							await updateFile();
						});
					}

					const doc = await workspace.openTextDocument(file.uri);
					this.trackedDocuments.set(doc, activeDrawioEditor);
					const editor = await window.showTextDocument(doc, {
						viewColumn: ViewColumn.Beside,
					});
				}
			)
		);
	}
}

class DiagramAsTextDocument {
	public static parse(src: string): DiagramAsTextDocument {
		const lines = src.split("\n");

		const vertexUpdates = new Array<{
			id: string;
			label: string;
		}>();
		const newVertices = new Array<{ label: string }>();

		for (const line of lines) {
			const m = line.match(/(.*):(.*)/);
			if (!m) {
				newVertices.push({ label: line });
			} else {
				vertexUpdates.push({ id: m[1], label: m[2] });
			}
		}

		return new DiagramAsTextDocument(vertexUpdates, newVertices);
	}

	constructor(
		public vertexUpdates: {
			id: string;
			label: string;
		}[],
		public newVertices: { label: string }[]
	) {}

	public toString(): string {
		return (
			this.vertexUpdates.map((n) => `${n.id}:${n.label}`).join("\n") +
			this.newVertices.map((v) => v.label).join("\n")
		);
	}

	public removeDuplicates(): void {
		this.newVertices = this.newVertices.filter(
			(v) =>
				!this.vertexUpdates.some(
					(existing) => existing.label === v.label
				)
		);
	}
}
