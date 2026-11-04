/** A name of `drawioSlides.colors`, which TeX reads as the name of a colour. */
export const COLOR_NAME = /^[A-Za-z][A-Za-z0-9]*$/;
export const COLOR_VALUE = /^#[0-9A-Fa-f]{6}$/;
/** The keys of a swatch of `drawioSlides.customColorSchemes` that hold a colour. */
export const SCHEME_COLOR_KEYS = [
	"fill",
	"stroke",
	"gradient",
	"font",
] as const;
/** The kinds of list of `drawioSlides.listStyles`, each a list of levels that may give a `color`. */
export const LIST_KINDS = ["bulleted", "numbered"] as const;
