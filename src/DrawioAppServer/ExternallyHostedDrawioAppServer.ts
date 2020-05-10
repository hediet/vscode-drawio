import { HostedDrawioAppServer } from "./HostedDrawioAppServer";

export class ExternallyHostedDrawioAppServer extends HostedDrawioAppServer {
	constructor(public url: string) {
		super();
	}

	public async getIndexUrl(): Promise<string> {
		return this.url;
	}
}
