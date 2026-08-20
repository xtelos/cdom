// Run as a child process: node --test claims `unhandledRejection` for itself.
//
// Documents an INHERENT limit, not a bug to fix. stashStatePromise has to attach a
// rejection handler to observe settlement, and doing so marks the rejection handled.
// Returning a derived promise instead would restore the report, but the release
// microtask would then run before the caller's continuation and the stash would stop
// working. So: a stashed promise nobody awaits rejects in silence.
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.document = dom.window.document;

const { stashStatePromise } = await import("../../dist/cdom.min.js");

const seen = [];
process.on("unhandledRejection", (err) => {
	seen.push(err instanceof Error ? err.message : String(err));
});

// Fire and forget: the return value is dropped on the floor.
stashStatePromise(Promise.reject(new Error("stashed-and-ignored")));

// Control: an ordinary ignored rejection, to prove the listener works at all.
Promise.reject(new Error("control"));

setTimeout(() => {
	console.log("SEEN:" + seen.join(","));
	process.exit(0);
}, 100);
