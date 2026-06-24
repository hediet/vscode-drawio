import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import {
	DiagramBlock,
	MermaidBlock,
	findDiagramBlocks,
	replaceDiagramBlock,
	createEmptyDiagram,
	isBlankDiagram,
	buildDiagramBlock,
	findMermaidBlocks,
	replaceMermaidBlock,
} from "./diagramParser";
import { toggleLockAtLine } from "./diagramLock";
import { createLocalServer, LocalServer } from "./localServer";
import markdownItDrawio from "./markdownPlugin";

/**
 * Default diagram padding (pixels) used as fallback for the
 * 'drawio-inline-editor.diagramPadding' setting.
 *
 * When changing this value, also update the defaults in:
 *  - package.json  ("drawio-inline-editor.diagramPadding" → "default")
 *  - src/webview/inlinePreview.html  (var diagramPadding = …)
 *  - src/webview/previewInit.js      (MXGRAPH_CONFIG.border)
 */
const DEFAULT_DIAGRAM_PADDING = 28;

/** Default dimensions for newly inserted blank diagrams (pixels). */
const DEFAULT_NEW_DIAGRAM_WIDTH = 800;

/**
 * Toggle to add dev=1 (and test=1 where applicable) to draw.io iframe URLs.
 * Enables unminified sources and debug features in the draw.io editor.
 */
const DEV_MODE = false;

let activePanel: vscode.WebviewPanel | null = null;
let localServer: LocalServer | null = null;

interface DiagramEditingContext {
	documentUri: vscode.Uri;
	block: DiagramBlock;
}

interface MermaidEditingContext {
	documentUri: vscode.Uri;
	mermaidBlock: MermaidBlock;
}

let editingContext: DiagramEditingContext | MermaidEditingContext | null = null;

let inlinePreviewPanel: vscode.WebviewPanel | null = null;
let inlinePreviewDocUri: vscode.Uri | null = null;

/** When true, suppress inline preview updates triggered by our own edits. */
let suppressInlinePreviewUpdate = false;

/**
 * Extract the diagram id attribute from XML (e.g. <diagram id="abc">).
 */
function extractDiagramId(xml: string): string | null {
	const match = xml.match(/<diagram[^>]+id="([^"]+)"/);
	return match ? match[1] : null;
}

/**
 * Returns the editor URL based on configuration.
 * If editorMode is 'local', starts the local server and returns its URL.
 * Otherwise returns the configured online URL.
 */
/**
 * Handle a "vscodeShortcut" message forwarded from the draw.io iframe
 * via the outer webview.  Returns true if the message was handled.
 */
function handleVSCodeShortcut(msg: { type: string; command?: string }): boolean {
	if (msg.type === "vscodeShortcut" && msg.command) {
		vscode.commands.executeCommand(msg.command);
		return true;
	}
	return false;
}

async function getEditorUrl(context: vscode.ExtensionContext): Promise<string> {
	const config = vscode.workspace.getConfiguration("drawio-inline-editor");
	const mode = config.get<string>("editorMode", "local");

	if (mode === "local") {
		const webappRoot = path.join(context.extensionPath, "drawio", "src", "main", "webapp");
		if (fs.existsSync(webappRoot)) {
			if (!localServer) {
				localServer = createLocalServer(webappRoot);
			}
			if (!localServer.port) {
				await localServer.start();
			}
			return `http://127.0.0.1:${localServer.port}`;
		} else {
			console.warn("drawio-inline-editor: local drawio webapp not found, falling back to online editor");
		}
	}

	return config.get<string>("editorUrl", "https://test.draw.io")!;
}

