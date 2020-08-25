import { EventEmitter } from "@hediet/std/events";
import { DrawioInstance } from "./DrawioInstance";

/**
 * Enhances the drawio client with custom events and methods.
 * They require modifications of the official drawio source or plugins.
 */
export class CustomDrawioInstance extends DrawioInstance<
	CustomDrawioAction,
	CustomDrawioEvent
> {
	private readonly onNodeSelectedEmitter = new EventEmitter<{
		label: string;
		linkedData: unknown;
	}>();
	public readonly onNodeSelected = this.onNodeSelectedEmitter.asEvent();

	private readonly onCustomPluginLoadedEmitter = new EventEmitter();
	public readonly onCustomPluginLoaded = this.onCustomPluginLoadedEmitter.asEvent();

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

	protected async handleEvent(evt: CustomDrawioEvent): Promise<void> {
		if (evt.event === "nodeSelected") {
			this.onNodeSelectedEmitter.emit({
				label: evt.label,
				linkedData: evt.linkedData,
			});
		} else if (evt.event === "pluginLoaded") {
			this.onCustomPluginLoadedEmitter.emit();
		} else {
			await super.handleEvent(evt);
		}
	}
}
