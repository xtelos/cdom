import { test } from "node:test";
import assert from "node:assert/strict";
import { cdom, mod, dom, host } from "./_setup.mjs";

const { div, span, input, a, img, p: para } = cdom.elements;
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
	assert.throws(() => div([1, 2]), /non-empty array/i);
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

test("href and src follow the same absent-value rule as any other attribute", () => {
	// Named separately because both have live cas surfaces: navbar and homepage tiles
	// build anchors as a({href: tile.href}), and an absent href now means the anchor
	// no longer matches `a[href]`, is not focusable, and loses link styling.
	assert.equal(a({ href: undefined }).outerHTML, "<a></a>");
	assert.equal(a({ href: null }).hasAttribute("href"), false);
	assert.equal(a({ href: "/x" }).getAttribute("href"), "/x");
	assert.equal(img({ src: null }).hasAttribute("src"), false);
	assert.equal(img({ src: "/i.png" }).getAttribute("src"), "/i.png");
});

test("style is written as the element's inline style", () => {
	const el = div({ style: "color: red" });
	assert.equal(el.style.color, "red");
	assert.equal(el.style.length, 1);
});

test("an empty array renders an empty container", () => {
	// This used to work and briefly regressed to a throw. Only a NON-empty array is
	// an error, and that one threw before too, just with a nonsense message.
	assert.equal(div([]).outerHTML, "<div></div>");
	assert.equal(div({ id: "z" }, []).outerHTML, '<div id="z"></div>');
	const h = host();
	h.innerHTML = "<b>old</b>";
	cdom.replaceInner(h, []);
	assert.equal(h.innerHTML, "");
});

test("replaceInner clears the host before appending", () => {
	const h = host();
	h.innerHTML = "<b>old</b><i>stuff</i>";
	cdom.replaceInner(h, () => para("new"));
	assert.equal(h.innerHTML, "<p>new</p>");
});

test("a render callback that throws still restores the parent", () => {
	// handleNodeInner's `finally` is the invariant the whole builder rests on. Without
	// it, everything created later in the frame lands in the wrong container.
	const h = host();
	cdom.replaceInner(h, () => {
		para("outer");
		try {
			span(() => {
				para("inner");
				throw new Error("boom");
			});
		} catch {
			/* the caller handles it; cdom must still have restored the parent */
		}
		para("after");
	});
	assert.equal(h.innerHTML, "<p>outer</p><span><p>inner</p></span><p>after</p>");

	// And the top-level context is back to detached, not left pointing at h.
	assert.equal(div("later").parentNode, null);
});

/* ------------------------------------------------------------------------- *
 * Coverage the 2026-08-20 audit found missing. Two mutations passed the whole
 * suite at 37/0 before these existed: gutting node() and text(), and deleting
 * an entry from booleanAttributes.
 * ------------------------------------------------------------------------- */

test("node() appends into the current parent and returns the node", () => {
	const h = host();
	const made = dom.window.document.createElement("b");
	let returned;
	cdom.replaceInner(h, () => {
		returned = cdom.node(made);
	});
	assert.equal(returned, made, "node() must return exactly what it was given");
	assert.equal(h.innerHTML, "<b></b>");
	assert.equal(made.parentNode, h);

	// At top level it is returned and appended nowhere, like any other builder.
	const loose = dom.window.document.createElement("i");
	assert.equal(cdom.node(loose), loose);
	assert.equal(loose.parentNode, null);
});

test("text() appends a text node, and stringifies the way inner content does", () => {
	const h = host();
	let returned;
	cdom.replaceInner(h, () => {
		returned = cdom.text("hi");
	});
	assert.equal(h.innerHTML, "hi");
	assert.equal(returned.nodeType, 3, "must be a Text node");
	assert.equal(returned.parentNode, h);

	const h2 = host();
	cdom.replaceInner(h2, () => {
		cdom.text(0);
		cdom.text(false);
		cdom.text(null);
		cdom.text(undefined);
	});
	assert.equal(h2.childNodes.length, 4, "null and undefined still make an (empty) text node");
	assert.equal(h2.textContent, "0false");

	// Unlike html(), text() is escaped. This is the safe way to put user data on a page.
	const h3 = host();
	cdom.replaceInner(h3, () => cdom.text("<b>&</b>"));
	assert.equal(h3.innerHTML, "&lt;b&gt;&amp;&lt;/b&gt;");

	assert.equal(cdom.text("x").parentNode, null);
});

