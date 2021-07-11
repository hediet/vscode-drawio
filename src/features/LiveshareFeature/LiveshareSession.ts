import { Disposable } from "@hediet/std/disposable";
import { EventEmitter, EventSource } from "@hediet/std/events";
import { Uri } from "vscode";
import * as vsls from "vsls";
import { DrawioEditor, DrawioEditorService } from "../../DrawioEditorService";
import { autorunTrackDisposables } from "../../utils/autorunTrackDisposables";
import { CurrentViewState } from "./CurrentViewState";
import {
	SessionModelUpdate,
	SessionModel,
	NormalizedUri,
} from "./SessionModel";

export class LiveshareSession {
	public readonly dispose = Disposable.fn();

	private readonly sessionModel = new SessionModel();

	constructor(
		private readonly api: vsls.LiveShare,
		private readonly session: vsls.Session,
		private readonly editorManager: DrawioEditorService
	) {
		this.dispose.track(
			autorunTrackDisposables((track) =>
				[...editorManager.openedEditors].map((e) =>
					track([
						autorunTrackDisposables(() =>
							this.updateLiveshareOverlaysInDrawio(e)
						),
					])
				)
			)
		);

		this.init();
	}

	private getPeerIdInformation(peerId: number): {
		color: string;
		name: string | undefined;
	} {
		const peer = this.api.peers.find((p) => p.peerNumber === peerId);
		const colors = [
			"#2965CC",
			"#29A634",
			"#D99E0B",
			"#D13913",
			"#8F398F",
			"#00B3A4",
			"#DB2C6F",
			"#9BBF30",
			"#96622D",
			"#7157D9",
		];

		const colorIdx = peer
			? this.api.peers.indexOf(peer)
			: colors.length - 2;
		const color = colors[colorIdx % colors.length];
		const name = peer && peer.user ? peer.user.displayName : undefined;

		return { color, name };
	}

	private updateLiveshareOverlaysInDrawio(editor: DrawioEditor) {
		const viewStates = [
			...this.sessionModel.viewStatesByPeerId.values(),
		].filter(
			(v) =>
				v.peerId !== this.session.peerNumber &&
				v.viewState &&
				v.viewState.activeUri ===
					this.normalizeUri(editor.document.document.uri)
		);

		const selectedCells: Array<ParticipantSelectedCellsInfo> =
			viewStates.map((v) => ({
				id: "" + v.peerId,
				selectedCellIds: v.viewState!.selectedCellIds,
				color: this.getPeerIdInformation(v.peerId).color,
			}));

		const cursors: Array<ParticipantCursorInfo> = viewStates
			.filter((v) => v.viewState && v.viewState.currentCursor)
			.map((v) => ({
				id: "" + v.peerId,
				label: this.getPeerIdInformation(v.peerId).name,
				color: this.getPeerIdInformation(v.peerId).color,
				position: v.viewState!.currentCursor!,
			}));

		const selectedRectangles: Array<ParticipantSelectedRectangleInfo> =
			viewStates
				.filter((v) => v.viewState && v.viewState.selectedRectangle)
				.map((v) => ({
					id: "" + v.peerId,
					color: this.getPeerIdInformation(v.peerId).color,
					rectangle: v.viewState!.selectedRectangle!,
				}));

		editor.drawioClient.updateLiveshareViewState({
			selectedCells,
			cursors,
			selectedRectangles,
		});
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
				console.error("Could not share liveshare service");
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
				client.sendAction(arg as unknown as ServerAction);
			});
			this.dispose.track(
				this.api.onDidChangePeers(({ removed }) => {
					for (const r of removed) {
						client.sendAction({
							action: "applyUpdate",
							update: {
								kind: "removePeer",
								peerId: r.peerNumber,
							},
						});
					}
				})
			);
		} else {
			const svc = await this.api.getSharedService("drawio");
			if (!svc) {
				console.error("Could not get liveshare service");
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

type ServerAction = { action: "applyUpdate"; update: SessionModelUpdate };
type ServerEvent = { event: "applyUpdate"; update: SessionModelUpdate };
