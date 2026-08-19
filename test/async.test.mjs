import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { cdom, mod, host, sleep } from "./_setup.mjs";

const execFile = promisify(execFileCb);

const { p, div, section } = cdom.elements;
const { stashStatePromise, stashStateFunction } = mod;

/** Runs an async render to completion and hands back the host. */
async function render(fn) {
	const h = host();
	let done;
	const finished = new Promise((r) => (done = r));
	cdom.replaceInner(h, () => fn(h, done));
	// Bounded: `node --test` has no default timeout, so a regression that stops calling
	// the inner callback would hang the suite instead of failing it.
	const timeout = new Promise((_, reject) =>
		setTimeout(() => reject(new Error("render never reached done()")), 5000).unref()
	);
	await Promise.race([finished, timeout]);
	return h;
}

test("a stashed await keeps rendering into the same parent", async () => {
	const h = await render(async (h, done) => {
		p("a");
		await stashStatePromise(sleep(2));
		p("b");
		done();
	});
	assert.equal(h.innerHTML, "<p>a</p><p>b</p>");
});

test("stashed awaits chain: two in a row, and a loop", async () => {
	const two = await render(async (h, done) => {
		p("a");
		await stashStatePromise(sleep(1));
		p("b");
		await stashStatePromise(sleep(1));
		p("c");
		done();
	});
	assert.equal(two.innerHTML, "<p>a</p><p>b</p><p>c</p>");

	const looped = await render(async (h, done) => {
		for (let i = 0; i < 3; i++) {
			await stashStatePromise(sleep(1));
			p("r" + i);
		}
		done();
	});
	assert.equal(looped.innerHTML, "<p>r0</p><p>r1</p><p>r2</p>");
});

test("a stash inside a nested element restores that element, not the root", async () => {
	const h = await render((h, done) => {
		p("outer");
		section(async () => {
			p("i-a");
			await stashStatePromise(sleep(2));
			p("i-b");
			done();
		});
	});
	assert.equal(h.innerHTML, "<p>outer</p><section><p>i-a</p><p>i-b</p></section>");
});

test("two concurrent async renders on different timers keep their own parent", async () => {
	const h1 = host();
	const h2 = host();
	let n = 0;
	let done;
	const finished = new Promise((r) => (done = r));
	const fin = () => {
		if (++n === 2) done();
	};
	cdom.replaceInner(h1, async () => {
		p("H1a");
		await stashStatePromise(sleep(20));
		p("H1b");
		fin();
	});
	cdom.replaceInner(h2, async () => {
		p("H2a");
		await stashStatePromise(sleep(5));
		p("H2b");
		fin();
	});
	await finished;
	assert.equal(h1.innerHTML, "<p>H1a</p><p>H1b</p>");
	assert.equal(h2.innerHTML, "<p>H2a</p><p>H2b</p>");
});

test("two renders awaiting the SAME promise do not leak a parent", async () => {
	// The hard case: both release callbacks run in one microtask drain. Releasing to
	// "whatever currentNode is now" instead of to null made the second capture the
	// first's node and write it back permanently, so every later top-level build
	// silently landed inside h1. Different timers never produce this interleaving,
	// which is why only a shared promise catches it.
	const h1 = host();
	const h2 = host();
	const shared = sleep(5).then(() => "DATA");
	let n = 0;
	let done;
	const finished = new Promise((r) => (done = r));
	const fin = () => {
		if (++n === 2) done();
	};
	cdom.replaceInner(h1, async () => {
		p("panel1");
		p(await stashStatePromise(shared));
		fin();
	});
	cdom.replaceInner(h2, async () => {
		p("panel2");
		p(await stashStatePromise(shared));
		fin();
	});
	await finished;
	await sleep(5);

	assert.equal(h1.innerHTML, "<p>panel1</p><p>DATA</p>");
	assert.equal(h2.innerHTML, "<p>panel2</p><p>DATA</p>");

	const stray = div("built at top level, afterwards");
	assert.equal(stray.parentNode, null, "a later top-level build must stay detached");
	assert.equal(h1.contains(stray), false);
	assert.equal(h2.contains(stray), false);
});

test("a rejected stashed promise still restores, and still rejects for the caller", async () => {
	const h = await render(async (h, done) => {
		p("a");
		try {
			await stashStatePromise(Promise.reject(new Error("boom")));
		} catch {
			/* handled by the caller, as usual */
		}
		p("b");
		done();
	});
	assert.equal(h.innerHTML, "<p>a</p><p>b</p>");

	await assert.rejects(() => stashStatePromise(Promise.reject(new Error("x"))), /x/);
});

test("stashStateFunction behaves like stashStatePromise", async () => {
	const h = await render(async (h, done) => {
		p("a");
		await stashStateFunction(async () => {
			await sleep(2);
		});
		p("b");
		done();
	});
	assert.equal(h.innerHTML, "<p>a</p><p>b</p>");
});

test("an async render that throws still surfaces as an unhandled rejection", async () => {
	// Attaching any handler to the callback's promise (even just to observe it) marks
	// its rejection handled, and a render that blows up then fails completely silently.
	const fixture = fileURLToPath(new URL("./fixtures/throwing-render.mjs", import.meta.url));
	const { stdout } = await execFile(process.execPath, [fixture]);
	assert.match(stdout.trim(), /^UNHANDLED:render blew up$/, `got: ${stdout.trim()}`);
});

test("an unstashed await drops what follows it, silently", async () => {
	// Inherent to a module-global parent: the synchronous closure has already ended,
	// so `finally` has restored currentNode before the continuation runs. cdom cannot
	// tell this apart from an ordinary detached top-level build, so it does not try.
	const h = await render(async (h, done) => {
		p("a");
		await sleep(2);
		p("c");
		done();
	});
	assert.equal(h.innerHTML, "<p>a</p>");
});

test("the stash covers exactly one continuation", async () => {
	const afterBareAwait = await render(async (h, done) => {
		p("a");
		await stashStatePromise(sleep(2));
		p("b");
		await sleep(2);
		p("c");
		done();
	});
	assert.equal(afterBareAwait.innerHTML, "<p>a</p><p>b</p>");

	// Even a bare microtask hop lands past the stash.
	const afterMicrotask = await render(async (h, done) => {
		p("a");
		await stashStatePromise(sleep(2));
		await Promise.resolve();
		p("b");
		done();
	});
	assert.equal(afterMicrotask.innerHTML, "<p>a</p>");
});

test("an ordinary top-level build stays detached while an async render is in flight", async () => {
	const h = host();
	let done;
	const finished = new Promise((r) => (done = r));
	cdom.replaceInner(h, async () => {
		p("a");
		await stashStatePromise(sleep(10));
		p("b");
		done();
	});
	// Built mid-flight: this is the documented top-level idiom and must be unaffected.
	const midFlight = div("detached");
	assert.equal(midFlight.parentNode, null);
	await finished;
	assert.equal(h.innerHTML, "<p>a</p><p>b</p>");
	assert.equal(h.contains(midFlight), false);
});
