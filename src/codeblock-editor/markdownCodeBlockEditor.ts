/**
 * Extension host side of the inline Draw.io editor for ```drawio fences in
 * VS Code's experimental Markdown editor.
 *
 * VS Code (Insiders, since Aug 2026) lets extensions replace fenced code
 * blocks in its Markdown editor with iframe-backed editors through the
 * `markdown.codeBlockEditorProviders` contribution. The Markdown editor asks
 * the provider registered in package.json for an HTML document per
 * (document, info string), mounts it in a sandboxed same-origin iframe with a
 * `<base href>` pointing at `content.baseUri`, and talks to it with the
 * `@vscode/web-editors` protocol (see `guest/main.ts`).
 *
 * The API is experimental and has already changed once (V1 -> V2, which added
 * the host transport), so everything specific to it is kept in this folder and
 * typed locally; nothing else in the extension depends on it. When VS Code
 * lacks the contribution point the manifest entry is ignored and fences stay
 * plain text.
 */
import * as vscode from "vscode";
import { sha256 } from "js-sha256";
import { Config, DiagramConfig } from "../Config";
import { DrawioLibrarySection, simpleDrawioLibrary } from "../DrawioClient";
import { VSCODE_PASSTHROUGH_KEYS } from "../vscodeShortcuts";
import { parseBlockAttrs } from "../inline-editor/diagramParser";
import {
	GuestConfig,
	GuestToHostMessage,
	GUEST_CONFIG_ELEMENT_ID,
} from "./protocol";

/** `markdown.codeBlockEditorProviders[].id` in package.json. */
const PROVIDER_ID = "drawio";

/** Placeholder height until the guest reports the diagram's size. */
const DEFAULT_HEIGHT = 400;

/**
 * Fallback for `drawio-inline-editor.diagramPadding`; keep in sync with
 * package.json and src/inline-editor/extension.ts.
 */
const DEFAULT_DIAGRAM_PADDING = 28;

/** Guest bundle, relative to the document base (`drawio/src/main/webapp/`). */
const GUEST_SCRIPT = "../../../../dist/codeblock-editor/guest.js";

/**
 * Draw.io chrome to hide for the inline presentation (same rules as the
 * minimal UI of the inline Markdown editor in src/inline-editor).
 */
const INLINE_CSS = [
	".geMenubarContainer { display:none !important; }",
	".geFooterContainer { display:none !important; }",
	".geSidebar { display:none !important; }",
	".geFormatContainer { display:none !important; }",
	".geTabContainer { display:none !important; }",
	".geToolbarContainer { box-shadow:none !important; }",
	".mxWindow { display:none !important; }",
	"::-webkit-scrollbar { display:none !important; }",
	"body { background: transparent !important; overflow: hidden !important; }",
	".geDiagramBackdrop { background: transparent !important; }",
	".geBackgroundPage { box-shadow:none !important; background:transparent !important; border:none !important; }",
	".geDiagramContainer { background: transparent !important; overflow: hidden !important; }",
	// Draw.io's embed resizer handles (hidden by noResizers, but still laid
	// out at the old bottom/right edge until its deferred resize handler
	// runs). The Markdown editor re-measures the document synchronously on
	// every resize, so any stale overflow makes it undo a shrink.
	'body > div[style*="cursor: row-resize"], body > div[style*="cursor:row-resize"], body > div[style*="cursor: col-resize"], body > div[style*="cursor:col-resize"] { display:none !important; }',
	...["nw", "ne", "sw", "se", "n", "s", "e", "w"].map(
		(dir) =>
			`.geDiagramContainer div[style*="cursor: ${dir}-resize"], .geDiagramContainer div[style*="cursor:${dir}-resize"] { display:none !important; }`
	),
].join("\n");

//#region VS Code API surface (experimental, mirrored from microsoft/vscode
// extensions/markdown-language-features/src/preview/markdownEditorProvider.ts)

interface ResolveRequest {
	readonly providerId: string;
	/** Despite the name this is the complete fence info string, e.g. `drawio locked`. */
	readonly language: string;
	readonly documentUri: vscode.Uri;
}

interface ResolvedCodeBlockEditor {
	readonly content: { readonly html: string; readonly baseUri?: vscode.Uri };
	readonly contentType?: "text" | "json";
	readonly runtimeKey?: string;
	readonly initialHeight?: number;
	readonly sandbox?: { readonly clipboardWrite?: boolean };
}

interface HostTransport {
	readonly runtimeKey: string;
	readonly onDidReceiveMessage: vscode.Event<unknown>;
	readonly onDidDispose: vscode.Event<void>;
	sendMessage(message: unknown): void;
}

