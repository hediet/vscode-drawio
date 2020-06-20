import { EventEmitter } from "@hediet/std/events";
import { Disposable } from "@hediet/std/disposable";
import { groupBy } from "./utils/groupBy";

export class DrawioInstance {
	public readonly dispose = Disposable.fn();

	private readonly onInitEmitter = new EventEmitter();
	public readonly onInit = this.onInitEmitter.asEvent();

	private readonly onChangeEmitter = new EventEmitter<DrawioDocumentChange>();
	public readonly onChange = this.onChangeEmitter.asEvent();

	private readonly onSaveEmitter = new EventEmitter();
	public readonly onSave = this.onSaveEmitter.asEvent();

	private readonly onUnknownMessageEmitter = new EventEmitter<{
		message: { event: string };
	}>();
	public readonly onUnknownMessage = this.onUnknownMessageEmitter.asEvent();

	// This is always up to date, except directly after calling load.
	private currentXml: string | undefined = undefined;

	constructor(
		private readonly messageStream: MessageStream,
		private readonly getConfig: () => Promise<DrawioConfig>
	) {
		this.dispose.track(
			messageStream.registerMessageHandler((msg) =>
				this.handleEvent(JSON.parse(msg as string) as DrawioEvent)
			)
		);
	}

	private currentActionId = 0;
	private responseHandlers = new Map<
		string,
		{ resolve: (response: DrawioEvent) => void; reject: () => void }
	>();

	protected sendUnknownAction(action: { action: string }): void {
		this.messageStream.sendMessage(JSON.stringify(Object.assign(action)));
	}

	private sendAction(
		action: DrawioAction,
		expectResponse: boolean = false
	): Promise<DrawioEvent> {
		return new Promise((resolve, reject) => {
			const actionId = (this.currentActionId++).toString();
			if (expectResponse) {
				this.responseHandlers.set(actionId, {
					resolve: (response) => {
						this.responseHandlers.delete(actionId);
						resolve(response);
					},
					reject,
				});
			}
			this.messageStream.sendMessage(
				JSON.stringify(Object.assign(action, { actionId }))
			);
			if (!expectResponse) {
				resolve();
			}
		});
	}

	protected async handleEvent(evt: { event: string }): Promise<void> {
		const drawioEvt = evt as DrawioEvent;
		if (drawioEvt.event === "init") {
			this.onInitEmitter.emit();
		} else if (drawioEvt.event === "autosave") {
			const newXml = drawioEvt.xml;
			const oldXml = this.currentXml;
			this.currentXml = newXml;

			this.onChangeEmitter.emit({ newXml, oldXml });
		} else if (drawioEvt.event === "save") {
			this.onSaveEmitter.emit();
		} else if (drawioEvt.event === "export") {
			if (!("message" in drawioEvt)) {
				// sometimes, message is not included :(
				const vals = [...this.responseHandlers.values()];
				this.responseHandlers.clear();
				if (vals.length !== 1) {
					for (const val of vals) {
						val.reject();
					}
				} else {
					vals[0].resolve(drawioEvt);
				}
			}
			// do nothing
		} else if (drawioEvt.event === "configure") {
			const config = await this.getConfig();
			this.sendAction({
				action: "configure",
				config,
			});
		} else {
			this.onUnknownMessageEmitter.emit({ message: drawioEvt });
		}

		if ("message" in drawioEvt) {
			const actionId = (drawioEvt.message as any).actionId as
				| string
				| undefined;
			if (actionId) {
				const responseHandler = this.responseHandlers.get(actionId);
				this.responseHandlers.delete(actionId);
				if (responseHandler) {
					responseHandler.resolve(drawioEvt);
				}
			}
		}
	}

	public async mergeXmlLike(xmlLike: string): Promise<void> {
		const evt = await this.sendAction(
			{ action: "merge", xml: xmlLike },
			true
		);

		if (evt.event !== "merge") {
			throw new Error("Invalid response");
		}
		if (evt.error) {
			throw new Error(evt.error);
		}
	}

