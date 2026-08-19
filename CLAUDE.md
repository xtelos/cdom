# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

CDOM is a 208-line, zero-dependency TypeScript library that builds DOM trees from nested closures.
All of the source is `src/cdom.ts`; the shipped artifact is `dist/cdom.min.js`, a minified ES module
with a default export. It is the rendering primitive under every modern page in the CAS web app.

The whole repo is small enough that this file is its map. The estate-level synthesis (provenance,
consumer census, the vendoring contract, measured semantics) is
`~/.claude/reference/cdom/cdom.md`, and the evidence behind it is
`~/.claude/research/cdom-deep-dive-2026-08-19/`.

## Read this before touching anything

**This repo is a frozen mirror, not the source of truth for what production runs.**

- All three commits are Ambrose Cavalier's from June 2021. `newspapersystems/cdom` HEAD (`32dec2d`)
  is the same SHA as upstream `AmbroseCavalier/cdom` HEAD. There are zero Newspaper Systems commits.
- What CAS actually loads is `cas/web_bs/static/3rdparty/cdom/cdom.min.js`. That file is this repo's
  `dist/cdom.min.js` byte-for-byte, **plus a hand-appended, unminified NS patch** exporting
  `stashStatePromise`, `stashStateFunction`, `clearInner`, `appendInner`.
- **Rebuilding here and copying `dist/cdom.min.js` over the vendored file deletes those four
  exports**, which ~50 CAS modules import. Nothing automates this and no test catches it. To ship a
  library change: rebuild, commit both files here, copy the new base bytes into cas, **re-append the
  NS tail**, then diff to prove the four exports survived.
- The patch has to live inside the bundle: `stashStatePromise` assigns to `currentNode`, a
  module-scoped binding with no exported setter, so a sibling module cannot do it.
- cas's `.gitattributes` carries `*.min.js -diff`, so every change to the vendored copy shows up as
  `Bin N -> M bytes` in `git show` and in PR review. Do not expect review to catch a mistake here.

## Build

```sh
./build.sh                                             # tsc, then terser, into ./dist
npx tsc --noEmit --project tsconfig.production.json    # type-check only
```

- The build is **byte-reproducible** (verified 2026-08-19 with tsc 5.9.3 + terser 5.50.0: the
  regenerated `dist/cdom.min.js` is identical to the committed one), so a byte diff against `dist/`
  is a real signal.
- `terser` is not installed globally on every box; `npx --yes terser ...` works.
- Every commit touching `src/cdom.ts` must also commit the rebuilt `dist/cdom.min.js`.
- `dist/cdom.js`, `dist/cdom.d.ts` and `dist/cdom.js.map` are build outputs that are neither tracked
  nor gitignored (`.gitignore` lists only `built` and `test`), so never `git add -A` here.
- No `package.json`, no tests, no linter, no CI. Verification is the type-check plus running it.
- The version banner lives only in the `/*! ... */` block atop `src/cdom.ts`; terser preserves it
  into the minified output. Bump it in the source, never in `dist/`.
- Source style is hard tabs.

## Architecture: one module-global `currentNode`

Everything follows from `src/cdom.ts:113`.

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
  are lowercased. SVG goes through `createElementNS`.
- Argument dispatch is by `typeof`, not arity: `(attrs)`, `(inner)`, `(attrs, inner)` and `()` are
  told apart by `typeof a === "object"`.

## Measured semantics

Probed against the shipped bundle under jsdom, not read off the source:

| Case | Result |
|---|---|
| top-level `div(...)` | returns element, `parentNode === null` |
| `style: "color:red"` | written to `el.style.cssText`, replacing the whole inline style |
| `hidden: true` / `disabled: false` | `hidden="true"` / attribute removed (the `booleanAttributes` list) |
| `title: null` or `undefined` | attribute **present and empty** (`title=""`), not removed |
| `value` / `checked` | set as JS properties, not attributes |
| `div(null)` | `null` is `typeof "object"`, so it is read as the attrs map: an empty div |
| `div(undefined)` | reads as "argument absent": an empty div |
| `div(0)` / `div(false)` | render as text `0` / `false`; only `null` inner is skipped |
| `onClick: fn` | `addEventListener("click", fn)`; `null`/`undefined` listeners are skipped |
| `onclick: "alert(1)"` | throws `Got non-function for "onclick"` |
| `title: () => {}` | throws `Got function for "title"` |
| `cdom.html(str)` | `<template>` parse then append, **no sanitization**: trusted input only |

## The async edge (the reason the NS patch exists)

An `await` inside a content callback ends the synchronous closure, so `handleNodeInner`'s `finally`
has already restored `currentNode` before the continuation runs.

- **Measured: nodes created after an unwrapped `await` are silently dropped.** `currentNode` is null,
  the append is skipped, the element is returned detached. Nothing throws, and nothing lands on
  `document.body`.
- `stashStatePromise(promise)` captures `currentNode`, restores it in a `.finally()` registered
  before the caller's `await`, then queues a microtask that nulls it again.
- **It buys back the parent for exactly one continuation turn.** A second unwrapped `await` later in
  the same async function drops everything after it. Wrap every await whose continuation renders, not
  just the first.

## Consumers

`cas` is the only one, in 135 files, loaded as a native ES module by relative path
(`../static/3rdparty/cdom/cdom.min.js`); no bundler touches `web_bs/js`. Weight: `replaceInner` 244,
`elements` 100 (destructured once per module), `text` 18, `html` 9, `node` 7, `svgElements` 0. Most
page code should go through the `cdomModal` / `cdomPromiseModal` / `cdomConfirmModal` /
`cdomAlertModal` wrappers in `cas/web_bs/js/general_utils.js` rather than raw builders.

**A green cas suite proves nothing about this library**: `cas/vitest.config.js` aliases
`/.*cdom\.min\.js$/` to a no-op mock, which does not even carry `stashStatePromise`. Consumer-side
detail: `cas/docs/maps/frontend-architecture.md` §2 and §10.