export function activate(context: vscode.ExtensionContext): { extendMarkdownIt: (md: any) => any } {

	// CodeLens provider for diagram blocks
	const codeLensProvider = new DiagramCodeLensProvider();
	context.subscriptions.push(
		vscode.languages.registerCodeLensProvider(
			{ language: "markdown", scheme: "file" },
			codeLensProvider
		)
	);

	// CodeLens provider for mermaid blocks
	const mermaidCodeLensProvider = new MermaidCodeLensProvider();
	context.subscriptions.push(
		vscode.languages.registerCodeLensProvider(
			{ language: "markdown", scheme: "file" },
			mermaidCodeLensProvider
		)
	);

	// Custom editor provider for .drawio and .dio files
	context.subscriptions.push(
		vscode.window.registerCustomEditorProvider(
			"drawio-inline-editor.drawioEditor",
			new DrawioCustomEditorProvider(context),
			{ webviewOptions: { retainContextWhenHidden: true } }
		)
	);

	// Custom editor provider for .md files (Markdown with Diagrams)
	const markdownEditorProvider = new MarkdownEditorProvider(context);
	context.subscriptions.push(
		vscode.window.registerCustomEditorProvider(
			"drawio-inline-editor.markdownEditor",
			markdownEditorProvider,
			{ webviewOptions: { retainContextWhenHidden: true } }
		)
	);

	// Eagerly start the local server so it's ready when the user opens an editor.
	// This runs in the background and doesn't block activation.
	{
		const config = vscode.workspace.getConfiguration("drawio-inline-editor");
		const mode = config.get<string>("editorMode", "local");
		if (mode === "local") {
			const webappRoot = path.join(context.extensionPath, "drawio", "src", "main", "webapp");
			if (fs.existsSync(webappRoot)) {
				if (!localServer) {
					localServer = createLocalServer(webappRoot);
				}
				if (!localServer.port) {
					localServer.start().catch(err =>
						console.error("drawio-inline-editor: failed to pre-start local server:", err)
					);
				}
			}
		}
	}

	// Decorations for locked diagrams
	const lockedDecoration = vscode.window.createTextEditorDecorationType({
		backgroundColor: "rgba(255, 200, 0, 0.05)",
		isWholeLine: true,
		overviewRulerColor: "rgba(255, 200, 0, 0.5)",
	});
	context.subscriptions.push(lockedDecoration);

	// Update decorations when active editor changes
	function updateDecorations(editor: vscode.TextEditor | undefined): void {
		if (!editor || editor.document.languageId !== "markdown") { return; }
		const text = editor.document.getText();
		const blocks = findDiagramBlocks(text);
		const ranges: vscode.Range[] = [];
		for (const block of blocks) {
			if (block.locked) {
				ranges.push(new vscode.Range(block.startLine, 0, block.endLine, 0));
			}
		}
		editor.setDecorations(lockedDecoration, ranges);
	}

	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(updateDecorations),
		vscode.workspace.onDidChangeTextDocument(e => {
			const editor = vscode.window.activeTextEditor;
			if (editor && e.document === editor.document) {
				updateDecorations(editor);
			}
		})
	);

	if (vscode.window.activeTextEditor) {
		updateDecorations(vscode.window.activeTextEditor);
	}

	// URI handler for vscode:// URIs from the markdown preview.
	// The markdown preview cannot use command: URIs (enableCommandUris is not
	// set), so the edit button uses vscode://drawio.drawio-inline-editor/edit?line=N
	// which routes through this handler.
	//
	// Because the URI round-trips through the OS protocol handler,
	// activeTextEditor and visibleTextEditors may not contain the markdown
	// file.  We search workspace.textDocuments instead (all open documents
	// regardless of visibility).
	context.subscriptions.push(
		vscode.window.registerUriHandler({
			async handleUri(uri: vscode.Uri) {
				if (uri.path !== "/edit") { return; }

				const params = new URLSearchParams(uri.query);
				const line = parseInt(params.get("line") || "", 10);
				if (isNaN(line)) { return; }

				const docParam = params.get("doc");
				const blockIndex = parseInt(params.get("blockIndex") || "", 10);
				const hasBlockIndex = !isNaN(blockIndex) && blockIndex >= 0;
				const diagramIdParam = params.get("diagramId");

				// Helper: find block in a known document (Strategy 1 — file already identified).
				// Diagram ID is the most reliable key; block index and line are fallbacks.
				function findBlockInDoc(doc: vscode.TextDocument): DiagramBlock | null {
					const blocks = findDiagramBlocks(doc.getText());

					// Prefer diagram ID match (unique and stable across edits)
					if (diagramIdParam) {
						const byId = blocks.find(b => extractDiagramId(b.xml) === diagramIdParam);
						if (byId) { return byId; }
					}

					if (hasBlockIndex && blockIndex < blocks.length) {
						return blocks[blockIndex];
					}

					const exact = blocks.find(b => line >= b.startLine && line <= b.endLine);
					if (exact) { return exact; }

					let best: DiagramBlock | null = null;
					let bestDist = Infinity;
					for (const b of blocks) {
						const dist = line < b.startLine ? b.startLine - line
							: line > b.endLine ? line - b.endLine : 0;
						if (dist < bestDist) {
							bestDist = dist;
							best = b;
						}
					}
					return (best && bestDist <= 5) ? best : null;
				}

				function openBlock(doc: vscode.TextDocument, block: DiagramBlock): void {
					if (block.locked) {
						vscode.window.showWarningMessage("This diagram is locked. Unlock it first to edit.");
						return;
					}
					openDiagramEditor(context, doc, block);
				}

				// Strategy 1: open the exact file via the doc URI embedded by the
				// markdown-it plugin.  This is the most reliable path.
				if (docParam) {
					try {
						const docUri = vscode.Uri.parse(decodeURIComponent(docParam));
						const doc = await vscode.workspace.openTextDocument(docUri);
						const block = findBlockInDoc(doc);
						if (block) {
							openBlock(doc, block);
							return;
						}
					} catch (err: any) {
						console.warn("drawio-inline-editor: failed to open doc from URI param:", err.message);
					}
				}

				// Strategy 2: diagram ID search across all open markdown documents.
				// Diagram IDs are unique, so this reliably finds the correct file
				// even when the doc URI parameter is missing.
				const docs = vscode.workspace.textDocuments.filter(
					d => d.languageId === "markdown"
				);

				if (diagramIdParam) {
					for (const doc of docs) {
						const blocks = findDiagramBlocks(doc.getText());
						const block = blocks.find(b => extractDiagramId(b.xml) === diagramIdParam);
						if (block) {
							openBlock(doc, block);
							return;
						}
					}
				}

				// Strategy 3: search all open markdown documents by line number.
				// We use multi-pass matching to avoid picking phantom blocks
				// (e.g. documentation examples nested inside backtick fences).

				// Pass 1: block index + line range must BOTH agree (highest confidence)
				if (hasBlockIndex) {
					for (const doc of docs) {
						const blocks = findDiagramBlocks(doc.getText());
						if (blockIndex < blocks.length) {
							const b = blocks[blockIndex];
							if (line >= b.startLine && line <= b.endLine) {
								openBlock(doc, b);
								return;
							}
						}
					}
				}

				// Pass 2: exact line range only
				for (const doc of docs) {
					const blocks = findDiagramBlocks(doc.getText());
					const block = blocks.find(b => line >= b.startLine && line <= b.endLine);
					if (block) {
						openBlock(doc, block);
						return;
					}
				}

				// Pass 3: fuzzy line match (nearest within 5 lines)
				for (const doc of docs) {
					const blocks = findDiagramBlocks(doc.getText());
					let best: DiagramBlock | null = null;
					let bestDist = Infinity;
					for (const b of blocks) {
						const dist = line < b.startLine ? b.startLine - line
							: line > b.endLine ? line - b.endLine : 0;
						if (dist < bestDist) {
							bestDist = dist;
							best = b;
						}
					}
					if (best && bestDist <= 5) {
						openBlock(doc, best);
						return;
					}
				}

				vscode.window.showWarningMessage(
					"Could not find the diagram. Make sure the Markdown file is open."
				);
			},
		})
	);

	// Command: Edit Diagram
	context.subscriptions.push(
		vscode.commands.registerCommand("drawio-inline-editor.editDiagram", (lineOrUri: unknown, blockIndex?: number) => {
			// Find the markdown document.  Prefer the active editor; fall back to
			// searching all open documents (needed when triggered from the markdown
			// preview where activeTextEditor may not be set).
			let doc: vscode.TextDocument | null = null;
			const editor = vscode.window.activeTextEditor;

			if (editor && editor.document.languageId === "markdown") {
				doc = editor.document;
			} else if (typeof lineOrUri === "number") {
				const mdDocs = vscode.workspace.textDocuments.filter(
					d => d.languageId === "markdown"
				);
				for (const d of mdDocs) {
					const blocks = findDiagramBlocks(d.getText());
					if (blocks.some(b => lineOrUri >= b.startLine && lineOrUri <= b.endLine)) {
						doc = d;
						break;
					}
				}
			}

			if (!doc) {
				vscode.window.showWarningMessage("Open a Markdown file to edit a diagram.");
				return;
			}

			const text = doc.getText();
			const blocks = findDiagramBlocks(text);

			let block: DiagramBlock | undefined;
			if (typeof blockIndex === "number" && blockIndex < blocks.length) {
				// From CodeLens: direct block index
				block = blocks[blockIndex];
			} else if (typeof lineOrUri === "number") {
				// From preview / URI handler: lineOrUri is the source line number
				block = blocks.find(b => lineOrUri >= b.startLine && lineOrUri <= b.endLine);
			} else {
				// From keyboard / command palette: use cursor position
				const cursorLine = editor ? editor.selection.active.line : -1;
				block = blocks.find(b => cursorLine >= b.startLine && cursorLine <= b.endLine);
			}

			if (!block) {
				vscode.window.showWarningMessage("No draw.io diagram block found at cursor position.");
				return;
			}

			if (block.locked) {
				vscode.window.showWarningMessage("This diagram is locked. Unlock it first to edit.");
				return;
			}

			openDiagramEditor(context, doc, block);
		})
	);

	// Command: Insert New Diagram
	context.subscriptions.push(
		vscode.commands.registerCommand("drawio-inline-editor.insertDiagram", async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor || editor.document.languageId !== "markdown") {
				vscode.window.showWarningMessage("Open a Markdown file to insert a diagram.");
				return;
			}

			const format = await vscode.window.showQuickPick(
				[
					{ label: "Fenced Code Block", description: "```drawio ... ```", value: "fenced" as const },
					{ label: "HTML Comment Block", description: "<!-- drawio:start --> ... <!-- drawio:end -->", value: "comment" as const },
				],
				{ placeHolder: "Choose diagram block format" }
			);

			if (!format) { return; }

			const xml = createEmptyDiagram();
			const snippet = buildDiagramBlock(xml, format.value, false);

			await editor.edit(editBuilder => {
				editBuilder.insert(editor.selection.active, "\n" + snippet + "\n");
			});
		})
	);

	// Command: Toggle Lock
	context.subscriptions.push(
		vscode.commands.registerCommand("drawio-inline-editor.toggleLock", (lineNumber?: number) => {
			const editor = vscode.window.activeTextEditor;
			if (!editor || editor.document.languageId !== "markdown") { return; }

			const line = typeof lineNumber === "number" ? lineNumber : editor.selection.active.line;
			const text = editor.document.getText();
			const result = toggleLockAtLine(text, line);

			if (!result) {
				vscode.window.showWarningMessage("No draw.io diagram block found at cursor position.");
				return;
			}

			const fullRange = new vscode.Range(
				editor.document.positionAt(0),
				editor.document.positionAt(text.length)
			);

			editor.edit(editBuilder => {
				editBuilder.replace(fullRange, result.text);
			});

			vscode.window.showInformationMessage(
				result.locked ? "Diagram locked." : "Diagram unlocked."
			);
		})
	);

	// Command: Preview Diagram
	context.subscriptions.push(
		vscode.commands.registerCommand("drawio-inline-editor.previewDiagram", async (lineNumber?: number) => {
			const editor = vscode.window.activeTextEditor;
			if (!editor || editor.document.languageId !== "markdown") { return; }

			const line = typeof lineNumber === "number" ? lineNumber : editor.selection.active.line;
			const text = editor.document.getText();
			const blocks = findDiagramBlocks(text);
			const block = blocks.find(b => line >= b.startLine && line <= b.endLine);

			if (!block) {
				vscode.window.showWarningMessage("No draw.io diagram block found at cursor position.");
				return;
			}

			await openPreviewPanel(context, block.xml);
		})
	);

	// Command: Convert Mermaid to draw.io
	context.subscriptions.push(
		vscode.commands.registerCommand("drawio-inline-editor.convertMermaid", (lineOrUri: unknown, blockIndex?: number) => {
			let doc: vscode.TextDocument | null = null;
			const editor = vscode.window.activeTextEditor;

			if (editor && editor.document.languageId === "markdown") {
				doc = editor.document;
			}

			if (!doc) {
				vscode.window.showWarningMessage("Open a Markdown file to convert a mermaid diagram.");
				return;
			}

			const text = doc.getText();
			const blocks = findMermaidBlocks(text);

			let block: MermaidBlock | undefined;
			if (typeof blockIndex === "number" && blockIndex < blocks.length) {
				block = blocks[blockIndex];
			} else if (typeof lineOrUri === "number") {
				block = blocks.find(b => lineOrUri >= b.startLine && lineOrUri <= b.endLine);
			}

			if (!block) {
				vscode.window.showWarningMessage("No mermaid code block found.");
				return;
			}

			openMermaidEditor(context, doc, block);
		})
	);

	// Command: Inline Preview (open Markdown with Diagrams custom editor)
	context.subscriptions.push(
		vscode.commands.registerCommand("drawio-inline-editor.inlinePreview", (targetBlockIndex?: number) => {
			const editor = vscode.window.activeTextEditor;
			if (!editor || editor.document.languageId !== "markdown") {
				vscode.window.showWarningMessage("Open a Markdown file to use the inline preview.");
				return;
			}

			markdownEditorProvider.openEditor(editor.document.uri, targetBlockIndex);
		})
	);

	// Update inline preview when the source document changes
	context.subscriptions.push(
		vscode.workspace.onDidChangeTextDocument(e => {
			if (inlinePreviewPanel && inlinePreviewDocUri &&
				e.document.uri.toString() === inlinePreviewDocUri.toString()) {
				if (suppressInlinePreviewUpdate) {
					return;
				}
				updateInlinePreview(e.document);
			}
		})
	);

	// Return extendMarkdownIt so VS Code's markdown preview can find it.
	// VS Code looks for this on extension.exports (the activate() return value).
	return { extendMarkdownIt };
}

