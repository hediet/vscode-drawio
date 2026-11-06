const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const ts = require("typescript");

function loadDeferredReloads() {
	const filename = path.resolve(__dirname, "../../src/DrawioClient/DeferredReloads.ts");
	const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
		compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
	}).outputText;
	const exports = {};
	vm.runInNewContext(source, { exports }, { filename });

	return exports.DeferredReloads;
}

const DeferredReloads = loadDeferredReloads();

// A promise and its resolve and reject functions
function deferred() {
	let resolve, reject;
	const promise = new Promise((res, rej) => { resolve = res; reject = rej; });

	return { promise, resolve, reject };
}

test("reloads without an Apply as usual", () => {
	const reloads = new DeferredReloads();

	assert.equal(reloads.defer(() => assert.fail("not recorded")), false);
});

test("reloads each editor once after the writes", async () => {
	const reloads = new DeferredReloads();
	const counts = { a: 0, b: 0 };
	const a = () => counts.a++;
	const b = () => counts.b++;

	await reloads.run(async () => {
		// Two settings writes reload both editors
		assert.equal(reloads.defer(a), true);
		assert.equal(reloads.defer(b), true);
		assert.equal(reloads.defer(a), true);
		assert.deepEqual(counts, { a: 0, b: 0 }, "nothing reloads during the writes");
	});

	assert.deepEqual(counts, { a: 1, b: 1 });
	assert.equal(reloads.defer(a), false, "reloads as usual afterwards");
});

test("waits for overlapping Applies", async () => {
	const reloads = new DeferredReloads();
	const first = deferred();
	const second = deferred();
	let count = 0;
	const reload = () => count++;

	const runs = [reloads.run(() => first.promise), reloads.run(() => second.promise)];
	reloads.defer(reload);

	first.resolve();
	await runs[0];
	assert.equal(count, 0, "the second Apply still writes");

	second.resolve();
	await runs[1];
	assert.equal(count, 1);
});

test("reloads after an error and forgets closed editors", async () => {
	const reloads = new DeferredReloads();
	let count = 0;
	const reload = () => count++;
	const closed = () => assert.fail("closed editor reloaded");

	await assert.rejects(reloads.run(async () => {
		reloads.defer(reload);
		reloads.defer(closed);
		reloads.forget(closed);
		throw new Error("write failed");
	}), /write failed/);

	assert.equal(count, 1, "reloads for the settings written before the error");
});
