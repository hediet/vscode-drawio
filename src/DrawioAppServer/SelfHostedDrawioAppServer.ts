import { resolve, join } from "path";
import { AddressInfo } from "net";
import { HostedDrawioAppServer } from "./HostedDrawioAppServer";
import * as http from "http";
import * as serveStatic from "serve-static";
import * as finalhandler from "finalhandler";
import { OutputChannel, env } from "vscode";
import { Config } from "../Config";
import { readFile, readFileSync } from "fs";

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
			if (req.url && req.url.startsWith("/index.html")) {
				let content = readFileSync(join(webRoot, "index.html"), {
					encoding: "utf-8",
				});

				const setupJsContent = readFileSync(
					join(__dirname, "../../injected-scripts/setup.js"),
					{
						encoding: "utf-8",
					}
				).replace(
					"$defaultLocalStorageValue$",
					JSON.stringify(this.config.localStorage)
				);

				const patcherJsContent = readFileSync(
					join(__dirname, "../../injected-scripts/patcher.js"),
					{
						encoding: "utf-8",
					}
				);

				content = content
					.replace(
						'<script type="text/javascript">',
						'<script type="text/javascript">' +
							setupJsContent +
							"\n"
					)
					.replace("App.main();", patcherJsContent + " App.main();");

				res.writeHead(200, { "Content-Type": "text/html" });
				res.end(content, "utf-8");
				return;
			}

			if (req.url && req.url.startsWith("/patcher.js")) {
				const content = readFileSync(
					join(__dirname, "../../patcher.js"),
					{
						encoding: "utf-8",
					}
				);
				res.writeHead(200, {
					"Content-Type": "application/javascript",
				});
				res.end(content, "utf-8");
				return;
			}

			serve(req as any, res as any, finalhandler(req, res));
		});

		let port: number | undefined = undefined;
		if (process.env.NODE_ENV === "development") {
			port = 12345;
		}

		this.serverReady = new Promise((resolve) => {
			this.server.listen(port, "localhost", () => {
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
