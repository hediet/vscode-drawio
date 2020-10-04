import { Disposable, Disposer } from "@hediet/std/disposable";
import { computed } from "mobx";
import { Uri } from "vscode";
import { DrawioEditor, DrawioEditorManager } from "../../DrawioEditorManager";
import { CustomDrawioInstance } from "../../DrawioInstance";
import { fromResource, IResource } from "../../utils/fromResource";
import { Point, ViewState, NormalizedUri } from "./SessionModel";

export class CurrentViewState {
	@computed private get _state():
		| {
				editor: DrawioEditor;
				cursorPos: IResource<Point | undefined>;
				selectedCellIds: IResource<string[]>;
				selectedRectangle: IResource<Rectangle | undefined>;
		  }
		| undefined {
		const activeDrawioEditor = this.editorManager.activeDrawioEditor;
		if (!activeDrawioEditor) {
			return undefined;
		}

		return {
			editor: activeDrawioEditor,
			cursorPos: getCursorPositionResource(activeDrawioEditor.instance),
			selectedCellIds: getSelectedCellsResource(
				activeDrawioEditor.instance
			),
			selectedRectangle: getSelectedRectangleResource(
				activeDrawioEditor.instance
			),
		};
	}

	@computed get state(): ViewState {
		const state = this._state;
		if (!state) {
			return undefined;
		}
		const activeUri = this.normalizeUri(state.editor.uri);
		return {
			activeUri,
			currentCursor: state.cursorPos.current(),
			selectedCellIds: state.selectedCellIds.current(),
			selectedRectangle: state.selectedRectangle.current(),
		};
	}

	constructor(
		private readonly editorManager: DrawioEditorManager,
		private readonly normalizeUri: (uri: Uri) => NormalizedUri
	) {}
}

function getSelectedRectangleResource(
	drawioInstance: CustomDrawioInstance
): IResource<Rectangle | undefined> {
	return fromResource<Rectangle | undefined>(
		(sink) =>
			Disposable.fn((track) => {
				let lastRect: Rectangle | undefined;
				let timeout: any;

				track(
					drawioInstance.onFocusChanged.sub(({ hasFocus }) => {
						if (!hasFocus) {
							sink(undefined);
						}
					})
				);
				track(
					drawioInstance.onSelectedRectangleChanged.sub(
						({ rectangle }) => {
							lastRect = rectangle;
							if (!timeout) {
								timeout = setTimeout(() => {
									timeout = undefined;
									sink(lastRect);
								}, 1000 / 30);
							}
						}
					)
				);
			}),
		() => undefined
	);
}

function getCursorPositionResource(
	drawioInstance: CustomDrawioInstance
): IResource<Point | undefined> {
	return fromResource<Point | undefined>(
		(sink) =>
			Disposable.fn((track) => {
				let lastPosition: Point | undefined;
				let timeout: any;

				track(
					drawioInstance.onFocusChanged.sub(({ hasFocus }) => {
						if (!hasFocus) {
							sink(undefined);
						}
					})
				);
				track(
					drawioInstance.onCursorChanged.sub(({ newPosition }) => {
						lastPosition = newPosition;
						if (!timeout) {
							timeout = setTimeout(() => {
								timeout = undefined;
								sink(lastPosition);
							}, 1000 / 30);
						}
					})
				);
			}),
		() => undefined
	);
}

function getSelectedCellsResource(
	drawioInstance: CustomDrawioInstance
): IResource<string[]> {
	return fromResource<string[]>(
		(sink) =>
			Disposable.fn((track) => {
				track(
					drawioInstance.onFocusChanged.sub(({ hasFocus }) => {
						if (!hasFocus) {
							sink([]);
						}
					})
				);
				track(
					drawioInstance.onSelectedCellsChanged.sub(
						({ selectedCellIds }) => {
							sink(selectedCellIds);
						}
					)
				);
			}),
		() => []
	);
}
