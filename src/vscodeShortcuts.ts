/**
 * Keyboard chords draw.io should hand back to VS Code instead of handling
 * itself. Used two ways that must stay in sync:
 *
 *  - Offline: injected into the local-server HTML (inline-editor/localServer.ts)
 *    and webview-content.html as a capture-phase keydown listener that posts
 *    `{type:'vscodeShortcut', command}` to the host.
 *  - Online (cross-origin iframe, where we cannot inject): passed to draw.io via
 *    the embed `configure` config as `passThroughKeys`. draw.io's own
 *    `installPassThroughKeys` intercepts the chord and posts
 *    `{event:'shortcut', command}` back to the host.
 *
 * `command` is the VS Code command to run; `null` means "suppress in draw.io but
 * don't forward" (e.g. a chord we just want to swallow).
 */
export interface PassThroughKey {
	key: string;
	ctrl: boolean;
	shift: boolean;
	alt: boolean;
	command: string | null;
}

export const VSCODE_PASSTHROUGH_KEYS: PassThroughKey[] = [
	{ key: "Tab", ctrl: true, shift: false, alt: false, command: "workbench.action.quickOpenPreviousRecentlyUsedEditorInGroup" },
	{ key: "P", ctrl: true, shift: true, alt: false, command: "workbench.action.showCommands" },
	{ key: "p", ctrl: true, shift: false, alt: false, command: "workbench.action.quickOpen" },
	{ key: "S", ctrl: false, shift: true, alt: true, command: null },
	{ key: "s", ctrl: true, shift: false, alt: false, command: "workbench.action.files.save" },
	{ key: "S", ctrl: true, shift: true, alt: false, command: "workbench.action.files.saveAs" },
	{ key: "F1", ctrl: false, shift: false, alt: false, command: "workbench.action.showCommands" },
];
