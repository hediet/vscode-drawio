import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import { Config } from "../Config";
import {
	VSCODE_PASSTHROUGH_COMMANDS,
	VSCODE_PASSTHROUGH_KEYS,
	isExternalLink,
} from "../vscodeShortcuts";
import { withConfigSetting } from "../drawioConfiguration";
import { appendEmbedParams } from "../utils/appendEmbedParams";
import { toScriptJson } from "../utils/toScriptJson";
import {
	DiagramBlock,
	SourceBlock,
	SourceLanguage,
	SOURCE_LANGUAGE_NAMES,
	ImageLink,
	findDiagramBlocks,
	createEmptyDiagram,
	isBlankDiagram,
	buildDiagramBlock,
	findSourceBlocks,
	createConversionDescriptor,
	findDiagramImageLinks,
	isLocalLinkTarget,
	isPngLinkTarget,
	extractDiagramId,
	extractDiagramXmlFromSvg,
	extractDiagramXmlFromPng,
	locateDiagramBlock,
} from "./diagramParser";
import { toggleLockAtLine } from "./diagramLock";
import { createLocalServer, LocalServer } from "./localServer";
import markdownItDrawio from "./markdownPlugin";
import {
	TextSection,
	buildTextSections,
	createRenderEnv,
	locateLines,
	splitLines,
} from "./markdownSections";

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

/** Pause before the Markdown editor shows changes made elsewhere (ms). */
const CONTENT_UPDATE_DELAY_MS = 150;

/**
 * Toggle to add dev=1 (and test=1 where applicable) to draw.io iframe URLs.
 * Enables unminified sources and debug features in the draw.io editor.
 */
const DEV_MODE = false;

let activePanel: vscode.WebviewPanel | null = null;
let localServer: LocalServer | null = null;

/** The block the Edit Diagram tab saves to, as last seen in the document. */
interface DiagramEditingContext {
	documentUri: vscode.Uri;
	blockIndex: number;
	diagramId: string | null;
	/** The block's XML in the document (what the tab loaded or last saved). */
	xml: string;
}

/** The Mermaid / PlantUML block the conversion tab replaces on its first save. */
interface SourceEditingContext {
	documentUri: vscode.Uri;
	sourceIndex: number;
	sourceBlock: SourceBlock;
}

let editingContext: DiagramEditingContext | SourceEditingContext | null = null;

/**
 * Resolves a Markdown image-link target to an editable, same-repo `.drawio.svg`
 * or `.drawio.png` file: the file must be local, inside the document's workspace
 * folder (same repo), exist, and carry an embedded diagram (the SVG `content`
 * attribute, or a PNG `tEXt`/`zTXt` "mxfile" chunk). Returns the resolved file
 * URI and the embedded XML, or null otherwise (remote URLs, out-of-repo paths
 * and plain SVG/PNG images are left as ordinary images).
 */
