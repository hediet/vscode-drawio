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

	const propertiesActionName = "properties";
	ui.actions.addAction(propertiesActionName, () => {
		showDialog(ui);
	});

	// Extends the file menu itself rather than using addPluginMenuItems: draw.io
	// only appends plugin items in Menus.addMenu, which the classic menubar
	// (Kennedy theme) bypasses, so the items were missing there (#532).
	// Save is not added here since draw.io shows its own (noSaveBtn=0).
	const fileMenu = ui.menus.get("file");
	const oldFunct = fileMenu.funct;
	fileMenu.funct = function (menu: any, parent: any) {
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
			],
			parent
		);
	};
});
