/**
 * Browser guest of the inline Draw.io editor for ```drawio fences in VS Code's
 * experimental Markdown editor (see ../markdownCodeBlockEditor.ts for the
 * extension host side and the API notes).
 *
 * The Markdown editor mounts this document in a sandboxed iframe and drives
 * it through `@vscode/web-editors`: `getContent()` is the fence body, edits
 * go back with `applyEdits`, `reportSize` sizes the iframe. Draw.io is embedded
 * with its JSON embed protocol, either loaded into this document (bundled
 * webapp, resolved against the `<base href>` the host injects) or as the
 * online editor in a nested iframe.
 *
 * Iframes are pooled and re-bound to other blocks by the Markdown editor, so
 * all state derives from the current content and a forced content update
 * simply reloads the diagram.
 */
import { WebEditorClient } from "@vscode/web-editors";
import {
	GUEST_CONFIG_ELEMENT_ID,
	GuestConfig,
	GuestToHostMessage,
} from "../protocol";
import type { PassThroughKey } from "../../vscodeShortcuts";

const MIN_HEIGHT = 120;
const MAX_HEIGHT = 5000;
const INIT_TIMEOUT_MS = 30000;
const FIT_DEBOUNCE_MS = 100;

/** A message from Draw.io's embed protocol. */
type DrawioEvent = { event: string } & Record<string, unknown>;

/** Sends embed protocol actions to Draw.io. */
interface DrawioChannel {
	send(action: Record<string, unknown>): void;
}

let sendToHost: ((message: GuestToHostMessage) => void) | undefined;

function log(message: string): void {
	console.log(`[drawio-codeblock] ${message}`);
	sendToHost?.({ type: "log", message });
}

const statusElement = document.getElementById("drawio-codeblock-status");

function showStatus(text: string, isError = false): void {
	if (!statusElement) {
		return;
	}
	statusElement.textContent = text;
	statusElement.classList.toggle("error", isError);
	statusElement.classList.remove("hidden");
	if (isError) {
		log(text);
	}
}

function hideStatus(): void {
	statusElement?.classList.add("hidden");
}

function asText(content: unknown): string {
	return typeof content === "string" ? content : "";
}

/** Comparison form of a fence body: line endings and surrounding whitespace don't matter. */
function normalize(text: string): string {
	return text.replace(/\r\n/g, "\n").trim();
}

function parseDrawioEvent(data: unknown): DrawioEvent | undefined {
	if (typeof data !== "string") {
		return undefined;
	}
	try {
		const parsed = JSON.parse(data);
		return parsed && typeof parsed.event === "string" ? parsed : undefined;
	} catch {
		return undefined;
	}
}

/**
 * One code block editor: the bridge between the Markdown editor (client) and
 * Draw.io (channel).
 */
class Session {
	private channel: DrawioChannel | undefined;
	private client: WebEditorClient | undefined;
	private drawioReady = false;
	private loaded = false;
	/** Normalized text last exchanged with the host; used to drop echoes. */
	private lastText: string | undefined;
	private hostReadOnly = false;
	private reportedHeight: number | undefined;
	private lastWidth = 0;
	private fitPending = false;
	private fitTimer: number | undefined;
	private initTimer: number | undefined;
	private readonly _themeObserver = new MutationObserver(() => this._syncTheme());
	/** Offline only: Draw.io's EditorUi instance (it runs in this document). */
	public editorUi: any;

	constructor(private readonly config: GuestConfig) {
		if (config.mode.kind === "offline" && config.followHostTheme) {
			this._themeObserver.observe(document.head, { childList: true, subtree: true, characterData: true });
		}
	}

	private _syncTheme(): void {
		const dark = hostDarkMode();
		if (this.loaded && this.config.followHostTheme && dark !== undefined) {
			const drawio = window as Window & { Editor?: { isDarkMode(): boolean } };
			if (drawio.Editor?.isDarkMode() !== dark) {
				this.editorUi?.setDarkMode(dark);
			}
		}
	}

	private get readOnly(): boolean {
		return this.config.locked || this.hostReadOnly;
	}

	attachChannel(channel: DrawioChannel): void {
		this.channel = channel;
		this.initTimer = window.setTimeout(() => {
			if (!this.drawioReady) {
				showStatus(
					"Draw.io did not start. See the 'Drawio Integration Log' output channel.",
					true
				);
			}
		}, INIT_TIMEOUT_MS);
	}

