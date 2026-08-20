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
type InnerDescriptor = (() => unknown) | Node | Primitive;
type BoundCreateFunc<N> = ((attrs: AttrMap) => N) & ((attrs: AttrMap, inner: InnerDescriptor) => N) & ((inner: InnerDescriptor) => N) & (() => N);
declare const CDOM: {
    elements: { [K in keyof HTMLElementTagNameMap]: BoundCreateFunc<HTMLElementTagNameMap[K]>; };
    svgElements: { [K in keyof SVGElementTagNameMap]: BoundCreateFunc<SVGElementTagNameMap[K]>; };
    node<T extends Node>(node: T): T;
    /**
     * Parses `html` and appends it. NOT sanitized: trusted input only.
     * Returns the fragment, which is still populated when there is no current node,
     * so a top-level call can place its own content instead of silently losing it.
     */
    html(html: string): DocumentFragment;
    text(val: Primitive): Node;
    replaceInner(node: Node, inner: () => unknown): void;
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
export declare function stashStatePromise<T>(promise: Promise<T>): Promise<T>;
/** `stashStatePromise` for a function that returns a promise. */
export declare function stashStateFunction<T>(func: () => Promise<T>): Promise<T>;
/** Removes every child of `element`. */
export declare function clearInner<T extends Node>(element: T): T;
/**
 * Appends content to `element`: a string, a Node, or a callback that builds children
 * inside it. Synchronous, so the caller does not need an `await` that would itself
 * drop whatever the continuation renders.
 */
export declare function appendInner<T extends Node>(element: T, content: InnerDescriptor): T;
export default CDOM;
