# Figure Hover Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the native `<title>` tooltip from every figure SVG (keeping `aria-label`, which carries the identical accessible name), and make the React `.exp-popover` reachable from the demo's `/interactive` route.

**Architecture:** Two independent changes. The library change is one deleted line in `sceneToSvg` plus tests pinning both halves of the accessibility contract. The demo change is a new `mindMapIr` fixture plus an `onElementEvent` prop on one `<Explanation>` mount — because the mind map lives in `educationIr`, which `/interactive` does not render.

**Tech Stack:** TypeScript, vitest, Vite. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-05-figure-hover-surfaces-design.md`
**Baseline for the rendered-output diff:** `58af00e`

---

## Global Constraints

- Execute plans **inline**, in-session. No CLI subagents (`claude`, `gemini`, …) — they are unauthenticated and unreliable on this machine.
- One commit per task. `npx tsc --noEmit` and `npm test` green at every task boundary.
- **Every new test must bite.** Run it against the pre-change code and confirm RED.
- The rendered-output diff is a **gate**, not a report: the only permitted difference is the removal of `<title>…</title>`, and stripping those spans must restore `58af00e`'s output byte-for-byte.
- Do not widen scope. `resolveTip`'s 200-char cap and the Escape-closes-popover rough edge are **out of scope** (spec §4); record, do not fix.
- `README.md` and `docs/ROADMAP.md` travel **in the same commit as the code** they describe.

### Verified facts (probed 2026-10-05 — do not re-derive)

- `src/figures/svg.ts:333-334` emits `aria-label` and `<title>` from the same `opts.ariaLabel`, on consecutive lines, with no conditional between them.
- `SceneSvgOptions.ariaLabel` is **required** (`svg.ts:22`). All 8 `sceneToSvg` call sites pass it, so no input yields `<title>` without `aria-label`.
- **No test anywhere references `<title>`** (searched `tests/`). Task 1 is purely additive; nothing existing needs rewriting.
- `role="img"` + `aria-label` wins the accessible-name computation; `<title>` is a fallback only. So suppression is free for screen readers.
- The popover mounts only when a host passes `onElementEvent` (`ElementPopover.tsx:103`); `Explanation.tsx:117` routes `figure`, `diagram`, `chart`, `mind-map` through `FigureEvents` when it is set.
- The tipped mind-map node is at `demo/examples.js:93`, inside **`educationIr`**. `/interactive` mounts `figuresIr`, `quizIr`, `dragIr` — not `educationIr`.
- `figuresIr` carries 8 `tip:` fields, `dragIr` 1, `educationIr` 1 — so popovers become reachable for existing mounts too, once the prop is passed.
- Demo server runs under launchd label `explanations-demo` on port 4173 and serves the **built** `dist/`. Restart it after every build or it serves stale output.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/figures/svg.ts` | **Modify.** Drop the `<title>` emission. One line. |
| `tests/figures/svg.test.ts` | **Modify.** Pin `aria-label` present AND `<title>` absent. |
| `demo/examples.js` | **Modify.** Add `mindMapIr` — a narrow copy of the `Cache` tree. |
| `demo/interactive.html` | **Modify.** Mount `mindMapIr` with `onElementEvent`; pass the prop to the existing three mounts. |
| `README.md` | **Modify.** Popover is host-opt-in; reachable at `/interactive`. |
| `docs/ROADMAP.md` | **Modify.** `Shipped` line + a new backlog thread for the Escape rough edge. |
| `docs/OPEN_THREADS.md` | **Modify.** Thread 17: record the resolved hover-surface decision. |

---

## Task 1: Suppress `<title>`, pin the accessibility contract

**Files:** `src/figures/svg.ts`, `tests/figures/svg.test.ts`
**Spec:** §3, §6

- [ ] **Step 1.1 — RED: write the test first**

Add to `tests/figures/svg.test.ts`. Assert **both** halves — asserting only
the absence would pass against an `aria-label` regression, and asserting only
the presence would pass against the `<title>` returning.

```ts
it("carries the accessible name in aria-label and emits no <title> element", () => {
  const svg = sceneToSvg(scene, { ariaLabel: "Cache hierarchy" })
  expect(svg).toContain('aria-label="Cache hierarchy"')
  expect(svg).not.toContain("<title>")
})
```

Assert `not.toContain("<title>")` — the **element**, not the `[title]`
attribute. The 2026-10-04 session's `[title]` probe counted attributes and
concluded no tooltip existed; wrong tool for the question.

Confirm RED:

```bash
npx vitest run tests/figures/svg.test.ts 2>&1 | grep -E "title|Tests "
```

- [ ] **Step 1.2 — GREEN: delete the line**

In `src/figures/svg.ts`, remove line 334:

