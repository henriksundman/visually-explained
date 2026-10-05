# React Warning Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `Quiz`, `InteractiveFigure` and `ElementPopover` report their prose degradations, so `onWarning` and `failOnWarning` hold on every React surface.

**Architecture:** Copy `Document`'s pattern — a per-render `warnings` array plus a `warnCtx = { addWarning }` sink — into the three components that lack one. Two of them also need the `onWarning` / `failOnWarning` props **added**, since neither exists today, and `Explanation` must pass its already-computed `warnCtx` down to both.

**Tech Stack:** TypeScript, React 19, vitest, `renderToStaticMarkup`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-05-react-warning-surface-design.md`
**Baseline for the rendered-output diff:** `8e5a217`
**Tests live in:** `tests/degradation-policy-react.test.tsx` — it already holds the parity pattern, the copy-not-reference test, and the identical-HTML check this work extends.

---

## Global Constraints

- Execute plans **inline**, in-session. No CLI subagents.
- One commit per task. `npx tsc --noEmit` and `npm test` green at every task boundary.
- **Every new test must bite** — run it against the pre-change component and confirm RED. A test asserting only that rendering *succeeds* is vacuous here: all three broken components render perfectly, they just stay silent.
- **The rendered output of the string renderers must not change.** This cycle is observation-only. The diff gate is *byte-identical*, not "diff reviewed" — a changed byte means a degradation started or stopped happening, which is a bug here.
- Read `Document.tsx:75-133` before starting; it is the reference implementation.
- Do not widen scope. `resolveTip`'s cap, the Escape rough edge, the focus-event asymmetry and StrictMode double-invocation are all out (spec §4).

### Verified facts (probed 2026-10-05 — do not re-derive)

- `Quiz.tsx:31` — `renderBlock("quiz", block, 1)` with **no fourth argument**. Discards the block's own warnings wholesale. Lines 45/55/58/74 call `renderInline` with no sink.
- `InteractiveFigureProps` declares only `block`, `sketch`, `onElementEvent` — **no `onWarning`, no `failOnWarning`**. Its `warnings` array is created at line 63 **inside a `useMemo`** and reaches only `console.debug` at line 70; title (167) and caption (170) render outside it.
- `PopoverDiv` calls `renderInline(pop.tip)` with no sink; `useElementPopover` sits directly above it and owns the show/hide state.
- `Explanation.tsx:112` renders `<InteractiveFigure block sketch />` and `:115` renders `<Quiz block />` — **neither receives a sink prop**. `Explanation` already builds `warnCtx` at line 127 and runs the policy check at 130-133.
- `Document.tsx` order is load-bearing: build all JSX **first** (`renderBlock`/`renderInline` populate the array as a side effect), then `onWarning([...warnings])`, then `failOnWarning`. Checking first always sees an empty array.
- Measured on merged `main`: a quiz whose prose carries `\(x^\)` (a dangling superscript, which the math cycle established throws) yields **1** `[math]` warning from `renderExplanation` and from `renderInline` **with** a sink, **0** without one — and the two outputs are **byte-identical**.
- `quizBlockSchema` takes **`answer: <0-based index>`**, not per-option `correct` booleans. A fixture using `correct` fails validation, the block is dropped, and warnings read 0 **for the wrong reason**.
- `\(1/0\)` is **not** a degradation — it parses. Only malformed input triggers the `[math]` path.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/react/Quiz.tsx` | **Modify.** Accept a sink; pass it to `renderBlock` and all four `renderInline` calls. |
| `src/react/InteractiveFigure.tsx` | **Modify.** Add `onWarning`/`failOnWarning` props; lift `warnings` out of the `useMemo`; sink the title and caption. |
| `src/react/ElementPopover.tsx` | **Modify.** Thread a sink from `useElementPopover` into `PopoverDiv`. |
| `src/react/Explanation.tsx` | **Modify.** Pass `warnCtx` + policy props to `Quiz` and `InteractiveFigure`. |
| `tests/degradation-policy-react.test.tsx` | **Modify.** Parity, throw, copy, and per-surface tests. |

---

## Task 1: Quiz stops discarding `renderBlock`'s warnings

**Why first and alone:** this is the pre-existing bug, unrelated to prose. It
gets its own commit so it cannot pass unnoticed inside a math-shaped diff.

- [ ] **Step 1.1 — RED**

In `tests/degradation-policy-react.test.tsx`. Use a quiz whose *block* renders a
warning, so this test cannot be satisfied by prose plumbing:

