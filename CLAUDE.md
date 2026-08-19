# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

CDOM is a zero-dependency TypeScript library that builds DOM trees from nested closures.
All of the source is `src/cdom.ts`; the shipped artifact is `dist/cdom.min.js`, a minified ES module
with a default export plus four named exports. It is the rendering primitive under every modern page
in the CAS web app.

The whole repo is small enough that this file is its map. The estate-level synthesis (provenance,
consumer census, measured semantics) is `~/.claude/reference/cdom/cdom.md`, and the evidence behind
it is `~/.claude/research/cdom-deep-dive-2026-08-19/`.

## Where this checkout pushes

`origin` is **`xtelos/cdom`**, a fork; `upstream` is `newspapersystems/cdom`. The org repo is
read-only for us (`push: false`; a push there 403s naming the account, which is a repo-permission
gap, not a credential problem), so work lands on the fork and the org repo stays the frozen mirror it
already was. `master` and `dev` both track `origin`. Both repos are public.

## Provenance

Commits `3862679`, `3fec200` and `32dec2d` are Ambrose Cavalier's from June 2021, and
`newspapersystems/cdom` HEAD is the same SHA as upstream `AmbroseCavalier/cdom` HEAD. Everything
after that is ours. Do not expect upstream to have fixes; it has not moved since 2021.

## The vendoring contract (this changed in v0.2.0, read it)

What CAS loads is `cas/web_bs/static/3rdparty/cdom/cdom.min.js`. **As of v0.2.0 that file is
`dist/cdom.min.js` byte-for-byte, and nothing else.** Shipping a library change is now:

```sh
npm run verify                                          # typecheck + build + tests
cp dist/cdom.min.js "$CAS/web_bs/static/3rdparty/cdom/cdom.min.js"
cmp dist/cdom.min.js "$CAS/web_bs/static/3rdparty/cdom/cdom.min.js"   # must be silent
```

**Before v0.2.0 this was a trap**, and the history matters because the fix is only one commit deep:
the vendored file used to be the built bundle *plus* a hand-appended, unminified tail defining
`stashStatePromise`, `stashStateFunction`, `clearInner` and `appendInner`. Rebuilding and copying
deleted all four, which 19 cas modules import, and nothing caught it. Those four now live in
`src/cdom.ts` and are covered by `test/vendoring.test.mjs`, so the build cannot silently lose them
again. If you ever find a vendored copy that is larger than `dist/cdom.min.js`, someone has
re-appended a tail and you are back in the old world.

The patch had to live inside the bundle because `stashStatePromise` assigns to `currentNode`, a
module-scoped binding with no exported setter, so a sibling module cannot do it. That is still true,
which is why these are exports of this library rather than helpers in cas.

cas's `.gitattributes` carries `*.min.js -diff`, so every change to the vendored copy shows up as
`Bin N -> M bytes` in `git show` and in PR review. Do not expect review to catch a mistake here; the
`cmp` above is the check that matters.

## Build and test

```sh
npm install         # jsdom, terser, typescript, all pinned
npm run verify      # typecheck, build, then the suite. Use this before shipping.
npm run build       # tsc, then terser, into ./dist
npm test            # node --test, against dist/cdom.min.js
npm run typecheck   # tsc --noEmit
```

- The tests load **`dist/cdom.min.js`**, not the TypeScript source, so they exercise exactly the
  bytes cas vendors. A source fix that does not survive minification fails the suite.
- The build is **byte-reproducible** with the pinned tsc 5.9.3 + terser 5.50.0 (verified 2026-08-19),
  so a byte diff against `dist/` is a real signal. `build.sh` runs `node_modules/.bin` directly and
  fails if you have not run `npm install`, deliberately: `npx --yes` silently downloads the *latest*
  tsc/terser when `node_modules` is absent, which would turn that byte diff into noise. The pins and
  the committed `package-lock.json` are what protect it; do not float them casually.
