import { DrawioAppServer } from "./DrawioAppServer";
import { SelfHostedDrawioAppServer } from "./SelfHostedDrawioAppServer";
import { Disposable } from "@hediet/std/disposable";
import { Webview } from "vscode";
import { DrawioInstance } from "../DrawioInstance";
import { Config } from "../Config";
import { ExternallyHostedDrawioAppServer } from "./ExternallyHostedDrawioAppServer";

export class ConfiguredDrawioAppServer implements DrawioAppServer {
	public readonly dispose = Disposable.fn();

	private selfHostedAppServer: SelfHostedDrawioAppServer | undefined;

	constructor(public readonly config: Config) {}

	setupWebview(webview: Webview): Promise<DrawioInstance> {
		let target: DrawioAppServer;
		if (this.config.useOfflineMode) {
			if (!this.selfHostedAppServer) {
				this.selfHostedAppServer = this.dispose.track(
					new SelfHostedDrawioAppServer()
				);
			}
			target = this.selfHostedAppServer;
		} else {
			target = new ExternallyHostedDrawioAppServer(this.config.drawioUrl);
		}

		return target.setupWebview(webview);
	}
}
