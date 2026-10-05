# Figure hover surfaces: one native tooltip, one React popover

**Date:** 2026-10-05
**Status:** design agreed, not yet built
**Supersedes:** the open question at the end of the 2026-10-04 mind-map cycle
(`.superpowers/sdd/HANDOFF-2026-10-04-mind-map.md`)

---

## 1. The problem, restated from measurement

Every figure `<svg>` emitted by `sceneToSvg` carried the accessible name
**twice**:

```ts
// src/figures/svg.ts:332-334
`<svg class="exp-figure" ... role="img" ` +
  `aria-label="${escapeHtml(opts.ariaLabel)}" xmlns="...">` +
  `<title>${escapeHtml(opts.ariaLabel)}</title>` +
```

Both come from the same `opts.ariaLabel`, unconditionally, with no flag to
suppress either. Two consequences:

1. **A native browser tooltip on every figure.** `<title>` is a user-agent
   tooltip: hovering *anywhere* on a figure shows it. For a mind map that
   string is the whole tree linearised, so hovering one node pops a wall of
   text describing a different shape than the one under the cursor.
2. **The per-element popover is unreachable from the demo.**
   `ElementPopover` mounts only when a host passes `onElementEvent`
   (`src/react/ElementPopover.tsx:103`, opt-in by design). No demo route does:
   `demo/server.mjs` renders through the string renderers, and
   `demo/interactive.html` mounts `<Explanation interactive>` with no
   `onElementEvent`. So on `/document` the reader sees the native tooltip and
   nothing else, and the surface that actually carries per-node detail cannot
   be inspected without writing a host app.

The 2026-10-04 session recorded this as a design decision with three options and
explicitly declined to start. This spec picks.

## 2. Decision

**Suppress `<title>`; wire `onElementEvent` into the demo's interactive route.**

The two surfaces are **complementary, not redundant**:

| surface | scope | content |
|---|---|---|
| `aria-label` | whole figure | the figure's summary, derived from its own fields |
| `.exp-popover` | one element | that element's `tip` |

So "merge them" is not available — they answer different questions. The choice
is which one the *pointer* surfaces. `<title>` loses, for three reasons:

1. **It is the wrong shape.** One tooltip per *figure*, identical for every
   node, is not per-node information wearing a per-node affordance.
2. **It is the long one.** The mind-map `ariaLabel` linearises the whole tree.
   A tooltip that long is worse than no tooltip.
3. **It costs nothing to remove.** Measured below.

Suppressing the *popover* instead would keep the long generic surface and
discard the short specific one.

## 3. Why suppressing `<title>` is free

The accessible name of an SVG `role="img"` is computed from `aria-label` first;
`<title>` is a fallback used only when there is no `aria-label`. In this code
path the two are not merely equivalent but **the same string, emitted
unconditionally from the same variable**, one line apart.

This is stronger than the 2026-10-04 measurement, which sampled the served page
(15 figure SVGs on `/document`, all 15 carrying `aria-label`, none relying on
`<title>`). That was evidence; this is construction:

- `SceneSvgOptions.ariaLabel` is a **required** field (`svg.ts:22`), so every
  one of the 8 `sceneToSvg` call sites supplies it.
- Both attributes are emitted on the same line with no conditional between
  them, so there is no input for which `<title>` appears without `aria-label`.

**Consequence:** no test, fixture, or host needs updating for accessibility,
and no a11y claim in the README or specs changes. Suppression removes a
*visual* surface only.

**A host that wants a tooltip back** can add one in host CSS or by post-
processing; the library is not the right place to re-add a UA tooltip. No
opt-in flag is added — a flag for "restore the thing we just removed" is
speculative, and the ROADMAP convention is explicit that switches are not added
without being asked for.

## 4. Scope

### In

1. `src/figures/svg.ts` — drop the `<title>` emission.
2. `tests/figures/svg.test.ts` — pin both halves: `aria-label` present,
   `<title>` absent. **No existing test references `<title>`** (verified by
   search), so this is purely additive and nothing has to be re-written.
3. `demo/interactive.html` — pass `onElementEvent` so the popover is reachable.
4. `demo/examples.js` — see §5; the mind map is not currently on that route.
5. `README.md` — document that the popover is host-opt-in and reachable in the
   demo.
