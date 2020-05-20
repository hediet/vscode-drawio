import { DrawioAppServer } from "./DrawioAppServer";
import { SelfHostedDrawioAppServer } from "./SelfHostedDrawioAppServer";
import { Disposable } from "@hediet/std/disposable";
import { Webview, OutputChannel } from "vscode";
import { DrawioInstance } from "../DrawioInstance";
import { Config } from "../Config";
import { ExternallyHostedDrawioAppServer } from "./ExternallyHostedDrawioAppServer";

export class ConfiguredDrawioAppServer implements DrawioAppServer {
	public readonly dispose = Disposable.fn();

	constructor(
		private readonly config: Config,
		private readonly log: OutputChannel
	) {}

	setupWebview(webview: Webview): Promise<DrawioInstance> {
		let target: DrawioAppServer;
		if (this.config.useOfflineMode) {
			target = new SelfHostedDrawioAppServer(this.log, this.config);
		} else {
			target = new ExternallyHostedDrawioAppServer(
				this.config.drawioUrl,
				this.log,
				this.config
			);
		}

		return target.setupWebview(webview);
	}
}
