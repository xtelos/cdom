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
npm run verify                                          # typecheck, build, tests, byte-check
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

**v0.2.1 is built here and not yet vendored.** cas still loads v0.2.0, so every *(new in 0.2.1)* row
in the semantics table below is true of this repo and not of a live page. Shipping it is the `cp` +
`cmp` above plus a cas PR, and it wants a browser first: `indeterminate`, `xlink:href` and the
`href: null` focusability rows are all jsdom-derived.

## Build and test

```sh
npm install         # jsdom, terser, typescript, all pinned
npm run verify      # typecheck, build, suite, byte-check. Use this before shipping.
npm run build       # tsc, then terser, into ./dist (or into $1, for check-dist.sh)
npm test            # rebuilds first (pretest), then node --test against dist/cdom.min.js
npm run check:dist  # rebuild to a temp dir and cmp against the committed dist/
npm run typecheck   # tsc --noEmit, from node_modules/.bin, never a global tsc
```

- The tests load **`dist/cdom.min.js`**, not the TypeScript source, so they exercise exactly the
  bytes cas vendors. A source fix that does not survive minification fails the suite.
- The build is **byte-reproducible** with the pinned tsc 5.9.3 + terser 5.50.0, and as of v0.2.1
  `npm run check:dist` proves it on every verify instead of leaving it a claim. `build.sh` runs `node_modules/.bin` directly and
  fails if you have not run `npm install`, deliberately: `npx --yes` silently downloads the *latest*
  tsc/terser when `node_modules` is absent, which would turn that byte diff into noise. The pins and
  the committed `package-lock.json` are what protect it; do not float them casually.
- Every commit touching `src/cdom.ts` must also commit the rebuilt `dist/cdom.min.js`.
- `dist/cdom.js` and `dist/cdom.js.map` are build intermediates and are gitignored. `dist/cdom.min.js`
  **and `dist/cdom.d.ts`** are tracked: the bundle is what cas vendors, and the declarations are what
  `package.json`'s `types` field points at. It pointed at a gitignored file until v0.2.1, so the
  package shipped a types path that did not exist.
- No CI. `npm run verify` is the gate, **and as of v0.2.1 it actually gates.** It was a false green
  until 2026-08-20, proved by two mutations: gutting `node()` and `text()` passed the whole chain at
  `# pass 37 / # fail 0` because neither had a behavioural assertion, and `npm test` never rebuilt, so
  a `src/cdom.ts` edit was validated against the **stale** `dist/`. Both are closed:
  - `pretest` rebuilds, so bare `npm test` can no longer pass against a stale bundle (re-proved: the
    same no-op `clearInner` that used to read 37/0 now reads 36/1).
  - `check:dist` rebuilds into a temp dir and `cmp`s against the committed `dist/`. Run after a build
    it proves byte-reproducibility; run on a clean checkout it proves the committed artifact is what
    the source actually builds to. Both directions were verified by hand.
  - The suite is now **mutation-tested**: 12 mutations (gutted `node`/`text`, a deleted
    `booleanAttributes` entry, `cssText` swapped for an additive `setProperty` merge, a removed
    `finally`, releasing the stash to the previous parent instead of `null`, and one per v0.2.1 fix)
    are each killed by a named failing test. Re-run them before trusting a green suite again.
  What the gate still does not cover: anything needing a real browser (focus, paint, keyboard
  activation, `xlink:href` rendering), and cas's own call sites. `npm run verify` green means the
  library does what its tests say, not that a cas page works.
- The version banner lives only in the `/*! ... */` block atop `src/cdom.ts`; terser preserves it
  into the minified output, and `test/vendoring.test.mjs` asserts it survived **and that it matches
  `package.json`'s version**, which nothing checked before v0.2.1: the old assertion was
  `/CDOM v\d+\.\d+\.\d+/` and matched any version at all. Bump it in the source, never in `dist/`.
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
`test/semantics.test.mjs`. **This table is v0.2.1; cas vendors v0.2.0 until the bundle is copied
across**, so the rows marked *new in 0.2.1* are not yet true of what a cas page loads.

