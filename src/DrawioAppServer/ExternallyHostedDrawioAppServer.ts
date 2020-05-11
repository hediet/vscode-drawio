import { HostedDrawioAppServer } from "./HostedDrawioAppServer";
import { OutputChannel } from "vscode";
import { Config } from "../Config";

export class ExternallyHostedDrawioAppServer extends HostedDrawioAppServer {
	constructor(public url: string, log: OutputChannel, config: Config) {
		super(log, config);
	}

	public async getIndexUrl(): Promise<string> {
		return this.url;
	}
}
