import { Disposable, TrackFunction } from "@hediet/std/disposable";
import { EventEmitter, EventSource } from "@hediet/std/events";
import { action, autorun, computed, observable, ObservableMap } from "mobx";
import { Uri } from "vscode";
import * as vsls from "vsls";
import { Config } from "../Config";
import { DrawioEditor, DrawioEditorManager } from "../DrawioEditorManager";
import { CustomDrawioInstance } from "../DrawioInstance";
import { fromResource, IResource } from "../utils/fromResource";

export class LiveshareFeature {
	public readonly dispose = Disposable.fn();

	constructor(
		private readonly editorManager: DrawioEditorManager,
		private readonly config: Config
	) {
		if (!config.experimentalFeaturesEnabled) {
			return;
		}

		this.init().catch(console.error);
	}

	private async init() {
		const liveshare = await vsls.getApi();
		if (!liveshare) {
			console.warn("Could not get liveshare API");
			return;
		}
		this.dispose.track(
			new LiveshareFeatureInitialized(liveshare, this.editorManager)
		);
	}
}

function autorunTrackDisposables(
	reaction: (track: TrackFunction) => void
): Disposable {
	let lastDisposable: Disposable | undefined;
	return {
		dispose: autorun(() => {
			if (lastDisposable) {
				lastDisposable.dispose();
			}
			lastDisposable = Disposable.fn(reaction);
		}),
	};
}

interface Point {
	x: number;
	y: number;
}

type NormalizedUri = { __brand: "normalizedUri" };

type ViewState =
	| {
			activeUri: NormalizedUri;
			currentCursor: Point | undefined;
			selectedCellIds: string[];
	  }
	| undefined;

function getCursorPositionResource(
	drawioInstance: CustomDrawioInstance
): IResource<Point | undefined> {
	return fromResource<Point | undefined>((sink) => {
		let lastPosition: Point | undefined;
		let timeout: any;
		return drawioInstance.onCursorChanged.sub(({ newPosition }) => {
			lastPosition = newPosition;
			if (!timeout) {
				timeout = setTimeout(() => {
					timeout = undefined;
					sink(lastPosition);
				}, 10);
			}
		});
	}, undefined);
}

function getSelectedCellsResource(
	drawioInstance: CustomDrawioInstance
): IResource<string[]> {
	return fromResource<string[]>((sink) => {
		return drawioInstance.onSelectionsChanged.sub(({ selectedCellIds }) => {
			sink(selectedCellIds);
		});
	}, []);
}

class CurrentViewState {
	@computed private get _state():
		| {
				editor: DrawioEditor;
				cursorPos: IResource<Point | undefined>;
				selectedCellIds: IResource<string[]>;
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
		};
	}

	constructor(
		private readonly editorManager: DrawioEditorManager,
		private readonly normalizeUri: (uri: Uri) => NormalizedUri
	) {}
}

class SessionModel {
	public readonly viewStatesByPeerId = new ObservableMap<
		number,
		{ viewState: ViewState; peerId: number }
	>();

	@action
	public apply(update: SessionModelUpdate): void {
		if (update.kind === "updateViewState") {
			const val = this.viewStatesByPeerId.get(update.peerId);
			const newVal = {
				peerId: update.peerId,
				viewState: update.newViewState,
			};
			if (JSON.stringify(val) !== JSON.stringify(newVal)) {
				this.viewStatesByPeerId.set(update.peerId, newVal);
			}
		}
	}
}

type SessionModelUpdate =
	| {
			kind: "updateViewState";
			peerId: number;
			newViewState: ViewState;
	  }
	| {
			kind: "removePeer";
			peerId: number;
	  }
	| {
			kind: "updateCursor";
			peerId: number;
			cursorPosition: Point | undefined;
	  };

class LiveshareFeatureInitialized {
	public readonly dispose = Disposable.fn();
	@observable private session: vsls.Session | undefined;

	constructor(
		private readonly api: vsls.LiveShare,
		editorManager: DrawioEditorManager
	) {
		this.dispose.track(
			this.api.onDidChangeSession(({ session }) => {
				this.session = session;
			})
		);
		this.session = api.session;

		this.dispose.track(
			autorunTrackDisposables(async (track) => {
				const session = this.session;
				if (!session) {
					return;
				}
				track(new LiveshareSession(api, session, editorManager));
			})
		);
	}
}