async function openDiagramEditor(
	context: vscode.ExtensionContext,
	document: vscode.TextDocument,
	block: DiagramBlock
): Promise<void> {
	if (activePanel) {
		activePanel.dispose();
	}

	editingContext = { documentUri: document.uri, block };

	const config = vscode.workspace.getConfiguration("drawio-inline-editor");
	const editorUrl = await getEditorUrl(context);
	const themeConfig = config.get<string>("ui", "kennedy")!;
	const autoLock = config.get<boolean>("autoLock", false)!;
	const devMode = DEV_MODE;

	const isDark = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark
		|| vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast;
	const theme = themeConfig === "auto" ? (isDark ? "dark" : "kennedy") : themeConfig;

	activePanel = vscode.window.createWebviewPanel(
		"drawio-inline-editor.editor",
		"Edit Diagram",
		vscode.ViewColumn.Beside,
		{
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, "src", "inline-editor", "webview"))],
		}
	);

	const nonce = getNonce();
	const htmlPath = path.join(context.extensionPath, "src", "inline-editor", "webview", "editor.html");
	let html = fs.readFileSync(htmlPath, "utf8");

	// Replace nonce placeholders
	html = html.replace(/\{\{nonce\}\}/g, nonce);

	// Update CSP to allow the configured editor URL (local or online)
	const editorOrigin = new URL(editorUrl).origin;
	html = html.replace(
		/frame-src[^;]+;/,
		`frame-src ${editorOrigin} http://127.0.0.1:* https://*.draw.io https://*.diagrams.net;`
	);

	// Pre-build the iframe URL so it starts loading immediately (no round-trip)
	let iframeSrc = editorUrl + "/?embed=1&proto=json&spin=1&configure=1&libraries=1&saveAndExit=1";
	if (devMode) { iframeSrc += "&dev=1&test=1"; }
	if (isDark) { iframeSrc += "&dark=1"; }
	html = html.replace("{{iframeSrc}}", iframeSrc);

	activePanel.webview.html = html;

	activePanel.webview.onDidReceiveMessage(
		async (msg) => {
			if (handleVSCodeShortcut(msg)) return;
			switch (msg.type) {
				case "webviewReady":
					activePanel!.webview.postMessage({
						type: "loadDiagram",
						xml: block.xml,
						locked: block.locked,
						isBlank: isBlankDiagram(block.xml),
						editorUrl,
						theme,
						isDark,
						devMode,
					});
					break;

				case "save":
					await saveDiagram(msg.xml, autoLock);
					break;

				case "saveAndClose":
					await saveDiagram(msg.xml, autoLock);
					activePanel!.dispose();
					break;

				case "cancel":
					activePanel!.dispose();
					break;
			}
		},
		undefined,
		context.subscriptions
	);

	// TODO: WebviewPanel has no onWillDispose / close-prevention API.
	// Convert to a CustomTextEditorProvider so VS Code's native dirty-state
	// tracking can block the close-tab action when there are unsaved changes.
	activePanel.onDidDispose(() => {
		activePanel = null;
		editingContext = null;
	});
}

async function saveDiagram(newXml: string, autoLock: boolean): Promise<void> {
	if (!editingContext || !("block" in editingContext)) { return; }

	const { documentUri, block } = editingContext;

	// Re-open the document by URI to ensure a valid reference.
	// The original document reference may have been garbage-collected or closed
	// between when the editor was opened and when the user clicks "save".
	const document = await vscode.workspace.openTextDocument(documentUri);
	const text = document.getText();

	// Re-parse to find the block.  Prefer diagram-ID match (survives edits
	// that shift line numbers), then fall back to startLine match.
	const blocks = findDiagramBlocks(text);
	const diagramId = extractDiagramId(block.xml);
	const currentBlock = (diagramId && blocks.find(b => extractDiagramId(b.xml) === diagramId))
		|| blocks.find(b => b.startLine === block.startLine)
		|| block;

	const locked = autoLock ? true : currentBlock.locked;
	const newText = replaceDiagramBlock(text, currentBlock, newXml, locked);

	const fullRange = new vscode.Range(
		document.positionAt(0),
		document.positionAt(text.length)
	);

	const edit = new vscode.WorkspaceEdit();
	edit.replace(document.uri, fullRange, newText);
	await vscode.workspace.applyEdit(edit);
}

/**
 * Opens the draw.io editor with mermaid source, converting it to a draw.io diagram.
 * When saved, replaces the mermaid block with a drawio block.
 */
async function openMermaidEditor(
	context: vscode.ExtensionContext,
	document: vscode.TextDocument,
	mermaidBlock: MermaidBlock
): Promise<void> {
	if (activePanel) {
		activePanel.dispose();
	}

	// Store the mermaid block as the editing context so saveMermaidDiagram can find it
	editingContext = { documentUri: document.uri, mermaidBlock };

	const config = vscode.workspace.getConfiguration("drawio-inline-editor");
	const editorUrl = await getEditorUrl(context);
	const themeConfig = config.get<string>("ui", "kennedy")!;
	const devMode = DEV_MODE;

	const isDark = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark
		|| vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast;
	const theme = themeConfig === "auto" ? (isDark ? "dark" : "kennedy") : themeConfig;

	activePanel = vscode.window.createWebviewPanel(
		"drawio-inline-editor.editor",
		"Convert Mermaid to Draw.io",
		vscode.ViewColumn.Beside,
		{
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, "src", "inline-editor", "webview"))],
		}
	);

	const nonce = getNonce();
	const htmlPath = path.join(context.extensionPath, "src", "inline-editor", "webview", "editor.html");
	let html = fs.readFileSync(htmlPath, "utf8");

	html = html.replace(/\{\{nonce\}\}/g, nonce);

	const editorOrigin = new URL(editorUrl).origin;
	html = html.replace(
		/frame-src[^;]+;/,
		`frame-src ${editorOrigin} http://127.0.0.1:* https://*.draw.io https://*.diagrams.net;`
	);

	// Pre-build the iframe URL so it starts loading immediately (no round-trip)
	let iframeSrc = editorUrl + "/?embed=1&proto=json&spin=1&configure=1&libraries=1&saveAndExit=1";
	if (devMode) { iframeSrc += "&dev=1&test=1"; }
	if (isDark) { iframeSrc += "&dark=1"; }
	html = html.replace("{{iframeSrc}}", iframeSrc);

	activePanel.webview.html = html;

	activePanel.webview.onDidReceiveMessage(
		async (msg) => {
			if (handleVSCodeShortcut(msg)) return;
			switch (msg.type) {
				case "webviewReady":
					activePanel!.webview.postMessage({
						type: "loadMermaid",
						mermaidSource: mermaidBlock.source,
						editorUrl,
						theme,
						isDark,
						devMode,
						sourceMetadataKey: "mermaidSource",
					});
					break;

				case "save":
					await saveMermaidDiagram(msg.xml);
					break;

				case "saveAndClose":
					await saveMermaidDiagram(msg.xml);
					activePanel!.dispose();
					break;

				case "cancel":
					activePanel!.dispose();
					break;
			}
		},
		undefined,
		context.subscriptions
	);

	// TODO: WebviewPanel has no onWillDispose / close-prevention API.
	// Convert to a CustomTextEditorProvider so VS Code's native dirty-state
	// tracking can block the close-tab action when there are unsaved changes.
	activePanel.onDidDispose(() => {
		activePanel = null;
		editingContext = null;
	});
}

/**
 * Saves the converted diagram, replacing the mermaid block with a drawio block.
 */
async function saveMermaidDiagram(newXml: string): Promise<void> {
	if (!editingContext || !("mermaidBlock" in editingContext)) { return; }

	const { documentUri, mermaidBlock } = editingContext;
	const document = await vscode.workspace.openTextDocument(documentUri);
	const text = document.getText();

	// Re-parse to find the mermaid block by startLine
	const blocks = findMermaidBlocks(text);
	const currentBlock = blocks.find(b => b.startLine === mermaidBlock.startLine) || mermaidBlock;

	const newText = replaceMermaidBlock(text, currentBlock, newXml, "fenced");

	const fullRange = new vscode.Range(
		document.positionAt(0),
		document.positionAt(text.length)
	);

	const edit = new vscode.WorkspaceEdit();
	edit.replace(document.uri, fullRange, newText);
	await vscode.workspace.applyEdit(edit);
}

/**
 * Saves a mermaid-to-drawio conversion from the inline preview.
 * Replaces the mermaid block with a drawio block and re-renders.
 */
async function saveMermaidConversion(
	mermaidIndex: number,
	xml: string,
	height: number | undefined,
	width: number | undefined
): Promise<void> {
	const doc = await vscode.workspace.openTextDocument(inlinePreviewDocUri!);
	const text = doc.getText();
	const mBlocks = findMermaidBlocks(text);
	const mBlock = mBlocks[mermaidIndex];
	if (!mBlock) { return; }

	suppressInlinePreviewUpdate = true;
	const newText = replaceMermaidBlock(text, mBlock, xml, "fenced", height, width);
	const fullRange = new vscode.Range(
		doc.positionAt(0),
		doc.positionAt(text.length)
	);
	const edit = new vscode.WorkspaceEdit();
	edit.replace(doc.uri, fullRange, newText);
	await vscode.workspace.applyEdit(edit);
	await doc.save();

	// Find the new diagram block that replaced the mermaid block
	const updatedDoc = await vscode.workspace.openTextDocument(inlinePreviewDocUri!);
	const newDiagramBlocks = findDiagramBlocks(updatedDoc.getText());
	const newBlock = newDiagramBlocks.find(b => b.startLine >= mBlock.startLine);
	const blockIndex = newBlock ? newDiagramBlocks.indexOf(newBlock) : -1;

	// Send targeted message to replace the mermaid element in-place
	if (inlinePreviewPanel && blockIndex >= 0) {
		inlinePreviewPanel.webview.postMessage({
			type: "mermaidConverted",
			mermaidIndex: mermaidIndex,
			blockIndex: blockIndex,
			xml: xml,
			locked: false,
			height: newBlock!.height,
			width: newBlock!.width,
			startLine: newBlock!.startLine,
			endLine: newBlock!.endLine,
			format: newBlock!.format,
			diagramId: extractDiagramId(xml),
		});
	}

	// Keep suppressing until late-firing change events have been processed.
	// applyEdit() can trigger async onDidChangeTextDocument events that would
	// cause a full re-render and reset the scroll position.
	setTimeout(() => { suppressInlinePreviewUpdate = false; }, 500);
}

