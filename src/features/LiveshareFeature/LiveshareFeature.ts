import { Disposable } from "@hediet/std/disposable";
import { observable } from "mobx";
import * as vsls from "vsls";
import { Config } from "../../Config";
import { DrawioEditorManager } from "../../DrawioEditorManager";
import { autorunTrackDisposables } from "../../utils/autorunTrackDisposables";
import { LiveshareSession } from "./LiveshareSession";

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
		const liveshare = await vsls.getApi("hediet.vscode-drawio");
		if (!liveshare) {
			console.warn("Could not get liveshare API");
			return;
		}
		this.dispose.track(
			new LiveshareFeatureInitialized(liveshare, this.editorManager)
		);
	}
}

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