	attachClient(client: WebEditorClient): void {
		this.client = client;
		this.hostReadOnly = client.getReadOnly();
		sendToHost = (message) => client.hostTransport?.sendMessage(message);
		client.hostTransport?.sendMessage({ type: "ready" });
		client.onDidChangeContent(({ content, force }) =>
			this.onHostContent(asText(content), force)
		);
		client.onDidChangeReadOnly(({ readOnly }) => {
			this.hostReadOnly = readOnly;
			this.applyReadOnly();
		});
		this.maybeLoad();
	}

	/** Draw.io -> guest. */
	onDrawioEvent(msg: DrawioEvent): void {
		switch (msg.event) {
			case "configure":
				this.channel?.send({
					action: "configure",
					config: this.config.drawioConfig,
				});
				break;
			case "init":
				this.drawioReady = true;
				window.clearTimeout(this.initTimer);
				this.maybeLoad();
				break;
			case "load":
				this.onLoaded(msg);
				break;
			case "autosave":
			case "save":
				this.onDrawioEdit(asText(msg.xml), msg);
				break;
			case "openLink":
				if (typeof msg.href === "string") {
					sendToHost?.({ type: "openLink", href: msg.href });
				}
				break;
			case "shortcut":
				if (typeof msg.command === "string") {
					sendToHost?.({ type: "command", command: msg.command });
				}
				break;
			// 'exit', 'export', 'draft', ... have no meaning inline.
		}
	}

	/** The iframe was resized (by the host applying our height, or the editor width changing). */
	onResize(width: number): void {
		const widthChanged = width !== this.lastWidth;
		this.lastWidth = width;
		if (!this.loaded || !(this.fitPending || widthChanged)) {
			return;
		}
		this.fitPending = false;
		window.clearTimeout(this.fitTimer);
		this.fitTimer = window.setTimeout(() => this.fit(), FIT_DEBOUNCE_MS);
	}

	dispose(): void {
		this._themeObserver.disconnect();
		window.clearTimeout(this.initTimer);
		window.clearTimeout(this.fitTimer);
		this.client?.dispose();
		this.client = undefined;
	}

	private maybeLoad(): void {
		if (this.drawioReady && this.client) {
			this.load(asText(this.client.getContent()));
		}
	}

	private load(text: string): void {
		this.lastText = normalize(text);
		this.loaded = false;
		this.fitPending = true;
		this.channel?.send({
			action: "load",
			autosave: 1,
			xml: text,
			title: "",
			border: this.config.diagramPadding,
			fit: 1,
			maxFitScale: 1,
		});
	}

	private onLoaded(msg: DrawioEvent): void {
		this.loaded = true;
		this._syncTheme();
		hideStatus();
		this.applyReadOnly();
		this.reportHeight(msg, true);
	}

	private onDrawioEdit(xml: string, msg: DrawioEvent): void {
		if (!this.loaded || !this.client) {
			return;
		}
		if (this.readOnly) {
			// Every mutation path is disabled while read-only; a change that
			// slips through (online mode) is dropped and the block restored.
			log("dropping edit while read-only");
			this.load(this.lastTextOrEmpty());
			return;
		}
		const text = normalize(xml);
		if (text === this.lastText) {
			return;
		}
		this.lastText = text;
		// Draw.io's pretty-printed XML ends with a newline; the fence body
		// must not, or a blank line creeps in before the closing fence.
		this.client.applyEdits([
			{ kind: "replace", path: [], newValue: xml.replace(/\s+$/, "") },
		]);
		// Grow with the diagram while editing; never shrink or re-fit under
		// the user's cursor.
		this.reportHeight(msg, false);
	}

	private lastTextOrEmpty(): string {
		return this.lastText ?? "";
	}

	/** Host -> guest: the block changed elsewhere, or this frame now shows another block. */
	private onHostContent(text: string, force: boolean): void {
		if (!force && normalize(text) === this.lastText) {
			return; // echo of our own edit
		}
		if (!this.drawioReady) {
			return; // picked up from getContent() at init
		}
		this.load(text);
	}

	private applyReadOnly(): void {
		const graph = this.editorUi?.editor?.graph;
		if (graph) {
			try {
				graph.setEnabled(!this.readOnly);
			} catch (e) {
				log(`could not toggle read-only: ${e}`);
			}
		}
	}

	private fit(): void {
		this.channel?.send({
			action: "fit",
			border: this.config.diagramPadding,
			maxScale: 1,
		});
	}

