export function sendEvent(data: CustomDrawioEvent) {
	if (window.opener) {
		window.opener.postMessage(JSON.stringify(data), "*");
	} else {
		console.log("sending >>>", data);
	}
}
