// Run as a child process: node --test claims `unhandledRejection` for itself, so the
// only way to assert that a throwing async render still surfaces is out of process.
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.document = dom.window.document;

const { default: cdom } = await import("../../dist/cdom.min.js");
const { p } = cdom.elements;

process.on("unhandledRejection", (err) => {
	console.log("UNHANDLED:" + (err instanceof Error ? err.message : String(err)));
	process.exit(0);
});

const host = document.createElement("div");
cdom.replaceInner(host, async () => {
	p("a");
	throw new Error("render blew up");
});

setTimeout(() => {
	console.log("NONE:" + host.innerHTML);
	process.exit(0);
}, 200);