	/**
	 * This loads an xml or svg+xml Draw.io diagram.
	 */
	public loadXmlLike(xmlLike: string) {
		if (xmlLike === "") {
			// see https://github.com/jgraph/drawio/issues/915
			xmlLike = `
<mxfile host="localhost" modified="2020-05-14T13:54:05.771Z" agent="5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Code/1.45.0 Chrome/78.0.3904.130 Electron/7.2.4 Safari/537.36" etag="eoEzpxJQLkNMd8Iw5vpY" version="13.0.9">
	<diagram id="6hGFLwfOUW9BJ-s0fimq" name="Page-1">
		<mxGraphModel dx="606" dy="468" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="827" pageHeight="1169" math="0" shadow="0">
			<root>
				<mxCell id="0"/>
				<mxCell id="1" parent="0"/>
			</root>
		</mxGraphModel>
	</diagram>
</mxfile>`;
		}

		this.currentXml = undefined;
		this.sendAction({
			action: "load",
			xml: xmlLike,
			autosave: 1,
		});
	}

	public async loadPngWithEmbeddedXml(png: Uint8Array): Promise<void> {
		let str = Buffer.from(png).toString("base64");
		this.loadXmlLike("data:image/png;base64," + str);
	}

	public async export(extension: string): Promise<Buffer> {
		if (extension.endsWith(".png")) {
			return await this.exportAsPngWithEmbeddedXml();
		} else if (
			extension.endsWith(".drawio") ||
			extension.endsWith(".dio")
		) {
			const xml = await this.getXml();
			return Buffer.from(xml, "utf-8");
		} else if (extension.endsWith(".svg")) {
			return await this.exportAsSvgWithEmbeddedXml();
		} else {
			throw new Error(
				`Invalid file extension "${extension}"! Only ".png", ".svg" and ".drawio" are supported.`
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

	public async exportAsSvgWithEmbeddedXml(): Promise<Buffer> {
		const response = await this.sendAction(
			{
				action: "export",
				format: "xmlsvg",
			},
			true
		);
		if (response.event !== "export") {
			throw new Error("Unexpected response");
		}
		const start = "data:image/svg+xml;base64,";
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
			event: "merge";
			error: string;
			message: DrawioEvent;
	  }
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
	| { action: "merge"; xml: string }
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
			config: DrawioConfig;
	  };

// See https://desk.draw.io/support/solutions/articles/16000058316-how-to-configure-draw-io-
export interface DrawioConfig {
	/**
	 * An array of font family names in the format panel font drop-down list.
	 */
	defaultFonts?: string[];

	/**
	 * An array of font family names to be added before defaultFonts (9.2.4 and later).
	 * Note: Fonts must be installed on the server and all client devices, or be added using the fontCss option. (6.5.4 and later).
	 */
	customFonts?: string[];

	/**
	 * Colour codes for the upper palette in the colour dialog (no leading # for the colour codes).
	 */
	presetColors?: string[];

	/**
	 * Colour codes to be added before presetColors (no leading # for the colour codes) (9.2.5 and later).
	 */
	customPresetColors?: string[];

	/**
	 * Available colour schemes in the style section at the top of the format panel (use leading # for the colour codes).
	 * Possible colour keys are fill, stroke, gradient and font (font is ignored for connectors).
	 */
	defaultColorSchemes?: string[];

	/**
	 * Colour schemes to be added before defaultColorSchemes (9.2.4 and later).
	 */
	customColorSchemes?: string[];

	/**
	 * Defines the initial default styles for vertices and edges (connectors).
	 * Note that the styles defined here are copied to the styles of new cells, for each cell.
	 * This means that these values override everything else that is inherited from other styles or themes
	 * (which may be supported at a later time).
	 * Therefore, it is recommended to use a minimal set of values for the default styles.
	 * To find the key/value pairs to be used, set the style in the application and find the key and value via Edit Style (Ctrl+E) (6.5.2 and later).
	 * For example, to assign a default fontFamily of Courier New to all edges and vertices (and override all other default styles),
	 * use
	 * ```json
	 * {
	 * 	"defaultVertexStyle": {"fontFamily": "Courier New"},
	 * 	"defaultEdgeStyle": {"fontFamily": "Courier New"}
	 * }
	 * ```
	 * (6.5.2 and later).
	 */
	defaultVertexStyle?: Record<string, string>;

	/**
	 * See `defaultVertexStyle`.
	 */
	defaultEdgeStyle?: Record<string, string>;

	/**
	 * Defines a string with CSS rules to be used to configure the diagrams.net user interface.
	 * For example, to change the background colour of the menu bar, use the following:
	 * ```css
	 * .geMenubarContainer { background-color: #c0c0c0 !important; }
	 * .geMenubar { background-color: #c0c0c0 !important; }
	 * ```
	 * (6.5.2 and later).
	 */
	css?: string;

	/**
	 * Defines a string with CSS rules for web fonts to be used in diagrams.
	 */
	fontCss?: string;

	/**
	 * Defines a semicolon-separated list of library keys (unique names)
	 * in a string to be initially displayed in the left panel (e.g. "general;uml;company-graphics").
	 * Possible keys include custom entry IDs from the libraries field,
	 * or keys for the libs URL parameter (6.5.2 and later).
	 * The default value is `"general;uml;er;bpmn;flowchart;basic;arrows2"`.
	 */
	defaultLibraries?: string;

	/**
	 * Defines an array of objects that list additional libraries and sections
	 * in the left panel and the More Shapes dialog.
	 */
	libraries?: DrawioLibrarySection[];

	/**
	 * Defines the XML for blank diagrams and libraries (6.5.4 and later).
	 */
	emptyDiagramXml?: string;

	/**
	 * Specifies if the XML output should be compressed. The default is true.
	 */
	compressXml?: boolean;
}

interface DrawioLibrarySection {
	title: DrawioResource;
	entries: {
		id: string;
		preview?: string;
		title: DrawioResource;
		desc?: DrawioResource;
		libs: ({
			title: DrawioResource;
			tags?: string;
		} & ({ data: unknown } | { url: string }))[];
	}[];
}

export interface DrawioLibraryData {
	entryId: string;
	libName: string;
	data: { kind: "value"; value: unknown } | { kind: "url"; url: string };
}

export function simpleDrawioLibrary(
	libs: DrawioLibraryData[]
): DrawioLibrarySection[] {
	function mapLib(lib: DrawioLibraryData) {
		return lib.data.kind === "value"
			? {
					title: res(lib.libName),
					data: lib.data.value,
			  }
			: {
					title: res(lib.libName),
					url: lib.data.url,
			  };
	}

	const groupedLibs = groupBy(libs, (l) => l.entryId);

	return [
		{
			title: res("Custom Libraries"),
			entries: [...groupedLibs.values()].map((group) => ({
				title: res(group.key),
				id: group.key,
				libs: group.items.map(mapLib),
			})),
		},
	];
}

function res(name: string): DrawioResource {
	return {
		main: name,
	};
}

export interface DrawioResource {
	main: string;
}

export type DrawioFormat = "html" | "xmlpng" | "png" | "xml" | "xmlsvg";

export class CustomDrawioInstance extends DrawioInstance {
	private readonly onNodeSelectedEmitter = new EventEmitter<{
		label: string;
		linkedData: unknown;
	}>();
	public readonly onNodeSelected = this.onNodeSelectedEmitter.asEvent();

	public linkSelectedNodeWithData(linkedData: unknown) {
		this.sendUnknownAction({
			action: "linkSelectedNodeWithData",
			linkedData: linkedData,
		} as any);
	}

	protected async handleEvent(evt: { event: string }): Promise<void> {
		if (evt.event === "nodeSelected") {
			const e = evt as { event: string; linkedData: any; label: string };
			this.onNodeSelectedEmitter.emit({
				label: e.label,
				linkedData: e.linkedData,
			});
		} else {
			await super.handleEvent(evt);
		}
	}
}
