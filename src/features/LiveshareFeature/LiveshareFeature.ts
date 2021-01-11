import { Disposable } from "@hediet/std/disposable";
import * as vsls from "vsls";
import { Config } from "../../Config";
import { DrawioEditorService } from "../../DrawioEditorService";
import { autorunTrackDisposables } from "../../utils/autorunTrackDisposables";
import { fromResource } from "../../utils/fromResource";
import { LiveshareSession } from "./LiveshareSession";

export class LiveshareFeature {
	public readonly dispose = Disposable.fn();

	constructor(
		private readonly editorManager: DrawioEditorService,
		private readonly config: Config
	) {
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

	private session = fromResource(
		(sink) => {
			this.api.onDidChangeSession(({ session }) => {
				sink(normalizeSession(session));
			});
		},
		() => normalizeSession(this.api.session)
	);

	constructor(
		private readonly api: vsls.LiveShare,
		editorManager: DrawioEditorService
	) {
		this.dispose.track(
			autorunTrackDisposables(async (track) => {
				const session = this.session.current();
				if (!session) {
					return;
				}
				track(new LiveshareSession(api, session, editorManager));
			})
		);
	}
}

function normalizeSession(session: vsls.Session): vsls.Session | undefined {
	if (session.role === vsls.Role.None) {
		return undefined;
	}
	return { ...session };
}
