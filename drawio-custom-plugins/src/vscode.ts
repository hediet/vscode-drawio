export function sendEvent(data: CustomDrawioEvent) {
	if (window.opener) {
		const targetOrigin = document.referrer ? new URL(document.referrer).origin : null;
		if (!targetOrigin) {
			console.warn("Cannot send event: missing target origin", data);
			return;
		}
		window.opener.postMessage(JSON.stringify(data), targetOrigin);
	} else {
		console.log("sending >>>", data);
	}
}
