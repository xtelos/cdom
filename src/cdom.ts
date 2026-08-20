/*!
 * CDOM v0.2.1 (https://github.com/AmbroseCavalier/cdom)
 *
 * Copyright 2021 Ambrose Cavalier
 * Licensed under the MIT (https://github.com/AmbroseCavalier/cdom/blob/master/LICENSE)
 *
 * Includes the Newspaper Systems extensions (stashStatePromise, stashStateFunction,
 * clearInner, appendInner). Those used to be hand-appended to the built bundle in
 * cas; they live here now, so dist/cdom.min.js is the whole artifact.
 */

type Primitive = string | number | boolean | undefined | null;
type PrimitiveOrEventListener = Primitive | ((evt: Event) => void);
type AttrMap = Record<string, PrimitiveOrEventListener>;

const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";

/**
 * Names set as live JS properties rather than attributes, when the element in hand
 * actually has the property. These take precedence over `booleanAttributes`: "checked"
 * appears in both lists, and the attribute branch used to shadow it, so `checked` was
 * only ever written as an attribute.
 *
 * The other four are property-ONLY in HTML. `indeterminate` in particular sat in
 * `booleanAttributes` alone, which made it a silent no-op: cas hand-works-around it in
 * prebuy_utils/classifications_picker.js. They stay listed as boolean attributes too,
 * as the fallback for an element that has no such property.
 */
const booleanProperties = [
	"checked",
	"indeterminate",
	"defaultChecked",
	"defaultMuted",
	"defaultSelected"
];
const stringProperties = ["value"];

// from https://github.com/kangax/html-minifier/blob/gh-pages/src/htmlminifier.js#L202
// A Set for clarity, not for speed: at cas scale the lookup cost is unmeasurable
// against the per-element budget, and claiming otherwise would be a false perf win.
// "enabled" was dropped in v0.2.1: it is neither an HTML attribute nor a property, so
// it was a silent no-op that reads like it disables something.
const booleanAttributes = new Set([
	"allowfullscreen",
	"async",
	"autofocus",
	"autoplay",
	"checked",
	"compact",
	"controls",
	"declare",
	"default",
	"defaultchecked",
	"defaultmuted",
	"defaultselected",
	"defer",
	"disabled",
	"formnovalidate",
	"hidden",
	"indeterminate",
	"inert",
	"ismap",
	"itemscope",
	"loop",
	"multiple",
	"muted",
	"nohref",
	"noresize",
	"noshade",
	"novalidate",
	"nowrap",
	"open",
	"pauseonexit",
	"readonly",
	"required",
	"reversed",
	"scoped",
	"seamless",
	"selected",
	"sortable",
	"truespeed",
	"typemustmatch",
	"visible"
]);

function setAttrOrProp(el: SVGElement | HTMLElement, name: string, val: Primitive) {
	if (name === "className") {
		// `className` is the JS property name; as an attribute it lowercases to the
		// inert `classname`. cas carried two independent translation shims for this.
		name = "class";
	}

	if (val === null || val === undefined) {
		// An absent value removes the attribute. Writing `name=""` instead would make
		// the element match presence selectors like `[title]`.
		//
		// This runs BEFORE the property branches, which it did not until v0.2.1:
		// `el.value = ""` on an <li> writes value="0" and pins the ordinal, where
		// removing the attribute leaves it auto-numbered. removeAttribute matches on
		// qualified name, so it clears a namespaced `xlink:href` too.
		el.removeAttribute(name);
	} else if (booleanProperties.includes(name) && name in el) {
		// @ts-ignore
		el[name] = !!val;
	} else if (stringProperties.includes(name) && name in el) {
		// @ts-ignore
		el[name] = val;
	} else if (name === "style") {
		if (typeof val !== "string") {
			// An object silently coerced to "[object Object]", which parses to nothing:
			// the whole inline style vanished. Mirrors the guard on function values.
			throw new Error(
				`Got ${typeof val} for "style". Pass a CSS string, e.g. style: "color: red".`
			);
		}
		// The whole inline style, parsed by CSSOM. Not a merge, and not a list of
		// ";"-separated pairs: a semicolon is legal inside a url().
		el.style.cssText = val;
	} else if (name.startsWith("xlink:")) {
		// SVG's xlink:href only works from its own namespace; plain setAttribute puts
		// it in no namespace at all, where a renderer ignores it.
		el.setAttributeNS(XLINK_NAMESPACE, name, val.toString());
	} else if (booleanAttributes.has(name.toLowerCase())) {
		if (val) {
			el.setAttribute(name, "true");
		} else {
			el.removeAttribute(name);
		}
	} else {
		el.setAttribute(name, val.toString());
	}
}

