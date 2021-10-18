export type DrawioEvent =
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
			message?: DrawioEvent;
	  }
	| {
			event: "configure";
	  };

export type DrawioAction =
	| {
			action: "load";
			xml: string;
			autosave?: 1;
	  }
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
	customColorSchemes?: ColorScheme[][];

	/**
	 * Config for the style tab in the format panel
	 */
	styles?: Style[];

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
	 * Names for colors, eg. {‘FFFFFF’: ‘White’, ‘000000’: ‘Black’} that are used as tooltips (uppercase, no leading # for the colour codes).
	 */
	colorNames?: Record<string, string>;

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

export interface ColorScheme {
	title?: string;
	fill?: string;
	stroke?: string;
	gradient?: string;
	font?: string;
}

export interface CommonStyle {
	fontColor?: string;
	strokeColor?: string;
	fillColor?: string;
}

export interface Graph {
	background?: string;
	gridColor?: string;
}

export interface Style {
	commonStyle?: CommonStyle;
	graph?: Graph;
}

export interface DrawioLibrarySection {
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

export function res(name: string): DrawioResource {
	return {
		main: name,
	};
}

export interface DrawioResource {
	main: string;
}

export type DrawioFormat = "html" | "xmlpng" | "png" | "xml" | "xmlsvg";
