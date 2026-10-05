# Closing the React warning surface — design spec

**Date:** 2026-10-05
**Status:** design agreed, not yet built
**Closes:** open thread 13 (three React sites render prose with no warnings sink)
**Related:** the enforceable no-degradation policy (2026-10-04), inline math in prose (2026-10-04)

---

## 1. The problem, measured

The 2026-10-04 cycle shipped `onWarning(warnings)` and `failOnWarning: true` on
all four render entry points, so a host can observe — or enforce against — every
degradation a render pass produces. Three React components were left out, and
the consequence is that the guarantee is **silently defeated** on those
surfaces.

Probed on the merged `main` (`8e5a217`) with `.superpowers/probe-thread13.mjs`,
using an unparseable formula — a dangling superscript, `\(x^\)`, which the math
cycle established throws a `TypeError` that `mathOrLiteral` degrades on:

| surface | string renderer | `renderInline` **with** a sink | **without** a sink |
|---|---|---|---|
| quiz prose | **1** `[math]` warning | 1 | **0** |

And the decisive measurement:

```
output identical with and without a sink: true
```

The rendered HTML is **byte-identical** whether or not a sink is passed. So a
host cannot detect the degradation by inspecting the DOM, by diffing output, or
by any means other than `onWarning`. A `failOnWarning: true` host renders a
quiz with a broken formula in the question and **does not throw**.

That is a different kind of defect from a missing feature. The policy shipped
two days ago says "a degraded output is a content problem, and a host can make
it fatal"; on these three surfaces it is not.

## 2. The three sites (the site list stands; the FIX in (b) does not — see §3a)

They look like one list in thread 13 and are two distinct defects. Bundling them
would hide the older one inside a math-shaped diff, so **the plan splits them**.

**(a) `src/react/Quiz.tsx` — a `renderBlock` sink is never created.**
Line 31 is `renderBlock("quiz", block, 1)` with no fourth argument. This
discards the block's own warnings **wholesale**, which is not a math issue: it
predates inline math entirely, and it swallows every warning `renderBlock` would
emit for a quiz. Separately, lines 45, 55, 58 and 74 call `renderInline` for the
question, each option's text and why, and the explanation — all with no sink.
Both halves are fixed here, but the block-warning half gets **its own task and
its own RED test** so it cannot pass unnoticed as part of a prose change.

**(b) `src/react/InteractiveFigure.tsx` — no sink, and no way to add one.**
A `warnings` array is created at line 63 **inside a `useMemo`** and reaches only
`console.debug` at line 70; the title (line 167) and caption (line 170) render
outside it with no sink. Worse, `InteractiveFigureProps` declares only `block`,
`sketch` and `onElementEvent` — there is **no `onWarning` and no
`failOnWarning`**, so a host cannot reach this component's warnings at all. The
fix is to lift the array to the component's per-render scope, add the two policy
props, and pass a sink to the title and caption.

**(c) `src/react/ElementPopover.tsx` — `PopoverDiv` is purely presentational.**
`PopoverDiv` calls `renderInline(pop.tip)` with no sink, so a tip containing an
unparseable formula degrades to literal text silently. `useElementPopover` sits
directly above it and already owns the show/hide state, so the sink is the same
shape as the other two. It has no `onWarning` prop either; the sink arrives via
`useElementPopover`'s caller.

**The plumbing gap this exposes.** `Explanation.tsx:112` and `:115` render
`InteractiveFigure` and `Quiz` with **no sink prop at all** — `<InteractiveFigure
block={…} sketch={…} />` and `<Quiz block={…} />`. So the work is not only
"thread a sink"; for two of the three components the props they need **do not
exist yet**. `Explanation` already computes `warnCtx` at line 127 and already
owns the policy check at lines 130-133, so it is the natural place to pass it
down. This is why the change is a cycle rather than a patch.

## 3. Why the obvious fix does not work — child effects land too late

The first implementation threaded the shared array into `Quiz` and passed it
from `Explanation`, exactly as this section originally read. **It did not
work**, and the reason is structural.

**A child component's side effects land after the parent's body has finished.**
Measured with a minimal repro (`.superpowers/probe-nesting.mjs`):

```
<div>parent-read:[]</div>
warnings after full render: ["from-child"]
```