// The full list as of v0.2.1. Duplicated here on purpose: the source list is not
// exported, and before this test deleting an entry outright passed the suite.
const BOOLEAN_ATTRIBUTES = [
	"allowfullscreen", "async", "autofocus", "autoplay", "checked", "compact", "controls",
	"declare", "default", "defaultchecked", "defaultmuted", "defaultselected", "defer",
	"disabled", "formnovalidate", "hidden", "indeterminate", "inert", "ismap", "itemscope",
	"loop", "multiple", "muted", "nohref", "noresize", "noshade", "novalidate", "nowrap",
	"open", "pauseonexit", "readonly", "required", "reversed", "scoped", "seamless",
	"selected", "sortable", "truespeed", "typemustmatch", "visible"
];

test("every boolean attribute writes true and removes on false", () => {
	// A div has none of these as a JS property, so each one takes the attribute path.
	for (const name of BOOLEAN_ATTRIBUTES) {
		assert.equal(div({ [name]: true }).getAttribute(name), "true", `${name}: true`);
		assert.equal(div({ [name]: false }).hasAttribute(name), false, `${name}: false`);
		assert.equal(div({ [name]: 0 }).hasAttribute(name), false, `${name}: falsy`);
	}
	assert.equal(BOOLEAN_ATTRIBUTES.length, 40);
});

test("the boolean-attribute lookup is case-insensitive", () => {
	// Every name in the loop above is already lowercase, so dropping the .toLowerCase()
	// from the lookup passed the whole suite. An upper-case key is what HTML would
	// lowercase on the way in, so it has to take the same branch.
	assert.equal(div({ HIDDEN: true }).getAttribute("hidden"), "true");
	assert.equal(div({ HIDDEN: false }).hasAttribute("hidden"), false);
	assert.equal(div({ Disabled: false }).hasAttribute("disabled"), false);
});

test("a name outside the list keeps its literal value", () => {
	// The counterpart to the loop above: "false" as a *string* is exactly what the DOM
	// does with an unknown attribute, and is why the list has to be explicit. Naming
	// several is the only guard against a name being ADDED to the list; the length
	// assertion above pins this file's copy, not the source's.
	assert.equal(div({ contenteditable: false }).getAttribute("contenteditable"), "false");
	assert.equal(div({ draggable: false }).getAttribute("draggable"), "false");
	assert.equal(div({ spellcheck: false }).getAttribute("spellcheck"), "false");
	assert.equal(div({ translate: false }).getAttribute("translate"), "false");
	// `enabled` was in the list and is not an HTML attribute or property at all, so it
	// was a silent no-op. Removed in v0.2.1: junk you can see beats a no-op you cannot.
	assert.equal(div({ enabled: false }).getAttribute("enabled"), "false");
});

test("style is the element's whole inline style, parsed by CSSOM", () => {
	const el = div({ style: "color: red" });
	assert.equal(el.style.color, "red");
	assert.equal(el.style.length, 1);

	// A CSS string is not a list of ";"-separated pairs: a semicolon appears inside a
	// url(). Splitting on ";" and calling setProperty per piece (which is *merge*
	// semantics, not replace) satisfies the two assertions above and mangles this one.
	const withUrl = div({ style: "background-image: url(data:image/png;base64,AAAA); color: red" });
	assert.equal(withUrl.style.length, 2);
	assert.equal(withUrl.style.color, "red");
	assert.match(withUrl.getAttribute("style"), /base64,AAAA/);

	// An object used to coerce to "[object Object]" and leave the style empty.
	assert.throws(() => div({ style: { color: "red" } }), /style/);
	assert.throws(() => div({ style: 12 }), /style/);
});

