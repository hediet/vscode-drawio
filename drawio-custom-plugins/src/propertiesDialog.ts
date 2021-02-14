import "./styles.css";
import * as m from "mithril";

export function showDialog(ui: DrawioUI) {
	const node = ui.fileNode;

	if (node == null) {
		return;
	}

	const initialScale = parseFloat(node.getAttribute("scale") || "1");
	const initialBorder = parseFloat(node.getAttribute("border") || "0");
	const initialLinkTarget = node.getAttribute("linkTarget");
	const initialDisableSvgWarning =
		node.getAttribute("disableSvgWarning") === "true";

	let scale = initialScale;
	let border = initialBorder;
	let linkTarget = initialLinkTarget;
	let disableSvgWarning = initialDisableSvgWarning;

	var div = document.createElement("div");
	div.style.height = "100%";
	m.render(
		div,
		m(
			"properties-dialog.div",
			{
				style: {
					fontFamily: "Segoe WPC,Segoe UI,sans-serif",
					display: "flex",
					flexDirection: "column",
					height: "100%",
				},
			},
			[
				m(
					"div",
					{
						style: {
							display: "flex",
							flexDirection: "column",
						},
					},
					[
						m(
							"h2",
							{ style: { marginTop: "4px" } },
							"Export Properties"
						),
						m(
							"div",
							{
								style: {
									display: "flex",
									flexDirection: "row",
									paddingTop: "8px",
									paddingBottom: "4px",
								},
							},
							[
								m("div", {}, mxResources.get("zoom") + ":"),
								m("div", { style: { flex: 1 } }),
								m("input", {
									value: scale * 100 + "%",
									oninput: (e: any) => {
										scale = Math.min(
											20,
											Math.max(
												0.01,
												parseInt(e.target.value) / 100
											)
										);
									},
								}),
							]
						),
						m(
							"div",
							{
								style: {
									display: "flex",
									flexDirection: "row",
									paddingBottom: "4px",
								},
							},
							[
								m(
									"div",
									{},
									mxResources.get("borderWidth") + ":"
								),
								m("div", { style: { flex: 1 } }),
								m("input", {
									value: border,
									oninput: (e: any) => {
										border = Math.max(
											0,
											parseInt(e.target.value)
										);
									},
								}),
							]
						),
						m(
							"div",
							{
								style: {
									display: "flex",
									flexDirection: "row",
									paddingBottom: "4px",
								},
							},
							[
								m("div", {}, mxResources.get("links") + ":"),
								m("div", { style: { flex: 1 } }),
								m(
									"select.geBtn",
									{
										value: linkTarget || "",
										oninput: (e: any) => {
											linkTarget = e.target.value;
										},
									},
									[
										m(
											"option",
											{ value: "" },
											mxResources.get("automatic")
										),
										m(
											"option",
											{ value: "_blank" },
											mxResources.get("openInNewWindow")
										),
										m(
											"option",
											{ value: "_top" },
											mxResources.get("openInThisWindow")
										),
									]
								),
							]
						),
						m(
							"div",
							{
								style: {
									display: "flex",
									flexDirection: "row",
									paddingBottom: "4px",
								},
							},
							[
								m("label", {}, [
									m("input", {
										type: "checkbox",
										checked: disableSvgWarning,
										onchange: (e: any) => {
											disableSvgWarning =
												e.target.checked;
										},
									}),
									"Disable SVG 1.1 warning",
								]),
							]
						),
					]
				),
				m("div", { style: { flex: 1 } }),
				m("div", { style: { textAlign: "right" } }, [
					m(
						"button.geBtn",
						{
							onclick: () => {
								ui.hideDialog();
							},
						},
						[mxResources.get("cancel")]
					),
					m(
						"button.geBtn.gePrimaryBtn",
						{
							onclick: () => {
								ui.hideDialog();

								if (
									scale === initialScale &&
									border === initialBorder &&
									linkTarget === initialLinkTarget &&
									disableSvgWarning ===
										initialDisableSvgWarning
								) {
									return;
								}

								if (linkTarget) {
									node.setAttribute("linkTarget", linkTarget);
								} else {
									node.removeAttribute("linkTarget");
								}
								node.setAttribute("scale", "" + scale);
								node.setAttribute("border", "" + border);

								if (disableSvgWarning) {
									node.setAttribute(
										"disableSvgWarning",
										"true"
									);
								} else {
									node.removeAttribute("disableSvgWarning");
								}

								ui.actions.get("save").funct();
							},
						},
						[mxResources.get("apply")]
					),
				]),
			]
		)
	);

	ui.showDialog(div, 350, 200, true, true);
}
