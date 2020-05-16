var storage = {};

function log(...msg) {
	window.parent.postMessage(JSON.stringify({ event: "log", body: msg }), "*");
}

log("patcher.js is active");

console.log = function (...args) {
	log(args);
};

var mockedLS = {
	getItem: function (key) {
		log("localStorage: get " + key);
		return storage[key];
	},
	setItem: function (key, val) {
		log("localStorage: set " + key + " to " + val);
		storage[key] = val;
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
	log("Mocked localStorage ", e);
} catch (e) {
	log("Initialize localStorage ", e);
}

function patchProto(clazz, fnName, fnFactory) {
	var old = clazz.prototype[fnName];
	clazz.prototype[fnName] = fnFactory(old);
}