	/**
	 * Reports the iframe height that shows the whole diagram at up to 100%
	 * inside the current width. `fixedHeight` (fence `height=N`) wins.
	 */
	private reportHeight(msg: DrawioEvent, allowShrink: boolean): void {
		let height: number;
		if (this.config.fixedHeight != null) {
			height = this.config.fixedHeight;
		} else {
			const bounds = msg.modelBounds as
				| { width: number; height: number }
				| undefined;
			if (!bounds) {
				return;
			}
			const padding = this.config.diagramPadding;
			const availableWidth = Math.max(
				1,
				document.documentElement.clientWidth - 2 * padding
			);
			const scale =
				bounds.width > 0
					? Math.min(1, availableWidth / bounds.width)
					: 1;
			height = Math.ceil(bounds.height * scale + 2 * padding);
			height = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, height));
		}
		if (
			!allowShrink &&
			this.reportedHeight != null &&
			height <= this.reportedHeight
		) {
			return;
		}
		if (height === this.reportedHeight) {
			// No resize will follow, so fit now if one is pending.
			if (this.fitPending) {
				this.fitPending = false;
				this.fit();
			}
			return;
		}
		this.reportedHeight = height;
		this.client?.reportSize(height);
		// The pending fit runs from onResize once the host applied the height.
	}
}

//#region Offline: the bundled webapp runs in this document

function loadScript(src: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const script = document.createElement("script");
		script.src = src;
		script.async = false;
		script.onload = () => resolve();
		script.onerror = () => reject(new Error(`Failed to load ${src}`));
		document.head.appendChild(script);
	});
}

function installKeyInterceptor(keys: PassThroughKey[]): void {
	// Capture phase on window runs before any Draw.io keydown listener.
	window.addEventListener(
		"keydown",
		(e) => {
			const mod = e.ctrlKey || e.metaKey;
			const key = (e.key || "").toLowerCase();
			for (const s of keys) {
				if (
					key === s.key.toLowerCase() &&
					mod === s.ctrl &&
					e.shiftKey === s.shift &&
					e.altKey === s.alt
				) {
					e.preventDefault();
					e.stopImmediatePropagation();
					if (s.command) {
						sendToHost?.({ type: "command", command: s.command });
					}
					return;
				}
			}
		},
		true
	);
}

function startOffline(config: GuestConfig, session: Session): DrawioChannel {
	const w = window as any;

	// Draw.io reads its parameters from this global instead of location.search
	// (Init.js keeps an existing object).
	w.urlParams = { ...config.urlParams };
	const dark = config.followHostTheme ? hostDarkMode() : undefined;
	if (dark !== undefined) {
		w.urlParams.dark = dark ? "1" : "0";
	}
	w.isLocalStorage = true;

	// Draw.io persists settings in localStorage; route them to the extension
	// memento so the code block editor shares them with the full editor.
	const storage: Record<string, string> = { ...config.localStorage };
	const publishStorage = () =>
		sendToHost?.({ type: "updateLocalStorage", newLocalStorage: storage });
	const bridgedStorage = {
		getItem: (key: string) => (key in storage ? storage[key] : null),
		setItem: (key: string, value: unknown) => {
			storage[key] = String(value);
			publishStorage();
		},
		removeItem: (key: string) => {
			delete storage[key];
			publishStorage();
		},
		clear: () => {
			for (const key of Object.keys(storage)) {
				delete storage[key];
			}
			publishStorage();
		},
		key: (index: number) => Object.keys(storage)[index] ?? null,
		get length() {
			return Object.keys(storage).length;
		},
	};
	try {
		Object.defineProperty(window, "localStorage", {
			value: bridgedStorage,
			configurable: true,
		});
		Object.defineProperty(document, "cookie", {
			value: "",
			configurable: true,
		});
	} catch (e) {
		log(`could not bridge localStorage: ${e}`);
	}

	// Draw.io posts embed events to `embedMessageSource` and accepts messages
	// whose `source` is that object, so a plain object works as the channel.
	const bridge = {
		postMessage: (data: unknown) => {
			const msg = parseDrawioEvent(data);
			if (msg) {
				session.onDrawioEvent(msg);
			}
		},
	};
	try {
		// Plugins that check evt.source === window.opener keep working.
		Object.defineProperty(window, "opener", {
			value: bridge,
			configurable: true,
		});
	} catch {
		// not essential
	}
	const channel: DrawioChannel = {
		send(action) {
			const evt = new Event("message") as any;
			evt.source = bridge;
			evt.data = JSON.stringify(action);
			window.dispatchEvent(evt);
		},
	};

	installKeyInterceptor(config.passThroughKeys);

	// Loader helpers Draw.io's index.html normally provides.
	w.mxscript = (
		src: string,
		onLoad?: () => void,
		id?: string,
		dataAppKey?: string
	) => {
		const script = document.createElement("script");
		script.type = "text/javascript";
		script.src = src;
		if (id != null) {
			script.id = id;
		}
		if (dataAppKey != null) {
			script.setAttribute("data-app-key", dataAppKey);
		}
		if (onLoad != null) {
			script.onload = onLoad;
		}
		document.head.appendChild(script);
	};
	w.mxinclude = (src: string) => w.mxscript(src);

	(async () => {
		await loadScript("js/PreConfig.js");
		await loadScript("js/app.min.js");
		await loadScript("js/PostConfig.js");

		const { EditorUi, mxUrlConverter, App } = w;
		const cellEditor = w.mxCellEditor.prototype as { focusContainer(): void };
		const focusContainer = cellEditor.focusContainer;
		cellEditor.focusContainer = function () {
			// stopEditing also runs during startup and programmatic theme changes.
			if (document.hasFocus()) {
				focusContainer.call(this);
			}
		};
		EditorUi.prototype.embedMessageSource = bridge;
		EditorUi.prototype.noAutoFocus = true;
		EditorUi.prototype.addEmbedButtons = () => {};
		const originalInit = EditorUi.prototype.init;
		EditorUi.prototype.init = function (this: any, ...args: unknown[]) {
			session.editorUi = this;
			const result = originalInit.apply(this, args);
			this.editor.graph.getModel().prefix = `${w.Editor.guid()}-`;
			return result;
		};
		// Relative image links in diagrams resolve against the document base
		// (the webapp folder), not this iframe's location.
		const baseUrl = document.baseURI;
		mxUrlConverter.prototype.baseUrl = baseUrl;
		mxUrlConverter.prototype.updateBaseUrl = function (this: any) {
			this.baseDomain = new URL(baseUrl).origin;
			this.baseUrl = baseUrl;
		};

		App.main();
	})().catch((e) => showStatus(`Could not load Draw.io: ${e}`, true));

	return channel;
}

