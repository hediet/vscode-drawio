import { EventEmitter } from "@hediet/std/events";
import { DrawioClient } from "./DrawioClient";

/**
 * Enhances the drawio client with custom events and methods.
 * They require modifications of the official drawio source or plugins.
 */
export class CustomizedDrawioClient extends DrawioClient<
	CustomDrawioAction,
	CustomDrawioEvent
> {
	private readonly onNodeSelectedEmitter = new EventEmitter<{
		label: string;
		linkedData: unknown;
	}>();
	public readonly onNodeSelected = this.onNodeSelectedEmitter.asEvent();

	private readonly onCustomPluginLoadedEmitter = new EventEmitter<{
		pluginId: string;
	}>();
	public readonly onCustomPluginLoaded =
		this.onCustomPluginLoadedEmitter.asEvent();

	private readonly onCursorChangeEmitter = new EventEmitter<{
		newPosition: Point | undefined;
	}>();
	public readonly onCursorChanged = this.onCursorChangeEmitter.asEvent();

	private readonly onSelectedCellsChangedEmitter = new EventEmitter<{
		selectedCellIds: string[];
	}>();
	public readonly onSelectedCellsChanged =
		this.onSelectedCellsChangedEmitter.asEvent();

	private readonly onSelectedRectangleChangedEmitter = new EventEmitter<{
		rectangle: { start: Point; end: Point } | undefined;
	}>();
	public readonly onSelectedRectangleChanged =
		this.onSelectedRectangleChangedEmitter.asEvent();

	private readonly onFocusChangedEmitter = new EventEmitter<{
		hasFocus: boolean;
	}>();
	public readonly onFocusChanged = this.onFocusChangedEmitter.asEvent();

	private readonly onInvokeCommandEmitter = new EventEmitter<{
		command: InvokeCommandEvent["command"];
	}>();
	public readonly onInvokeCommand = this.onInvokeCommandEmitter.asEvent();

	public linkSelectedNodeWithData(linkedData: unknown) {
		this.sendCustomAction({
			action: "linkSelectedNodeWithData",
			linkedData,
		});
	}

	public async getVertices(): Promise<{ id: string; label: string }[]> {
		const response = await this.sendCustomActionExpectResponse({
			action: "getVertices",
		});
		if (response.event !== "getVertices") {
			throw new Error("Invalid Response");
		}

		return response.vertices;
	}

	public setNodeSelectionEnabled(enabled: boolean): void {
		this.sendCustomAction({
			action: "setNodeSelectionEnabled",
			enabled,
		});
	}

	public updateVertices(verticesToUpdate: { id: string; label: string }[]) {
		this.sendCustomAction({
			action: "updateVertices",
			verticesToUpdate,
		});
	}

	public addVertices(vertices: { label: string }[]) {
		this.sendCustomAction({
			action: "addVertices",
			vertices,
		});
	}

	public updateLiveshareViewState(update: {
		cursors: ParticipantCursorInfo[];
		selectedCells: ParticipantSelectedCellsInfo[];
		selectedRectangles: ParticipantSelectedRectangleInfo[];
	}) {
		this.sendCustomAction({
			action: "updateLiveshareViewState",
			...update,
		});
	}

	public askForDonations(): void {
		this.sendCustomAction({
			action: "askForDonations",
		});
	}

	protected async handleEvent(evt: CustomDrawioEvent): Promise<void> {
		if (evt.event === "nodeSelected") {
			this.onNodeSelectedEmitter.emit({
				label: evt.label,
				linkedData: evt.linkedData,
			});
		} else if (evt.event === "pluginLoaded") {
			this.onCustomPluginLoadedEmitter.emit({ pluginId: evt.pluginId });
		} else if (evt.event === "focusChanged") {
			this.onFocusChangedEmitter.emit({ hasFocus: evt.hasFocus });
		} else if (evt.event === "cursorChanged") {
			this.onCursorChangeEmitter.emit({ newPosition: evt.position });
		} else if (evt.event === "selectedCellsChanged") {
			this.onSelectedCellsChangedEmitter.emit({
				selectedCellIds: evt.selectedCellIds,
			});
		} else if (evt.event === "invokeCommand") {
			this.onInvokeCommandEmitter.emit({ command: evt.command });
		} else if (evt.event === "selectedRectangleChanged") {
			this.onSelectedRectangleChangedEmitter.emit({
				rectangle: evt.rect,
			});
		} else {
			await super.handleEvent(evt);
		}
	}
}

interface Point {
	x: number;
	y: number;
}