async function openPreviewPanel(context: vscode.ExtensionContext, xml: string): Promise<void> {
	const panel = vscode.window.createWebviewPanel(
		"drawio-inline-editor.preview",
		"Diagram Preview",
		vscode.ViewColumn.Beside,
		{
			enableScripts: true,
		}
	);

	const nonce = getNonce();
	const isDark = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark;
	const devMode = DEV_MODE;
	const editorUrl = await getEditorUrl(context);
	const editorOrigin = new URL(editorUrl).origin;

	const LIGHTBOX_CSS = [
		".geMenubarContainer { display:none !important; }",
		".geFooterContainer { display:none !important; }",
		".geSidebar { display:none !important; }",
		".geFormatContainer { display:none !important; }",
		".geTabContainer { display:none !important; }",
		".mxWindow { display:none !important; }",
		"body { background: transparent !important; }",
		".geDiagramBackdrop { background: transparent !important; }",
		".geBackgroundPage { box-shadow:none !important; background:transparent !important; border:none !important; }",
		".geDiagramContainer { background: transparent !important; }",
		".mxCellEditor { resize:none !important; }",
	].join("\\n");

	const lightboxUrl = `${editorUrl}/?lightbox=1&toolbar=0&configure=1&embed=1&proto=json&spin=1&pv=0&grid=0&transparent=1&border=60${devMode ? "&dev=1&test=1" : ""}${isDark ? "&dark=1" : ""}`;

	const escapedXml = xml.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n").replace(/\r/g, "\\r");

	panel.webview.html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${editorOrigin} https://*.draw.io https://*.diagrams.net http://127.0.0.1:* http://localhost:*; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}';">
  <style nonce="${nonce}">
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: 100vw; height: 100vh; overflow: hidden;
      font-family: var(--vscode-font-family);
      background: var(--vscode-editor-background);
      display: flex; flex-direction: column;
    }
    .toolbar {
      display: flex;
      align-items: center;
      padding: 0 50px;
      gap: 8px;
      height: 36px;
      background: var(--vscode-editorGroupHeader-tabsBackground, var(--vscode-editor-background));
      border-bottom: 1px solid var(--vscode-editorGroup-border);
      flex-shrink: 0;
    }
    .toolbar .spacer { flex: 1; }
    .toolbar button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      height: 28px;
      padding: 0 12px;
      border: 1px solid var(--vscode-button-border, var(--vscode-editorGroup-border));
      border-radius: 4px;
      background: var(--vscode-button-secondaryBackground, transparent);
      color: var(--vscode-button-secondaryForeground, var(--vscode-editor-foreground));
      font-size: 12px;
      cursor: pointer;
    }
    .toolbar button:hover {
      background: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,0.15));
    }
    .toolbar button svg { width: 14px; height: 14px; fill: currentColor; }
    iframe { flex: 1; width: 100%; border: none; }
    #loading {
      position: absolute; top: 0; left: 0; right: 0; bottom: 0;
      display: flex; align-items: center; justify-content: center;
      color: var(--vscode-descriptionForeground, #888);
      font-size: 14px; pointer-events: none;
    }
    #loading.hidden { display: none; }
  </style>
</head>
<body>
  <div class="toolbar">
    <button id="zoom-in" title="Zoom in">
      <svg viewBox="0 0 16 16"><path d="M7 1a6 6 0 1 0 3.5 10.9l3.3 3.3a.75.75 0 1 0 1.06-1.06l-3.3-3.3A6 6 0 0 0 7 1ZM2.5 7a4.5 4.5 0 1 1 9 0 4.5 4.5 0 0 1-9 0ZM7 4a.75.75 0 0 1 .75.75v1.5h1.5a.75.75 0 0 1 0 1.5h-1.5v1.5a.75.75 0 0 1-1.5 0v-1.5h-1.5a.75.75 0 0 1 0-1.5h1.5v-1.5A.75.75 0 0 1 7 4Z"/></svg>
    </button>
    <button id="zoom-out" title="Zoom out">
      <svg viewBox="0 0 16 16"><path d="M7 1a6 6 0 1 0 3.5 10.9l3.3 3.3a.75.75 0 1 0 1.06-1.06l-3.3-3.3A6 6 0 0 0 7 1ZM2.5 7a4.5 4.5 0 1 1 9 0 4.5 4.5 0 0 1-9 0ZM4.25 6.25a.75.75 0 0 0 0 1.5h5.5a.75.75 0 0 0 0-1.5h-5.5Z"/></svg>
    </button>
    <button id="fit" title="Fit to window">
      <svg viewBox="0 0 16 16"><path d="M2 2.5A.5.5 0 0 1 2.5 2h3a.5.5 0 0 1 0 1H3v2.5a.5.5 0 0 1-1 0v-3Zm0 11a.5.5 0 0 0 .5.5h3a.5.5 0 0 0 0-1H3v-2.5a.5.5 0 0 0-1 0v3Zm12 0a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1 0-1H13v-2.5a.5.5 0 0 1 1 0v3Zm0-11a.5.5 0 0 0-.5-.5h-3a.5.5 0 0 0 0 1H13v2.5a.5.5 0 0 0 1 0v-3Z"/></svg>
    </button>
    <div class="spacer"></div>
  </div>
  <div id="loading">Loading diagram\u2026</div>
  <iframe id="frame"></iframe>
  <script nonce="${nonce}">
  (function() {
    var frame = document.getElementById('frame');
    var loading = document.getElementById('loading');
    var initialized = false;
    var xml = '${escapedXml}';

    frame.src = '${lightboxUrl}';

    window.addEventListener('message', function(e) {
      if (e.source !== frame.contentWindow) return;
      var msg;
      try { msg = JSON.parse(e.data); } catch(ex) { return; }
      if (!msg || !msg.event) return;

      switch (msg.event) {
        case 'configure':
          frame.contentWindow.postMessage(JSON.stringify({
            action: 'configure',
            config: {
              compact: true,
              css: '${LIGHTBOX_CSS}',
              darkColor: '#1e1e1e',
              settingsName: 'vscode-lightbox',
              noAutoFocus: true,
              noResizers: true,
            }
          }), '*');
          break;
        case 'init':
          loading.classList.add('hidden');
          initialized = true;
          frame.contentWindow.postMessage(JSON.stringify({
            action: 'load',
            autosave: 0,
            xml: xml,
            title: '',
          }), '*');
          break;
      }
    });

    function sendAction(name) {
      if (initialized)
        frame.contentWindow.postMessage(JSON.stringify({ action: 'invokeAction', actionName: name }), '*');
    }
    document.getElementById('zoom-in').addEventListener('click', function() { sendAction('zoomIn'); });
    document.getElementById('zoom-out').addEventListener('click', function() { sendAction('zoomOut'); });
    document.getElementById('fit').addEventListener('click', function() { sendAction('smartFit'); });
  })();
  </script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Inline Preview (custom markdown preview with inline editing)
// ---------------------------------------------------------------------------

async function openInlinePreview(
	context: vscode.ExtensionContext,
	document: vscode.TextDocument,
	targetBlockIndex?: number
): Promise<void> {
	const config = vscode.workspace.getConfiguration("drawio-inline-editor");
	const editorUrl = await getEditorUrl(context);
	const minimalUI = config.get<boolean>("minimalUI", true)!;
	const devMode = DEV_MODE;
	const diagramPadding = config.get<number>("diagramPadding", DEFAULT_DIAGRAM_PADDING)!;
	const isDark = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark
		|| vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast;

	if (inlinePreviewPanel) {
		// Reuse existing panel
		inlinePreviewDocUri = document.uri;
		inlinePreviewPanel.reveal(vscode.ViewColumn.Beside);
		updateInlinePreview(document);
		if (targetBlockIndex != null) {
			inlinePreviewPanel.webview.postMessage({
				type: "scrollToAndEdit",
				blockIndex: targetBlockIndex,
			});
		}
		return;
	}

	inlinePreviewDocUri = document.uri;

	inlinePreviewPanel = vscode.window.createWebviewPanel(
		"drawio-inline-editor.inlinePreview",
		"Markdown Editor",
		vscode.ViewColumn.Beside,
		{
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [
				vscode.Uri.file(path.join(context.extensionPath, "src", "inline-editor", "webview")),
				vscode.Uri.file(path.join(context.extensionPath, "drawio", "src", "main", "webapp", "js")),
				vscode.Uri.file(path.dirname(document.uri.fsPath)),
			],
		}
	);

	const nonce = getNonce();
	const htmlPath = path.join(context.extensionPath, "src", "inline-editor", "webview", "inlinePreview.html");
	let html = fs.readFileSync(htmlPath, "utf8");

	// Replace template variables
	const cspSource = inlinePreviewPanel.webview.cspSource;
	html = html.replace(/\$\{nonce\}/g, nonce);
	html = html.replace(/\$\{cspSource\}/g, cspSource);

	// Update CSP to allow the configured editor URL (local or online)
	const editorOrigin = new URL(editorUrl).origin;
	html = html.replace(
		/frame-src[^;]+;/,
		`frame-src ${editorOrigin} http://127.0.0.1:* https://*.draw.io https://*.diagrams.net;`
	);

	// Inject viewer-static.min.js as a script tag
	const viewerUri = inlinePreviewPanel.webview.asWebviewUri(
		vscode.Uri.file(path.join(context.extensionPath, "drawio", "src", "main", "webapp", "js", "viewer-static.min.js"))
	);
	html = html.replace("</head>",
		`<script nonce="${nonce}" src="${viewerUri}"></script>\n</head>`);

	inlinePreviewPanel.webview.html = html;

	inlinePreviewPanel.webview.onDidReceiveMessage(
		async (msg) => {
			if (handleVSCodeShortcut(msg)) return;
			switch (msg.type) {
				case "previewReady":
					inlinePreviewPanel!.webview.postMessage({
						type: "setDevMode",
						devMode: devMode,
					});
					inlinePreviewPanel!.webview.postMessage({
						type: "setEditorUrl",
						url: editorUrl,
					});
					inlinePreviewPanel!.webview.postMessage({
						type: "setDarkMode",
						dark: isDark,
					});
					inlinePreviewPanel!.webview.postMessage({
						type: "setMinimalUI",
						minimalUI: minimalUI,
					});
					inlinePreviewPanel!.webview.postMessage({
						type: "setDiagramPadding",
						padding: diagramPadding,
					});
					updateInlinePreview(document);
					if (targetBlockIndex != null) {
						inlinePreviewPanel!.webview.postMessage({
							type: "scrollToAndEdit",
							blockIndex: targetBlockIndex,
						});
					}
					break;

				case "diagramEdited":
					if (msg.mermaidIndex != null) {
						await saveMermaidConversion(msg.mermaidIndex, msg.xml, msg.height, msg.width);
					} else {
						await saveInlineDiagramEdit(msg.blockIndex, msg.xml, msg.diagramId);
					}
					break;

				case "textEdited":
					await saveTextSectionEdit(msg.startLine, msg.endLine, msg.markdown);
					break;

				case "diagramResized":
					await saveInlineDiagramResize(msg.blockIndex, msg.height, msg.diagramId, msg.width);
					break;

				case "diagramFitted":
					await saveInlineDiagramFit(msg.blockIndex, msg.diagramId, msg.width, msg.height);
					break;


				case "requestRefresh":
					{
						const doc = await vscode.workspace.openTextDocument(inlinePreviewDocUri!);
						updateInlinePreview(doc);
						break;
					}

				case "insertDiagram":
					await insertDiagramFromPreview(msg.afterLine);
					break;

				case "convertMermaid":
					{
						const doc = await vscode.workspace.openTextDocument(inlinePreviewDocUri!);
						const mBlocks = findMermaidBlocks(doc.getText());
						const mBlock = mBlocks[msg.mermaidIndex];
						if (mBlock) {
							openMermaidEditor(context, doc, mBlock);
						}
						break;
					}
			}
		},
		undefined,
		context.subscriptions
	);

	inlinePreviewPanel.onDidDispose(() => {
		inlinePreviewPanel = null;
		inlinePreviewDocUri = null;
	});
}