/* ------------------------------------------------------------------------- *
 * v0.2.1 fixes. Each row was probed against the v0.2.0 bundle first, so every
 * assertion here is a behaviour that measurably changed.
 * ------------------------------------------------------------------------- */

test("indeterminate reaches the property instead of a dead attribute", () => {
	// The only audit finding with a live consumer already working around it:
	// cas/web_bs/js/prebuy_utils/classifications_picker.js sets it by hand afterwards.
	const el = input({ type: "checkbox", indeterminate: true });
	assert.equal(el.indeterminate, true);
	assert.equal(el.hasAttribute("indeterminate"), false);
	assert.equal(input({ type: "checkbox", indeterminate: false }).indeterminate, false);

	// The other three property-only names in the same list.
	assert.equal(input({ type: "checkbox", defaultChecked: true }).defaultChecked, true);
	assert.equal(cdom.elements.option({ defaultSelected: true }).defaultSelected, true);
	assert.equal(cdom.elements.audio({ defaultMuted: true }).defaultMuted, true);

	// An element without the property still falls back to the attribute path.
	assert.equal(div({ indeterminate: true }).getAttribute("indeterminate"), "true");
});

test("an attribute that merely starts with 'on' is not an event handler", () => {
	// `startsWith("on")` with no event-name check threw on both of these.
	assert.equal(div({ online: "yes" }).getAttribute("online"), "yes");
	assert.equal(input({ once: true }).getAttribute("once"), "true");
	assert.equal(div({ "data-onboarding": "x" }).getAttribute("data-onboarding"), "x");

	// A real handler name with a non-function value is still a bug, not markup.
	assert.throws(() => div({ onclick: "alert(1)" }), /non-function/);
	assert.throws(() => div({ onClick: "alert(1)" }), /non-function/);

	// And a function under any on* name is still a listener, custom events included.
	let hits = 0;
	const el = div({ onMyCustomEvent: () => hits++ });
	el.dispatchEvent(new dom.window.Event("mycustomevent"));
	assert.equal(hits, 1);
});

test("className is an alias for class", () => {
	assert.equal(div({ className: "foo bar" }).getAttribute("class"), "foo bar");
	assert.equal(div({ className: "foo bar" }).classList.contains("bar"), true);
	assert.equal(div({ className: "x" }).hasAttribute("classname"), false);
	assert.equal(div({ className: null }).hasAttribute("class"), false);
	// The plain spelling is untouched.
	assert.equal(div({ class: "z" }).getAttribute("class"), "z");
});

test("xlink:href lands in the XLink namespace", () => {
	// Plain setAttribute puts it in no namespace, where an SVG renderer ignores it.
	const use = cdom.svgElements.use({ "xlink:href": "#icon" });
	assert.equal(use.attributes.length, 1);
	assert.equal(use.attributes[0].namespaceURI, "http://www.w3.org/1999/xlink");
	assert.equal(use.getAttributeNS("http://www.w3.org/1999/xlink", "href"), "#icon");
	assert.equal(cdom.svgElements.use({ "xlink:href": null }).attributes.length, 0);
});

test("an absent value removes the attribute before any property is written", () => {
	// value: null took the property path and wrote el.value = "", which on an <li> is
	// the number 0 and pins the ordinal. No key at all leaves it auto-numbered, and
	// that is what an absent value has to mean.
	const li = cdom.elements.li({ value: null });
	assert.equal(li.hasAttribute("value"), false);
	assert.equal(li.outerHTML, "<li></li>");
	assert.equal(cdom.elements.li({ value: 3 }).value, 3);

	// Unchanged for the elements where value is a live string property.
	assert.equal(input({ value: null }).value, "");
	assert.equal(input({ value: "hi" }).value, "hi");
	assert.equal(input({ type: "checkbox", checked: null }).checked, false);
});

