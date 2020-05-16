/**
 * @param {{ event: string }} msg
 */
function sendToParent(msg) {
	window.parent.postMessage(JSON.stringify(msg), "*");
}

function log(...msg) {
	sendToParent({ event: "log", body: msg });
}

log("patcher.js is active");
console.log = function (...args) {
	log(args);
};

var storage = $defaultLocalStorageValue$;

log("localStorage: Init: " + JSON.stringify(storage, undefined, 4));
var mockedLS = {
	getItem: function (key) {
		log("localStorage: get " + key);
		return storage[key];
	},
	setItem: function (key, val) {
		log("localStorage: set " + key + " to " + val);
		storage[key] = val;
		sendToParent({ event: "updateLocalStorage", newLocalStorage: storage });
	},
	removeItem: function (key) {
		log("localStorage: remove " + key);
		delete storage[key];
	},
};

try {
	Object.defineProperty(window, "localStorage", {
		get() {
			return mockedLS;
		},
	});
	log("Mocked localStorage");
} catch (e) {
	log("Error while initializing localStorage ", e.toString(), e);
}

function patchProto(clazz, fnName, fnFactory) {
	var old = clazz.prototype[fnName];
	clazz.prototype[fnName] = fnFactory(old);
}
