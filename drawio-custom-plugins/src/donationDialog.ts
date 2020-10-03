import "./styles.css";
import * as m from "mithril";
import { sendEvent } from "./vscode";

Draw.loadPlugin((ui) => {
	function showDialog() {
		var div = document.createElement("div");
		div.style.height = "100%";
		m.render(
			div,
			m(
				"sponsor-dialog.div",
				{
					style: {
						fontFamily: "Segoe WPC,Segoe UI,sans-serif",
						display: "flex",
						flexDirection: "column",
						height: "100%",
					},
				},
				[
					m("h1", ["Thank You for Your Support!"]),
					m(
						"p",
						"This unofficial extension that brings Draw.io to VS Code was made possible by awesome sponsors and generous donations - thank you so much for that!"
					),
					m(
						"p",
						"If you like this extension and want to see more open source projects like this, please consider donating too, if you haven't already!"
					),

					m("p", "By the way: Did you know that you can...", [
						m("ul", {}, [
							m(
								"li",
								"convert your diagram to SVG so that it is an SVG file and draw.io diagram at the same time?"
							),
							m(
								"li",
								"use liveshare to present or edit diagrams collaboratively?"
							),
							m("li", "paste screenshots into a diagram?"),
							m(
								"li",
								'link a screenshot of a react component "MyComponent" with its source by naming the node "#MyComponent"?'
							),
						]),
					]),
					m("div", { style: { flex: 1 } }),
					m("div", { style: { textAlign: "right" } }, [
						m(
							"button.geBtn",
							{
								onclick: () => {
									ui.hideDialog();
								},
							},
							["Thanks, but I don't want to donate (yet)"]
						),
						m(
							"button.geBtn.gePrimaryBtn",
							{
								onclick: () => {
									ui.hideDialog();
									sendEvent({
										event: "invokeCommand",
										command: "openDonationPage",
									});
								},
							},
							["I'd like to donate ❤️"]
						),
					]),
				]
			)
		);

		ui.showDialog(div, 650, 380, true, false);
	}

	let loadAction: (() => void) | undefined;
	let loaded = false;
	window.addEventListener("message", (evt) => {
		if (evt.source !== window.opener) {
			return;
		}

		const data = JSON.parse(evt.data) as
			| CustomDrawioAction
			| { action: "load" };
		if (data.action === "load") {
			loaded = true;
			if (loadAction) {
				loadAction();
			}
		}

		if (data.action === "askForDonations") {
			if (loaded) {
				showDialog();
			} else {
				// only show dialog after load happened
				loadAction = () => {
					loadAction = undefined;
					showDialog();
				};
			}
		}
	});
});