test("undefined is accepted as the first of two arguments", () => {
	// Building attrs conditionally is normal; div(undefined, fn) threw where
	// div(null, fn) worked.
	const attrs = undefined;
	assert.equal(div(attrs, () => span("s")).outerHTML, "<div><span>s</span></div>");
	assert.equal(div(undefined, "text").outerHTML, "<div>text</div>");
	assert.equal(div(null, () => span("s")).outerHTML, "<div><span>s</span></div>");
	// A Node or a primitive first is still an error worth naming.
	assert.throws(() => div(dom.window.document.createTextNode("x"), () => {}), /Node/);
	assert.throws(() => div("str", () => {}), /string/);
});

/* ------------------------------------------------------------------------- *
 * Adversarial review of the v0.2.1 diff, 2026-08-20. Every case below was
 * measured against both the v0.2.0 and the v0.2.1 bundle before being written.
 * ------------------------------------------------------------------------- */

test("an event-handler name is recognised whatever its case", () => {
	// The gate was `attributeName.startsWith("on")` while the handler test lowercased,
	// so an upper-case name fell through BOTH branches into setAttribute. HTML then
	// lowercased it on the way in, which made ONCLICK: "alert(1)" a live inline
	// handler. The mirror image was just as wrong: ONCLICK: fn threw.
	assert.throws(() => div({ ONCLICK: "alert(1)" }), /non-function/);
	assert.throws(() => div({ OnClick: "alert(1)" }), /non-function/);
	assert.equal(div({ ONCLICK: null }).hasAttribute("onclick"), false);

	for (const name of ["ONCLICK", "OnClick", "onClick", "onclick"]) {
		let hits = 0;
		const el = div({ [name]: () => hits++ });
		el.dispatchEvent(new dom.window.Event("click"));
		assert.equal(hits, 1, `${name} must attach a listener`);
		assert.equal(el.hasAttribute("onclick"), false, `${name} must not write an attribute`);
	}
});

test("an unrecognised on* name throws rather than becoming an attribute", () => {
	// These are real handlers in a browser and absent from jsdom's element prototypes.
	// Deciding by `name in el` made cdom write an inline handler attribute under a test
	// runner for input that is a hard error in production, which is the wrong direction
	// for a test environment to differ in. An unknown on* name defaults to throwing.
	for (const name of [
		"onanimationend",
		"ontransitionend",
		"onpointerdown",
		"onfocusin",
		"ongotpointercapture",
		"onwhateverisnext"
	]) {
		assert.throws(() => div({ [name]: "alert(1)" }), /non-function/, name);
		assert.equal(div({ [name]: null }).hasAttribute(name), false, name);
	}

	// The carve-out stays: these two are the on-prefixed names that are not handlers.
	assert.equal(div({ online: "yes" }).getAttribute("online"), "yes");
	assert.equal(input({ once: true }).getAttribute("once"), "true");
	assert.equal(div({ ONLINE: "yes" }).getAttribute("online"), "yes");
});

test("an absent value changes <option> and <progress> too, not just <li>", () => {
	// The reordering that fixed <li> reaches every element with a `value` property.
	// The <option> row is the one to watch: a placeholder built as option({value: x})
	// with x null now submits its own label instead of "". No cas call site does this,
	// and passing "" explicitly is unchanged, but it is the shape of bug that gets
	// diagnosed as a backend problem.
	const opt = cdom.elements.option({ value: null }, "Any");
	assert.equal(opt.outerHTML, "<option>Any</option>");
	assert.equal(opt.value, "Any", "with no value attribute, <option> falls back to its text");
	assert.equal(cdom.elements.option({ value: "" }, "Any").value, "");

	// <progress> flips from a determinate zero bar to an animated indeterminate one.
	assert.equal(cdom.elements.progress({ value: null }).hasAttribute("value"), false);
	assert.equal(cdom.elements.progress({ value: 0 }).getAttribute("value"), "0");
});
