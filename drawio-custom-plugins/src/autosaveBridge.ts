import { sendEvent } from "./vscode";

/**
 * Safety net for draw.io's embed autosave.
 *
 * draw.io v30.2.7 stopped emitting the embed 'autosave' message on edit in the
 * VS Code webview (regression vs v30.2.5: the built-in change listener is armed
 * on the live model but never fires here). Without that message the host never
 * learns the diagram changed, so the editor tab never gets its modified dot and
 * edits are silently lost when the tab is closed.
 *
 * This plugin reproduces the embed autosave directly from the graph model and
 * posts the same { event: "autosave", xml } the host already consumes
 * (DrawioClient.handleEvent -> onChange -> document dirty). It is idempotent:
 * DrawioClient guards on oldXml !== xml, so once draw.io fixes the built-in
 * embed autosave upstream this becomes a harmless no-op and can be removed.
 */
Draw.loadPlugin((ui) => {
	const u = ui as any;

	// Mirrors EditorUi.getData() in diagramly/EditorUi.js so the XML we post
	// matches what draw.io's own embed autosave would have sent.
	function getData(): string {
		const up = (window as any).urlParams || {};
		if (up["pages"] != "0" || (u.pages != null && u.pages.length > 1)) {
			return u.getFileData(true);
		}
		return (mxUtils as any).getXml(u.editor.getGraphXml());
	}

	let lastData: string | null = null;
	let ready = false;

	function baseline(): void {
		try {
			lastData = getData();
		} catch (e) {
			/* graph not populated yet */
		}
		ready = true;
	}

	function post(): void {
		if (!ready) {
			return;
		}
		let data: string;
		try {
			data = getData();
		} catch (e) {
			return;
		}
		if (data !== lastData) {
			lastData = data;
			sendEvent({ event: "autosave", xml: data });
		}
	}

	u.editor.graph.model.addListener(mxEvent.CHANGE, post);

	// Options that dirty the file without going through the model (matches the
	// listener set draw.io's own embed autosave attaches).
	u.editor.graph.addListener("gridSizeChanged", post);
	u.editor.graph.addListener("shadowVisibleChanged", post);
	u.addListener("pageFormatChanged", post);
	u.addListener("pageScaleChanged", post);
	u.addListener("backgroundColorChanged", post);
	u.addListener("backgroundImageChanged", post);
	u.addListener("foldingEnabledChanged", post);
	u.addListener("mathEnabledChanged", post);

	// Re-baseline after each host 'load' so the model changes the load itself
	// produces are not reported as edits. The setTimeout(0) runs after draw.io
	// has processed the load (and fired its synchronous CHANGE events) within
	// the same message dispatch, so lastData captures the freshly-loaded state.
	window.addEventListener("message", (evt: MessageEvent) => {
		let d: any;
		try {
			d = JSON.parse(evt.data);
		} catch (e) {
			return;
		}
		if (d && d.action === "load") {
			ready = false;
			setTimeout(baseline, 0);
		}
	});

	sendEvent({ event: "pluginLoaded", pluginId: "AutosaveBridge" });
});
