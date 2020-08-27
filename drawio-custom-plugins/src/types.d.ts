
declare type CustomDrawioAction = UpdateVerticesAction | AddVerticesAction | GetVerticesAction | LinkSelectedNodeWithDataAction | NodeSelectionEnabledAction | UpdateGhostCursors | UpdateGhostSelections;
declare type CustomDrawioEvent = NodeSelectedEvent | GetVerticesResultEvent | UpdateLocalStorage | PluginLoaded | CursorChangedEvent |  SelectionChangedEvent;

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

declare interface UpdateGhostCursors {
    action: "updateGhostCursors";
    cursors: CursorUpdateInfo[];
}

declare interface SelectionChangedEvent {
    event: "selectionChanged";
    selectedCellIds: string[];
}

declare interface UpdateGhostSelections {
    action: "updateGhostSelections";
    selections: SelectionsUpdateInfo[]
}

declare interface CursorUpdateInfo {
    name: string;
    id: string;
    position: { x: number, y: number };
}

declare interface SelectionsUpdateInfo {
    id: string;
    selectedCellIds: string[];
}