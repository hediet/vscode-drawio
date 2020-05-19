import { HostedDrawioAppServer } from "./HostedDrawioAppServer";
import * as path from "path";
import { Webview, Uri } from "vscode";
import html from './vscode.html';

export class SelfHostedDrawioAppServer extends HostedDrawioAppServer {

	public async getHtml(webview: Webview): Promise<string> {
		const vsuri = webview.asWebviewUri(Uri.file(path.join(__dirname, "../drawio/src/main/webapp/index.html")));
		const patchedHtml = html
			.replace("${vsuri}", vsuri.toString())
			.replace("${theme}", this.getTheme())
			.replace("${lang}", this.getLanguage())
			.replace("$$localStorage$$", JSON.stringify(this.config.localStorage));
		return patchedHtml;
	}
}
