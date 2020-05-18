function patchProto(clazz, fnName, fnFactory) {
	var old = clazz.prototype[fnName];
	clazz.prototype[fnName] = fnFactory(old);
}

window.addEventListener("load", () => {
	log("Document loaded, patching prototypes");
	patchProto(Menus, "addSubmenu", function (old) {
		return function (...args) {
			if (args[0] === "exportAs") {
				return;
			}
			console.log("added submenu ", args[0]);
			return old.apply(this, args);
		};
	});

	patchProto(Menus, "put", function (old) {
		return function (...args) {
			if (args[0] === "language") {
				return;
			}
			return old.apply(this, args);
		};
	});
});

/**
 * @param url {string}
 */
function loadScript(url) {
	const pluginScript = document.createElement("script");
	pluginScript.type = "text/javascript";
	pluginScript.src = url;
	document.getElementsByTagName("head")[0].appendChild(pluginScript);
}

loadScript("/plugins/linkSelectedNodeWithData.js");
