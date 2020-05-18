//# sourceURL=C:\Users\Henning\Desktop\hediet\vscode-drawio\drawio\src\main\webapp\plugins\foo.js

function sendEvent(data) {
	window.parent.postMessage(JSON.stringify(data), "*");
}

Draw.loadPlugin(function (ui) {
	console.log("Registering Node Data Linker Plugin");

	const graph = ui.editor.graph;

	/** @type {{ setStyle(cell: unknown, style: string): void }} */
	const model = graph.model;
	/** @type {{ style: string } | undefined} */
	let activeCell = undefined;

	const selectionModel = graph.getSelectionModel();
	selectionModel.addListener(mxEvent.CHANGE, function (sender, evt) {
		// selection has changed
		const cells = selectionModel.cells; // array of cells
		if (cells.length >= 1) {
			const selectedCell = cells[0];
			activeCell = selectedCell;
			window.hediet_Cell = selectedCell;

			const data = getLinkedData(selectedCell);
			if (data !== undefined) {
				sendEvent({ event: "revealCode", linkedData: data });
			}
		} else {
			activeCell = undefined;
		}
	});

	function getLinkedData(cell) {
		const style = ParsedStyle.parse(cell.style);
		const value = style.getValue("hedietLinkedData");
		if (!value) {
			return undefined;
		}
		return atob(value);
	}

	function setLinkedData(cell, linkedData) {
		const style = ParsedStyle.parse(cell.style);

		if (linkedData === undefined) {
			style.removeValue("hedietLinkedData");
		} else {
			style.setValue("hedietLinkedData", btoa(linkedData));
		}
		console.log("New style: " + style.toString());
		model.setStyle(cell, style.toString());
	}

	window.addEventListener("message", (evt) => {
		const data = JSON.parse(evt.data);
		if (data.action === "linkSelectedNodeWithData") {
			if (activeCell !== undefined) {
				console.log("Set linkedData to " + data.linkedData);
				setLinkedData(activeCell, data.linkedData);
			}
			evt.preventDefault();
		}
	});

	window.addEventListener("blur", () => {
		sendEvent({ event: "onBlur" });
	});

	window.hediet_DbgUi = ui;
});

// Live Share:
// search highlight.highlight in plugins
// cell.id

/**
 * @typedef {{ key: string, value: string | undefined }} Item
 */
class ParsedStyle {
	/**
	 * @param text {string}
	 * @returns {ParsedStyle}
	 */
	static parse(text) {
		const items = text.split(";");
		return new ParsedStyle(
			items.map((i) => {
				const parts = i.split("=", 2);
				return { key: parts[0], value: parts[1] };
			})
		);
	}

	/**
	 * @param items {Item[]}
	 */
	constructor(items) {
		/** @type {Item[]} */
		this.items = items;
	}

	/**
	 * @param key {string}
	 * @param value {string|undefined}
	 */
	setValue(key, value) {
		for (let item of this.items) {
			if (item.key === key) {
				item.value = value;
				return;
			}
		}
		this.items.push({ key, value });
	}

	/**
	 * @param key {string}
	 */
	getValue(key) {
		for (let item of this.items) {
			if (item.key === key) {
				return item.value;
				return;
			}
		}
		return undefined;
	}

	/**
	 * @param key {string}
	 */
	removeValue(key) {
		this.items = this.items.filter((i) => i.key !== key);
	}

	/**
	 * @returns {string}
	 */
	toString() {
		return this.items
			.map((i) => (i.value === undefined ? i.key : i.key + "=" + i.value))
			.join(";");
	}
}