```tsx
it("Quiz surfaces the block warnings it was discarding", () => {
  const onWarning = vi.fn()
  renderToStaticMarkup(<Explanation ir={{ version: 1, title: "T", blocks: [badQuiz] }} onWarning={onWarning} />)
  expect(onWarning.mock.calls[0][0].length).toBeGreaterThan(0)
})
```

Find a quiz that `renderBlock` genuinely warns on and confirm with the string
renderer first — **a fixture that fails validation reports nothing for the wrong
reason.** Confirm RED.

- [ ] **Step 1.2 — GREEN**

`Quiz.tsx`: accept `warnings?: string[]` (or a sink), pass it as `renderBlock`'s
fourth argument at line 31. `Explanation.tsx:115`: pass the array it already
owns.

- [ ] **Step 1.3 — verify** `npx tsc --noEmit && npm test`

- [ ] **Step 1.4 — commit** `fix(quiz): stop discarding the block's own warnings`

---

## Task 2: Quiz prose reports (question, option text, why, explanation)

- [ ] **Step 2.1 — RED** — a quiz with `\(x^\)` in **each** of the four prose
  fields; assert the warning count matches `renderExplanation`'s.

- [ ] **Step 2.2 — GREEN** — pass the sink at `Quiz.tsx:45,55,58,74`.

- [ ] **Step 2.3 — the ordering test.** Assert `failOnWarning` **throws** for a
  bad quiz question, not merely that the count is non-zero — a component that
  checks in an effect reports correctly and still fails to throw.

- [ ] **Step 2.4 — commit** `fix(quiz): report prose degradations in questions and whys`

---

## Task 3: `InteractiveFigure` — add the props, fix the scope

- [ ] **Step 3.1 — RED** — a `figure` block with `\(x^\)` in `title` and
  `caption`, rendered `<Explanation interactive onWarning={fn}>`; assert both are
  reported. **Also RED on the throw** with `failOnWarning`.

- [ ] **Step 3.2 — GREEN** — add `onWarning` / `failOnWarning` to
  `InteractiveFigureProps`; lift `warnings` to the component's per-render scope;
  keep the `console.debug`; pass a sink at lines 167 and 170; run the policy
  check **after** the JSX is built (spec §3).

  It is a client component, so a `useRef`/`useMemo` is permissible — but the
  array must be populated **during render**, not in an effect, or `failOnWarning`
  cannot throw in the pass.

- [ ] **Step 3.3 — verify** — the existing `console.debug` behaviour must not
  regress; `tests/react.test.tsx` covers `InteractiveFigure` directly.

- [ ] **Step 3.4 — commit** `fix(figure): report title and caption degradations`

---

## Task 4: `ElementPopover` — a degraded tip is reported

- [ ] **Step 4.1 — RED** — render `PopoverDiv` with a `tip` containing `\(x^\)`
  and assert the sink receives the `[math]` warning.

- [ ] **Step 4.2 — GREEN** — thread a sink from `useElementPopover` into
  `PopoverDiv`.

  **Design note to settle while implementing:** `useElementPopover` has no
  `onWarning` prop today. Either add one, or route through the caller that owns
  the array. Prefer the prop — `PopoverDiv` is exported and a host may render it
  directly. Record the choice in the commit.

- [ ] **Step 4.3 — verify + commit** `fix(popover): report a degraded tip`

---

## Task 5: Parity, docs, review

- [ ] **Step 5.1 — the load-bearing test.** For one IR touching all three
  surfaces, assert React reports the **same warning set** the string renderer
  does — ids included, not just counts. The 2026-10-04 math cycle's precedent:
  React reported 1 where the string renderer reported 4, and `failOnWarning` did
  not throw at all.

- [ ] **Step 5.2 — copy, not reference.** A host mutating the array it is handed
  must not corrupt the render. `Document` already does `[...warnings]`; assert
  the new paths match.

- [ ] **Step 5.3 — the diff gate.** Render the full corpus and require it
  **byte-identical** to `8e5a217`. Use `.superpowers/render-fixtures.mjs dist
  out.txt` (note: `.superpowers/`, **not** `.superpowers/sdd/` — the handoff has
  the path wrong).

- [ ] **Step 5.4 — browser.** `/interactive` renders a quiz and an interactive
  figure. Confirm the page still renders and degrades visibly. A unit test cannot
  cover the popover, which needs a host.

- [ ] **Step 5.5 — docs.** README (the props now exist on `InteractiveFigure`),
  ROADMAP `Shipped` line, and **close thread 13** in `OPEN_THREADS.md` — do not
  renumber, it is cited by number.

- [ ] **Step 5.6 — review**, then the merge gate. Present and wait.
