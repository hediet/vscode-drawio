
declare type CustomDrawioAction = UpdateVerticesAction | AddVerticesAction | GetVerticesAction
    | LinkSelectedNodeWithDataAction | NodeSelectionEnabledAction | UpdateLiveshareViewState
    | SlideTemplatesAction | SlideSettingsAction | StyleUseAction;
declare type CustomDrawioEvent = NodeSelectedEvent | GetVerticesResultEvent
    | UpdateLocalStorage | PluginLoaded | CursorChangedEvent | SelectionChangedEvent | FocusChangedEvent | InvokeCommandEvent | SelectionRectangleChangedEvent
    | DeckColorEditEvent | DeckStyleEditEvent;

declare interface InvokeCommandEvent {
    event: "invokeCommand";
    command: "export" | "save" | "convert";
}

declare interface FocusChangedEvent {
    event: "focusChanged";
    hasFocus: boolean;
}

declare interface NodeSelectionEnabledAction {
    action: "setNodeSelectionEnabled";
    enabled: boolean;
}

declare interface UpdateVerticesAction {
    action: "updateVertices",
    verticesToUpdate: { id: string; label: string }[];
}

declare interface AddVerticesAction {
    action: "addVertices";
    vertices: { label: string }[];
}

declare interface GetVerticesAction {
    action: "getVertices";
}

declare interface LinkSelectedNodeWithDataAction {
    action: "linkSelectedNodeWithData";
    linkedData: any;
}

declare interface NodeSelectedEvent {
    event: "nodeSelected";
    linkedData: any;
    label: string;
}

declare interface GetVerticesResultEvent {
    event: "getVertices";
    message: GetVerticesAction;
    vertices: { id: string; label: string }[];
}

declare interface UpdateLocalStorage {
    event: "updateLocalStorage";
    newLocalStorage: Record<string, string>;
}

declare interface PluginLoaded {
    event: "pluginLoaded";
    pluginId: string;
}

// Liveshare 

declare interface CursorChangedEvent {
    event: "cursorChanged";
    position: { x: number, y: number } | undefined;
}

declare interface SelectionChangedEvent {
    event: "selectedCellsChanged";
    selectedCellIds: string[];
}

declare interface SelectionRectangleChangedEvent {
    event: "selectedRectangleChanged";
    rect: Rectangle | undefined;
}

declare interface Rectangle {
    start: { x: number, y: number },
    end: { x: number, y: number },
}

/** The pages of the templates of a deck, for insert-slide.plugin.js. */
declare interface SlideTemplatesAction {
    action: "drawSlidesCodeTemplates";
    templates: { name: string; pages: { name: string; xml: string }[] }[];
}

/**
 * The settings of a deck that the slide plugins follow without a reload, as the extension gives
 * them in `window.drawSlidesCodeSettings` and again after a change: the valid colors of
 * `drawSlidesCode.colors` in the order of the setting, the same colors as definitions of MathJax,
 * presets and names of the color picker, and the swatches, the list styles and the markers of the
 * menu List style, with each name of a color replaced by its value.
 */
declare interface SlideSettingsAction {
    action: "drawSlidesCodeSettings";
    settings: {
        colors: { name: string; value: string }[];
        listStyles: SlideListStyles;
        listMarkers: [string, string][];
        mathDefinitions: string;
        presetColors: string[];
        colorNames: Record<string, string>;
        colorSchemes: {
            title?: string;
            fill?: string;
            stroke?: string;
            gradient?: string;
            font?: string;
        }[][];
        /**
         * The styles of `drawSlidesCode.deckStyles` by kind of geometry, each list in the order of
         * the setting.
         */
        styles: {
            rectangles: { name: string; style: string }[];
            wires: { name: string; style: string }[];
        };
    };
}

/**
 * An edit of the colors of a deck, which `deck-colors-section.plugin.js` sends and the extension
 * writes into `drawSlidesCode.colors`: `set` gives a color, new or not, its value `#RRGGBB`,
 * `rename` gives a color a new name, and `remove` takes a color out.
 */
declare type DeckColorEdit =
    | { operation: "set"; name: string; value: string }
    | { operation: "rename"; name: string; newName: string }
    | { operation: "remove"; name: string };

declare type DeckColorEditEvent = { event: "drawSlidesCodeEditColor" } & DeckColorEdit;

/**
 * An edit of the styles of a deck, which `deck-styles-section.plugin.js` sends and the extension
 * writes into `drawSlidesCode.deckStyles`: `set` gives a style of a kind, new or not, its style
 * string, and the cells linked to a style that exists take the change, `rename` gives a style a
 * new name, and `remove` takes a style out and leaves its keys in the cells linked to it.
 */
declare type DeckStyleEdit =
    | { operation: "set"; kind: "rectangles" | "wires"; name: string; style: string }
    | { operation: "rename"; name: string; newName: string }
    | { operation: "remove"; name: string };

declare type DeckStyleEditEvent = { event: "drawSlidesCodeEditStyle" } & DeckStyleEdit;

/**
 * The edit of the cells linked to a style that an edit of the styles makes, which the extension
 * sends to each open drawing of the deck, so that `deck-styles-section.plugin.js` applies it to
 * every page of the drawing, also to a cell linked since the drawing was loaded: `update` writes
 * the change of the style from `before` to `after`, `rename` gives the links the new name, and
 * `remove` takes the links out.
 */
declare interface StyleUseAction {
    action: "drawSlidesCodeStyleUse";
    edit:
        | { operation: "update"; name: string; before: string; after: string }
        | { operation: "rename"; name: string; newName: string }
        | { operation: "remove"; name: string };
}

/** The setting `drawSlidesCode.listStyles`. */
declare interface SlideListStyles {
    itemGap: string;
    bulleted: SlideListLevelStyle[];
    numbered: SlideListLevelStyle[];
}

/** The style of one level of a list, as the setting `drawSlidesCode.listStyles` gives it. */
declare interface SlideListLevelStyle {
    indent: string;
    marker: string;
    color?: string;
    size?: string;
}

declare interface UpdateLiveshareViewState {
    action: "updateLiveshareViewState";
    cursors: ParticipantCursorInfo[];
    selectedCells: ParticipantSelectedCellsInfo[];
    selectedRectangles: ParticipantSelectedRectangleInfo[];
}

declare interface ParticipantCursorInfo {
    id: string;
    position: { x: number, y: number };
    label: string | undefined;
    color: string;
}

declare interface ParticipantSelectedCellsInfo {
    id: string;
    color: string;
    selectedCellIds: string[];
}

declare interface ParticipantSelectedRectangleInfo {
    id: string;
    color: string;
    rectangle: Rectangle;
}