| Case | Result |
|---|---|
| top-level `div(...)` | returns element, `parentNode === null` |
| `style: "color:red"` | written to `el.style.cssText`, replacing the whole inline style. A non-string **throws** *(new in 0.2.1; an object used to coerce to `[object Object]` and leave the style empty)* |
| `hidden: true` / `disabled: false` | `hidden="true"` / attribute removed (the `booleanAttributes` list) |
| `title: null` or `undefined` | attribute **removed** |
| `href: null` / `src: undefined` | attribute **removed**, so an anchor stops matching `a[href]`, stops being focusable, and loses link styling. This has live cas surfaces (navbar and homepage tiles) |
| `value` / `checked` | set as JS properties when the element has one, else as attributes (property names beat the boolean-attribute list) |
| `value: null` on `<li>` | attribute **removed**, ordinal stays auto-numbered *(new in 0.2.1; the property path used to write `value="0"` and pin it)* |
| `indeterminate: true` | sets the **property** *(new in 0.2.1; it was attribute-only and a silent no-op, which cas hand-works-around in `prebuy_utils/classifications_picker.js`)*. Same for `defaultChecked` / `defaultMuted` / `defaultSelected` |
| `enabled: false` | plain attribute `enabled="false"` *(new in 0.2.1; it was a listed boolean attribute, so it did nothing at all, and it is neither an HTML attribute nor a property)* |
| `className: "a b"` | writes `class` *(new in 0.2.1; it wrote the inert `classname`, which is why cas carries two translation shims)* |
| `"xlink:href": "#i"` | `setAttributeNS` into the XLink namespace *(new in 0.2.1; plain `setAttribute` left it in no namespace, where a renderer ignores it)*. **Browser-unverified** |
| `checked: true` serialization | **no `checked` in `outerHTML`, and `defaultChecked` stays false**, so a re-parse of the markup and `form.reset()` both come back unchecked. `.checked`, `:checked` and `cloneNode` are unaffected |
| `href: null` on an anchor | attribute removed, so the anchor is no longer focusable or keyboard-activatable |
| `div(null)` / `div(undefined)` | empty div |
| `div(undefined, fn)` | same as `div(null, fn)` *(new in 0.2.1; it used to throw, which bites anyone building attrs conditionally)* |
| `div(0)` / `div(false)` | render as text `0` / `false` |
| `div(someNode)` | the node is appended as content |
| `div([])` | empty container |
| `div([a, b])` | throws; pass a callback that creates each child |
| `onClick: fn` | `addEventListener("click", fn)`; `null`/`undefined` listeners are skipped |
| `onclick: "alert(1)"` | throws `Got non-function for "onclick"`. cdom never writes an inline handler attribute |
| `online: "yes"` / `once: true` | ordinary attributes *(new in 0.2.1; a bare `startsWith("on")` routed them to `addEventListener` and threw)*. A name counts as a handler only if the element has the matching IDL property; a **function** under any `on*` name is always a listener, custom events included |
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
- **A stashed promise nobody awaits rejects in silence.** Observing settlement is what marks the
  rejection handled, so this cannot be fixed from inside cdom: returning a derived promise would
  restore the report and break the stash, because the release microtask would then run before the
  caller's continuation instead of after it. Await the returned promise, or attach your own `.catch`.
  Pinned out of process by `test/fixtures/fire-and-forget-rejection.mjs`. The one cas call site
  shaped like this is `db_maint.js`'s fire-and-forget `EditDatabase`.
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
(re-measured 2026-08-20 against `origin/dev`, call sites unless noted): `replaceInner` 163,
`elements` destructured once per module, `stashStatePromise` **24 across 14 files**, `text` 9,
`html` 3, `node` 2, `svgElements` 0, `clearInner` 1, `appendInner` 1, `stashStateFunction` **0**.
Only 19 files use any of the four formerly-appended exports.

**Count these against a named branch or the number is meaningless.** The figures above are
`origin/dev` (= `origin/master` for `web_bs/js`). The live `track-modernization` branch is 226 files
and 243 `replaceInner` sites, so a count taken from whatever happens to be checked out reads as ~50%
growth that is really just unmerged feature work. The `41 across 17 files` this line carried until
2026-08-20 was wrong on every branch; `argus_impact stashStatePromise` gives 24 and is the check to
run, since `stashStatePromise` is an indexed `js_function` and grep is blocked on it.

Most page code should go through the `cdomModal` / `cdomPromiseModal` / `cdomConfirmModal` /
`cdomAlertModal` wrappers in `cas/web_bs/js/general_utils.js` rather than raw builders.

**cas's main suite proves nothing about this library**: `cas/vitest.config.js` aliases
`/.*cdom\.min\.js$/` to a no-op mock that does not even carry `stashStatePromise`. The suite that
does load the real bundle is `cas/vitest.render.config.js` (`npm run test:render`), and **as of
2026-08-19 it exists only on the unmerged `track-modernization` branch**, not on `dev` or `master`
(cas#974 merged into that branch, not into dev). Until it lands, running it means checking out that
branch and dropping the bundle in; `npm run test:render` on `dev` is `Missing script`. So the real
consumer-side gate today is `npm run verify` here plus a browser. Consumer-side detail:
`cas/docs/maps/frontend-architecture.md` sections 2 and 10.