/**
 * Renders the markdown document and sends sections (text + diagram) to the webview.
 */
function updateInlinePreview(document: vscode.TextDocument): void {
	if (!inlinePreviewPanel) { return; }

	const docDir = path.dirname(document.uri.fsPath);
	const imageBaseUri = inlinePreviewPanel.webview.asWebviewUri(
		vscode.Uri.file(docDir)
	).toString();

	const text = document.getText();
	const diagramBlocks = findDiagramBlocks(text);
	const mermaidBlocks = findMermaidBlocks(text);

	// Merge diagram and mermaid blocks, sorted by position
	const allBlocks = [
		...diagramBlocks.map((b, i) => ({ ...b, sectionType: "diagram" as const, blockIndex: i })),
		...mermaidBlocks.map((b, i) => ({ ...b, sectionType: "mermaid" as const, mermaidIndex: i })),
	];
	allBlocks.sort((a, b) => a.index - b.index);

	const lines = text.split("\n");
	const sections: Array<Record<string, unknown>> = [];
	let currentLine = 0;

	// Helper: split a range of lines into paragraph-level text sections
	// (split at blank lines) so that each section maps to a small line range.
	function pushTextSections(fromLine: number, toLine: number): void {
		let paraStart = fromLine;
		for (let i = fromLine; i <= toLine; i++) {
			if (lines[i].trim() === "" || i === toLine) {
				// End of paragraph (blank line) or end of range
				const paraEnd = (lines[i].trim() === "" && i > paraStart) ? i - 1 : i;
				if (paraEnd >= paraStart) {
					const paraText = lines.slice(paraStart, paraEnd + 1).join("\n");
					if (paraText.trim()) {
						sections.push({
							type: "text",
							startLine: paraStart,
							endLine: paraEnd,
							html: renderBasicMarkdown(paraText, imageBaseUri),
						});
					}
				}
				paraStart = i + 1;
			}
		}
	}

	for (const block of allBlocks) {
		// Text sections before this block (split into paragraphs)
		if (currentLine < block.startLine) {
			pushTextSections(currentLine, block.startLine - 1);
		}

		if (block.sectionType === "diagram") {
			sections.push({
				type: "diagram",
				blockIndex: block.blockIndex,
				xml: block.xml,
				locked: block.locked,
				height: block.height,
				width: block.width,
				startLine: block.startLine,
				endLine: block.endLine,
				format: block.format,
				diagramId: extractDiagramId(block.xml),
			});
		} else if (block.sectionType === "mermaid") {
			sections.push({
				type: "mermaid",
				mermaidIndex: block.mermaidIndex,
				source: (block as any).source,
				startLine: block.startLine,
				endLine: block.endLine,
			});
		}

		currentLine = block.endLine + 1;
	}

	// Text sections after last block (split into paragraphs)
	if (currentLine < lines.length) {
		pushTextSections(currentLine, lines.length - 1);
	}

	inlinePreviewPanel.webview.postMessage({
		type: "updateContent",
		sections: sections,
		imageBaseUri: imageBaseUri,
	});
}

/**
 * Basic markdown to HTML conversion.
 * This is intentionally simple - a production version would use markdown-it.
 */