function hostDarkMode(): boolean | undefined {
	const scheme = getComputedStyle(document.documentElement).colorScheme;
	return scheme === "dark" ? true : scheme === "light" ? false : undefined;
}

//#endregion

//#region Online: the configured editor URL in a nested iframe

function buildOnlineUrl(base: string, params: Record<string, string>): string {
	const query = Object.keys(params)
		.map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
		.join("&");
	try {
		const url = new URL(base);
		url.search = (url.search ? url.search + "&" : "?") + query;
		return url.href;
	} catch {
		return base + (base.indexOf("?") >= 0 ? "&" : "/?") + query;
	}
}

function startOnline(
	url: string,
	config: GuestConfig,
	session: Session
): DrawioChannel {
	const iframe = document.createElement("iframe");
	iframe.id = "drawio-codeblock-frame";
	iframe.src = buildOnlineUrl(url, config.urlParams);
	document.body.appendChild(iframe);
	window.addEventListener("message", (evt) => {
		if (evt.source !== iframe.contentWindow) {
			return;
		}
		const msg = parseDrawioEvent(evt.data);
		if (msg) {
			session.onDrawioEvent(msg);
		}
	});
	return {
		send(action) {
			iframe.contentWindow?.postMessage(JSON.stringify(action), "*");
		},
	};
}

//#endregion

function readConfig(): GuestConfig {
	const element = document.getElementById(GUEST_CONFIG_ELEMENT_ID);
	if (!element?.textContent) {
		throw new Error("Missing editor configuration");
	}
	return JSON.parse(element.textContent);
}

async function main(): Promise<void> {
	const config = readConfig();
	const session = new Session(config);
	// For debugging from the developer tools.
	(window as any).drawioCodeBlockSession = session;

	// Connect and start Draw.io concurrently; loading Draw.io is the slow part.
	const connecting = WebEditorClient.connect({
		connection: "windowParent",
		contentType: "text",
	});
	session.attachChannel(
		config.mode.kind === "offline"
			? startOffline(config, session)
			: startOnline(config.mode.url, config, session)
	);

	const resizeObserver = new ResizeObserver(() =>
		session.onResize(document.documentElement.clientWidth)
	);
	resizeObserver.observe(document.documentElement);

	window.addEventListener(
		"pagehide",
		() => {
			resizeObserver.disconnect();
			session.dispose();
		},
		{ once: true }
	);

	session.attachClient(await connecting);
	log(`connected (${config.mode.kind}${config.locked ? ", locked" : ""})`);
}

main().catch((e) =>
	showStatus(`Could not start the Draw.io editor: ${e}`, true)
);