/**
 * Names that start with "on" and are NOT event handlers. HTML has no such attribute;
 * both of these are borrowed from adjacent APIs (`once` is an addEventListener option,
 * `online` is a navigator property) and are the two an author actually reaches for.
 *
 * This is a carve-out list rather than a test against the element, deliberately. Asking
 * `name in el` sounds more honest and is worse: jsdom has no `onanimationend`,
 * `ontransitionend`, `onpointerdown`, `onfocusin` or `ongotpointercapture`, so the same
 * attribute map would write an inline handler attribute under a test runner and throw in
 * a browser. An unknown on* name has to default to throwing, not to writing.
 */
const nonEventOnAttributes = new Set(["once", "online"]);

function createElementFromParams(
	tagName: string,
	namespace: ElementNamespace,
	attrs: AttrMap | null
) {
	//See https://stackoverflow.com/a/28734954
	let el: SVGElement | HTMLElement;
	if (namespace === "svg") {
		el = document.createElementNS("http://www.w3.org/2000/svg", tagName);
	} else {
		el = document.createElement(tagName);
	}

	if (attrs) {
		for (const attributeName in attrs) {
			const val = attrs[attributeName];
			// Lowercase for the decision, never for the write. HTML lowercases an
			// attribute name on the way in, so a gate on the raw name let `ONCLICK`
			// past both branches and straight into setAttribute, where it became a live
			// inline handler; `ONCLICK: fn` meanwhile threw. Both directions were wrong.
			const lowerName = attributeName.toLowerCase();
			const isOnName = lowerName.startsWith("on") && !nonEventOnAttributes.has(lowerName);
			if (typeof val === "function") {
				if (!isOnName) {
					throw new Error(`Got function for "${attributeName}".`);
				}
				// A function under an on* name is a listener, including for a custom
				// event the DOM has never heard of.
				//@ts-ignore
				el.addEventListener(lowerName.substring(2), val);
			} else if (isOnName) {
				if (val !== null && val !== undefined) {
					// `onclick: "alert(1)"` is a bug, not markup. cdom has never written
					// an inline handler attribute and must not start. An on* name that
					// is not a handler belongs in `nonEventOnAttributes`, above.
					throw new Error(
						`Got non-function for "${attributeName}". Event handlers take a function; ` +
							`if this is not an event handler, it needs adding to nonEventOnAttributes.`
					);
				}
				// A null listener is nothing to attach, and there is nothing to remove
				// from an element this call just created.
			} else {
				setAttrOrProp(el, attributeName, val);
			}
		}
	}

	return el;
}

/** Realm-safe: `instanceof Node` is false for a node from another document/iframe. */
function isNode(val: unknown): val is Node {
	return typeof val === "object" && val !== null && typeof (val as Node).nodeType === "number";
}

/** A plain attribute map, as opposed to a Node, an array, or null. */
function isAttrMap(val: unknown): val is AttrMap {
	return typeof val === "object" && val !== null && !isNode(val) && !Array.isArray(val);
}

let currentNode: Node | null = null;

function addNode<T extends Node>(node: T): T {
	if (currentNode) {
		currentNode.appendChild(node);
	}
	return node;
}

function stringifyForInner(val: Primitive): string {
	return val?.toString() ?? "";
}

type ElementNamespace = "xhtml" | "svg";

type InnerDescriptor = (() => unknown) | Node | Primitive;

function handleNodeInner<T extends Node>(node: T, inner: InnerDescriptor | null): T {
	if (inner !== null && inner !== undefined) {
		if (typeof inner === "function") {
			const oldCurrent = currentNode;
			currentNode = node;
			try {
				// The return value is deliberately untouched. Attaching a handler to an
				// async callback's promise would mark its rejection handled, so a render
				// that throws would stop surfacing through `unhandledrejection`.
				inner();
			} finally {
				currentNode = oldCurrent;
			}
		} else if (isNode(inner)) {
			node.appendChild(inner);
		} else if (Array.isArray(inner)) {
			// An empty array has always rendered an empty container; keep that. A non-empty
			// one used to be read as an attribute map and died on a nonsense attribute name.
			if (inner.length > 0) {
				throw new Error(
					"Got a non-empty array for inner content. Pass a callback that creates each child instead."
				);
			}
		} else {
			node.appendChild(document.createTextNode(stringifyForInner(inner)));
		}
	}
	return node;
}

function createAndAddElement(
	namespace: ElementNamespace,
	tagName: string,
	attrs: AttrMap | null,
	inner: InnerDescriptor | null
): Node {
	return handleNodeInner(addNode(createElementFromParams(tagName, namespace, attrs)), inner);
}
type BoundCreateFunc<N> = ((attrs: AttrMap) => N) &
	((attrs: AttrMap, inner: InnerDescriptor) => N) &
	((inner: InnerDescriptor) => N) &
	(() => N);

