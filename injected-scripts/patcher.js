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
			return old.apply(this, args);
		};
	});

	patchProto(Menus, "put", function (old) {
		return function (...args) {
			log(...args);
			if (args[0] === "language") {
				return;
			}
			return old.apply(this, args);
		};
	});
});
