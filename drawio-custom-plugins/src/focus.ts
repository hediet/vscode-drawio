import { sendEvent } from "./vscode";

Draw.loadPlugin((ui) => {
	sendEvent({ event: "pluginLoaded", pluginId: "focus" });

	if (document.hasFocus()) {
		sendEvent({ event: "focusChanged", hasFocus: true });
	} else {
		sendEvent({ event: "focusChanged", hasFocus: false });
	}

	window.addEventListener("focus", () => {
		sendEvent({ event: "focusChanged", hasFocus: true });
	});

	window.addEventListener("blur", () => {
		sendEvent({ event: "focusChanged", hasFocus: false });
	});
});
