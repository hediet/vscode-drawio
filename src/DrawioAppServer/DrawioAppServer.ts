import { Webview } from "vscode";
import { CustomDrawioInstance } from "../DrawioInstance";

export interface DrawioAppServer {
	setupWebview(webview: Webview): Promise<CustomDrawioInstance>;
}
