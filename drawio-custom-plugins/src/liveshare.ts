import { sendEvent } from "./vscode";
import * as m from "mithril";

Draw.loadPlugin((ui) => {
	setTimeout(() => {
		sendEvent({ event: "pluginLoaded", pluginId: "LiveShare" });

		const graph = ui.editor.graph;
		const selectionModel = graph.getSelectionModel();

		selectionModel.addListener(mxEvent.CHANGE, () => {
			const cells = selectionModel.cells;
			sendEvent({
				event: "selectedCellsChanged",
				selectedCellIds: cells.map((c) => c.id),
			});
		});

		const theme = graph.defaultThemeName === "darkTheme" ? "dark" : "light";

		/*
		new Cursor(graph.view.canvas, "test", {
			color: "#2965CC",
			name: "Henning Dieterichs",
			theme,
		}).setPosition({
			x: 1200,
			y: 800,
		});

		const r = new SelectionRectangle(graph.view.canvas, "test", {
			color: "blue",
		});
		
		r.setPositions(
			{
				x: 1250,
				y: 850,
			},
			{
				x: 1400,
				y: 1000,
			}
		);
		*/

		const cursors = new Set<Cursor>();
		const rectangles = new Set<SelectionRectangle>();
		const hightlights = new Highlights(graph);

		window.addEventListener("message", (evt) => {
			if (evt.source !== window.opener) {
				return;
			}
			const data = JSON.parse(evt.data) as CustomDrawioAction;

			switch (data.action) {
				case "updateLiveshareViewState": {
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
							) ||
							new Cursor(graph.view.canvas, c.id, {
								color: c.color,
								name: c.label || "",
								theme,
							});
						cursors.add(existing);
						existing.setPosition(transform(c.position));
					}

					const highlightInfos = new Array<HighlightInfo>();
					for (const s of data.selectedCells) {
						for (const selectedCellId of s.selectedCellIds) {
							const cell = graph.model.cells[selectedCellId];
							highlightInfos.push({ cell, color: s.color });
						}
					}
					hightlights.updateHighlights(highlightInfos);

					for (const c of rectangles) {
						if (
							!data.selectedRectangles.some((c) => c.id === c.id)
						) {
							rectangles.delete(c);
							c.dispose();
						}
					}
					for (const c of data.selectedRectangles) {
						const existing =
							[...rectangles].find(
								(existingRectangle) =>
									existingRectangle.id === c.id
							) ||
							new SelectionRectangle(graph.view.canvas, c.id, {
								color: c.color,
							});
						rectangles.add(existing);
						existing.setPositions(
							transform(c.rectangle.start),
							transform(c.rectangle.end)
						);
					}

					break;
				}
			}
		});

		function transform({ x, y }: { x: number; y: number }) {
			const { scale, translate } = graph.view as any;
			return {
				x: (x + translate.x) * scale,
				y: (y + translate.y) * scale,
			};
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

		function patchFn(
			clazz: any,
			fnName: string,
			fnFactory: (old: Function) => (this: any, ...args: any) => any
		) {
			const old = clazz[fnName];
			clazz[fnName] = fnFactory(old);
		}

		patchFn(mxRubberband.prototype, "update", function (old) {
			return function (...args: any[]) {
				let first = { ...this.first };
				let second = { x: args[0], y: args[1] };
				old.apply(this, args);

				if (first.x > second.x) {
					const temp = first.x;
					first.x = second.x;
					second.x = temp;
				}
				if (first.y > second.y) {
					const temp = first.y;
					first.y = second.y;
					second.y = temp;
				}

				sendEvent({
					event: "selectedRectangleChanged",
					rect: {
						start: transformBack(first),
						end: transformBack(second),
					},
				});
			};
		});

		patchFn(mxRubberband.prototype, "reset", function (old) {
			return function (...args: any[]) {
				old.apply(this, args);

				sendEvent({
					event: "selectedRectangleChanged",
					rect: undefined,
				});
			};
		});
	});
});

declare class mxRubberband {}

const svgns = "http://www.w3.org/2000/svg";

class SelectionRectangle {
	private readonly g = document.createElementNS(svgns, "g");
	private pos1: { x: number; y: number } = { x: 0, y: 0 };
	private pos2: { x: number; y: number } = { x: 0, y: 0 };

	constructor(
		canvas: SVGElement,
		public readonly id: string,
		private readonly options: { color: string }
	) {
		canvas.appendChild(this.g);
		this.g.setAttribute("pointer-events", "none");
	}

	public setPositions(
		pos1: { x: number; y: number },
		pos2: { x: number; y: number }
	) {
		this.pos1 = pos1;
		this.pos2 = pos2;
		this.render();
	}

	private render() {
		m.render(
			this.g,
			m(
				"rect",
				{
					x: this.pos1.x,
					y: this.pos1.y,
					width: this.pos2.x - this.pos1.x,
					height: this.pos2.y - this.pos1.y,
					style: {
						fill: this.options.color,
						fillOpacity: 0.08,
						stroke: this.options.color,
						strokeOpacity: 0.8,
					},
				},
				[]
			)
		);
	}

	public dispose(): void {
		this.g.remove();
	}
}

interface CursorOptions {
	color: string;
	///borderColor: string;
	name: string;
	theme: "dark" | "light";
}

class Cursor {
	private readonly g = document.createElementNS(svgns, "g");

	constructor(
		canvas: SVGElement,
		public readonly id: string,
		options: CursorOptions
	) {
		canvas.appendChild(this.g);
		this.g.setAttribute("pointer-events", "none");

		m.render(
			this.g,
			m("g", [
				m("g", { transform: "scale(0.06,0.06)" }, [
					m("path", {
						fill: options.color,
						style: {
							stroke:
								options.theme === "dark" ? "white" : "black",
							strokeWidth: 10,
						},
						d:
							"M302.189 329.126H196.105l55.831 135.993c3.889 9.428-.555 19.999-9.444 23.999l-49.165 21.427c-9.165 4-19.443-.571-23.332-9.714l-53.053-129.136-86.664 89.138C18.729 472.71 0 463.554 0 447.977V18.299C0 1.899 19.921-6.096 30.277 5.443l284.412 292.542c11.472 11.179 3.007 31.141-12.5 31.141z",
					}),
				]),
				m(
					"text",
					{
						x: 10,
						y: 45,
						style: {
							fontSize: 12,
							fill: options.theme === "dark" ? "white" : "gray",
						},
					},
					[options.name]
				),
			])
		);
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
