import { test } from "node:test";
import assert from "node:assert/strict";
import { cdom, mod, dom, host } from "./_setup.mjs";

const { div, span, input } = cdom.elements;
const { appendInner, clearInner } = mod;

test("null and undefined attribute values remove the attribute", () => {
	// Writing `title=""` instead made the element match presence selectors like
	// `[title]`, which cas uses to attach tooltips.
	assert.equal(div({ title: null }).outerHTML, "<div></div>");
	assert.equal(div({ title: undefined }).outerHTML, "<div></div>");
	assert.equal(div({ style: null }).outerHTML, "<div></div>");
	assert.equal(div({ title: "x" }).outerHTML, '<div title="x"></div>');
});

test("checked is set as a property, not an attribute", () => {
	// "checked" is in both nonAttributeProperties and booleanAttributes; the attribute
	// branch used to win, so the property was never set.
	const on = input({ type: "checkbox", checked: true });
	assert.equal(on.checked, true);
	assert.equal(on.getAttribute("checked"), null);
	assert.equal(input({ type: "checkbox", checked: false }).checked, false);
	assert.equal(input({ type: "checkbox", checked: "checked" }).checked, true);
	assert.equal(input({ type: "checkbox", checked: undefined }).checked, false);
	assert.equal(input({ type: "checkbox", checked: null }).checked, false);
});

test("the checked property change has two documented side effects", () => {
	// Both are real deltas from the old attribute-based behavior. No cas call site is
	// hit by either, but they belong in the record.
	const el = input({ type: "checkbox", checked: true });

	// 1. `checked` no longer appears in serialized markup, so a re-parse of outerHTML
	//    comes back unchecked.
	assert.equal(el.outerHTML, '<input type="checkbox">');

	// 2. The attribute backs defaultChecked, so form.reset() no longer restores it.
	assert.equal(el.defaultChecked, false);

	// What did NOT change:
	assert.equal(el.checked, true);
	assert.equal(el.matches(":checked"), true);
	assert.equal(el.cloneNode(true).checked, true);
});

test("attribute key order does not change the result", () => {
	assert.equal(input({ checked: true, type: "checkbox" }).checked, true);
	assert.equal(input({ type: "checkbox", checked: true }).checked, true);
});

test("property names fall back to attributes on elements that lack the property", () => {
	// A div has no `checked`/`value`, so writing an expando there would be silent junk.
	const d = div({ value: "x" });
	assert.equal(d.getAttribute("value"), "x");
	assert.equal("value" in d, false);
});

test("value is set as a property", () => {
	const el = input({ value: "hi" });
	assert.equal(el.value, "hi");
	assert.equal(el.getAttribute("value"), null);
});

test("other boolean attributes stay attributes", () => {
	assert.equal(input({ disabled: true }).getAttribute("disabled"), "true");
	assert.equal(input({ disabled: false }).getAttribute("disabled"), null);
	assert.equal(div({ hidden: true }).getAttribute("hidden"), "true");
});

test("html() returns its fragment so a top-level call is recoverable", () => {
	const frag = cdom.html("<b>hi</b>");
	assert.equal(frag.childNodes.length, 1, "top-level html() must not discard content");
	const h = host();
	h.appendChild(frag);
	assert.equal(h.innerHTML, "<b>hi</b>");
});

test("html() still appends when there is a current node", () => {
	const h = host();
	cdom.replaceInner(h, () => {
		cdom.html("<b>x</b>");
	});
	assert.equal(h.innerHTML, "<b>x</b>");
});

test("a Node is inner content, not an attribute map", () => {
	assert.equal(div(dom.window.document.createTextNode("x")).outerHTML, "<div>x</div>");
	const h = host();
	assert.equal(appendInner(h, dom.window.document.createTextNode("z")), h);
	assert.equal(h.innerHTML, "z");
});

test("appendInner accepts a string, a Node, or a callback, and is synchronous", () => {
	const a = host();
	appendInner(a, "str");
	assert.equal(a.innerHTML, "str");

	const b = host();
	appendInner(b, () => {
		span("f");
	});
	assert.equal(b.innerHTML, "<span>f</span>");

	// Returns the element itself, not a promise: `await appendInner(...)` would be an
	// unstashed await that drops whatever the continuation renders.
	const c = host();
	assert.equal(appendInner(c, "q"), c);
});

test("clearInner empties an element and returns it", () => {
	const h = host();
	h.innerHTML = "<b>1</b><b>2</b>";
	assert.equal(clearInner(h), h);
	assert.equal(h.innerHTML, "");
});

test("misused arguments throw an actionable error", () => {
	assert.throws(() => div([1, 2]), /array/i);
	assert.throws(() => div(dom.window.document.createTextNode("x"), () => {}), /Node/);
	assert.throws(() => div({ onclick: "alert(1)" }), /non-function/);
	assert.throws(() => div({ title: () => {} }), /Got function/);
});

test("elements is not thenable", async () => {
	// A `then` that answers with a function makes `await elements` and any async
	// function returning it misbehave.
	assert.equal(cdom.elements.then, undefined);
	assert.equal(await Promise.resolve(cdom.elements), cdom.elements);
});

test("argument dispatch is unchanged for the documented cases", () => {
	assert.equal(div().outerHTML, "<div></div>");
	assert.equal(div(null).outerHTML, "<div></div>");
	assert.equal(div(undefined).outerHTML, "<div></div>");
	assert.equal(div(0).outerHTML, "<div>0</div>");
	assert.equal(div(false).outerHTML, "<div>false</div>");
	assert.equal(div("t").outerHTML, "<div>t</div>");
	assert.equal(div({ id: "a" }, () => span("s")).outerHTML, '<div id="a"><span>s</span></div>');
});

test("a top-level call returns a detached element", () => {
	assert.equal(div("x").parentNode, null);
});

test("event listeners attach, and null listeners are skipped", () => {
	let hits = 0;
	const el = div({ onClick: () => hits++ });
	el.dispatchEvent(new dom.window.Event("click"));
	assert.equal(hits, 1);
	assert.equal(div({ onClick: null }).outerHTML, "<div></div>");
	assert.equal(div({ onClick: undefined }).outerHTML, "<div></div>");
});

test("svg elements use the svg namespace", () => {
	assert.equal(cdom.svgElements.circle({ r: "1" }).namespaceURI, "http://www.w3.org/2000/svg");
});
