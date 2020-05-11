import { resolve } from "path";
import { AddressInfo } from "net";
import { HostedDrawioAppServer } from "./HostedDrawioAppServer";
import * as http from "http";
import * as serveStatic from "serve-static";
import * as finalhandler from "finalhandler";
import { OutputChannel } from "vscode";
import { Config } from "../Config";

export class SelfHostedDrawioAppServer extends HostedDrawioAppServer {
	private readonly server: http.Server;
	private readonly serverReady: Promise<void>;

	public async getIndexUrl(): Promise<string> {
		await this.serverReady;
		const port = (this.server.address() as AddressInfo).port;
		// We could use https://www.draw.io/ too
		return `http://localhost:${port}/index.html`;
	}

	constructor(log: OutputChannel, config: Config) {
		super(log, config);

		const webRoot = resolve(__dirname, "../../drawio/src/main/webapp/");

		const serve = serveStatic(webRoot);
		this.server = http.createServer((req, res) => {
			serve(req as any, res as any, finalhandler(req, res));
		});

		this.serverReady = new Promise((resolve) => {
			this.server.listen(undefined, "localhost", () => {
				resolve();
			});
		});

		this.getIndexUrl().then((url) => {
			console.log(`Serving "${webRoot}" on "${url}"`);
		});
	}

	public dispose(): void {
		this.server.close();
	}
}
