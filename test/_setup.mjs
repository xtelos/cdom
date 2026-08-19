// Loads the SHIPPED bundle (dist/cdom.min.js), not the TypeScript source, so these
// tests exercise exactly the bytes cas vendors.
import { JSDOM } from "jsdom";

export const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.document = dom.window.document;
globalThis.Event = dom.window.Event;

export const mod = await import("../dist/cdom.min.js");
export const cdom = mod.default;
export const host = () => dom.window.document.createElement("div");
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
