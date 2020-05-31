import {
	ConservativeFlattenedEntryParser,
	FlattenToDictionary,
	JSONValue,
} from "@hediet/json-to-dictionary";

declare const Draw: any;
declare const log: any;
declare const mxCellHighlight: any;
declare const mxEvent: any;
declare const mxUtils: {
	isNode(node: any): node is HTMLElement;
	createXmlDocument(): XMLDocument;
};

function sendEvent(data: any) {
	window.opener.postMessage(JSON.stringify(data), "*");
}

Draw.loadPlugin(function (ui: any) {
	log("Registering Node Data Linker Plugin");

	const graph = ui.editor.graph;
	const highlight = new mxCellHighlight(graph, "#00ff00", 8);

	const model: { setStyle(cell: unknown, style: string): void } = graph.model;
	let activeCell: { style: string } | undefined = undefined;

	const selectionModel = graph.getSelectionModel();
	selectionModel.addListener(mxEvent.CHANGE, (sender: any, evt: any) => {
		// selection has changed
		const cells = selectionModel.cells; // array of cells
		if (cells.length >= 1) {
			const selectedCell = cells[0];
			activeCell = selectedCell;
			(window as any).hediet_Cell = selectedCell;

			const data = getLinkedData(selectedCell);
			if (data !== undefined) {
				sendEvent({ event: "revealCode", linkedData: data });
			}
		} else {
			activeCell = undefined;
		}
	});

	const prefix = "hedietLinkedDataV1";
	const flattener = new FlattenToDictionary({
		parser: new ConservativeFlattenedEntryParser({
			prefix,
			separator: "_",
		}),
	});

	function getLinkedData(cell: { value: unknown }) {
		if (!mxUtils.isNode(cell.value)) {
			return undefined;
		}
		const kvs = [...(cell.value.attributes as any)]
			.filter((a) => a.name.startsWith(prefix))
			.map((a) => [a.name, a.value]);

		const r: Record<string, string> = {};
		for (const [k, v] of kvs) {
			r[k] = v;
		}
		return flattener.unflatten(r);
	}

	function setLinkedData(cell: any, linkedData: JSONValue) {
		let newNode: HTMLElement;
		if (!mxUtils.isNode(cell.value)) {
			const doc = mxUtils.createXmlDocument();
			const obj = doc.createElement("object");
			obj.setAttribute("label", cell.value || "");
			newNode = obj;
		} else {
			newNode = cell.value.cloneNode(true);
		}

		for (const a of newNode.attributes as any) {
			if (a.name.startsWith(prefix)) {
				newNode.attributes.removeNamedItem(a.name);
			}
		}

		const kvp = flattener.flatten(linkedData);
		for (const [k, v] of Object.entries(kvp)) {
			newNode.setAttribute(k, v);
		}

		cell.setValue(newNode);
	}

	window.addEventListener("message", (evt) => {
		const data = JSON.parse(evt.data);
		if (data.action === "linkSelectedNodeWithData") {
			if (activeCell !== undefined) {
				log("Set linkedData to " + data.linkedData);
				setLinkedData(activeCell, data.linkedData);
				highlight.highlight(graph.view.getState(activeCell));
				setTimeout(() => {
					highlight.highlight(null);
				}, 500);
			}
			evt.preventDefault();
		}
	});

	(window as any).hediet_DbgUi = ui;
});
