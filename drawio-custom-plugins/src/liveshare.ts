import { sendEvent } from "./vscode";

Draw.loadPlugin((ui) => {
	sendEvent({ event: "pluginLoaded", pluginId: "LiveShare" });

	const graph = ui.editor.graph;
	const selectionModel = graph.getSelectionModel();

	selectionModel.addListener(mxEvent.CHANGE, () => {
		const cells = selectionModel.cells;
		sendEvent({
			event: "selectionChanged",
			selectedCellIds: cells.map((c) => c.id),
		});
	});

	const cursors = new Set<Cursor>();
	const hightlights = new Highlights(graph);

	window.addEventListener("message", (evt) => {
		if (evt.source !== window.opener) {
			return;
		}
		const data = JSON.parse(evt.data) as CustomDrawioAction;

		switch (data.action) {
			case "updateGhostCursors": {
				for (const c of cursors) {
					if (!data.cursors.some((c) => c.id === c.id)) {
						cursors.delete(c);
						c.dispose();
					}
				}
				for (const c of data.cursors) {
					const existing =
						[...cursors].find(
							(existingCursor) => existingCursor.id === c.id
						) || new Cursor(graph.view.canvas, c.id);
					cursors.add(existing);
					existing.setPosition(transform(c.position));
				}
				break;
			}
			case "updateGhostSelections": {
				const highlightInfos = new Array<HighlightInfo>();
				for (const s of data.selections) {
					for (const selectedCellId of s.selectedCellIds) {
						const cell = graph.model.cells[selectedCellId];
						highlightInfos.push({ cell, color: "#00ff00" });
					}
				}
				hightlights.updateHighlights(highlightInfos);
			}
		}
	});

	function transform({ x, y }: { x: number; y: number }) {
		const { scale, translate } = graph.view as any;
		return { x: (x + translate.x) * scale, y: (y + translate.y) * scale };
	}

	function transformBack({ x, y }: { x: number; y: number }) {
		const { scale, translate } = graph.view as any;
		return { x: x / scale - translate.x, y: y / scale - translate.y };
	}

	graph.addMouseListener({
		mouseMove: (graph: DrawioGraph, event: mxMouseEvent) => {
			const pos = { x: event.graphX, y: event.graphY };
			const graphPos = transformBack(pos);
			sendEvent({ event: "cursorChanged", position: graphPos });
		},
		mouseDown: () => {},
		mouseUp: () => {},
	});
});

const svgns = "http://www.w3.org/2000/svg";

class Cursor {
	private readonly g = document.createElementNS(svgns, "g");

	constructor(canvas: SVGElement, public readonly id: string) {
		canvas.appendChild(this.g);
		this.g.setAttribute("pointer-events", "none");
		this.g.innerHTML = `
            <g transform="scale(0.06,0.06)">
                <path fill="green" d="M302.189 329.126H196.105l55.831 135.993c3.889 9.428-.555 19.999-9.444 23.999l-49.165 21.427c-9.165 4-19.443-.571-23.332-9.714l-53.053-129.136-86.664 89.138C18.729 472.71 0 463.554 0 447.977V18.299C0 1.899 19.921-6.096 30.277 5.443l284.412 292.542c11.472 11.179 3.007 31.141-12.5 31.141z"/>
            </g>
        `;
	}

	public setPosition(pos: { x: number; y: number }) {
		this.g.setAttribute("transform", `translate(${pos.x}, ${pos.y})`);
	}

	public dispose(): void {
		this.g.remove();
	}
}

interface HighlightInfo {
	color: string;
	cell: DrawioCell;
}

class Highlights {
	private readonly highlights = new Map<
		string,
		{ info: HighlightInfo; instance: mxCellHighlight }
	>();

	constructor(private readonly graph: DrawioGraph) {}

	private highlightInfoToStr(info: HighlightInfo): string {
		return JSON.stringify({ color: info.color, cell: info.cell.id });
	}

	public updateHighlights(highlights: HighlightInfo[]): void {
		const set = new Set(highlights.map((h) => this.highlightInfoToStr(h)));

		for (const [key, h] of this.highlights) {
			if (!set.has(key)) {
				h.instance.destroy();
				this.highlights.delete(key);
			}
		}

		for (const h of highlights) {
			const key = this.highlightInfoToStr(h);
			if (!this.highlights.has(key)) {
				const obj = {
					info: h,
					instance: new mxCellHighlight(this.graph, h.color, 8),
				};
				this.highlights.set(key, obj);
				obj.instance.highlight(this.graph.view.getState(h.cell));
			}
		}
	}
}