function renderBasicMarkdown(text: string, imageBaseUri: string): string {
	// Escape HTML
	text = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

	// Stash code blocks/spans to protect their content from further processing
	const codeStash: string[] = [];

	// Code blocks (fenced with backticks or tildes)
	text = text.replace(/^(`{3,}|~{3,})(\w*)[^\r\n]*\r?\n([\s\S]*?)^\1$/gm, (_, _fence, lang, code) => {
		const i = codeStash.length;
		codeStash.push(`<pre><code class="language-${lang}">${(code as string).trim()}</code></pre>`);
		return `<pre data-stash="${i}"></pre>`;
	});

	// Indented code blocks (4 spaces or tab)
	text = text.replace(/((?:^(?:    |\t).*$(?:\r?\n|$))+)/gm, (match) => {
		const i = codeStash.length;
		const code = match.replace(/^(?:    |\t)/gm, "").trimEnd();
		codeStash.push(`<pre><code>${code}</code></pre>`);
		return `<pre data-stash="${i}"></pre>`;
	});

	// Double-backtick inline code (can contain single backticks)
	// Lookbehind/lookahead ensures `` is exactly two backticks, not part of ```
	text = text.replace(/(?<!`)``(?!`)(.+?)(?<!`)``(?!`)/g, (_, code) => {
		const i = codeStash.length;
		codeStash.push(`<code>${(code as string).trim()}</code>`);
		return `\x00cs${i}\x00`;
	});

	// Inline code
	text = text.replace(/(?<!`)`(?!`)([^`]+)`/g, (_, code) => {
		const i = codeStash.length;
		codeStash.push(`<code>${code}</code>`);
		return `\x00cs${i}\x00`;
	});

	// Headers
	text = text.replace(/^######\s+(.+)$/gm, "<h6>$1</h6>");
	text = text.replace(/^#####\s+(.+)$/gm, "<h5>$1</h5>");
	text = text.replace(/^####\s+(.+)$/gm, "<h4>$1</h4>");
	text = text.replace(/^###\s+(.+)$/gm, "<h3>$1</h3>");
	text = text.replace(/^##\s+(.+)$/gm, "<h2>$1</h2>");
	text = text.replace(/^#\s+(.+)$/gm, "<h1>$1</h1>");

	// Horizontal rules
	text = text.replace(/^---+$/gm, "<hr>");

	// Bold and italic
	text = text.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
	text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
	text = text.replace(/\*(.+?)\*/g, "<em>$1</em>");

	// Images (must run before links so ![alt](src) isn't matched as a link)
	text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => {
		let resolvedSrc = src as string;
		if (imageBaseUri && !/^https?:\/\/|^data:/i.test(src as string)) {
			resolvedSrc = imageBaseUri + "/" + src;
		}
		return `<img alt="${alt}" src="${resolvedSrc}">`;
	});

	// Links
	text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

	// Blockquotes
	text = text.replace(/^&gt;\s+(.+)$/gm, "<blockquote>$1</blockquote>");

	// Unordered lists
	text = text.replace(/^[-*]\s+(.+)$/gm, "<li>$1</li>");
	text = text.replace(/((?:<li>.*<\/li>\r?\n?)+)/g, "<ul>$1</ul>");

	// Tables (header row, separator row, body rows)
	text = text.replace(/(^\|.+\|\s*\r?\n\|[-| :]+\|\s*\r?\n(?:\|.+\|\s*\r?\n?)+)/gm, (table) => {
		const rows = table.trim().split(/\r?\n/);
		const parseRow = (row: string) => row.replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim());
		const headers = parseRow(rows[0]);
		const body = rows.slice(2).map(parseRow);
		let html = "<table><thead><tr>" + headers.map(h => `<th>${h}</th>`).join("") + "</tr></thead><tbody>";
		for (const row of body) {
			html += "<tr>" + row.map(c => `<td>${c}</td>`).join("") + "</tr>";
		}
		html += "</tbody></table>";
		return html;
	});

	// Paragraphs - wrap remaining text lines
	text = text.replace(/^(?!<[a-z/]|$)(.+)$/gm, "<p>$1</p>");

	// Clean up empty paragraphs
	text = text.replace(/<p>\s*<\/p>/g, "");

	// Restore stashed code blocks and inline code
	text = text.replace(/<pre data-stash="(\d+)"><\/pre>/g, (_, i) => codeStash[parseInt(i)]);
	text = text.replace(/\x00cs(\d+)\x00/g, (_, i) => codeStash[parseInt(i)]);

	return text;
}

/**
 * Saves an inline diagram edit back to the markdown source file.
 */
async function saveInlineDiagramEdit(
	blockIndex: number,
	newXml: string,
	diagramId: string | undefined
): Promise<void> {
	if (!inlinePreviewDocUri) { return; }

	try {
		const document = await vscode.workspace.openTextDocument(inlinePreviewDocUri);
		const text = document.getText();
		const blocks = findDiagramBlocks(text);

		// Prefer diagram ID match (survives line-number shifts), fall back to index
		let block: DiagramBlock | null = null;
		if (diagramId) {
			block = blocks.find(b => extractDiagramId(b.xml) === diagramId) || null;
		}
		if (!block && blockIndex >= 0 && blockIndex < blocks.length) {
			block = blocks[blockIndex];
		}
		if (!block) { return; }

		const newText = replaceDiagramBlock(text, block, newXml, block.locked);

		const fullRange = new vscode.Range(
			document.positionAt(0),
			document.positionAt(text.length)
		);

		// Suppress preview update so we don't re-render and destroy live editors
		suppressInlinePreviewUpdate = true;
		const edit = new vscode.WorkspaceEdit();
		edit.replace(document.uri, fullRange, newText);
		await vscode.workspace.applyEdit(edit);
		setTimeout(() => { suppressInlinePreviewUpdate = false; }, 200);
	} catch (err: any) {
		suppressInlinePreviewUpdate = false;
		vscode.window.showErrorMessage("Failed to save diagram: " + err.message);
	}
}

/**
 * Saves a text section edit back to the markdown source file.
 */
async function saveTextSectionEdit(
	startLine: number,
	endLine: number,
	newMarkdown: string
): Promise<void> {
	if (!inlinePreviewDocUri) { return; }

	try {
		const document = await vscode.workspace.openTextDocument(inlinePreviewDocUri);
		const text = document.getText();
		const lines = text.split("\n");

		// Replace lines from startLine to endLine with new markdown
		const newLines = newMarkdown.split("\n");
		lines.splice(startLine, endLine - startLine + 1, ...newLines);

		const newText = lines.join("\n");
		const fullRange = new vscode.Range(
			document.positionAt(0),
			document.positionAt(text.length)
		);

		suppressInlinePreviewUpdate = true;
		const edit = new vscode.WorkspaceEdit();
		edit.replace(document.uri, fullRange, newText);
		await vscode.workspace.applyEdit(edit);
		setTimeout(() => { suppressInlinePreviewUpdate = false; }, 500);
	} catch (err: any) {
		suppressInlinePreviewUpdate = false;
		console.error("drawio-inline-editor: failed to save text edit:", err.message);
	}
}

/**
 * Saves a diagram container height change back to the markdown source file.
 */
async function saveInlineDiagramResize(
	blockIndex: number,
	_height: number | undefined,
	diagramId: string | undefined,
	width: number | undefined
): Promise<void> {
	if (!inlinePreviewDocUri) { return; }

	try {
		const document = await vscode.workspace.openTextDocument(inlinePreviewDocUri);
		const text = document.getText();
		const blocks = findDiagramBlocks(text);

		let block: DiagramBlock | null = null;
		if (diagramId) {
			block = blocks.find(b => extractDiagramId(b.xml) === diagramId) || null;
		}
		if (!block && blockIndex >= 0 && blockIndex < blocks.length) {
			block = blocks[blockIndex];
		}
		if (!block) { return; }

		const clampedWidth = width != null ? Math.max(200, width) : block.width;
		const newText = replaceDiagramBlock(text, block, block.xml, block.locked, undefined, clampedWidth);

		const fullRange = new vscode.Range(
			document.positionAt(0),
			document.positionAt(text.length)
		);

		suppressInlinePreviewUpdate = true;
		const edit = new vscode.WorkspaceEdit();
		edit.replace(document.uri, fullRange, newText);
		await vscode.workspace.applyEdit(edit);
		setTimeout(() => { suppressInlinePreviewUpdate = false; }, 200);
	} catch {
		suppressInlinePreviewUpdate = false;
	}
}

/**
 * Updates a diagram block after fit: always removes height, keeps width only if provided.
 */
async function saveInlineDiagramFit(
	blockIndex: number,
	diagramId: string | undefined,
	keepWidth: number | undefined,
	keepHeight: number | undefined
): Promise<void> {
	if (!inlinePreviewDocUri) { return; }

	try {
		const document = await vscode.workspace.openTextDocument(inlinePreviewDocUri);
		const text = document.getText();
		const blocks = findDiagramBlocks(text);

		let block: DiagramBlock | null = null;
		if (diagramId) {
			block = blocks.find(b => extractDiagramId(b.xml) === diagramId) || null;
		}
		if (!block && blockIndex >= 0 && blockIndex < blocks.length) {
			block = blocks[blockIndex];
		}
		if (!block) { return; }

		const newWidth = keepWidth != null ? keepWidth : null;
		const newHeight = keepHeight != null ? keepHeight : null;
		if (block.width === newWidth && block.height === newHeight) { return; }

		const newText = replaceDiagramBlock(text, block, block.xml, block.locked, newHeight, newWidth);

		const fullRange = new vscode.Range(
			document.positionAt(0),
			document.positionAt(text.length)
		);

		suppressInlinePreviewUpdate = true;
		const edit = new vscode.WorkspaceEdit();
		edit.replace(document.uri, fullRange, newText);
		await vscode.workspace.applyEdit(edit);
		setTimeout(() => { suppressInlinePreviewUpdate = false; }, 200);
	} catch {
		suppressInlinePreviewUpdate = false;
	}
}



/**
 * Inserts a new empty diagram block after the block containing the cursor,
 * or at the end of the document if no cursor position is available.
 */
async function insertDiagramFromPreview(afterLine: number | null): Promise<void> {
	if (!inlinePreviewDocUri) { return; }

	try {
		const document = await vscode.workspace.openTextDocument(inlinePreviewDocUri);
		const text = document.getText();
		const xml = createEmptyDiagram();
		const snippet = buildDiagramBlock(xml, "fenced", false, null, DEFAULT_NEW_DIAGRAM_WIDTH);

		// Try to get the cursor line from the VS Code text editor for this document
		let cursorLine = afterLine;
		if (cursorLine == null) {
			const editors = vscode.window.visibleTextEditors;
			for (const ed of editors) {
				if (ed.document.uri.toString() === inlinePreviewDocUri!.toString()) {
					cursorLine = ed.selection.active.line;
					break;
				}
			}
		}

		// Find the block (diagram or otherwise) that contains the cursor line,
		// and insert after it. If no cursor, append at end.
		let insertAfterLine: number | null = null;
		if (cursorLine != null && cursorLine >= 0) {
			const blocks = findDiagramBlocks(text);
			const lines = text.split("\n");

			// Find the end of the paragraph/block containing the cursor.
			// Check if cursor is inside a diagram block first.
			for (const b of blocks) {
				if (cursorLine >= b.startLine && cursorLine <= b.endLine) {
					insertAfterLine = b.endLine;
					break;
				}
			}

			// If not inside a diagram block, find the end of the current
			// paragraph (next blank line or next diagram block start).
			if (insertAfterLine == null) {
				insertAfterLine = cursorLine;
				// Walk forward to find end of current paragraph
				for (let i = cursorLine + 1; i < lines.length; i++) {
					// Stop at blank line
					if (lines[i].trim() === "") { insertAfterLine = i; break; }
					// Stop before a diagram block
					let hitBlock = false;
					for (const b of blocks) {
						if (i === b.startLine) { hitBlock = true; break; }
					}
					if (hitBlock) { insertAfterLine = i - 1; break; }
					insertAfterLine = i;
				}
			}
		}

		let newText: string;
		if (insertAfterLine != null) {
			const lines = text.split("\n");
			const idx = Math.min(insertAfterLine, lines.length - 1);
			const before = lines.slice(0, idx + 1).join("\n");
			const after = lines.slice(idx + 1).join("\n");
			newText = before + "\n\n" + snippet + "\n\n" + after;
		} else {
			newText = text.trimEnd() + "\n\n" + snippet + "\n";
		}

		const fullRange = new vscode.Range(
			document.positionAt(0),
			document.positionAt(text.length)
		);
		const edit = new vscode.WorkspaceEdit();
		edit.replace(document.uri, fullRange, newText);
		await vscode.workspace.applyEdit(edit);

		// After inserting, find the new block index and scroll to it
		const updatedDoc = await vscode.workspace.openTextDocument(inlinePreviewDocUri);
		const newBlocks = findDiagramBlocks(updatedDoc.getText());
		let newBlockIndex = newBlocks.length - 1; // default: last block
		if (insertAfterLine != null) {
			for (let i = 0; i < newBlocks.length; i++) {
				if (newBlocks[i].startLine > insertAfterLine) {
					newBlockIndex = i;
					break;
				}
			}
		}

		if (inlinePreviewPanel && newBlockIndex >= 0) {
			inlinePreviewPanel.webview.postMessage({
				type: "scrollToAndEdit",
				blockIndex: newBlockIndex,
				isNew: true,
			});
		}
	} catch (err: any) {
		vscode.window.showErrorMessage("Failed to insert diagram: " + err.message);
	}
}

function getNonce(): string {
	let text = "";
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	for (let i = 0; i < 32; i++) {
		text += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return text;
}

// ---------------------------------------------------------------------------
// Custom Editor Provider for .drawio / .dio files
// ---------------------------------------------------------------------------

class DrawioCustomEditorProvider implements vscode.CustomTextEditorProvider {
	constructor(private readonly context: vscode.ExtensionContext) {}

	async resolveCustomTextEditor(
		document: vscode.TextDocument,
		webviewPanel: vscode.WebviewPanel
	): Promise<void> {
		const context = this.context;
		const config = vscode.workspace.getConfiguration("drawio-inline-editor");
		const editorUrl = await getEditorUrl(context);
		const themeConfig = config.get<string>("ui", "kennedy")!;
		const devMode = DEV_MODE;
		const isDark = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark
			|| vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast;
		const theme = themeConfig === "auto" ? (isDark ? "dark" : "kennedy") : themeConfig;

		let suppressUpdate = false;

		webviewPanel.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.file(path.join(context.extensionPath, "src", "inline-editor", "webview")),
			],
		};

		const nonce = getNonce();
		const htmlPath = path.join(context.extensionPath, "src", "inline-editor", "webview", "editor.html");
		let html = fs.readFileSync(htmlPath, "utf8");
		html = html.replace(/\{\{nonce\}\}/g, nonce);

		// Update CSP for configured editor URL (local or online)
		const editorOrigin = new URL(editorUrl).origin;
		html = html.replace(
			/frame-src[^;]+;/,
			`frame-src ${editorOrigin} http://127.0.0.1:* https://*.draw.io https://*.diagrams.net;`
		);

		// Pre-build the iframe URL so it starts loading immediately (no round-trip)
		let iframeSrc = editorUrl + "/?embed=1&proto=json&spin=1&configure=1&libraries=1&saveAndExit=1";
		if (devMode) { iframeSrc += "&dev=1&test=1"; }
		if (isDark) { iframeSrc += "&dark=1"; }
		html = html.replace("{{iframeSrc}}", iframeSrc);

		webviewPanel.webview.html = html;

		webviewPanel.webview.onDidReceiveMessage(
			async (msg) => {
				if (handleVSCodeShortcut(msg)) return;
				switch (msg.type) {
					case "webviewReady":
						webviewPanel.webview.postMessage({
							type: "loadDiagram",
							xml: document.getText(),
							locked: false,
							editorUrl,
							theme,
							isDark,
							devMode,
							mode: "customEditor",
						});
						break;

					case "save":
					case "autosave":
						if (msg.xml) {
							suppressUpdate = true;
							const fullRange = new vscode.Range(
								document.positionAt(0),
								document.positionAt(document.getText().length)
							);
							const edit = new vscode.WorkspaceEdit();
							edit.replace(document.uri, fullRange, msg.xml);
							await vscode.workspace.applyEdit(edit);
							setTimeout(() => { suppressUpdate = false; }, 200);
						}
						break;

					case "cancel":
						// No-op for custom editor — user can just close the tab
						break;
				}
			}
		);

		// Reload diagram when external changes occur
		const changeDisposable = vscode.workspace.onDidChangeTextDocument(e => {
			if (suppressUpdate) { return; }
			if (e.document.uri.toString() === document.uri.toString()) {
				webviewPanel.webview.postMessage({
					type: "loadDiagram",
					xml: document.getText(),
					locked: false,
					editorUrl,
					theme,
					isDark,
					devMode,
					mode: "customEditor",
				});
			}
		});

		webviewPanel.onDidDispose(() => {
			changeDisposable.dispose();
		});
	}
}

// ---------------------------------------------------------------------------
// Custom Editor Provider for .md files (Markdown with Diagrams)
// ---------------------------------------------------------------------------

class MarkdownEditorProvider implements vscode.CustomTextEditorProvider {
	private readonly activePanels = new Map<string, vscode.WebviewPanel>();
	private readonly pendingScrollTargets = new Map<string, number>();

	constructor(private readonly context: vscode.ExtensionContext) {}

	/**
	 * Open the Markdown with Diagrams editor for a document, optionally scrolling
	 * to a specific diagram block. Reuses an existing tab if already open.
	 */
	async openEditor(uri: vscode.Uri, targetBlockIndex?: number): Promise<void> {
		const alreadyOpen = this.activePanels.has(uri.toString());

		if (targetBlockIndex != null && !alreadyOpen) {
			// Store target so it's sent after the webview finishes its first render
			this.pendingScrollTargets.set(uri.toString(), targetBlockIndex);
		}

		await vscode.commands.executeCommand("vscode.openWith", uri, "drawio-inline-editor.markdownEditor");

		if (targetBlockIndex != null && alreadyOpen) {
			// Panel already loaded — send immediately
			const panel = this.activePanels.get(uri.toString());
			if (panel) {
				panel.webview.postMessage({
					type: "scrollToAndEdit",
					blockIndex: targetBlockIndex,
				});
			}
		}
	}

	async resolveCustomTextEditor(
		document: vscode.TextDocument,
		webviewPanel: vscode.WebviewPanel
	): Promise<void> {
		const context = this.context;
		const config = vscode.workspace.getConfiguration("drawio-inline-editor");
		const editorUrl = await getEditorUrl(context);
		const minimalUI = config.get<boolean>("minimalUI", true)!;
		const diagramPadding = config.get<number>("diagramPadding", DEFAULT_DIAGRAM_PADDING)!;
		const isDark = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark
			|| vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast;

		let suppressUpdate = false;

		const docDir = path.dirname(document.uri.fsPath);
		webviewPanel.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.file(path.join(context.extensionPath, "src", "inline-editor", "webview")),
				vscode.Uri.file(path.join(context.extensionPath, "drawio", "src", "main", "webapp", "js")),
				vscode.Uri.file(docDir),
			],
		};

		webviewPanel.iconPath = {
			light: vscode.Uri.file(path.join(context.extensionPath, "media", "markdown-diagram-light.svg")),
			dark: vscode.Uri.file(path.join(context.extensionPath, "media", "markdown-diagram-dark.svg")),
		};

		const nonce = getNonce();
		const htmlPath = path.join(context.extensionPath, "src", "inline-editor", "webview", "inlinePreview.html");
		let html = fs.readFileSync(htmlPath, "utf8");

		const cspSource = webviewPanel.webview.cspSource;
		html = html.replace(/\$\{nonce\}/g, nonce);
		html = html.replace(/\$\{cspSource\}/g, cspSource);

		const editorOrigin = new URL(editorUrl).origin;
		html = html.replace(
			/frame-src[^;]+;/,
			`frame-src ${editorOrigin} http://127.0.0.1:* https://*.draw.io https://*.diagrams.net;`
		);

		const viewerUri = webviewPanel.webview.asWebviewUri(
			vscode.Uri.file(path.join(context.extensionPath, "drawio", "src", "main", "webapp", "js", "viewer-static.min.js"))
		);
		html = html.replace("</head>",
			`<script nonce="${nonce}" src="${viewerUri}"></script>\n</head>`);

		webviewPanel.webview.html = html;

		// Track this panel so openEditor() can send messages to it
		this.activePanels.set(document.uri.toString(), webviewPanel);

		const sendContent = (): void => {
			const imageBaseUri = webviewPanel.webview.asWebviewUri(
				vscode.Uri.file(docDir)
			).toString();
			const text = document.getText();
			const diagramBlocks = findDiagramBlocks(text);
			const mermaidBlocks = findMermaidBlocks(text);

			// Merge diagram and mermaid blocks, sorted by position
			const allBlocks = [
				...diagramBlocks.map((b, i) => ({ ...b, sectionType: "diagram" as const, blockIndex: i })),
				...mermaidBlocks.map((b, i) => ({ ...b, sectionType: "mermaid" as const, mermaidIndex: i })),
			];
			allBlocks.sort((a, b) => a.index - b.index);

			const lines = text.split("\n");
			const sections: Array<Record<string, unknown>> = [];
			let currentLine = 0;

			// Helper: split a range of lines into paragraph-level text sections
			function pushTextSections(fromLine: number, toLine: number): void {
				let paraStart = fromLine;
				for (let i = fromLine; i <= toLine; i++) {
					if (lines[i].trim() === "" || i === toLine) {
						const paraEnd = (lines[i].trim() === "" && i > paraStart) ? i - 1 : i;
						if (paraEnd >= paraStart) {
							const paraText = lines.slice(paraStart, paraEnd + 1).join("\n");
							if (paraText.trim()) {
								sections.push({
									type: "text",
									startLine: paraStart,
									endLine: paraEnd,
									html: renderBasicMarkdown(paraText, imageBaseUri),
								});
							}
						}
						paraStart = i + 1;
					}
				}
			}

			for (const block of allBlocks) {
				if (currentLine < block.startLine) {
					pushTextSections(currentLine, block.startLine - 1);
				}

				if (block.sectionType === "diagram") {
					sections.push({
						type: "diagram",
						blockIndex: block.blockIndex,
						xml: block.xml,
						locked: block.locked,
						height: block.height,
						width: block.width,
						startLine: block.startLine,
						endLine: block.endLine,
						format: block.format,
						diagramId: extractDiagramId(block.xml),
					});
				} else if (block.sectionType === "mermaid") {
					sections.push({
						type: "mermaid",
						mermaidIndex: block.mermaidIndex,
						source: (block as any).source,
						startLine: block.startLine,
						endLine: block.endLine,
					});
				}

				currentLine = block.endLine + 1;
			}

			if (currentLine < lines.length) {
				pushTextSections(currentLine, lines.length - 1);
			}

			webviewPanel.webview.postMessage({
				type: "updateContent",
				sections: sections,
				imageBaseUri: imageBaseUri,
			});
		};

		const applyEdit = async (newText: string): Promise<void> => {
			suppressUpdate = true;
			const text = document.getText();
			const fullRange = new vscode.Range(
				document.positionAt(0),
				document.positionAt(text.length)
			);
			const edit = new vscode.WorkspaceEdit();
			edit.replace(document.uri, fullRange, newText);
			await vscode.workspace.applyEdit(edit);
			setTimeout(() => { suppressUpdate = false; }, 200);
		};

		webviewPanel.webview.onDidReceiveMessage(
			async (msg) => {
				if (handleVSCodeShortcut(msg)) return;
				switch (msg.type) {
					case "previewReady":
						webviewPanel.webview.postMessage({
							type: "setDevMode",
							devMode: DEV_MODE,
						});
						webviewPanel.webview.postMessage({
							type: "setEditorUrl",
							url: editorUrl,
						});
						webviewPanel.webview.postMessage({
							type: "setDarkMode",
							dark: isDark,
						});
						webviewPanel.webview.postMessage({
							type: "setMinimalUI",
							minimalUI: minimalUI,
						});
						webviewPanel.webview.postMessage({
							type: "setDiagramPadding",
							padding: diagramPadding,
						});
						sendContent();
						{
							const uriKey = document.uri.toString();
							const pendingBlock = this.pendingScrollTargets.get(uriKey);
							if (pendingBlock != null) {
								this.pendingScrollTargets.delete(uriKey);
								webviewPanel.webview.postMessage({
									type: "scrollToAndEdit",
									blockIndex: pendingBlock,
								});
							}
						}
						break;

					case "diagramEdited":
						{
							if (msg.mermaidIndex != null) {
								// Mermaid conversion: replace mermaid block with drawio block
								const text = document.getText();
								const mBlocks = findMermaidBlocks(text);
								const mBlock = mBlocks[msg.mermaidIndex];
								if (mBlock) {
									const newText = replaceMermaidBlock(text, mBlock, msg.xml, "fenced", msg.height, msg.width);
									await applyEdit(newText);

									// Send targeted mermaidConverted message for in-place DOM replacement
									// (avoids full re-render which resets scroll position)
									const updatedText = document.getText();
									const newDiagramBlocks = findDiagramBlocks(updatedText);
									const newBlock = newDiagramBlocks.find(b => b.startLine >= mBlock.startLine);
									const bIdx = newBlock ? newDiagramBlocks.indexOf(newBlock) : -1;

									if (bIdx >= 0) {
										webviewPanel.webview.postMessage({
											type: "mermaidConverted",
											mermaidIndex: msg.mermaidIndex,
											blockIndex: bIdx,
											xml: msg.xml,
											locked: false,
											height: newBlock!.height,
											width: newBlock!.width,
											startLine: newBlock!.startLine,
											endLine: newBlock!.endLine,
											format: newBlock!.format,
											diagramId: extractDiagramId(msg.xml),
										});
									}
								}
							} else {
								const text = document.getText();
								const blocks = findDiagramBlocks(text);
								let block: DiagramBlock | null = null;
								if (msg.diagramId) {
									block = blocks.find(b => extractDiagramId(b.xml) === msg.diagramId) || null;
								}
								if (!block && msg.blockIndex >= 0 && msg.blockIndex < blocks.length) {
									block = blocks[msg.blockIndex];
								}
								if (block) {
									const newText = replaceDiagramBlock(text, block, msg.xml, block.locked);
									await applyEdit(newText);
								}
							}
							break;
						}

					case "textEdited":
						{
							const text = document.getText();
							const lines = text.split("\n");
							const newLines = (msg.markdown as string).split("\n");
							lines.splice(msg.startLine, msg.endLine - msg.startLine + 1, ...newLines);
							await applyEdit(lines.join("\n"));
							break;
						}

					case "diagramResized":
						{
							const text = document.getText();
							const blocks = findDiagramBlocks(text);
							let block: DiagramBlock | null = null;
							if (msg.diagramId) {
								block = blocks.find(b => extractDiagramId(b.xml) === msg.diagramId) || null;
							}
							if (!block && msg.blockIndex >= 0 && msg.blockIndex < blocks.length) {
								block = blocks[msg.blockIndex];
							}
							if (block) {
								const clampedWidth = msg.width != null ? Math.max(200, msg.width) : block.width;
								const newText = replaceDiagramBlock(text, block, block.xml, block.locked, undefined, clampedWidth);
								await applyEdit(newText);
							}
							break;
						}

					case "diagramFitted":
						{
							const text = document.getText();
							const blocks = findDiagramBlocks(text);
							let block: DiagramBlock | null = null;
							if (msg.diagramId) {
								block = blocks.find(b => extractDiagramId(b.xml) === msg.diagramId) || null;
							}
							if (!block && msg.blockIndex >= 0 && msg.blockIndex < blocks.length) {
								block = blocks[msg.blockIndex];
							}
							if (block) {
								const newWidth = msg.width != null ? msg.width : null;
								if (block.width !== newWidth) {
									const newText = replaceDiagramBlock(text, block, block.xml, block.locked, undefined, newWidth);
									await applyEdit(newText);
								}
							}
							break;
						}

					case "requestRefresh":
						sendContent();
						break;

					case "insertDiagram":
						{
							const text = document.getText();
							const xml = createEmptyDiagram();
							const snippet = buildDiagramBlock(xml, "fenced", false, null, DEFAULT_NEW_DIAGRAM_WIDTH);
							const lines = text.split("\n");
							const afterLine = msg.afterLine as number | undefined;

							let newText: string;
							if (afterLine != null && afterLine >= 0 && afterLine < lines.length) {
								const before = lines.slice(0, afterLine + 1).join("\n");
								const after = lines.slice(afterLine + 1).join("\n");
								newText = before + "\n\n" + snippet + "\n\n" + after;
							} else {
								newText = text.trimEnd() + "\n\n" + snippet + "\n";
							}

							await applyEdit(newText);

							// Find the newly inserted block and open it in the inline editor
							const updatedText = document.getText();
							const newBlocks = findDiagramBlocks(updatedText);
							let newBlockIndex = newBlocks.length - 1;
							if (afterLine != null && afterLine >= 0) {
								for (let i = 0; i < newBlocks.length; i++) {
									if (newBlocks[i].startLine > afterLine) {
										newBlockIndex = i;
										break;
									}
								}
							}

							if (newBlockIndex >= 0) {
								sendContent();
								webviewPanel.webview.postMessage({
									type: "scrollToAndEdit",
									blockIndex: newBlockIndex,
									isNew: true,
								});
							}
							break;
						}
				}
			}
		);

		const changeDisposable = vscode.workspace.onDidChangeTextDocument(e => {
			if (suppressUpdate) { return; }
			if (e.document.uri.toString() === document.uri.toString()) {
				sendContent();
			}
		});

		// Hide breadcrumbs when this custom editor is active
		function updateBreadcrumbs(active: boolean): void {
			const breadcrumbsConfig = vscode.workspace.getConfiguration("breadcrumbs");
			if (active) {
				breadcrumbsConfig.update("enabled", false, vscode.ConfigurationTarget.Global);
			} else {
				breadcrumbsConfig.update("enabled", undefined, vscode.ConfigurationTarget.Global);
			}
		}

		if (webviewPanel.active) { updateBreadcrumbs(true); }

		webviewPanel.onDidChangeViewState(e => {
			updateBreadcrumbs(e.webviewPanel.active);
		});

		webviewPanel.onDidDispose(() => {
			changeDisposable.dispose();
			updateBreadcrumbs(false);
			this.activePanels.delete(document.uri.toString());
		});
	}
}

