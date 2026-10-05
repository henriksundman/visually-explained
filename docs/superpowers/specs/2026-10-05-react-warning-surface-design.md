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

## 2. The three sites, and why they are not one bug

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

## 3. The pattern to copy

`Document.tsx` is the reference implementation and is already test-locked:

- a plain **local per-render array** (not a hook — `Document` is a server
  component and a hook would make it a client component);
- `warnCtx = { addWarning: (m) => warnings.push(m) }`;
- passed to every `renderInline` React itself calls, and to `renderBlock` via
  `blockOpts`;
- **`onWarning([...warnings])` then `failOnWarning` AFTER all the JSX is
  built** — because `renderBlock` and `renderInline` populate the array as a
  side effect of that construction. Checking first would always see an empty
  array. This ordering is the whole subtlety, and it is why the JSX is built
  before the check rather than returned directly.

`InteractiveFigure` is a **client** component (it has `useState`/`useEffect`),
so it can use a `useMemo`/`useRef` — but it must still populate during render,
not in an effect, or `failOnWarning` cannot throw during the render pass.

## 4. Scope

### In

1. `src/react/Quiz.tsx` — accept and thread a sink; pass it to `renderBlock`
   and to all four `renderInline` calls. **Own task.**
2. `src/react/InteractiveFigure.tsx` — lift `warnings` out of the `useMemo`;
   **add `onWarning` / `failOnWarning` props** (neither exists today); pass a
   sink to the title and caption.
3. `src/react/ElementPopover.tsx` — thread a sink through `useElementPopover` to
   `PopoverDiv`.
4. `Explanation.tsx` — pass `warnCtx` (already built at line 127) and the
   existing policy props down to `Quiz` and `InteractiveFigure`, so a quiz or an
   interactive figure inside an `<Explanation>` reports into the array the host
   already receives rather than into a component-local one.
5. Tests, in the shape §5 describes.
6. README + ROADMAP + thread 13.

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
- **`.focus()` cannot test a focus-driven surface** — see `DEBUGGING.md`
  2026-10-05. Not directly load-bearing here, but the same file warns against
  concluding "the path is dead" from a harness artefact.
