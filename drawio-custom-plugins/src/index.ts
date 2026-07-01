import "./linkSelectedNodeWithData";
import "./liveshare";
import "./focus";
import "./menu-entries";
import "./autosaveBridge";

Draw.loadPlugin((ui) => {
	(window as any).hediet_DbgUi = ui;
});
