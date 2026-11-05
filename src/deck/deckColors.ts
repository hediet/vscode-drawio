/** A name of `drawSlidesCode.colors`, which TeX reads as the name of a color. */
export const COLOR_NAME = /^[A-Za-z][A-Za-z0-9]*$/;
export const COLOR_VALUE = /^#[0-9A-Fa-f]{6}$/;
/** The keys of a swatch of `drawSlidesCode.customColorSchemes` that hold a color. */
export const SCHEME_COLOR_KEYS = [
	"fill",
	"stroke",
	"gradient",
	"font",
] as const;
/** The kinds of list of `drawSlidesCode.listStyles`, each a list of levels that may give a `color`. */
export const LIST_KINDS = ["bulleted", "numbered"] as const;
/**
 * The keys of a style of draw.io that hold a color, each with the key of its link to a color of
 * `drawSlidesCode.colors`. A cell styled `fillColor=#B20000;deckFillColor=red` draws its fill in the
 * value of `red`, and keeps `#B20000` for a draw.io without the extension.
 */
export const COLOR_LINK_KEYS: Readonly<Record<string, { readonly link: string }>> = {
	fillColor: { link: "deckFillColor" },
	swimlaneFillColor: { link: "deckSwimlaneFillColor" },
	imageBackground: { link: "deckImageBackground" },
	gradientColor: { link: "deckGradientColor" },
	strokeColor: { link: "deckStrokeColor" },
	imageBorder: { link: "deckImageBorder" },
	fontColor: { link: "deckFontColor" },
	labelBackgroundColor: { link: "deckLabelBackgroundColor" },
};
/**
 * The attribute of an element of the HTML of a label that links the color of its text to a color
 * of `drawSlidesCode.colors`, as in `<span data-deck-color="red" style="color: #B20000;">`.
 */
export const TEXT_COLOR_LINK = "data-deck-color";
