import { Webview } from "vscode";
import { DrawioInstance } from "../DrawioInstance";

export interface DrawioAppServer {
	setupWebview(webview: Webview): Promise<DrawioInstance>;
}