export interface MarkdownCodeBlockEditorProvider {
	resolve(
		request: ResolveRequest,
		token: vscode.CancellationToken
	): vscode.ProviderResult<ResolvedCodeBlockEditor>;
	createHostTransport(
		transport: HostTransport,
		token: vscode.CancellationToken
	): vscode.ProviderResult<vscode.Disposable>;
}

/** Shape of the `markdownCodeBlockEditors` export looked up by VS Code. */
export interface MarkdownCodeBlockEditorsApi {
	readonly apiV2: {
		getProvider(
			providerId: string
		): MarkdownCodeBlockEditorProvider | undefined;
	};
}

//#endregion

export function createMarkdownCodeBlockEditorsApi(
	context: vscode.ExtensionContext,
	config: Config,
	log: vscode.OutputChannel
): MarkdownCodeBlockEditorsApi {
	const webappUri = vscode.Uri.joinPath(
		context.extensionUri,
		"drawio",
		"src",
		"main",
		"webapp"
	);
	/** Document a runtime (= one resolved HTML variant) was created for. */
	const runtimeDocuments = new Map<string, vscode.Uri>();
	const allowedCommands = new Set(
		VSCODE_PASSTHROUGH_KEYS.map((k) => k.command).filter(
			(c): c is string => c !== null
		)
	);

	const provider: MarkdownCodeBlockEditorProvider = {
		async resolve(request, token) {
			if (request.providerId !== PROVIDER_ID) {
				return undefined;
			}
			const diagramConfig = config.getDiagramConfig(request.documentUri);
			const guestConfig = await buildGuestConfig(
				diagramConfig,
				request.language,
				log
			);
			if (token.isCancellationRequested) {
				return undefined;
			}
			const html = buildGuestHtml(guestConfig);
			// One iframe pool per distinct HTML; the key also lets the host
			// transport find the document the runtime belongs to.
			const runtimeKey = `drawio-codeblock:${sha256
				.hex(html)
				.slice(0, 16)}`;
			runtimeDocuments.set(runtimeKey, request.documentUri);
			log.appendLine(
				`markdown code block editor: resolved "${
					request.language
				}" in ${request.documentUri.toString()} (${
					guestConfig.mode.kind
				}, ${runtimeKey})`
			);
			return {
				content: { html, baseUri: webappUri },
				contentType: "text",
				runtimeKey,
				initialHeight: guestConfig.fixedHeight ?? DEFAULT_HEIGHT,
				sandbox: { clipboardWrite: true },
			};
		},

		createHostTransport(transport) {
			const documentUri = runtimeDocuments.get(transport.runtimeKey);
			const diagramConfig = documentUri
				? config.getDiagramConfig(documentUri)
				: undefined;
			return transport.onDidReceiveMessage((raw) => {
				const message = raw as GuestToHostMessage;
				switch (message?.type) {
					case "ready":
						log.appendLine(
							`markdown code block editor: guest ready (${transport.runtimeKey})`
						);
						break;
					case "log":
						log.appendLine(
							`markdown code block editor guest: ${message.message}`
						);
						break;
					case "command":
						// The guest runs untrusted diagram content: only run the
						// chords we deliberately hand back to VS Code.
						if (allowedCommands.has(message.command)) {
							vscode.commands.executeCommand(message.command);
						}
						break;
					case "openLink":
						vscode.env.openExternal(vscode.Uri.parse(message.href));
						break;
					case "updateLocalStorage":
						diagramConfig?.setLocalStorage(message.newLocalStorage);
						break;
				}
			});
		},
	};

	return {
		apiV2: {
			getProvider: (providerId) =>
				providerId === PROVIDER_ID ? provider : undefined,
		},
	};
}

