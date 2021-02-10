
declare type CustomDrawioAction = UpdateVerticesAction | AddVerticesAction | GetVerticesAction
    | LinkSelectedNodeWithDataAction | NodeSelectionEnabledAction | UpdateLiveshareViewState  | { action: "askForDonations" };
declare type CustomDrawioEvent = NodeSelectedEvent | GetVerticesResultEvent
    | UpdateLocalStorage | PluginLoaded | CursorChangedEvent | SelectionChangedEvent | FocusChangedEvent | InvokeCommandEvent | SelectionRectangleChangedEvent;

declare interface InvokeCommandEvent {
    event: "invokeCommand";
    command: "export" | "save" | "convert" | "openDonationPage";
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