function resolveEditableDiagramLink(
	target: string,
	docUri: vscode.Uri
): { fileUri: vscode.Uri; xml: string; isPng: boolean } | null {
	if (!isLocalLinkTarget(target)) { return null; }

	// Drop any ?query/#fragment and percent-decode the path
	let rel = target.replace(/[?#].*$/, "");
	try { rel = decodeURIComponent(rel); } catch (e) { /* keep raw on bad escape */ }

	const docDir = path.dirname(docUri.fsPath);
	const resolved = path.isAbsolute(rel) ? rel : path.resolve(docDir, rel);

	// Must stay within the document's workspace folder (same repo)
	const folder = vscode.workspace.getWorkspaceFolder(docUri);
	if (!folder) { return null; }
	const relToRoot = path.relative(folder.uri.fsPath, resolved);
	if (relToRoot.startsWith("..") || path.isAbsolute(relToRoot)) { return null; }

	const isPng = isPngLinkTarget(resolved);
	const isSvg = /\.drawio\.svg$/i.test(resolved);
	if (!isPng && !isSvg) { return null; }

	const xml = readLinkedDiagramXml(resolved, isPng);
	if (!xml) { return null; }

	return { fileUri: vscode.Uri.file(resolved), xml, isPng };
}

/**
 * Diagram XML of linked image files by path, kept while the file's size and
 * modification time stay the same: the Markdown editor resolves every link on
 * each update, which would otherwise read and decode every file each time.
 */
const linkedDiagramCache = new Map<string, { mtimeMs: number; size: number; xml: string | null }>();

function readLinkedDiagramXml(fsPath: string, isPng: boolean): string | null {
	let stat: fs.Stats;
	try {
		stat = fs.statSync(fsPath);
	} catch (e) {
		linkedDiagramCache.delete(fsPath);
		return null;
	}
	const cached = linkedDiagramCache.get(fsPath);
	if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
		return cached.xml;
	}

	let xml: string | null = null;
	try {
		xml = isPng
			? extractDiagramXmlFromPng(fs.readFileSync(fsPath))
			: extractDiagramXmlFromSvg(fs.readFileSync(fsPath, "utf8"));
	} catch (e) { xml = null; }
	linkedDiagramCache.set(fsPath, { mtimeMs: stat.mtimeMs, size: stat.size, xml });
	return xml;
}

/** Case-fold + normalize an fsPath for comparison. On case-insensitive
 * filesystems (macOS/Windows) a link target's casing can differ from the
 * on-disk casing, so the watcher's membership/self-write checks must fold case. */
function caseFold(p: string): string {
	return (process.platform === "win32" || process.platform === "darwin")
		? path.normalize(p).toLowerCase()
		: path.normalize(p);
}

/** Content fingerprint of file bytes — lets the file watcher recognize our own
 * writes by content (not by a timing window), so a genuine external change is
 * never mistaken for a self-write echo regardless of FS-event latency. */
function hashBytes(bytes: Uint8Array): string {
	return crypto.createHash("sha1").update(bytes).digest("hex");
}

/**
 * The draw.io UI theme, resolved from the shared `hediet.vscode-drawio.theme`
 * setting exactly like the standalone editor — so the full inline editors render
 * with the SAME theme. Legacy 'dark'/'automatic' collapse to 'kennedy' (dark mode
 * is handled separately via the dark= param).
 */
function resolveDrawioUiTheme(): string {
	const t = vscode.workspace
		.getConfiguration("hediet.vscode-drawio")
		.get<string>("theme", "kennedy")!
		.toLowerCase();
	return t === "dark" || t === "automatic" ? "kennedy" : t;
}

/**
 * The draw.io UI language, derived from VS Code's locale the SAME way the
 * standalone editor does (Config.drawioLanguage), so the inline and standalone
 * editors show the same language. draw.io reads this from the `lang` URL param.
 */
function resolveDrawioLanguage(): string {
	if (vscode.env.language.toLowerCase() === "zh-tw") {
		// See https://github.com/hediet/vscode-drawio/issues/231 — exception;
		// all other language codes are just the language, not the country.
		return "zh-tw";
	}
	return vscode.env.language.split("-")[0].toLowerCase();
}

// Cached so we don't leak a theme listener (Config's constructor registers one)
// on every editor open.
let _sharedDrawioConfig: Config | undefined;

/**
 * The user's draw.io configuration (styles, default vertex/edge styles, custom
 * fonts, colors, …) read the SAME way the standalone editor does (via
 * DiagramConfig), so the inline and full inline editors stay consistent with it.
 * Returned as a plain object to merge into the embed `configure` response.
 * (customLibraries is async and intentionally omitted here.)
 */
function getDrawioUserConfig(
	globalState: vscode.Memento,
	uri: vscode.Uri
): Record<string, unknown> {
	if (!_sharedDrawioConfig) { _sharedDrawioConfig = new Config(globalState); }
	const dc = _sharedDrawioConfig.getDiagramConfig(uri);
	// With the options of the hediet.vscode-drawio.config setting
	return withConfigSetting(uri, {
		styles: dc.styles,
		customColorSchemes: dc.customColorSchemes,
		defaultVertexStyle: dc.defaultVertexStyle,
		defaultEdgeStyle: dc.defaultEdgeStyle,
		colorNames: dc.colorNames,
		presetColors: dc.presetColors,
		customFonts: dc.customFonts,
		zoomFactor: dc.zoomFactor,
		globalVars: (dc.globalVars as Record<string, string>) ?? undefined,
		// Chords draw.io should forward to VS Code instead of handling itself
		// (online/cross-origin path; offline uses the injected script). See
		// vscodeShortcuts.ts.
		passThroughKeys: VSCODE_PASSTHROUGH_KEYS,
		// The VS Code webview blocks new windows/tabs: draw.io forwards link
		// clicks via {event:'openLink'} instead of window.open. See
		// Editor.suppressNewWindows.
		suppressNewWindows: true,
		// Print needs a popup/modal the webview sandbox blocks, so hide it.
		hideMenuItems: ["print"],
	});
}

/**
 * Decodes a draw.io xmlsvg/xmlpng export (a complete editable SVG or PNG) for
 * writing to a `.drawio.svg` / `.drawio.png` file. The export is a base64 data
 * URI (`data:image/svg+xml;base64,...` or `data:image/png;base64,...`); this
 * returns the raw file bytes, or null if the data URI is unexpected.
 */
function decodeExportedImage(dataUri: string): Buffer | null {
	if (!dataUri) { return null; }
	let m = dataUri.match(/^data:image\/svg\+xml;base64,(.*)$/);
	if (m) { return Buffer.from(m[1], "base64"); }
	m = dataUri.match(/^data:image\/png;base64,(.*)$/);
	if (m) { return Buffer.from(m[1], "base64"); }
	const u = dataUri.match(/^data:image\/svg\+xml(?:;charset=[^,]+)?,(.*)$/);
	if (u) { return Buffer.from(decodeURIComponent(u[1]), "utf8"); }
	if (dataUri.trimStart().startsWith("<")) { return Buffer.from(dataUri, "utf8"); }
	return null;
}

/**
 * Handle a "vscodeShortcut" message forwarded from the draw.io iframe
 * via the outer webview.  Returns true if the message was handled.
 */
function handleForwardedMessage(msg: { type: string; command?: string; href?: string; message?: string }): boolean {
	if (msg.type === "vscodeShortcut" && msg.command) {
		// Any frame in the webview can post this (the webview cannot always
		// tell the frames apart), so only the pass-through chords' commands run.
		if (VSCODE_PASSTHROUGH_COMMANDS.has(msg.command)) {
			vscode.commands.executeCommand(msg.command);
		}
		return true;
	}
	if (msg.type === "openLink" && msg.href) {
		// Link click forwarded from draw.io (suppressNewWindows mode): open it in
		// the host's default browser instead of a new tab/window.
		if (isExternalLink(msg.href)) {
			vscode.env.openExternal(vscode.Uri.parse(msg.href));
		}
		return true;
	}
	if (msg.type === "conversionFailed" && msg.message) {
		// A mermaid/plantuml block the inline editor could not convert: the
		// webview has put the source block back, this says why
		vscode.window.showErrorMessage(msg.message);
		return true;
	}
	return false;
}

/** Converts the line breaks of text to the document's line terminator. */
function withEol(document: vscode.TextDocument, text: string): string {
	return text.replace(/\r?\n/g, document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n");
}

/** Lines first..last including their line break (for deleting them). */
function wholeLinesRange(document: vscode.TextDocument, first: number, last: number): vscode.Range {
	if (last + 1 < document.lineCount) {
		return new vscode.Range(first, 0, last + 1, 0);
	}
	if (first > 0) {
		return new vscode.Range(first - 1, document.lineAt(first - 1).text.length, last, document.lineAt(last).text.length);
	}
	return new vscode.Range(0, 0, last, document.lineAt(last).text.length);
}

/** The range between two character offsets of the document. */
function offsetRange(document: vscode.TextDocument, start: number, end: number): vscode.Range {
	return new vscode.Range(document.positionAt(start), document.positionAt(end));
}

/**
 * An edit that replaces only the given diagram block (not the whole
 * document), and the block's last line after the edit.
 */
function diagramBlockEdit(
	document: vscode.TextDocument,
	block: DiagramBlock,
	xml: string,
	locked: boolean,
	height: number | null,
	width: number | null
): { edit: vscode.WorkspaceEdit; newEndLine: number } {
	const blockText = buildDiagramBlock(xml, block.format, locked, height, width);
	const edit = new vscode.WorkspaceEdit();
	edit.replace(document.uri, offsetRange(document, block.index, block.index + block.fullMatch.length), withEol(document, blockText));
	return { edit, newEndLine: block.startLine + blockText.split("\n").length - 1 };
}

/** Settings section shared with the main draw.io editor. */
const DRAWIO_CONFIG_SECTION = "hediet.vscode-drawio";

/** Whether the bundled (offline) editor should be used, per the shared setting. */
function isOfflineMode(): boolean {
	return vscode.workspace
		.getConfiguration(DRAWIO_CONFIG_SECTION)
		.get<boolean>("offline", true);
}

/** The configured online draw.io URL (trailing slashes stripped), per the shared setting. */
function getOnlineUrl(): string {
	const url = vscode.workspace
		.getConfiguration(DRAWIO_CONFIG_SECTION)
		.get<string>("online-url", "https://embed.diagrams.net/")!;
	return url.replace(/\/+$/, "");
}

/**
 * Resolves the draw.io editor URL for the inline editor.
 *
 * Honors the shared `hediet.vscode-drawio.offline` setting: when offline
 * (the default) the bundled draw.io webapp is served from a local HTTP
 * server; otherwise the configured `hediet.vscode-drawio.online-url` is used.
 *
 * The local server URL is passed through `asExternalUri` so it works in
 * remote/Codespaces/web contexts (where `127.0.0.1` in the webview points at
 * the client, not the extension host): VS Code forwards it to a tunnel.
 */
async function getEditorUrl(context: vscode.ExtensionContext): Promise<string> {
	if (isOfflineMode()) {
		const webappRoot = path.join(context.extensionPath, "drawio", "src", "main", "webapp");
		if (fs.existsSync(webappRoot)) {
			if (!localServer) {
				localServer = createLocalServer(webappRoot);
			}
			// Also waits for a start that is still in progress
			const port = await localServer.start();
			const local = vscode.Uri.parse(`http://127.0.0.1:${port}`);
			const external = await vscode.env.asExternalUri(local);
			return external.toString().replace(/\/$/, "");
		}
		console.warn("drawio-inline-editor: local drawio webapp not found, falling back to online editor");
	}

	return getOnlineUrl();
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

	// CodeLens provider for mermaid and plantuml blocks
	const sourceCodeLensProvider = new SourceCodeLensProvider();
	context.subscriptions.push(
		vscode.languages.registerCodeLensProvider(
			{ language: "markdown", scheme: "file" },
			sourceCodeLensProvider
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
		if (isOfflineMode()) {
			const webappRoot = path.join(context.extensionPath, "drawio", "src", "main", "webapp");
			if (fs.existsSync(webappRoot)) {
				if (!localServer) {
					localServer = createLocalServer(webappRoot);
				}
				localServer.start().catch(err =>
					console.error("drawio-inline-editor: failed to pre-start local server:", err)
				);
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

					// The block index and diagram ID, where they agree (several
					// blocks can share an ID when a block was copied)
					if (diagramIdParam || hasBlockIndex) {
						const located = locateDiagramBlock(blocks, hasBlockIndex ? blockIndex : -1, diagramIdParam);
						if (located) { return located; }
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

	// Commands: Convert Mermaid / PlantUML to draw.io
	const convertSource = (language: SourceLanguage, lineOrUri: unknown): void => {
		let doc: vscode.TextDocument | null = null;
		const editor = vscode.window.activeTextEditor;
		const name = SOURCE_LANGUAGE_NAMES[language];

		if (editor && editor.document.languageId === "markdown") {
			doc = editor.document;
		}

		if (!doc) {
			vscode.window.showWarningMessage(`Open a Markdown file to convert a ${name} diagram.`);
			return;
		}

		// The CodeLens passes the block's start line; from the command
		// palette the block at the cursor is converted
		const line = typeof lineOrUri === "number" ? lineOrUri : editor!.selection.active.line;
		const block = findSourceBlocks(doc.getText()).find(b =>
			b.language === language && line >= b.startLine && line <= b.endLine);

		if (!block) {
			vscode.window.showWarningMessage(`No ${name} code block found.`);
			return;
		}

		openSourceEditor(context, doc, block);
	};

	context.subscriptions.push(
		vscode.commands.registerCommand("drawio-inline-editor.convertMermaid", (lineOrUri: unknown) => {
			convertSource("mermaid", lineOrUri);
		}),
		vscode.commands.registerCommand("drawio-inline-editor.convertPlantUml", (lineOrUri: unknown) => {
			convertSource("plantuml", lineOrUri);
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

	editingContext = {
		documentUri: document.uri,
		blockIndex: findDiagramBlocks(document.getText()).findIndex(b => b.index === block.index),
		diagramId: extractDiagramId(block.xml),
		xml: block.xml,
	};

	const config = vscode.workspace.getConfiguration("drawio-inline-editor");
	const editorUrl = await getEditorUrl(context);
	const autoLock = config.get<boolean>("autoLock", false)!;
	const devMode = DEV_MODE;

	const isDark = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark
		|| vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast;

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
	html = html.replace(/\{\{nonce\}\}/g, nonce);

	// Allow the iframe to load from the resolved editor origin (the local server
	// — possibly an asExternalUri tunnel — or the online draw.io hosts).
	const editorOrigin = new URL(editorUrl).origin;
	html = html.replace(
		/frame-src[^;]+;/,
		`frame-src ${editorOrigin} http://127.0.0.1:* https://*.draw.io https://*.diagrams.net;`
	);

	// Pre-build the iframe URL so it starts loading immediately.
	let iframeSrc = appendEmbedParams(editorUrl, "embed=1&proto=json&spin=1&configure=1&libraries=1&saveAndExit=1&tooltips=0"
		+ "&ui=" + encodeURIComponent(resolveDrawioUiTheme()) + "&lang=" + encodeURIComponent(resolveDrawioLanguage()));
	if (devMode) { iframeSrc += "&dev=1&test=1"; }
	if (isDark) { iframeSrc += "&dark=1"; }
	html = html.replace("{{iframeSrc}}", iframeSrc);
	// The user\'s draw.io configuration (a function, as the JSON can have $ patterns)
	html = html.replace("{{drawioConfig}}", () => toScriptJson(getDrawioUserConfig(context.globalState, document.uri)));

	activePanel.webview.html = html;

	activePanel.webview.onDidReceiveMessage(
		async (msg) => {
			if (handleForwardedMessage(msg)) return;
			switch (msg.type) {
				case "webviewReady":
					activePanel!.webview.postMessage({
						type: "loadDiagram",
						xml: block.xml,
						locked: block.locked,
						isBlank: isBlankDiagram(block.xml),
						editorUrl,
						isDark,
						devMode,
					});
					break;

				case "save":
					await saveDiagram(msg.xml, autoLock);
					break;

				case "saveAndClose":
					// Stays open if the diagram could not be saved
					if (await saveDiagram(msg.xml, autoLock)) {
						activePanel?.dispose();
					}
					break;

				case "cancel":
					activePanel!.dispose();
					break;
			}
		}
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
 * Saves the Edit Diagram tab to its block. The block is found again by its
 * index, page id and XML, so edits to the Markdown file in the meantime are
 * fine; if it can't be identified the diagram is not saved anywhere else.
 */
async function saveDiagram(newXml: string, autoLock: boolean): Promise<boolean> {
	const ctx = editingContext;
	if (!ctx || !("xml" in ctx)) { return false; }

	// Re-open the document by URI: the editor may have been closed meanwhile
	const document = await vscode.workspace.openTextDocument(ctx.documentUri);
	const blocks = findDiagramBlocks(document.getText());
	const block = locateDiagramBlock(blocks, ctx.blockIndex, ctx.diagramId, ctx.xml);
	if (!block) {
		vscode.window.showErrorMessage(
			"The diagram was not saved: its block in the Markdown file was removed or can't be told apart from a copy of it.");
		return false;
	}

	const locked = autoLock || block.locked;
	if (!(await vscode.workspace.applyEdit(diagramBlockEdit(document, block, newXml, locked, block.height, block.width).edit))) {
		return false;
	}
	ctx.blockIndex = blocks.indexOf(block);
	ctx.diagramId = extractDiagramId(newXml);
	ctx.xml = newXml.trim();
	return true;
}

/**
 * Opens the draw.io editor with mermaid or plantuml source, converting it to a
 * draw.io diagram. When saved, replaces the source block with a drawio block.
 */
async function openSourceEditor(
	context: vscode.ExtensionContext,
	document: vscode.TextDocument,
	sourceBlock: SourceBlock
): Promise<void> {
	if (activePanel) {
		activePanel.dispose();
	}

	// Store the source block as the editing context so saveSourceDiagram can find it
	editingContext = {
		documentUri: document.uri,
		sourceIndex: findSourceBlocks(document.getText()).findIndex(b => b.index === sourceBlock.index),
		sourceBlock,
	};

	const editorUrl = await getEditorUrl(context);
	const devMode = DEV_MODE;

	const isDark = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark
		|| vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast;

	activePanel = vscode.window.createWebviewPanel(
		"drawio-inline-editor.editor",
		`Convert ${SOURCE_LANGUAGE_NAMES[sourceBlock.language]} to Draw.io`,
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
	let iframeSrc = appendEmbedParams(editorUrl, "embed=1&proto=json&spin=1&configure=1&libraries=1&saveAndExit=1&tooltips=0"
		+ "&ui=" + encodeURIComponent(resolveDrawioUiTheme()) + "&lang=" + encodeURIComponent(resolveDrawioLanguage()));
	if (devMode) { iframeSrc += "&dev=1&test=1"; }
	if (isDark) { iframeSrc += "&dark=1"; }
	html = html.replace("{{iframeSrc}}", iframeSrc);
	// The user\'s draw.io configuration (a function, as the JSON can have $ patterns)
	html = html.replace("{{drawioConfig}}", () => toScriptJson(getDrawioUserConfig(context.globalState, document.uri)));

	activePanel.webview.html = html;

	activePanel.webview.onDidReceiveMessage(
		async (msg) => {
			if (handleForwardedMessage(msg)) return;
			switch (msg.type) {
				case "webviewReady":
					activePanel!.webview.postMessage({
						type: "loadSource",
						descriptor: createConversionDescriptor(sourceBlock),
						editorUrl,
						isDark,
						devMode,
					});
					break;

				case "save":
					await saveSourceDiagram(msg.xml);
					break;

				case "saveAndClose":
					// Stays open if the diagram could not be saved
					if (await saveSourceDiagram(msg.xml)) {
						activePanel?.dispose();
					}
					break;

				case "cancel":
					activePanel!.dispose();
					break;
			}
		}
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
 * Saves the converted diagram. The first save replaces the source block with
 * a drawio block, later saves of the same tab update that diagram block.
 */
async function saveSourceDiagram(newXml: string): Promise<boolean> {
	const ctx = editingContext;
	if (!ctx) { return false; }
	if ("xml" in ctx) { return saveDiagram(newXml, false); }

	const document = await vscode.workspace.openTextDocument(ctx.documentUri);
	const sources = findSourceBlocks(document.getText());
	const original = ctx.sourceBlock;
	const same = sources.filter(b => b.language === original.language && b.source === original.source);
	const atIndex = sources[ctx.sourceIndex];
	const block = atIndex && same.includes(atIndex) ? atIndex : same.length === 1 ? same[0] : null;
	if (!block) {
		vscode.window.showErrorMessage(
			`The diagram was not saved: the ${SOURCE_LANGUAGE_NAMES[original.language]} block in the Markdown file was changed or removed.`);
		return false;
	}

	const blockText = buildDiagramBlock(newXml, "fenced", false);
	const edit = new vscode.WorkspaceEdit();
	edit.replace(document.uri, offsetRange(document, block.index, block.index + block.fullMatch.length), withEol(document, blockText));
	if (!(await vscode.workspace.applyEdit(edit))) { return false; }

	// From now on the tab edits the new diagram block
	if (editingContext === ctx) {
		editingContext = {
			documentUri: ctx.documentUri,
			blockIndex: findDiagramBlocks(document.getText()).findIndex(b => b.index === block.index),
			diagramId: extractDiagramId(newXml),
			xml: newXml.trim(),
		};
	}
	return true;
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

	const lightboxUrl = appendEmbedParams(editorUrl, `lightbox=1&toolbar=0&configure=1&embed=1&proto=json&spin=1&pv=0&grid=0&border=60&tooltips=0${devMode ? "&dev=1&test=1" : ""}${isDark ? "&dark=1" : ""}&lang=${encodeURIComponent(resolveDrawioLanguage())}`);

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
              // Transparent unless the diagram has a background color
              // (transparent=1 would drop that color too)
              defaultPageBackgroundColor: 'transparent',
              defaultDarkPageBackgroundColor: 'transparent',
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
		const editorUrl = await getEditorUrl(context);
		const devMode = DEV_MODE;
		const isDark = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark
			|| vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast;

		// Edits of this editor in progress: their change events are echoes
		let ownEdits = 0;

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
		let iframeSrc = appendEmbedParams(editorUrl, "embed=1&proto=json&spin=1&configure=1&libraries=1&saveAndExit=1&tooltips=0"
		+ "&ui=" + encodeURIComponent(resolveDrawioUiTheme()) + "&lang=" + encodeURIComponent(resolveDrawioLanguage()));
		if (devMode) { iframeSrc += "&dev=1&test=1"; }
		if (isDark) { iframeSrc += "&dark=1"; }
		html = html.replace("{{iframeSrc}}", iframeSrc);
	// The user\'s draw.io configuration (a function, as the JSON can have $ patterns)
	html = html.replace("{{drawioConfig}}", () => toScriptJson(getDrawioUserConfig(context.globalState, document.uri)));

		webviewPanel.webview.html = html;

		webviewPanel.webview.onDidReceiveMessage(
			async (msg) => {
				if (handleForwardedMessage(msg)) return;
				switch (msg.type) {
					case "webviewReady":
						webviewPanel.webview.postMessage({
							type: "loadDiagram",
							xml: document.getText(),
							locked: false,
							editorUrl,
							isDark,
							devMode,
							mode: "customEditor",
						});
						break;

					case "save":
					case "autosave":
						if (msg.xml) {
							const edit = new vscode.WorkspaceEdit();
							edit.replace(document.uri, offsetRange(document, 0, document.getText().length), msg.xml);
							// The change event fires before applyEdit resolves
							ownEdits++;
							try {
								await vscode.workspace.applyEdit(edit);
							} finally {
								ownEdits--;
							}
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
			if (ownEdits > 0 || e.contentChanges.length === 0) { return; }
			if (e.document.uri.toString() === document.uri.toString()) {
				webviewPanel.webview.postMessage({
					type: "loadDiagram",
					xml: document.getText(),
					locked: false,
					editorUrl,
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

		// Edits of this editor in progress: their change events are echoes of
		// what the webview already shows (the event fires before applyEdit
		// resolves), so they are not sent back to it.
		let ownEdits = 0;

		// Case-folded fsPaths of the linked .drawio.svg/.png files referenced by
		// editable image links in this document (recomputed each sendContent) — the
		// file watcher only reacts to changes of these.
		const linkedFilePaths = new Set<string>();
		// Content hashes of linked files THIS panel just wrote (case-folded fsPath →
		// sha1), so the watcher ignores its own write echoes, per panel.
		const recentLinkWrites = new Map<string, string>();

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

		let contentTimer: NodeJS.Timeout | undefined;

		const sendContent = (): void => {
			if (contentTimer) {
				clearTimeout(contentTimer);
				contentTimer = undefined;
			}
			const imageBaseUri = webviewPanel.webview.asWebviewUri(
				vscode.Uri.file(docDir)
			).toString();
			const text = document.getText();
			const lines = splitLines(text);
			const env = createRenderEnv(text, imageBaseUri);
			const diagramBlocks = findDiagramBlocks(text);
			const sourceBlocks = findSourceBlocks(text);

			// Editable image links: ![alt](*.drawio.svg) / ![alt](*.drawio.png) on
			// their own line that resolve to a same-repo file are edited inline like
			// a codeblock and written back to the linked file. Inline (mid-paragraph),
			// remote or out-of-repo links stay as ordinary images.
			linkedFilePaths.clear();
			const imageLinks = findDiagramImageLinks(text)
				.map((lk) => {
					const ownLine = lk.startLine === lk.endLine
						&& lines[lk.startLine] !== undefined
						&& lines[lk.startLine].trim() === lk.fullMatch.trim();
					if (!ownLine) { return null; }
					const resolved = resolveEditableDiagramLink(lk.target, document.uri);
					if (!resolved) { return null; }
					linkedFilePaths.add(caseFold(resolved.fileUri.fsPath));
					return { ...lk, xml: resolved.xml };
				})
				.filter((x): x is ImageLink & { xml: string } => x != null);

			// Merge diagram, source and editable-image-link blocks by position
			const allBlocks = [
				...diagramBlocks.map((b, i) => ({ ...b, sectionType: "diagram" as const, blockIndex: i })),
				...sourceBlocks.map((b, i) => ({ ...b, sectionType: "source" as const, sourceIndex: i })),
				...imageLinks.map((b, i) => ({ ...b, sectionType: "imageLink" as const, linkIndex: i })),
			];
			allBlocks.sort((a, b) => a.index - b.index);
			const sections: Array<TextSection | Record<string, unknown>> = [];
			let currentLine = 0;

			for (const block of allBlocks) {
				// The text before the block, one section per Markdown block
				if (currentLine < block.startLine) {
					sections.push(...buildTextSections(lines, currentLine, block.startLine - 1, env));
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
				} else if (block.sectionType === "source") {
					sections.push({
						type: "source",
						sourceIndex: block.sourceIndex,
						language: block.language,
						source: block.source,
						descriptor: createConversionDescriptor(block),
						startLine: block.startLine,
						endLine: block.endLine,
					});
				} else if (block.sectionType === "imageLink") {
					// Rendered as a normal diagram so the inline editor works
					// unchanged; linkTarget routes saves to the .drawio.svg/.png file. The
					// blockIndex continues past the codeblock diagrams so it can't
					// clash with them.
					sections.push({
						type: "diagram",
						blockIndex: diagramBlocks.length + block.linkIndex,
						xml: block.xml,
						locked: false,
						height: null,
						width: null,
						startLine: block.startLine,
						endLine: block.endLine,
						format: "fenced",
						diagramId: extractDiagramId(block.xml),
						linkTarget: block.target,
					});
				}

				currentLine = block.endLine + 1;
			}

			if (currentLine < lines.length) {
				sections.push(...buildTextSections(lines, currentLine, lines.length - 1, env));
			}

			webviewPanel.webview.postMessage({
				type: "updateContent",
				sections: sections,
				imageBaseUri: imageBaseUri,
			});
		};

		// Changes from elsewhere (the text editor, git, linked files) are shown
		// after a short pause instead of on every keystroke.
		const scheduleContent = (): void => {
			if (contentTimer) { clearTimeout(contentTimer); }
			contentTimer = setTimeout(sendContent, CONTENT_UPDATE_DELAY_MS);
		};

		const applyOwnEdit = async (edit: vscode.WorkspaceEdit): Promise<boolean> => {
			ownEdits++;
			try {
				return await vscode.workspace.applyEdit(edit);
			} finally {
				ownEdits--;
			}
		};

		/**
		 * Tells the webview that the block on lines [startLine, oldEndLine] now
		 * ends at newEndLine, so it moves the line numbers of what follows.
		 */
		const postLinesChanged = (startLine: number, oldEndLine: number, newEndLine: number): void => {
			if (newEndLine !== oldEndLine) {
				webviewPanel.webview.postMessage({ type: "linesChanged", startLine, oldEndLine, newEndLine });
			}
		};

		/** The diagram block a webview message is about, or null (and a refresh). */
		const locateBlock = (msg: { blockIndex: number; diagramId?: string | null }): DiagramBlock | null => {
			const block = locateDiagramBlock(findDiagramBlocks(document.getText()), msg.blockIndex, msg.diagramId);
			if (!block) {
				console.warn("drawio-inline-editor: diagram block not found, refreshing the editor", msg.blockIndex, msg.diagramId);
				sendContent();
			}
			return block;
		};

		const replaceBlock = async (
			block: DiagramBlock,
			xml: string,
			height: number | null,
			width: number | null
		): Promise<void> => {
			const { edit, newEndLine } = diagramBlockEdit(document, block, xml, block.locked, height, width);
			if (await applyOwnEdit(edit)) {
				postLinesChanged(block.startLine, block.endLine, newEndLine);
			}
		};

		const handleMessage = async (msg: any): Promise<void> => {
			if (handleForwardedMessage(msg)) { return; }
			switch (msg.type) {
				case "previewReady":
					webviewPanel.webview.postMessage({
						type: "setDevMode",
						devMode: DEV_MODE,
					});
					webviewPanel.webview.postMessage({
						type: "setEditorUrl",
						url: editorUrl,
						uiTheme: resolveDrawioUiTheme(),
						lang: resolveDrawioLanguage(),
					});
					webviewPanel.webview.postMessage({
						type: "setDrawioConfig",
						config: getDrawioUserConfig(context.globalState, document.uri),
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
					webviewPanel.webview.postMessage({
						type: "setSvgAppearance",
						appearance: vscode.workspace
							.getConfiguration(DRAWIO_CONFIG_SECTION, document.uri)
							.get<string>("svgAppearance", "light"),
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
					if (msg.sourceIndex != null) {
						// Source conversion: replace the mermaid/plantuml block with a
						// drawio block. The index is checked against the source text,
						// as converting a block moves the indices of the ones after it.
						const sBlocks = findSourceBlocks(document.getText());
						const atIndex = sBlocks[msg.sourceIndex];
						const sameSource = sBlocks.filter(b => b.source === msg.source);
						const sBlock = msg.source == null || (atIndex && atIndex.source === msg.source)
							? atIndex
							: sameSource.length === 1 ? sameSource[0] : undefined;
						if (!sBlock) {
							sendContent();
							break;
						}

						const blockText = buildDiagramBlock(msg.xml, "fenced", false, msg.height, msg.width);
						const edit = new vscode.WorkspaceEdit();
						edit.replace(document.uri, offsetRange(document, sBlock.index, sBlock.index + sBlock.fullMatch.length), withEol(document, blockText));
						if (!(await applyOwnEdit(edit))) { break; }
						postLinesChanged(sBlock.startLine, sBlock.endLine, sBlock.startLine + blockText.split("\n").length - 1);

						// Send targeted sourceConverted message for in-place DOM replacement
						// (avoids full re-render which resets scroll position)
						const newDiagramBlocks = findDiagramBlocks(document.getText());
						const bIdx = newDiagramBlocks.findIndex(b => b.index === sBlock.index);
						if (bIdx >= 0) {
							const newBlock = newDiagramBlocks[bIdx];
							webviewPanel.webview.postMessage({
								type: "sourceConverted",
								sourceIndex: msg.sourceIndex,
								blockIndex: bIdx,
								xml: msg.xml,
								locked: false,
								height: newBlock.height,
								width: newBlock.width,
								startLine: newBlock.startLine,
								endLine: newBlock.endLine,
								format: newBlock.format,
								diagramId: extractDiagramId(msg.xml),
							});
						}
					} else {
						const block = locateBlock(msg);
						if (block) {
							await replaceBlock(block, msg.xml, block.height, block.width);
						}
					}
					break;

				case "diagramLinkEdited":
					{
						// An editable image link was saved: write the exported
						// editable image back to the linked same-repo .drawio.svg /
						// .drawio.png file (re-resolved from the link target, so a
						// moved/renamed file is handled safely). The markdown is left
						// untouched.
						const r = resolveEditableDiagramLink(msg.target as string, document.uri);
						if (r && msg.svg) {
							const bytes = decodeExportedImage(msg.svg as string);
							if (bytes) {
								try {
									// If the linked .drawio.svg is ALSO open in another editor
									// with unsaved changes (e.g. the full-tab draw.io editor), a
									// direct disk write would make that editor's in-memory document
									// stale — VS Code won't reload a dirty document, so its save hits
									// the "content is newer" conflict and its merge-on-change never
									// runs. Instead apply the change as a WorkspaceEdit: that updates
									// the open document in place, fires onDidChangeTextDocument, and
									// lets the other editor merge it. Persisting happens via that
									// document's own save. (PNG has no TextDocument, so it always
									// falls through to a disk write.)
									const key = caseFold(r.fileUri.fsPath);
									const openDoc = vscode.workspace.textDocuments.find(
										d => caseFold(d.uri.fsPath) === key);
									if (openDoc && openDoc.isDirty && !r.isPng) {
										const edit = new vscode.WorkspaceEdit();
										edit.replace(r.fileUri,
											new vscode.Range(0, 0, openDoc.lineCount, 0),
											bytes.toString("utf8"));
										await vscode.workspace.applyEdit(edit);
									} else {
										// Record the bytes we're writing so the watcher can
										// recognize this self-write by content and ignore its
										// own echo (a genuine concurrent external write has
										// different bytes and still refreshes).
										recentLinkWrites.set(key, hashBytes(bytes));
										await vscode.workspace.fs.writeFile(r.fileUri, bytes);
									}
								} catch (e) {
									vscode.window.showErrorMessage(
										`draw.io: failed to write ${path.basename(r.fileUri.fsPath)}: ${e}`);
								}
							}
						}
						break;
					}

				case "openLinkedFile":
					{
						// Preview button on a linked diagram: open the linked image
						// file in VS Code's built-in image preview tab (beside the
						// editor) instead of the draw.io lightbox viewer.
						const r = resolveEditableDiagramLink(msg.target as string, document.uri);
						if (r) {
							try {
								await vscode.commands.executeCommand(
									"vscode.openWith", r.fileUri, "imagePreview.previewEditor",
									vscode.ViewColumn.Beside);
							} catch (e) {
								await vscode.commands.executeCommand(
									"vscode.open", r.fileUri, vscode.ViewColumn.Beside);
							}
						}
						break;
					}

				case "textEdited":
					{
						// The Markdown source of one block, edited in the webview. Only
						// its lines are replaced. They are checked against the text the
						// webview started from, and searched for nearby if lines above
						// were added or removed in the meantime.
						const lines = splitLines(document.getText());
						const oldLines = String(msg.oldMarkdown).split("\n");
						const start = locateLines(lines, msg.startLine, oldLines);
						if (start < 0) {
							vscode.window.showWarningMessage(
								"Draw.io: the text was changed in another editor at the same time, so this edit was not applied.");
							sendContent();
							break;
						}
						const end = start + oldLines.length - 1;
						const markdown = String(msg.markdown);
						const edit = new vscode.WorkspaceEdit();
						if (markdown === "") {
							// The block was emptied: remove its lines, and one of the
							// blank lines around it so no double blank line is left
							const blankBefore = start > 0 && lines[start - 1].trim() === "";
							const blankAfter = end + 1 < lines.length && lines[end + 1].trim() === "";
							edit.delete(document.uri, wholeLinesRange(document, start, blankBefore && blankAfter ? end + 1 : end));
						} else {
							edit.replace(document.uri, new vscode.Range(start, 0, end, lines[end].length), withEol(document, markdown));
						}
						// The webview moved its line numbers for the edit; where it
						// could not know the result, it gets the document anew
						if (await applyOwnEdit(edit) && (start !== msg.startLine || markdown === "")) {
							sendContent();
						}
						break;
					}

				case "diagramResized":
					{
						const block = locateBlock(msg);
						if (block) {
							const clampedWidth = msg.width != null ? Math.max(200, msg.width) : block.width;
							await replaceBlock(block, block.xml, block.height, clampedWidth);
						}
						break;
					}

				case "diagramFitted":
					{
						const block = locateBlock(msg);
						if (block) {
							const newWidth = msg.width != null ? msg.width : null;
							if (block.width !== newWidth) {
								await replaceBlock(block, block.xml, block.height, newWidth);
							}
						}
						break;
					}

				case "requestRefresh":
					sendContent();
					break;

				case "saveDocument":
					// Ctrl+S in a text block, handled after the edits sent before it
					await document.save();
					break;

				case "insertDiagram":
					{
						const snippet = buildDiagramBlock(createEmptyDiagram(), "fenced", false, null, DEFAULT_NEW_DIAGRAM_WIDTH);
						const lineCount = document.lineCount;
						const afterLine = typeof msg.afterLine === "number" && msg.afterLine >= 0 && msg.afterLine < lineCount
							? msg.afterLine as number : null;
						const edit = new vscode.WorkspaceEdit();
						let snippetLine: number;
						if (afterLine != null) {
							// After the line, with a blank line before and after it
							const next = afterLine + 1 < lineCount ? document.lineAt(afterLine + 1) : null;
							edit.insert(document.uri, document.lineAt(afterLine).range.end,
								withEol(document, "\n\n" + snippet + (next == null || !next.isEmptyOrWhitespace ? "\n" : "")));
							snippetLine = afterLine + 2;
						} else {
							// At the end of the document
							const text = document.getText();
							const contentEnd = text.trimEnd().length;
							edit.replace(document.uri, offsetRange(document, contentEnd, text.length),
								withEol(document, (contentEnd > 0 ? "\n\n" : "") + snippet + "\n"));
							snippetLine = contentEnd > 0 ? document.positionAt(contentEnd).line + 2 : 0;
						}
						if (!(await applyOwnEdit(edit))) { break; }

						// Show the document with the new block and open it in the inline editor
						sendContent();
						const newBlockIndex = findDiagramBlocks(document.getText()).findIndex(b => b.startLine === snippetLine);
						if (newBlockIndex >= 0) {
							webviewPanel.webview.postMessage({
								type: "scrollToAndEdit",
								blockIndex: newBlockIndex,
								isNew: true,
							});
						}
						break;
					}
			}
		};

		// One message after the other, so each edit sees the document as the
		// edits before it left it (the handlers await applyEdit).
		let queue: Promise<void> = Promise.resolve();
		webviewPanel.webview.onDidReceiveMessage((msg) => {
			queue = queue
				.then(() => handleMessage(msg))
				.catch((err) => console.error("drawio-inline-editor: failed to handle", msg && msg.type, err));
		});

		const changeDisposable = vscode.workspace.onDidChangeTextDocument(e => {
			if (ownEdits > 0 || e.contentChanges.length === 0) { return; }
			if (e.document.uri.toString() === document.uri.toString()) {
				scheduleContent();
			}
		});

		// Watch the linked .drawio.svg/.png files so EXTERNAL changes (the standalone
		// draw.io editor, git checkout/pull, another tool) flow into any live inline
		// editing session — sendContent → tryIncrementalUpdate merges them just like a
		// markdown edit. Our own saves are ignored via recentLinkWrites so the write
		// doesn't echo back as a reload.
		let linkWatcher: vscode.FileSystemWatcher | undefined;
		const wsFolder = vscode.workspace.getWorkspaceFolder(document.uri);
		if (wsFolder) {
			linkWatcher = vscode.workspace.createFileSystemWatcher(
				new vscode.RelativePattern(wsFolder, "**/*.drawio.{svg,png}"));
			const onLinkChange = (uri: vscode.Uri) => {
				const key = caseFold(uri.fsPath);
				if (!linkedFilePaths.has(key)) { return; }
				// Ignore our own write: suppress only when the file's current bytes
				// still match what this panel last wrote (content-based, not timed —
				// a real concurrent external write differs and falls through).
				const wroteHash = recentLinkWrites.get(key);
				if (wroteHash != null) {
					let cur: Buffer | null = null;
					try { cur = fs.readFileSync(uri.fsPath); } catch (e) { cur = null; }
					if (cur && hashBytes(cur) === wroteHash) { recentLinkWrites.delete(key); return; }
				}
				scheduleContent();
			};
			linkWatcher.onDidChange(onLinkChange);
			linkWatcher.onDidCreate(onLinkChange);
			linkWatcher.onDidDelete(onLinkChange);
		}

		webviewPanel.onDidDispose(() => {
			if (contentTimer) { clearTimeout(contentTimer); }
			changeDisposable.dispose();
			linkWatcher?.dispose();
			if (this.activePanels.get(document.uri.toString()) === webviewPanel) {
				this.activePanels.delete(document.uri.toString());
			}
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

class SourceCodeLensProvider implements vscode.CodeLensProvider {
	provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
		if (document.languageId !== "markdown") { return []; }

		const text = document.getText();
		const blocks = findSourceBlocks(text);
		const lenses: vscode.CodeLens[] = [];

		blocks.forEach((block) => {
			const range = new vscode.Range(block.startLine, 0, block.startLine, 0);

			lenses.push(new vscode.CodeLens(range, {
				title: "$(arrow-swap) Convert to draw.io",
				command: block.language === "mermaid" ?
					"drawio-inline-editor.convertMermaid" :
					"drawio-inline-editor.convertPlantUml",
				arguments: [block.startLine],
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