type ServerAction = { action: "applyUpdate"; update: SessionModelUpdate };
type ServerEvent = { event: "applyUpdate"; update: SessionModelUpdate };

class LiveshareSession {
	public readonly dispose = Disposable.fn();

	private readonly sessionModel = new SessionModel();

	constructor(
		private readonly api: vsls.LiveShare,
		private readonly session: vsls.Session,
		private readonly editorManager: DrawioEditorManager
	) {
		this.dispose.track(
			autorunTrackDisposables((track) =>
				[...editorManager.openedEditors].map((e) =>
					track([
						autorunTrackDisposables(() => this.updateCursors(e)),
						autorunTrackDisposables(() => this.updateSelections(e)),
					])
				)
			)
		);

		this.init();
	}

	private updateCursors(editor: DrawioEditor) {
		const cursorInfo: Array<CursorUpdateInfo> = [
			...this.sessionModel.viewStatesByPeerId.values(),
		]
			.filter(
				(v) =>
					v.peerId !== this.session.peerNumber &&
					v.viewState !== undefined &&
					v.viewState.currentCursor !== undefined &&
					v.viewState.activeUri ===
						this.normalizeUri(editor.document.document.uri)
			)
			.map((v) => ({
				id: "" + v.peerId,
				name: "test",
				position: v.viewState!.currentCursor!,
			}));

		editor.instance.updateGhostCursors(cursorInfo);
	}

	private updateSelections(editor: DrawioEditor) {
		const cursorInfo: Array<SelectionsUpdateInfo> = [
			...this.sessionModel.viewStatesByPeerId.values(),
		]
			.filter(
				(v) =>
					v.peerId !== this.session.peerNumber &&
					v.viewState !== undefined &&
					v.viewState.activeUri ===
						this.normalizeUri(editor.document.document.uri)
			)
			.map((v) => ({
				id: "" + v.peerId,
				selectedCellIds: v.viewState!.selectedCellIds,
			}));

		editor.instance.updateGhostSelections(cursorInfo);
	}

	private async init() {
		let client: {
			sendAction(action: ServerAction): void;
			onEvent: EventSource<{ event: ServerEvent }>;
		};

		if (this.session.role === vsls.Role.Host) {
			const svc = await this.api.shareService("drawio");
			this.dispose.track({
				dispose: () => this.api.unshareService("drawio"),
			});
			if (!svc) {
				return;
			}
			const eventEmitter = new EventEmitter<{
				event: ServerEvent;
			}>();

			client = {
				sendAction: (action) => {
					const event: ServerEvent = {
						event: "applyUpdate",
						update: action.update,
					};
					svc.notify("event", event);
					eventEmitter.emit({ event });
				},
				onEvent: eventEmitter.asEvent(),
			};

			svc.onNotify("action", (arg) => {
				client.sendAction((arg as unknown) as ServerAction);
			});
		} else {
			const svc = await this.api.getSharedService("drawio");
			if (!svc) {
				return;
			}

			const eventEmitter = new EventEmitter<{
				event: ServerEvent;
			}>();
			client = {
				sendAction: (action) => svc.notify("action", action),
				onEvent: eventEmitter.asEvent(),
			};

			svc.onNotify("event", (arg) => {
				eventEmitter.emit({ event: arg as ServerEvent });
			});
		}

		client.onEvent.sub(({ event }) => {
			this.sessionModel.apply(event.update);
		});

		const curViewState = new CurrentViewState(
			this.editorManager,
			this.normalizeUri
		);
		this.dispose.track(
			autorunTrackDisposables(() => {
				client.sendAction({
					action: "applyUpdate",
					update: {
						kind: "updateViewState",
						newViewState: curViewState.state,
						peerId: this.session.peerNumber,
					},
				});
			})
		);
	}

	private readonly normalizeUri = (uri: Uri): NormalizedUri => {
		if (this.session.role === vsls.Role.Host) {
			return this.api.convertLocalUriToShared(uri).toString() as any;
		} else {
			return uri.toString() as any;
		}
	};
}
