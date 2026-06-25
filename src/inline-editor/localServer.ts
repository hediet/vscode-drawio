// Lazy-require Node built-ins so this module can be imported in the
// browser extension host without crashing (http/fs are only available
// in the Node.js extension host where the local server actually runs).
type Http = typeof import("http");
type Fs = typeof import("fs");
type Path = typeof import("path");

/**
 * Script injected into the Draw.io index.html to prevent Draw.io from
 * capturing VS Code keyboard shortcuts.  This is the same set of overrides
 * used in webview-content.html for the main editor, but wrapped so it can
 * run standalone inside the iframe served by the local dev server.
 */
const KEYBOARD_OVERRIDE_SCRIPT = `<script>
(function() {
	var VSCODE_SHORTCUTS = [
		{ key: "Tab", ctrl: true,  shift: false, alt: false, command: "workbench.action.quickOpenPreviousRecentlyUsedEditorInGroup" },
		{ key: "P",   ctrl: true,  shift: true,  alt: false, command: "workbench.action.showCommands" },
		{ key: "p",   ctrl: true,  shift: false, alt: false, command: "workbench.action.quickOpen" },
		{ key: "S",   ctrl: false, shift: true,  alt: true,  command: null },
		{ key: "s",   ctrl: true,  shift: false, alt: false, command: "workbench.action.files.save" },
		{ key: "S",   ctrl: true,  shift: true,  alt: false, command: "workbench.action.files.saveAs" },
		{ key: "F1",  ctrl: false, shift: false, alt: false, command: "workbench.action.showCommands" }
	];

	function matchShortcut(e) {
		var mod = e.ctrlKey || e.metaKey;
		var key = e.key.toLowerCase();
		for (var i = 0; i < VSCODE_SHORTCUTS.length; i++) {
			var s = VSCODE_SHORTCUTS[i];
			if (key === s.key.toLowerCase() && mod === s.ctrl && e.shiftKey === s.shift && e.altKey === s.alt) {
				return s;
			}
		}
		return null;
	}

	function forwardToVSCode(shortcut) {
		if (shortcut.command) {
			var msg = { type: "vscodeShortcut", command: shortcut.command };
			window.parent.postMessage(msg, "*");
			if (window.parent !== window.top) {
				window.top.postMessage(msg, "*");
			}
		}
	}

	// Capture ALL keydown events on WINDOW in the capture phase — the earliest
	// possible point, before any of Draw.io's own keydown listeners. (A
	// document-capture listener registered after Draw.io's scripts could be
	// pre-empted; window-capture from the <head> runs first.) stopImmediate so no
	// same-target Draw.io listener fires either.
	window.addEventListener("keydown", function(e) {
		var shortcut = matchShortcut(e);
		if (shortcut) {
			e.preventDefault();
			e.stopImmediatePropagation();
			forwardToVSCode(shortcut);
		}
	}, true);

	function patchWhenReady() {
		if (typeof mxEvent === "undefined") {
			setTimeout(patchWhenReady, 50);
			return;
		}
		var orig = mxEvent.addListener;
		mxEvent.addListener = function() {
			var args = Array.prototype.slice.call(arguments);
			if (args[1] === "keydown") {
				var oldHandler = args[2];
				args[2] = function(keyEvt) {
					var shortcut = matchShortcut(keyEvt);
					if (shortcut) {
						keyEvt.preventDefault();
						keyEvt.stopPropagation();
						forwardToVSCode(shortcut);
						return;
					}
					oldHandler(keyEvt);
				};
			}
			return orig.apply(this, args);
		};
	}
	patchWhenReady();

	// Give each editor instance a unique cell-ID prefix so new cells from
	// different editors don't collide on the same incrementing IDs (which breaks
	// the 3-way merge — same ID, different shape). Draw.io sets this in fileLoaded
	// for real files, but the embed 'load' path doesn't, so patch createId to
	// assign one lazily when the prefix is still empty.
	function patchPrefixWhenReady() {
		if (typeof mxGraphModel === "undefined" || typeof Editor === "undefined" || typeof Editor.guid !== "function") {
			setTimeout(patchPrefixWhenReady, 50);
			return;
		}
		if (mxGraphModel.prototype.__vscodeCellPrefix) return;
		mxGraphModel.prototype.__vscodeCellPrefix = true;
		var origCreateId = mxGraphModel.prototype.createId;
		mxGraphModel.prototype.createId = function() {
			if (this.prefix == null || this.prefix === "") {
				this.prefix = Editor.guid() + "-";
			}
			return origCreateId.apply(this, arguments);
		};
	}
	patchPrefixWhenReady();
})();
</script>`;

