import { showDialog } from "./propertiesDialog";
import { sendEvent } from "./vscode";

Draw.loadPlugin((ui) => {
	sendEvent({ event: "pluginLoaded", pluginId: "menu-entries" });

	const importActionName = "vscode.import";
	mxResources.parse(`${importActionName}=Import...`);
	ui.actions.addAction(importActionName, () => ui.importLocalFile(true));

	const exportActionName = "vscode.export";
	mxResources.parse(`${exportActionName}=Export...`);
	ui.actions.addAction(exportActionName, () => {
		sendEvent({ event: "invokeCommand", command: "export" });
	});

	const convertActionName = "vscode.convert";
	mxResources.parse(`${convertActionName}=Convert...`);
	ui.actions.addAction(convertActionName, () => {
		sendEvent({ event: "invokeCommand", command: "convert" });
	});

	const saveActionName = "vscode.save";
	mxResources.parse(`${saveActionName}=Save`);
	ui.actions.addAction(saveActionName, () => {
		sendEvent({ event: "invokeCommand", command: "save" });
	});

	const propertiesActionName = "properties";
	ui.actions.addAction(propertiesActionName, () => {
		showDialog(ui);
	});

	const menu = ui.menus.get("file");
	const oldFunct = menu.funct;
	menu.funct = function (menu: any, parent: any) {
		oldFunct.apply(this, arguments);
		ui.menus.addMenuItems(
			menu,
			[
				"-",
				propertiesActionName,
				"-",
				importActionName,
				exportActionName,
				convertActionName,
				"-",
				saveActionName,
			],
			parent
		);
	};
});
