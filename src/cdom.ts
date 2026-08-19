/*!
 * CDOM v0.2.0 (https://github.com/AmbroseCavalier/cdom)
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

/**
 * Names set as live JS properties rather than attributes. These take precedence over
 * `booleanAttributes`: "checked" appears in both lists, and the attribute branch used
 * to shadow it, so `checked` was only ever written as an attribute.
 */
const booleanProperties = ["checked"];
const stringProperties = ["value"];

// from https://github.com/kangax/html-minifier/blob/gh-pages/src/htmlminifier.js#L202
const booleanAttributes = [
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
	"enabled",
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
];

function setAttrOrProp(el: SVGElement | HTMLElement, name: string, val: Primitive) {
	if (booleanProperties.includes(name) && name in el) {
		// @ts-ignore
		el[name] = !!val;
	} else if (stringProperties.includes(name) && name in el) {
		// @ts-ignore
		el[name] = val ?? "";
	} else if (val === null || val === undefined) {
		// An absent value removes the attribute. Writing `name=""` instead would make
		// the element match presence selectors like `[title]`.
		el.removeAttribute(name);
	} else if (name === "style") {
		el.style.cssText = val.toString();
	} else if (booleanAttributes.includes(name.toLowerCase())) {
		if (val) {
			el.setAttribute(name, "true");
		} else {
			el.removeAttribute(name);
		}
	} else {
		el.setAttribute(name, val.toString());
	}
}

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
			if (attributeName.startsWith("on")) {
				if (val === null || val === undefined) {
					continue
				}
				if (typeof val !== "function") {
					throw new Error(`Got non-function for "${attributeName}".`);
				}
				//@ts-ignore
				el.addEventListener(attributeName.substring(2).toLowerCase(), val);
			} else if (typeof val === "function") {
				throw new Error(`Got function for "${attributeName}".`);
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
			throw new Error("Got an array for inner content. Pass a callback that creates each child instead.");
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
				if (a === null || isAttrMap(a)) {
					return create(a, b);
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
