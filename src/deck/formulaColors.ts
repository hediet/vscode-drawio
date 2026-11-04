/**
 * The colors that the formulas of a page name, read and edited as the MathJax of draw.io reads
 * them.
 *
 * MathJax typesets the text between `\(` and `\)`, between `$$` and `$$`, between `\[` and `\]`,
 * and each environment from `\begin{...}` to its `\end{...}`, in the labels of a page, as the
 * configuration of `drawio/src/main/webapp/math4/es5/drawio-mathjax.min.js` gives it. The text of
 * a label outside these spans is no formula, even when it holds a command.
 *
 * The commands `\textcolor`, `\color` and `\colorbox` take a color with an optional model before
 * it. The color is a name when the model is missing or `[named]`, so `\textcolor{red}{x}` and
 * `\textcolor[named]{red}{x}` name `red`, and `\textcolor[RGB]{178,0,0}{x}` names no color. The
 * command `\fcolorbox` takes a frame and a background, each with an optional model, and a
 * background without a model of its own takes the model of the frame, as MathJax reads it.
 */

/**
 * A formula with its delimiters, as MathJax finds it in the text of a label. The name of an
 * environment is the first group.
 */
const FORMULA =
	/\\\([\s\S]*?\\\)|\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\begin\s*\{([^{}]*)\}[\s\S]*?\\end\s*\{\1\}/g;
/** The label of a cell in the XML of a page, as the attribute `value` or `label`. */
const LABEL_ATTRIBUTE = /(\s(?:value|label)=")([^"]*)(")/g;
/** A command with one color: the command, the model and the color. */
const COLOR_COMMAND =
	/\\(textcolor|colorbox|color)\s*(?:\[([^\]]*)\])?\s*\{([^{}]*)\}/g;
/** A framed box: the model and the color of the frame, then those of the background. */
const FRAMED_BOX =
	/\\fcolorbox\s*(?:\[([^\]]*)\])?\s*\{([^{}]*)\}\s*(?:\[([^\]]*)\])?\s*\{([^{}]*)\}/g;

/**
 * What a color argument that names a color takes in its place: another name, which keeps the
 * model of the argument, or a value `#RRGGBB`, written in the model `RGB`.
 */
export type NamedColorChange =
	| { readonly kind: "rename"; readonly newName: string }
	| { readonly kind: "value"; readonly value: string };

/** A color argument of a command: its model as written, or undefined without one, and its color. */
interface ColorArgument {
	readonly model: string | undefined;
	readonly color: string;
}

/** The formulas of the labels of a page, each with its delimiters, in the order of the page. */
export function formulasOfPage(page: string): string[] {
	return [...page.matchAll(LABEL_ATTRIBUTE)].flatMap(([, , label]) =>
		[...label.matchAll(FORMULA)].map(([formula]) => formula)
	);
}

/** The page with each formula of its labels replaced by what `edit` makes of it. */
export function withEachFormulaOfPage(
	page: string,
	edit: (formula: string) => string
): string {
	return page.replace(
		LABEL_ATTRIBUTE,
		(_, start: string, label: string, end: string) =>
			start + label.replace(FORMULA, edit) + end
	);
}

/** The names of the colors that the commands of the formula name, once per argument. */
export function colorNamesOf(formula: string): string[] {
	const single = [...formula.matchAll(COLOR_COMMAND)]
		.filter(([, , model]) => isNamedModel(model))
		.map(([, , , color]) => color);
	const framed = [...formula.matchAll(FRAMED_BOX)].flatMap(
		([, frameModel, frame, backgroundModel, background]) => [
			...(isNamedModel(frameModel) ? [frame] : []),
			...(isNamedModel(backgroundModel ?? frameModel) ? [background] : []),
		]
	);
	return [...single, ...framed];
}

/** The formula with each argument that names the color changed as `change` says. */
export function withNamedColorChanged(
	formula: string,
	name: string,
	change: NamedColorChange
): string {
	const changed = (argument: ColorArgument): ColorArgument =>
		isNamedModel(argument.model) && argument.color === name
			? changedArgument(argument, change)
			: argument;
	return formula
		.replace(
			COLOR_COMMAND,
			(whole, command: string, model: string | undefined, color: string) => {
				const argument = { model, color };
				const result = changed(argument);
				return result === argument
					? whole
					: `\\${command}${modelText(result.model)}{${result.color}}`;
			}
		)
		.replace(
			FRAMED_BOX,
			(
				whole,
				frameModel: string | undefined,
				frameColor: string,
				backgroundModel: string | undefined,
				backgroundColor: string
			) => {
				const frame = { model: frameModel, color: frameColor };
				// The background reads its color in the model of the frame when it has none.
				const background = {
					model: backgroundModel ?? frameModel,
					color: backgroundColor,
				};
				const newFrame = changed(frame);
				const newBackground = changed(background);
				if (newFrame === frame && newBackground === background) {
					return whole;
				}
				const isBackgroundModelWritten =
					backgroundModel !== undefined ||
					modelName(newBackground.model) !== modelName(newFrame.model);
				return (
					`\\fcolorbox${modelText(newFrame.model)}{${newFrame.color}}` +
					`${
						isBackgroundModelWritten
							? `[${newBackground.model ?? "named"}]`
							: ""
					}{${newBackground.color}}`
				);
			}
		);
}

function changedArgument(
	argument: ColorArgument,
	change: NamedColorChange
): ColorArgument {
	switch (change.kind) {
		case "rename":
			return { model: argument.model, color: change.newName };
		case "value":
			return { model: "RGB", color: rgbOf(change.value) };
	}
}

/** Whether a color in the model, or without one, is a name. */
function isNamedModel(model: string | undefined): boolean {
	return modelName(model) === "named";
}

function modelName(model: string | undefined): string {
	return model === undefined ? "named" : model.trim();
}

function modelText(model: string | undefined): string {
	return model === undefined ? "" : `[${model}]`;
}

/** The red, green and blue of `#RRGGBB` as decimal numbers separated by commas. */
function rgbOf(value: string): string {
	return [1, 3, 5]
		.map((start) => parseInt(value.slice(start, start + 2), 16))
		.join(",");
}
