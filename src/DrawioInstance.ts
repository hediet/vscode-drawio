import { EventEmitter } from "@hediet/std/events";
import { Disposable } from "@hediet/std/disposable";

export class DrawioInstance {
	public readonly dispose = Disposable.fn();

	private readonly onInitEmitter = new EventEmitter();
	public readonly onInit = this.onInitEmitter.asEvent();

	private readonly onChangeEmitter = new EventEmitter<DrawioDocumentChange>();
	public readonly onChange = this.onChangeEmitter.asEvent();

	private readonly onSaveEmitter = new EventEmitter();
	public readonly onSave = this.onSaveEmitter.asEvent();

	// This is always up to date, except directly after calling load.
	private currentXml: string | undefined = undefined;

	constructor(private readonly messageStream: MessageStream) {
		this.dispose.track(
			messageStream.registerMessageHandler((msg) =>
				this.handleEvent(JSON.parse(msg as string) as DrawioEvent)
			)
		);
	}

	private currentActionId = 0;
	private responseHandlers = new Map<
		string,
		(response: DrawioEvent) => void
	>();

	private sendAction(
		action: DrawioAction,
		expectResponse: boolean = false
	): Promise<DrawioEvent> {
		return new Promise((resolve) => {
			const actionId = "" + this.currentActionId++;
			if (expectResponse) {
				this.responseHandlers.set(actionId, (response) =>
					resolve(response)
				);
			}
			this.messageStream.sendMessage(
				JSON.stringify(Object.assign(action, { actionId }))
			);
			if (!expectResponse) {
				resolve();
			}
		});
	}

	private handleEvent(msg: DrawioEvent): void {
		if (msg.event === "init") {
			this.onInitEmitter.emit();
		} else if (msg.event === "autosave") {
			const newXml = msg.xml;
			const oldXml = this.currentXml;
			this.currentXml = newXml;

			this.onChangeEmitter.emit({ newXml, oldXml });
		} else if (msg.event === "save") {
			this.onSaveEmitter.emit();
		} else if (msg.event === "export") {
			if (!("message" in msg)) {
				// sometimes, message is not includen :(
				const vals = [...this.responseHandlers.values()];
				if (vals.length !== 1) {
					throw new Error("Communication Error");
				}
				vals[0](msg);
			}
			// do nothing
		} else if (msg.event === "configure") {
			this.sendAction({
				action: "configure",
				config: {
					compressXml: false,
				},
			});
		}

		if ("message" in msg) {
			const actionId = (msg.message as any).actionId as
				| string
				| undefined;
			if (actionId) {
				const responseHandler = this.responseHandlers.get(actionId);
				this.responseHandlers.delete(actionId);
				if (responseHandler) {
					responseHandler(msg);
				}
			}
		}
	}

	public loadXml(xml: string) {
		this.currentXml = undefined;
		this.sendAction({
			action: "load",
			xml: xml,
			autosave: 1,
		});
	}

	public async loadPngWithEmbeddedXml(png: Uint8Array): Promise<void> {
		let str = Buffer.from(png).toString("base64");
		this.loadXml("data:image/png;base64," + str);
	}

	public async export(extension: string): Promise<Buffer> {
		if (extension === ".png") {
			return await this.exportAsPngWithEmbeddedXml();
		} else if (extension === ".drawio") {
			const xml = await this.getXml();
			return Buffer.from(xml, "utf-8");
		} else {
			throw new Error(
				`Invalid file extension "${extension}"! Only ".png" and ".drawio" are supported.`
			);
		}
	}

	public async getXml(): Promise<string> {
		if (!this.currentXml) {
			const response = await this.sendAction(
				{
					action: "export",
					format: "xml",
				},
				true
			);
			if (response.event !== "export") {
				throw new Error("Unexpected response");
			}

			if (!this.currentXml) {
				// It might have been changed in the meantime.
				// Always trust autosave.
				this.currentXml = response.xml;
			}
		}
		return this.currentXml;
	}

	public async exportAsPngWithEmbeddedXml(): Promise<Buffer> {
		const response = await this.sendAction(
			{
				action: "export",
				format: "xmlpng",
			},
			true
		);
		if (response.event !== "export") {
			throw new Error("Unexpected response");
		}
		const start = "data:image/png;base64,";
		if (!response.data.startsWith(start)) {
			throw new Error("Invalid data");
		}
		const base64Data = response.data.substr(start.length);
		return Buffer.from(base64Data, "base64");
	}
}

export interface DrawioDocumentChange {
	oldXml: string | undefined;
	newXml: string;
}

export interface MessageStream {
	registerMessageHandler(handler: (message: unknown) => void): Disposable;
	sendMessage(message: unknown): void;
}

type DrawioEvent =
	| {
			event: "init";
	  }
	| {
			event: "autosave";
			xml: string;
	  }
	| {
			event: "save";
			xml: string;
	  }
	| {
			event: "export";
			data: string;
			format: DrawioFormat;
			xml: string;
			message: DrawioEvent;
	  }
	| {
			event: "configure";
	  };

type DrawioAction =
	| { action: "load"; xml: string; autosave?: 1 }
	| {
			action: "prompt";
	  }
	| {
			action: "template";
	  }
	| {
			action: "draft";
	  }
	| {
			action: "export";
			format: DrawioFormat;
	  }
	| {
			action: "configure";
			config: {
				compressXml?: boolean;
			};
	  };

type DrawioFormat = "html" | "xmlpng" | "png" | "xml";