function makeElementProxy<N>(namespace: ElementNamespace) {
	return new Proxy(Object.create(null), {
		get(target, tagName, receiver): BoundCreateFunc<N> | undefined {
			if (typeof tagName !== "string") {
				return undefined;
			}
			// Without this the proxy answers `then` with a function, which makes the
			// whole `elements` object look like a thenable to `await` and to any async
			// function that returns it.
			if (tagName === "then") {
				return undefined;
			}
			tagName = tagName.toLowerCase();
			function boundCreate(a?: any, b?: any): N {
				const create = (attrs: AttrMap | null, inner: InnerDescriptor | null) =>
					createAndAddElement(namespace, tagName as string, attrs, inner) as unknown as N;

				if (a === undefined && b === undefined) {
					return create(null, null);
				}
				if (b === undefined) {
					// One argument: an attribute map, or inner content. A Node or an array
					// is content, not attributes, even though both are `typeof "object"`.
					return isAttrMap(a) ? create(a, null) : create(null, a);
				}
				if (a === null || a === undefined || isAttrMap(a)) {
					// `undefined` too: building attrs conditionally is normal, and
					// div(undefined, fn) threw where div(null, fn) worked.
					return create(a ?? null, b);
				}
				throw new Error(
					`Expected an attribute map as the first of two arguments to <${tagName as string}>, got ${
						isNode(a) ? "a Node" : typeof a
					}.`
				);
			}
			return boundCreate;
		}
	});
}

const CDOM = {
	elements: makeElementProxy("xhtml") as {
		[K in keyof HTMLElementTagNameMap]: BoundCreateFunc<HTMLElementTagNameMap[K]>;
	},
	svgElements: makeElementProxy("svg") as {
		[K in keyof SVGElementTagNameMap]: BoundCreateFunc<SVGElementTagNameMap[K]>;
	},
	node<T extends Node>(node: T): T {
		return addNode(node);
	},
	/**
	 * Parses `html` and appends it. NOT sanitized: trusted input only.
	 * Returns the fragment, which is still populated when there is no current node,
	 * so a top-level call can place its own content instead of silently losing it.
	 */
	html(html: string): DocumentFragment {
		const tmp = document.createElement("template");
		tmp.innerHTML = html;
		const frag = tmp.content;
		addNode(frag);
		return frag;
	},
	text(val: Primitive): Node {
		return addNode(document.createTextNode(stringifyForInner(val)));
	},
	replaceInner(node: Node, inner: () => unknown): void {
		node.textContent = "";
		handleNodeInner(node, inner);
	}
};

/**
 * Keeps the current parent alive across ONE `await`. Capture the parent now, put it
 * back when `promise` settles (before the caller's continuation runs), then let go of
 * it again once that continuation yields.
 *
 * Every await whose continuation renders needs its own call, and this covers exactly
 * one continuation: a further unstashed hop, even a bare `await Promise.resolve()`,
 * lands past it and the nodes created there are dropped silently. That drop is
 * inherent to a module-global parent and cannot be detected from inside cdom.
 */
export function stashStatePromise<T>(promise: Promise<T>): Promise<T> {
	const stashed = currentNode;
	const release = () => {
		currentNode = stashed;
		// Release to null, never to "whatever currentNode happens to be now". When two
		// renders await the SAME promise their release callbacks run in one drain, so
		// the second would capture the first's node and write it back permanently:
		// every later top-level build would then land inside that first render's host.
		queueMicrotask(() => {
			currentNode = null;
		});
	};
	// `then(release, release)` rather than `finally`, so the derived promise settles
	// here. The caller still awaits the original promise and sees it reject.
	//
	// The cost, which is inherent: observing settlement marks the rejection handled, so
	// a stashed promise NOBODY awaits rejects in silence. Both alternatives were built and
	// measured, and each fails differently. Returning a derived promise breaks the stash,
	// because the release microtask then runs before the caller's continuation instead of
	// after it. Rethrowing (`then(release, e => { release(); throw e; })`) keeps every
	// async invariant and does restore the report, but fires a SPURIOUS unhandled
	// rejection every time a caller handles the error properly, which is all 24 cas sites.
	// Await the returned promise, or attach your own .catch.
	// Pinned by test/fixtures/fire-and-forget-rejection.mjs.
	promise.then(release, release);
	return promise;
}

/** `stashStatePromise` for a function that returns a promise. */
export function stashStateFunction<T>(func: () => Promise<T>): Promise<T> {
	return stashStatePromise(func());
}

/** Removes every child of `element`. */
export function clearInner<T extends Node>(element: T): T {
	element.textContent = "";
	return element;
}

/**
 * Appends content to `element`: a string, a Node, or a callback that builds children
 * inside it. Synchronous, so the caller does not need an `await` that would itself
 * drop whatever the continuation renders.
 */
export function appendInner<T extends Node>(element: T, content: InnerDescriptor): T {
	return handleNodeInner(element, content ?? null);
}

export default CDOM;