const MIME_TYPES: Record<string, string> = {
	".html": "text/html",
	".js": "application/javascript",
	".css": "text/css",
	".json": "application/json",
	".xml": "text/xml",
	".svg": "image/svg+xml",
	".png": "image/png",
	".gif": "image/gif",
	".jpg": "image/jpeg",
	".ico": "image/x-icon",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".txt": "text/plain",
	".map": "application/json",
};

export interface LocalServer {
	readonly port: number | null;
	start(): Promise<number>;
	stop(): void;
}

/**
 * Creates a simple static HTTP server for the draw.io webapp.
 */
export function createLocalServer(webappRoot: string): LocalServer {
	const http: Http = require("http");
	const fs: Fs = require("fs");
	const path: Path = require("path");

	let server: ReturnType<Http["createServer"]> | null = null;
	let currentPort: number | null = null;

	const handler = (req: import("http").IncomingMessage, res: import("http").ServerResponse): void => {
		// CORS headers for iframe embedding
		res.setHeader("Access-Control-Allow-Origin", "*");
		res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
		res.setHeader("Access-Control-Allow-Headers", "Content-Type");

		if (req.method === "OPTIONS") {
			res.writeHead(204);
			res.end();
			return;
		}

		let urlPath = (req.url || "/").split("?")[0];
		if (urlPath === "/") { urlPath = "/index.html"; }

		// Prevent directory traversal
		const safePath = path.normalize(urlPath).replace(/^(\.\.(\/|\\|$))+/, "");
		const filePath = path.join(webappRoot, safePath);

		if (!filePath.startsWith(webappRoot)) {
			res.writeHead(403);
			res.end("Forbidden");
			return;
		}

		fs.stat(filePath, (err, stats) => {
			if (err || !stats.isFile()) {
				res.writeHead(404);
				res.end("Not found");
				return;
			}

			const ext = path.extname(filePath).toLowerCase();
			const contentType = MIME_TYPES[ext] || "application/octet-stream";

			if (ext === ".html") {
				// For HTML files, inject the keyboard override script
				fs.readFile(filePath, "utf8", (readErr, html) => {
					if (readErr) {
						res.writeHead(500);
						res.end("Internal server error");
						return;
					}
					// Inject into the <head> so the capture-phase keydown listener is
					// registered BEFORE draw.io's scripts run (otherwise it can be
					// pre-empted and Ctrl+P / Ctrl+Shift+P get swallowed). Fall back to
					// before </body> if there's no <head>.
					if (/<head[^>]*>/i.test(html)) {
						html = html.replace(/<head[^>]*>/i, (m) => m + KEYBOARD_OVERRIDE_SCRIPT);
					} else {
						html = html.replace("</body>", KEYBOARD_OVERRIDE_SCRIPT + "</body>");
					}
					// no-store so a rebuilt extension always re-fetches freshly
					// injected HTML instead of a cached (possibly un-injected) copy.
					res.writeHead(200, {
						"Content-Type": contentType,
						"Cache-Control": "no-store",
					});
					res.end(html);
				});
			} else {
				res.writeHead(200, { "Content-Type": contentType });
				fs.createReadStream(filePath).pipe(res);
			}
		});
	};

	return {
		get port() { return currentPort; },

		start(): Promise<number> {
			return new Promise((resolve, reject) => {
				if (server) {
					resolve(currentPort!);
					return;
				}

				server = http.createServer(handler);

				// Listen on random available port
				server.listen(0, "127.0.0.1", () => {
					currentPort = (server!.address() as { port: number }).port;
					resolve(currentPort);
				});

				server.on("error", (err) => {
					console.error("drawio-inline-editor: local server error:", err);
					reject(err);
				});
			});
		},

		stop(): void {
			if (server) {
				server.close();
				server = null;
				currentPort = null;
			}
		},
	};
}