The parent's own read sees an empty array; the child's push arrives afterwards.
`Explanation` calls `onWarning([...warnings])` **during its own render**, but
`<Quiz>`'s body has not run yet — it runs when React descends into the returned
tree. So passing the array down is **necessary but not sufficient**: the child
pushes into it too late for the parent to read.

Three consequences, each of which closed off an option:

1. **This affects every site, not just `Quiz`.** `InteractiveFigure` and
   `PopoverDiv` are also child components, so no amount of prop-threading fixes
   any of the three.
2. **`Document` does not have this bug**, and the reason is the key to the fix:
   `Document` calls `renderInline` / `renderBlock` **directly** as plain function
   calls inside its own body. Its ordering comment ("build the JSX before the
   policy check") is about `renderBlock` mutating the array as a side effect —
   a *different* hazard, not this one. The original spec copied `Document`'s
   shape without noticing that `Document` never delegates.
3. **Deferring the report to an effect is not available.** `onWarning` and
   `failOnWarning` are server-component features — every existing test drives
   them through `renderToStaticMarkup`, where **effects do not run**. Reporting
   from an effect would mean `onWarning` never fires under SSR, which is a
   regression of a shipped guarantee, not a trade-off.

## 3a. The fix: a synchronous pre-pass in the parent's own body

Since the parent's read happens during its own render, the array must be
populated during its own render too. `renderBlock` is a plain synchronous
function, so calling it **for the block types that get delegated to a child
component** populates the array at exactly the right moment:

```ts
// Inside Explanation's body, before the policy check.
// renderBlock mutates `warnings` as it runs, so this is synchronous and
// SSR-safe — no effect, no second pass, no reliance on child render order.
if (b.kind === "valid" && (b.type === "quiz" || b.type === "figure")) {
  renderBlock(b.type, b.data, 1, blockOpts) // html discarded; warnings kept
}
```

The delegated block is then rendered twice — once discarded for its warnings,
once as JSX for its interactivity. That is the cost, and it is small.

**Measured** (`.superpowers/probe-prepass.mjs`, on merged `main`):

| block | string renderer | pre-pass | identical set |
|---|---|---|---|
| quiz (3 prose math + out-of-range answer) | 3 | 3 | **yes** |
| figure (title + caption math) | 2 | 2 | **yes** |

Cost: ~0.13ms per block, once per delegated block on the SSR path.

Note the pre-pass captures the **whole** surface in one call, including prose
the child component would otherwise have to sink field by field — the quiz's
question, option texts, whys and explanation come from `renderQuiz`'s single
`renderInline(…, ctx)` chain.

**This also retires the original §2(b) diagnosis.** `renderFigure` — the string
path — already renders title and caption through `renderInline(block.title, ctx)`
with the sink attached, and reports both. `InteractiveFigure` duplicates that
same prose in JSX purely to make it interactive, and the duplication is where
the sink is lost. The pre-pass reports it without touching `InteractiveFigure`
at all.

## 3b. What still needs its own sink

`PopoverDiv` renders a **tip**, which is not part of any block's static render —
it appears at hover time, long after the parent's render. No pre-pass can
collect it. It keeps a sink: `useElementPopover` gains an `onWarning`-style
prop, and a degraded tip is reported when the popover opens. That is a
genuinely different lifecycle from a render pass, and it is honest to treat it
as one.

## 4. Scope

### In

1. `src/react/Explanation.tsx` — the **pre-pass** (§3a): call `renderBlock` for
   `quiz` and `figure` blocks during its own body, into the existing
   `blockOpts`, before the policy check. This is the load-bearing change and it
   covers both `Quiz` and `InteractiveFigure`.
2. `src/react/ElementPopover.tsx` — a sink for the **tip** (§3b), reported when
   the popover opens. `PopoverDiv` cannot be covered by a pre-pass: a tip has no
   static render pass to collect it from.
3. `src/react/Quiz.tsx` / `InteractiveFigure.tsx` — **only** if a test proves the
   pre-pass insufficient. The pre-pass is expected to make them correct without
   modification, which is the preferable outcome: less code, and no second place
   where the same prose is rendered.
4. Tests, in the shape §5 describes.
5. README + ROADMAP + thread 13.

### Explicitly NOT the approach

- **Do not** report from an effect: SSR never runs it (§3, consequence 3).
- **Do not** pass the shared array down to the child components and call it
  done: measured not to work (§3).
- **Do not** weaken `failOnWarning` into a "warn only" mode to accommodate this.

### Out

- **Changing what degrades.** No new degradation is added, removed, or made
  louder. This closes an observation gap.
- **`resolveTip`'s 200-char cap.** Unchanged.
- **`ElementPopover`'s Escape rough edge** (ROADMAP backlog). Separate.
- **The `onElementEvent` focus asymmetry** — focus opens the popover without
  reporting an event. Recorded 2026-10-05, out of scope here.
- **Deduplicating StrictMode's double `onWarning`** — accepted, documented, not
  fixed (thread 1).

## 5. Tests

**The load-bearing test is a parity assertion**, because the defect is precisely
a divergence: for the same IR, the React component and the string renderer must
report the **same set** of warnings. The 2026-10-04 math cycle already found that
React reported 1 math warning for a document the string renderer reported 4 for,
and that `failOnWarning` did not throw at all — that test is the precedent.

- **Parity**: an IR whose quiz question, option text, option why and explanation
  each carry an unparseable formula. Assert React reports the same warning count
  as `renderExplanation`, and that the ids match. This is the test that would
  have caught all three sites.
- **`failOnWarning` throws** for a quiz with a bad question. The policy is
  worthless if it silently passes, so this is asserted directly rather than
  inferred from the warning list.
- **`onWarning` receives a copy**, not the live array — `Document` already does
  `[...warnings]`; a host that mutates what it is handed must not corrupt the
  render's own state. One test.
- **The ordering test**: warnings must be complete *before* the policy check.
  A component that renders JSX and checks in an effect will pass a
  "does it report?" test and still fail to throw. Assert the throw, not just
  the count, so a late check cannot pass.
- **Every test must bite**: each is run against the pre-change component and
  confirmed RED. A test asserting only that rendering succeeds is vacuous here —
  the broken components render perfectly, they just stay silent.

**Anti-vacuity note.** A quiz fixture must be **schema-valid** to reach the
renderer. `quizBlockSchema` takes `answer: <index>`, not per-option `correct`
booleans; an invalid quiz is dropped during validation and reports *zero*
warnings for the wrong reason. This cost one probe run — see §7.

## 6. Verification

1. `tsc --noEmit`, full suite, `npm run build`.
2. Each new test RED before the change, GREEN after.
3. Browser on the rebuilt dist: `/interactive` renders a quiz and a figure; a
   deliberately bad tip in a fixture shows the popover degrading **and** the
   event firing. A unit test cannot cover the popover, since it needs a host.
4. Rendered-output diff vs `main` for the *string* renderers: **byte-identical**.
   Nothing in this change alters what is rendered — only what is reported. That
   is the strongest available check that the fix is observation-only.
5. All demo routes 200.

## 7. Traps already hit, recorded so they are not re-hit

- **A fixture that fails validation reports nothing for the wrong reason.** The
  first version of this cycle's probe used `correct: true` per option;
  `quizBlockSchema` has no such field (it is `answer: <0-based index>`), so the
  block was dropped during validation and the string renderer reported 0
  warnings — which looked like "thread 13 is overstated" rather than "my
  fixture is wrong". Confirmed by reading the schema, then fixed; the string
  renderer then reported the expected 1. **Check the fixture against the schema
  before believing a measurement of zero.**
- **`\(1/0\)` is not a degradation.** It parses, and Temml renders it as
  literal symbols. Only genuinely malformed input (the dangling `x^`) triggers
  the `[math]` path. A probe that measures zero warnings may be measuring valid
  input.
- **A component with a sink can still be silent**, because the sink was on the
  wrong side of the render boundary. Threading `warnings` into `<Quiz>` looked
  correct, compiled, type-checked — and reported nothing. The array was right;
  the *timing* was not.
- **A green test here can be vacuous for a routing reason.** The first version
  of the Task 1 test omitted `interactive`, so `Explanation.tsx:115` never
  reached `<Quiz>` and the block went through the plain `renderBlock` path —
  which *does* have a sink and *does* report. The test passed green against the
  very component carrying the bug. Any test of a delegated component must
  assert it is actually reached.
- **Write probes as files, not `node -e`.** The inline version lost backslashes
  through two layers of shell quoting and reported 0 warnings for a figure the
  string renderer reports 2 for. A measurement of **zero** is the result most
  worth re-verifying, because it is the one an escaping bug produces.