class DiagramCodeLensProvider implements vscode.CodeLensProvider {
	provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
		if (document.languageId !== "markdown") { return []; }

		const text = document.getText();
		const blocks = findDiagramBlocks(text);
		const lenses: vscode.CodeLens[] = [];

		blocks.forEach((block, index) => {
			const range = new vscode.Range(block.startLine, 0, block.startLine, 0);

			// Edit action — opens full editor in a separate tab
			if (!block.locked) {
				lenses.push(new vscode.CodeLens(range, {
					title: "$(pencil) Edit Diagram",
					command: "drawio-inline-editor.editDiagram",
					arguments: [block.startLine, index],
				}));
			}

			// Preview action — opens read-only preview in a separate tab
			lenses.push(new vscode.CodeLens(range, {
				title: "$(eye) Preview",
				command: "drawio-inline-editor.previewDiagram",
				arguments: [block.startLine],
			}));

			// Inline Edit action — opens markdown editor scrolled to the diagram
			if (!block.locked) {
				lenses.push(new vscode.CodeLens(range, {
					title: "$(open-preview) Inline Edit",
					command: "drawio-inline-editor.inlinePreview",
					arguments: [index],
				}));
			}

			// Lock/Unlock action
			lenses.push(new vscode.CodeLens(range, {
				title: block.locked ? "$(lock) Unlock" : "$(unlock) Lock",
				command: "drawio-inline-editor.toggleLock",
				arguments: [block.startLine],
			}));
		});

		return lenses;
	}
}

class MermaidCodeLensProvider implements vscode.CodeLensProvider {
	provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
		if (document.languageId !== "markdown") { return []; }

		const text = document.getText();
		const blocks = findMermaidBlocks(text);
		const lenses: vscode.CodeLens[] = [];

		blocks.forEach((block, index) => {
			const range = new vscode.Range(block.startLine, 0, block.startLine, 0);

			lenses.push(new vscode.CodeLens(range, {
				title: "$(arrow-swap) Convert to draw.io",
				command: "drawio-inline-editor.convertMermaid",
				arguments: [block.startLine, index],
			}));
		});

		return lenses;
	}
}

export function deactivate(): void {
	if (activePanel) {
		activePanel.dispose();
	}
	if (localServer) {
		localServer.stop();
		localServer = null;
	}
}

export function extendMarkdownIt(md: any): any {
	try {
		return md.use(markdownItDrawio);
	} catch (err) {
		console.error("drawio-inline-editor: failed to load markdown-it plugin:", err);
		return md;
	}
}
