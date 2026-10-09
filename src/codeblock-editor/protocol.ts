/**
 * Contract shared by the two halves of the Markdown code block editor:
 *
 *  - `markdownCodeBlockEditor.ts` (extension host) resolves a ```drawio fence
 *    to an HTML document that carries a {@link GuestConfig} in a JSON script
 *    element, and answers {@link GuestToHostMessage}s over the code block
 *    editor host transport.
 *  - `guest/main.ts` (browser) reads the config, embeds Draw.io and keeps the
 *    fence body in sync through `@vscode/web-editors`.
 *
 * This file must stay free of `vscode` and DOM imports so both bundles can
 * include it.
 */
import type { PassThroughKey } from "../vscodeShortcuts";

/** `id` of the `<script type="application/json">` element carrying the config. */
export const GUEST_CONFIG_ELEMENT_ID = "drawio-codeblock-config";

export interface GuestConfig {
	/**
	 * Where Draw.io comes from. `offline` loads the bundled webapp into the
	 * guest document itself (relative to the document base, which the host
	 * points at `drawio/src/main/webapp/`); `online` embeds `url` in a nested
	 * iframe.
	 */
	mode: { kind: "offline" } | { kind: "online"; url: string };
	/** Follow injected VS Code colors instead of the operating-system theme. */
	followHostTheme: boolean;
	/** Draw.io URL parameters: `window.urlParams` offline, query string online. */
	urlParams: Record<string, string>;
	/** The `config` object answered to Draw.io's `configure` event. */
	drawioConfig: Record<string, unknown>;
	/**
	 * Snapshot of Draw.io's localStorage, bridged to the extension memento so
	 * the code block editor shares settings with the full editor (offline only).
	 */
	localStorage: Record<string, string>;
	/** Keyboard chords forwarded to VS Code instead of Draw.io (offline only). */
	passThroughKeys: PassThroughKey[];
	/** The fence carries the `locked` attribute: never modify the block. */
	locked: boolean;
	/** The fence carries `height=N`: use that height instead of measuring. */
	fixedHeight: number | null;
	/** Padding (px) around the diagram when fitting and measuring. */
	diagramPadding: number;
}

/** Messages the guest sends to the extension host over the host transport. */
export type GuestToHostMessage =
	| { type: "ready" }
	| { type: "log"; message: string }
	| { type: "command"; command: string }
	| { type: "openLink"; href: string }
	| { type: "updateLocalStorage"; newLocalStorage: Record<string, string> };
