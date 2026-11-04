
declare type CustomDrawioAction = UpdateVerticesAction | AddVerticesAction | GetVerticesAction
    | LinkSelectedNodeWithDataAction | NodeSelectionEnabledAction | UpdateLiveshareViewState
    | SlideTemplatesAction | SlideSettingsAction;
declare type CustomDrawioEvent = NodeSelectedEvent | GetVerticesResultEvent
    | UpdateLocalStorage | PluginLoaded | CursorChangedEvent | SelectionChangedEvent | FocusChangedEvent | InvokeCommandEvent | SelectionRectangleChangedEvent
    | DeckColourEditEvent;

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
    action: "drawioSlidesTemplates";
    templates: { name: string; pages: { name: string; xml: string }[] }[];
}

/**
 * The settings of a deck that the slide plugins follow without a reload, as the extension gives
 * them in `window.drawioSlidesSettings` and again after a change: the valid colours of
 * `drawioSlides.colors` in the order of the setting, the same colours as definitions of MathJax,
 * presets and names of the colour picker, and the swatches, the list styles and the markers of the
 * menu List style, with each name of a colour replaced by its value.
 */
declare interface SlideSettingsAction {
    action: "drawioSlidesSettings";
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
    };
}

/**
 * An edit of the colours of a deck, which `deck-colors-section.plugin.js` sends and the extension
 * writes into `drawioSlides.colors`: `set` gives a colour, new or not, its value `#RRGGBB`,
 * `rename` gives a colour a new name, and `remove` takes a colour out.
 */
declare type DeckColourEdit =
    | { operation: "set"; name: string; value: string }
    | { operation: "rename"; name: string; newName: string }
    | { operation: "remove"; name: string };

declare type DeckColourEditEvent = { event: "drawioSlidesEditColor" } & DeckColourEdit;

/** The setting `drawioSlides.listStyles`. */
declare interface SlideListStyles {
    itemGap: string;
    bulleted: SlideListLevelStyle[];
    numbered: SlideListLevelStyle[];
}

/** The style of one level of a list, as the setting `drawioSlides.listStyles` gives it. */
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