- Every commit touching `src/cdom.ts` must also commit the rebuilt `dist/cdom.min.js`.
- `dist/cdom.js`, `dist/cdom.d.ts` and `dist/cdom.js.map` are build intermediates and are gitignored.
  Only `dist/cdom.min.js` is tracked.
- No CI. `npm run verify` is the gate.
- The version banner lives only in the `/*! ... */` block atop `src/cdom.ts`; terser preserves it
  into the minified output, and `test/vendoring.test.mjs` asserts it survived. Bump it in the source,
  never in `dist/`.
- Source style is hard tabs.

## Architecture: one module-global `currentNode`

- `addNode()` appends to `currentNode` **if there is one**, and returns the node either way.
- `handleNodeInner()` sets `currentNode` to the new node, runs the caller's `inner` closure, and
  restores the previous value in a `finally`. Nesting in the DOM is nesting of closures; no parent is
  ever passed as an argument.
- A call made while `currentNode` is null returns a **detached** element. That is the normal
  top-level idiom: capture the return value and place it (or hand it to `cdom.replaceInner`).
- Anything that runs an `inner` callback must restore `currentNode` on the way out, exceptions
  included. Losing that `finally` silently corrupts the tree for every later call in the frame.
- Element factories are `Proxy` objects, so any tag name works at runtime and the compile-time
  surface comes purely from the casts to `HTMLElementTagNameMap` / `SVGElementTagNameMap`. Tag names
  are lowercased. SVG goes through `createElementNS`. The proxy answers `then` with `undefined` on
  purpose, so `elements` is not mistaken for a thenable.
- Argument dispatch is by shape, not arity: a lone plain object is attributes, and a lone Node,
  function or primitive is inner content. Arrays and Nodes are never read as an attribute map.

## Measured semantics

Probed against the shipped bundle under jsdom, not read off the source. Every row is asserted in
`test/semantics.test.mjs`.

| Case | Result |
|---|---|
| top-level `div(...)` | returns element, `parentNode === null` |
| `style: "color:red"` | written to `el.style.cssText`, replacing the whole inline style |
| `hidden: true` / `disabled: false` | `hidden="true"` / attribute removed (the `booleanAttributes` list) |
| `title: null` or `undefined` | attribute **removed** |
| `href: null` / `src: undefined` | attribute **removed**, so an anchor stops matching `a[href]`, stops being focusable, and loses link styling. This has live cas surfaces (navbar and homepage tiles) |
| `value` / `checked` | set as JS properties when the element has one, else as attributes (property names beat the boolean-attribute list) |
| `checked: true` serialization | **no `checked` in `outerHTML`, and `defaultChecked` stays false**, so a re-parse of the markup and `form.reset()` both come back unchecked. `.checked`, `:checked` and `cloneNode` are unaffected |
| `href: null` on an anchor | attribute removed, so the anchor is no longer focusable or keyboard-activatable |
| `div(null)` / `div(undefined)` | empty div |
| `div(0)` / `div(false)` | render as text `0` / `false` |
| `div(someNode)` | the node is appended as content |
| `div([])` | empty container |
| `div([a, b])` | throws; pass a callback that creates each child |
| `onClick: fn` | `addEventListener("click", fn)`; `null`/`undefined` listeners are skipped |
| `onclick: "alert(1)"` | throws `Got non-function for "onclick"` |
| `title: () => {}` | throws `Got function for "title"` |
| `cdom.html(str)` | `<template>` parse then append, returns the fragment, **no sanitization**: trusted input only |

## The async edge (the reason the NS exports exist)

An `await` inside a content callback ends the synchronous closure, so `handleNodeInner`'s `finally`
has already restored `currentNode` before the continuation runs. Nodes created after an unwrapped
`await` are **not appended**; the element is returned detached, and **nothing reports it**.

