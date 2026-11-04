import { OutputChannel, Uri, workspace } from "vscode";
import { DiagramConfig } from "../Config";
import { BufferImpl } from "../utils/buffer";

/**
 * The settings that the slide plugins read from `window.drawioSlidesSettings`, and the colours of
 * the colour definitions, which the colour picker of draw.io names.
 */
export interface SlideSettings {
	readonly pluginSettings: {
		readonly listStyles: unknown;
		readonly listMarkers: unknown;
		readonly mathDefinitions: string;
	};
	readonly colours: readonly DefinedColour[];
}

export interface DefinedColour {
	readonly name: string;
	/** The colour as six upper-case hexadecimal digits, as draw.io writes a colour. */
	readonly hex: string;
}

const DEFINE_COLOUR = /\\definecolor\s*\{([^}]*)\}\s*\{([^}]*)\}\s*\{([^}]*)\}/;

/**
 * Reads the colour definitions of the drawing and the commands that MathJax lacks, which the
 * extension ships in `drawio-custom-plugins/slides/mathjax-commands.tex`.
 */
export async function readSlideSettings(
	config: DiagramConfig,
	deckFolder: Uri,
	extensionUri: Uri,
	log: OutputChannel
): Promise<SlideSettings> {
	const definitions = new Array<string>();
	const colours = new Array<DefinedColour>();
	for (const file of config.colorDefinitionFiles(deckFolder)) {
		let text: string;
		try {
			text = await readText(file);
		} catch {
			log.appendLine(`The colour definitions ${file.fsPath} do not exist.`);
			continue;
		}
		const pattern = new RegExp(DEFINE_COLOUR.source, "g");
		let match: RegExpExecArray | null;
		while ((match = pattern.exec(text)) !== null) {
			const [line, name, model, values] = match;
			const hex = colourHex(model.trim(), values);
			if (hex === undefined) {
				log.appendLine(
					`${file.fsPath} defines ${name} in the model ${model}, which the MathJax of draw.io does not read, so the colour is left out.`
				);
				continue;
			}
			definitions.push(line);
			colours.push({ name, hex });
		}
	}
	const commands = await readText(
		Uri.joinPath(
			extensionUri,
			"drawio-custom-plugins",
			"slides",
			"mathjax-commands.tex"
		)
	);
	const commandLines = commands
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "" && !line.startsWith("%"));
	return {
		pluginSettings: {
			listStyles: config.listStyles,
			listMarkers: config.listMarkers,
			mathDefinitions: [...definitions, ...commandLines].join(""),
		},
		colours,
	};
}

async function readText(file: Uri): Promise<string> {
	return BufferImpl.from(await workspace.fs.readFile(file)).toString("utf-8");
}

/**
 * A colour of the models that MathJax reads, `rgb`, `RGB`, `gray` and `HTML`, as six upper-case
 * hexadecimal digits, or undefined for another model or values that do not read.
 */
function colourHex(model: string, values: string): string | undefined {
	if (model === "HTML") {
		const digits = values.trim().toUpperCase();
		return /^[0-9A-F]{6}$/.test(digits) ? digits : undefined;
	}
	const numbers = values
		.split(",")
		.map((value) => value.trim())
		.filter((value) => value !== "")
		.map(Number);
	if (numbers.some((number) => isNaN(number))) {
		return undefined;
	}
	let channels: number[];
	if (model === "rgb" && numbers.length === 3) {
		channels = numbers;
	} else if (model === "RGB" && numbers.length === 3) {
		channels = numbers.map((number) => number / 255);
	} else if (model === "gray" && numbers.length === 1) {
		channels = [numbers[0], numbers[0], numbers[0]];
	} else {
		return undefined;
	}
	return channels
		.map((channel) =>
			(256 + Math.max(0, Math.min(255, Math.round(channel * 255))))
				.toString(16)
				.slice(1)
		)
		.join("")
		.toUpperCase();
}