```ts
`<title>${escapeHtml(opts.ariaLabel)}</title>` +
```

Leave `aria-label` untouched. Do **not** add an opt-in flag — spec §3.

- [ ] **Step 1.3 — verify**

```bash
npx tsc --noEmit && npm test 2>&1 | tail -20
```

Expect the full suite green. Baseline is 795 tests / 62 files.

- [ ] **Step 1.4 — rendered-output diff (GATE)**

The only permitted difference is the removed `<title>` span, and stripping
those spans must restore the baseline byte-for-byte:

```bash
npm run build
node .superpowers/sdd/render-fixtures.mjs > /tmp/after.txt
git checkout 58af00e -- dist/ 2>/dev/null || git stash list >/dev/null
```

Use the repo's existing `render-fixtures.mjs` scratch script (gitignored,
reusable per the handoff). Compare `/tmp/after.txt` against the same render at
`58af00e`, then pipe both through a `<title>…</title>` stripper and require the
results to be **identical**.

- [ ] **Step 1.5 — commit**

```
fix(figures): drop the native <title> tooltip, keep aria-label

The same accessible name was emitted twice, so every figure showed a
user-agent tooltip that was one-per-figure and identical for every node —
on a mind map, the whole tree linearised. aria-label is required and
unconditional, and for role="img" it wins the accessible-name computation,
so suppression removes only the visual surface. Pinned both halves.
```

---

## Task 2: Make the popover reachable in the demo

**Files:** `demo/examples.js`, `demo/interactive.html`, `README.md`
**Spec:** §5, §7

- [ ] **Step 2.1 — add the narrow fixture**

Append to `demo/examples.js` a `mindMapIr` export holding just the `Cache`
tree from `educationIr` (lines ~88-101), **including** its comment about the
single tipped node. Add a comment saying it is a deliberate near-copy of the
`educationIr` block and why (so the reader knows it may drift, and so a future
session updates both).

- [ ] **Step 2.2 — pass `onElementEvent` on all four mounts**

In `demo/interactive.html`, add a handler and a fourth section:

```js
const log = (e) => console.log("[element]", e.kind, e.elId)
```

Pass `onElementEvent: log` to the existing `figuresIr`, `quizIr` and `dragIr`
mounts (they already carry 8+1 tips, so popovers work there immediately), and
mount `mindMapIr` under a new heading explaining that this is where the
host-only popover is reachable.

- [ ] **Step 2.3 — README**

Document that `.exp-popover` requires `onElementEvent` and is demonstrated at
`/interactive`. Per AGENTS.md the README travels with the feature in the same
commit.

- [ ] **Step 2.4 — verify in a browser, not a unit test**

The popover needs React plus a host, which is the entire reason for this task.

```bash
npm run build
launchctl remove explanations-demo 2>/dev/null
launchctl submit -l explanations-demo -- "$(command -v node)" "$PWD/demo/server.mjs"
```

Then, in a **separate** tool call: `curl -s -o /dev/null -w "%{http_code}" http://localhost:4173/interactive` (expect 200).

Browser checks on the rebuilt dist:
- Hover the tipped mind-map node → `.exp-popover` opens with the right text.
- Keyboard-focus it (it is the only node with `tabindex="0"`) → popover opens.
- Hover an **untipped** node → **no** popover, but `[element] hover n0` logged.
  This preserves the thread-17 asymmetry; assert it, do not assume it.

---

## Task 3: Docs, threads, review

**Files:** `docs/ROADMAP.md`, `docs/OPEN_THREADS.md`

- [ ] **Step 3.1 — ROADMAP**

Add a `Shipped` line for this cycle. Add a backlog thread for the
Escape-closes-popover-when-focus-is-outside-the-stage rough edge (pre-existing,
deliberately not fixed — spec §4).

- [ ] **Step 3.2 — OPEN_THREADS**

Thread 17: record the resolved hover-surface decision and the measured fact that
`aria-label` is required and unconditional. Do **not** renumber — thread 17 is
cited by number elsewhere.

- [ ] **Step 3.3 — fresh-eyes review**

Walk spec §1-§8 against the diff. Confirm: no `aria-label` change; no opt-in
flag added; no cap change; the three pre-existing mounts' output unchanged; both
test halves present; ROADMAP + README in the same commits as the code.

- [ ] **Step 3.4 — full verification**

`npx tsc --noEmit`, `npm test`, `npm run build`, all 6 demo routes 200, browser
confirmation from §Task 2.4.

- [ ] **Step 3.5 — merge gate**

Present to the user: what changed, the diff stat, the two browser results to
look at, and the demo URL. Merge to `main` only on explicit go-ahead
(AGENTS.md). Keep the branch until then.