6. `docs/OPEN_THREADS.md` — close/rewrite the relevant part of thread 17 and
   record the reasoning.
7. `docs/ROADMAP.md` — a `Shipped` line, and a new thread for the rough edge
   this leaves behind.

### Out

- **Changing `resolveTip`'s 200-char cap.** The cap is the ceiling on popover
  detail, and it is *not* a capability limit — beyond it, detail belongs in
  prose beside the figure (spec §3.4 of the mind-map design). Widening it would
  be a different decision.
- **Escape-closes-popover when focus is outside the stage.** Pre-existing; the
  keydown listener is native and bound to the stage div, so the event must
  originate inside. Recorded as a new open thread, not fixed here.
- **Any change to `onElementEvent`'s signature or the identified-but-not-
  focusable asymmetry.** Both are deliberate and test-pinned (thread 17).

## 5. The wrinkle: the mind map is not on `/interactive`

The demo's tipped mind-map node lives in `educationIr`
(`demo/examples.js:93`), and `/interactive` mounts `figuresIr`, `quizIr` and
`dragIr` — **not** `educationIr`. So wiring `onElementEvent` alone makes
popovers reachable, but *not for the mind map*, which is the figure whose
tooltip motivated this.

Two ways to close that:

- **(a) Add `educationIr` to `/interactive`.** Reuses the existing fixture
  wholesale; brings 9 block types through the React runtime at once, including
  the derivation and math. Broad — it turns a targeted demo into a second copy
  of `/`.
- **(b) Add one small `mindMapIr` export** holding just the `Cache` tree, and
  mount it under its own heading. Narrow, one purpose: *this is where the
  popover is reachable*. Leaves the existing three mounts untouched.

**(b) is chosen.** The point of this demo route is to make one otherwise-host-
only surface inspectable; (a) widens the route's scope to re-render everything
and makes the new section's purpose unclear. (b) is also the smaller diff and
does not touch `figuresIr`/`quizIr`/`dragIr`, whose existing rendered output must
stay byte-identical.

The fixture is a near-copy of the `educationIr` block, including its comment
about the single tipped node. **The copy carries a comment saying why it is a
copy** — a duplicated fixture that silently drifts is the kind of thing this
repo has been bitten by (the ROADMAP records fixtures dodging layout bugs).

## 6. Tests

- `sceneToSvg` emits `aria-label` and **no** `<title>` element. Asserted on a
  figure with a known label. Both halves, because asserting only the absence
  would pass against an `aria-label` regression and vice versa.
- Assert the absence as an **element**, not the `[title]` attribute. The
  2026-10-04 session's `[title]` probe counted attributes and concluded no
  tooltip existed — the wrong tool for the question, recorded in the DEBUGGING
  log.
- Existing `svg.test.ts` suites must be **byte-identical apart from the removed
  `<title>`**; verified by rendered-output diff against `main`, per the
  repo-wide convention.
- Demo: `/interactive` serves the popover markup for the tipped node. Probed
  in a browser, not asserted in a unit test — the popover needs React plus a
  host, which is the entire reason for §5.

## 7. Verification

1. `tsc --noEmit`, full test suite, `npm run build`.
2. Rendered-output diff vs `main`: the **only** difference across the corpus is
   the removal of `<title>…</title>`, and stripping those spans restores
   `main`'s output byte-for-byte.
3. Browser, on the rebuilt dist:
   - `/document`: hovering a mind-map node produces **no** native tooltip;
     the accessible name is still exposed (`aria-label` present on all figure
     SVGs).
   - `/interactive`: hovering and keyboard-focusing the tipped mind-map node
     opens `.exp-popover` with the right text; hovering an **untipped** node
     opens nothing, preserving the thread-17 asymmetry.
4. All demo routes 200.

## 8. Risks

| risk | why it is low |
|---|---|
| Screen readers lose the name | §3: `aria-label` is required and unconditional; same string |
| A host depended on the visual tooltip | it was a UA tooltip over a whole figure; §2 argues it is the wrong surface. Recoverable in host CSS |
| The demo's other routes shift | only `interactive.html` and one new fixture change; the other three mounts are untouched (§5b) |
| `<title>` returns later | §6 pins both halves of the assertion |
