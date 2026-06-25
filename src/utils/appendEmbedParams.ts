/**
 * Appends draw.io embed query parameters to a base editor URL.
 *
 * The base may be:
 *  - a bare host (the local server, `http://127.0.0.1:PORT`),
 *  - a host with a trailing slash (the default online URL,
 *    `https://embed.diagrams.net/`), or
 *  - a full path that already carries its own query string — e.g. a local dev
 *    build pointed at via the `hediet.vscode-drawio.online-url` setting:
 *    `http://localhost/.../index.html?dev=1&test=1&embed=1`.
 *
 * Existing query parameters on the base are preserved; ours are appended with
 * `&`. `params` is the query string WITHOUT a leading `?`/`&`.
 */
export function appendEmbedParams(base: string, params: string): string {
	try {
		const u = new URL(base);
		u.search = (u.search ? u.search + "&" : "?") + params;
		return u.href;
	} catch {
		// Fallback for a non-absolute / unparseable base.
		return base + (base.includes("?") ? "&" : "/?") + params;
	}
}