- `stashStatePromise(promise)` captures `currentNode`, restores it when the promise settles (before
  the caller's continuation runs), then releases it in a microtask.
- **It releases to `null`, never to whatever `currentNode` happens to be at that moment.** This is
  load-bearing and the mistake is easy to make: when two renders await the *same* promise their
  release callbacks run in one microtask drain, so a "restore the previous value" release captures
  the first render's node and writes it back permanently. Every later top-level build then silently
  lands inside that first render's host. Different timers never produce the interleaving, so only a
  shared promise catches it (`test/async.test.mjs`, "two renders awaiting the SAME promise").
- **Wrap every await whose continuation renders.** Stashed awaits chain correctly: two in a row, a
  loop of them, and a stash inside a nested element all render into the right parent. The stash
  covers exactly **one** continuation, so a further unstashed hop, even a bare
  `await Promise.resolve()`, lands past it and loses everything after.
- **Two further leaks exist, both pre-existing and neither hit by any cas call site.** (a) An
  unrelated plain `.then` on the same promise a render stashed lands in the window between restore
  and release, so a top-level build inside that callback is silently adopted into the render's host.
  (b) `await Promise.all([stashStatePromise(a), stashStatePromise(b)])` drops everything after the
  await, because both release microtasks run before `Promise.all`'s continuation. **Write
  `await stashStatePromise(Promise.all([a, b]))` instead**, which works.
- **That drop cannot be detected from inside cdom, and v0.2.0 does not try.** A detector was built
  and removed before shipping: with a module-global parent there is no way to tell "a node from a
  continuation that lost its parent" from "an ordinary detached top-level build", which is the
  documented top-level idiom. A global "is any async render in flight" flag fires on correct code
  every time a page builds a detached element while any fetch is outstanding. Do not rebuild it
  without a per-frame mechanism.
- **Nothing may attach a handler to an `inner` callback's promise.** Doing so marks its rejection
  handled, and an async render that throws then fails silently instead of surfacing through
  `unhandledrejection`. `test/fixtures/throwing-render.mjs` guards this out of process, because
  `node --test` claims `unhandledRejection` for itself.
- `stashStateFunction(fn)` is the same thing for a function returning a promise. It had zero call
  sites in cas as of 2026-08-19, and before v0.2.0 its `return await` wrapper added a hop that broke
  it for any real (macrotask) async work.
- `appendInner` is **synchronous** and returns the element. It used to be `async`, which meant every
  `await appendInner(...)` was itself an unstashed await that dropped whatever came next.

## Consumers

`cas` is the only one. **61 of its 163 `web_bs/js` files** import the bundle, as a native ES module
by relative path (`../static/3rdparty/cdom/cdom.min.js`); no bundler touches `web_bs/js`. Weight
(measured 2026-08-19, call sites unless noted): `replaceInner` 163, `elements` destructured once per
module, `stashStatePromise` 41 across 17 files, `text`, `html` and `node` in single digits,
`svgElements` 0, `clearInner` 1, `appendInner` 1, `stashStateFunction` **0**. Only 19 files use any
of the four formerly-appended exports. Most page code should go through the `cdomModal` /
`cdomPromiseModal` / `cdomConfirmModal` / `cdomAlertModal` wrappers in
`cas/web_bs/js/general_utils.js` rather than raw builders.

**cas's main suite proves nothing about this library**: `cas/vitest.config.js` aliases
`/.*cdom\.min\.js$/` to a no-op mock that does not even carry `stashStatePromise`. The suite that
does load the real bundle is `cas/vitest.render.config.js` (`npm run test:render`), and **as of
2026-08-19 it exists only on the unmerged `track-modernization` branch**, not on `dev` or `master`
(cas#974 merged into that branch, not into dev). Until it lands, running it means checking out that
branch and dropping the bundle in; `npm run test:render` on `dev` is `Missing script`. So the real
consumer-side gate today is `npm run verify` here plus a browser. Consumer-side detail:
`cas/docs/maps/frontend-architecture.md` sections 2 and 10.
