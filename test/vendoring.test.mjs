import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * cas loads dist/cdom.min.js directly. Four of its exports used to be hand-appended
 * to the built file instead of living in src/, so any rebuild deleted them and no
 * test noticed. They are in the source now; this asserts they survive the build.
 */
const NS_EXPORTS = ["stashStatePromise", "stashStateFunction", "clearInner", "appendInner"];

const bundlePath = fileURLToPath(new URL("../dist/cdom.min.js", import.meta.url));

test("the built bundle exports everything cas imports", async () => {
	const built = await import("../dist/cdom.min.js");
	assert.ok(built.default, "default export (CDOM) missing");
	for (const name of NS_EXPORTS) {
		assert.equal(typeof built[name], "function", `named export ${name} missing from the build`);
	}
	for (const name of ["elements", "svgElements", "node", "html", "text", "replaceInner"]) {
		assert.ok(name in built.default, `CDOM.${name} missing from the build`);
	}
});

test("the bundle is a self-contained ES module with no imports", () => {
	const src = readFileSync(bundlePath, "utf8");
	assert.doesNotMatch(src, /\bimport\s*[({'"]/, "cas loads this by relative path with no bundler");
	assert.doesNotMatch(src, /\brequire\s*\(/, "must not be CommonJS");
});

test("the version banner survives minification", () => {
	const src = readFileSync(bundlePath, "utf8");
	assert.match(src, /CDOM v\d+\.\d+\.\d+/, "terser must preserve the /*! banner");
});