async function buildGuestConfig(
	dc: DiagramConfig,
	infoString: string,
	log: vscode.OutputChannel
): Promise<GuestConfig> {
	// Everything after the language token: `locked`, `height=N`, `width=N`.
	const attrs = parseBlockAttrs(
		infoString.trim().split(/\s+/).slice(1).join(" ")
	);
	const theme = dc.resolvedTheme;

	let libraries: DrawioLibrarySection[] = [];
	try {
		libraries = simpleDrawioLibrary(await dc.customLibraries);
	} catch (e) {
		log.appendLine(
			`markdown code block editor: could not load custom libraries: ${e}`
		);
	}

	const urlParams: Record<string, string> = {
		embed: "1",
		proto: "json",
		configure: "1",
		ui: "simple",
		dark: theme.getDarkDrawioValue(dc.appearanceFollowsSystem),
		"high-contrast":
			parseInt(theme.getAppearanceDrawioValue(), 10) & 2 ? "1" : "0",
		lang: dc.drawioLanguage,
		tooltips: "0",
		libraries: "1",
		pv: "0",
		grid: "0",
		embedInline: "1",
		noSaveBtn: "1",
		noExitBtn: "1",
	};
	if (attrs.locked) {
		// Read-only viewer chrome; the guest additionally drops every edit.
		urlParams.lightbox = "1";
		urlParams.toolbar = "0";
	}

	const drawioConfig: Record<string, unknown> = {
		compressXml: false,
		customFonts: dc.customFonts,
		presetColors: dc.presetColors,
		customColorSchemes: dc.customColorSchemes,
		styles: dc.styles,
		defaultVertexStyle: dc.defaultVertexStyle,
		defaultEdgeStyle: dc.defaultEdgeStyle,
		colorNames: dc.colorNames,
		simpleLabels: dc.simpleLabels,
		defaultLibraries: "general",
		libraries,
		zoomFactor: dc.zoomFactor,
		globalVars: (dc.globalVars as Record<string, string>) ?? undefined,
		// Online (cross-origin) path: Draw.io itself intercepts these chords
		// and reports them as {event:'shortcut'}; offline the guest does it.
		passThroughKeys: VSCODE_PASSTHROUGH_KEYS,
		// The iframe cannot open windows: links come back as {event:'openLink'}.
		suppressNewWindows: true,
		showTooltipIcons: dc.showTooltipIcons || undefined,
		showLinkIcons: dc.showLinkIcons || undefined,
		showConnectHandle: dc.showConnectHandle || undefined,
		compact: true,
		css: INLINE_CSS,
		darkColor: "#1e1e1e",
		// Transparent unless the diagram has a background color (the
		// transparent=1 URL param would drop that color too)
		defaultPageBackgroundColor: "transparent",
		defaultDarkPageBackgroundColor: "transparent",
		settingsName: "vscode-codeblock-editor",
		noAutoFocus: true,
		passiveScroll: true,
		preserveViewState: true,
		noResizers: true,
		useInternalClipboard: true,
		fitDiagramOnLoad: false,
		fitDiagramOnPage: false,
		hideMenuItems: [
			"exportAs",
			"importFrom",
			"print",
			"saveAndExit",
			"plugins",
			"exit",
		],
		hideMenus: ["language", "help"],
	};

	const diagramPadding = vscode.workspace
		.getConfiguration("drawio-inline-editor")
		.get<number>("diagramPadding", DEFAULT_DIAGRAM_PADDING);

	return {
		mode: dc.mode,
		followHostTheme: dc.appearanceFollowsSystem,
		urlParams,
		drawioConfig,
		localStorage: dc.mode.kind === "offline" ? dc.localStorage : {},
		passThroughKeys: VSCODE_PASSTHROUGH_KEYS,
		locked: attrs.locked,
		fixedHeight: attrs.height,
		diagramPadding,
	};
}

/**
 * The guest document. The Markdown editor prepends `<base href>` (pointing at
 * the Draw.io webapp folder), its theme styles and a size-reporting bootstrap
 * to `<head>`, so relative URLs resolve inside the bundled webapp.
 */
export function buildGuestHtml(guestConfig: GuestConfig): string {
	// `<` is escaped so no fence content can break out of the JSON element.
	const configJson = JSON.stringify(guestConfig).replace(/</g, "\\u003c");
	const drawioStyles =
		guestConfig.mode.kind === "offline"
			? `<link rel="stylesheet" type="text/css" href="styles/grapheditor.css">
	<link rel="stylesheet" media="(forced-colors: active)" href="styles/high-contrast.css" id="high-contrast-stylesheet">`
			: "";
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
	<title>Draw.io</title>
	${drawioStyles}
	<style>
		html, body { height: 100%; margin: 0; padding: 0; overflow: hidden; }
		body { background: transparent; }
		#drawio-codeblock-frame { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
		#drawio-codeblock-status {
			position: absolute; inset: 0; z-index: 10;
			display: flex; align-items: center; justify-content: center;
			padding: 8px; text-align: center; pointer-events: none;
			font-family: var(--vscode-font-family, sans-serif); font-size: 13px;
			color: var(--vscode-descriptionForeground, #888888);
		}
		#drawio-codeblock-status.error { color: var(--vscode-errorForeground, #f14c4c); pointer-events: auto; }
		#drawio-codeblock-status.hidden { display: none; }
	</style>
	<script type="application/json" id="${GUEST_CONFIG_ELEMENT_ID}">${configJson}</script>
</head>
<body class="geEditor">
	<div id="drawio-codeblock-status">Loading Draw.io…</div>
	<script src="${GUEST_SCRIPT}"></script>
</body>
</html>`;
}
