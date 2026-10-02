# Drag-to-vary simulations — design spec

Date: 2026-10-02
Status: proposed
Supersedes nothing. Continues the interactive-figure-runtime thread
(`2026-09-29-interactive-figure-runtime-design.md`), which explicitly deferred
direct manipulation.

## 1. Problem

The interactive runtime moves a figure through sliders and a play sweep. Both
are *indirect*: the reader adjusts a number and watches the figure respond.
That makes a card an animation player with a scrubber.

Direct manipulation inverts it. The reader grabs the thing itself — the bob, the
aperture, the mass — and the rest of the figure re-solves around their hand.
The figure stops being a recording and becomes a simulation.

The infrastructure is already in place, which is what makes this a small cycle
rather than a new subsystem:

- `dot.cx` / `dot.cy` and `box.x` / `box.y` already accept an expression
  (`Num`), not just a literal.
- `derived: [{ name: "cx", expr: "150" }]` in the epicycles demo is already a
  constant smuggled through the expression system — a drag is the same thing
  with the number supplied by a pointer.
- `dot` and `box` already carry `id`, so they already emit
  `<g class="exp-el" data-el-id=…>` and are already hit-testable by
  `hitElement`.
- `InteractiveFigure` already round-trips `values → compileFigure → sceneToSvg`
  through a `useMemo` keyed on `values`.

So a drag is **a second input device writing to the state sliders already
write to**. No new render path, no new value namespace.

## 2. Goals

- An author can mark an element draggable by naming the param it drives.
- Dragging writes to that param through the existing `values` state, so a
  co-present slider for the same param tracks the dragged element.
- Keyboard users can move every draggable element.
- The static (SSR) render is byte-identical to today's output when no drag has
  occurred.

## 3. Non-goals

- **Groups.** `group` deliberately carries no identity
  (`figure-id-unsupported` in `authored.ts`). Dragging a nested group is the
  most natural grab of all and is explicitly out of scope; giving groups
  identity is its own decision.
- **Multi-touch / pinch.** One pointer at a time.
- **Snapping, grid locking, undo.** v1 is direct and unadorned.
- **A figure editor.** This is a simulation surface for authored figures, not a
  canvas for authoring them. Nothing about the authoring path changes.
- **Non-`figure` blocks.** Diagrams, charts and timelines keep their own layout
  engines; dragging a chart point would mean teaching `layoutChart` about
  pointers, which is a different problem with a different owner.

## 4. Format

A new optional key on the `figure` block:

```
draggable?: [{ id: string, x?: string, y?: string }]
```

- `id` — the `data-el-id` of an authored `dot` or `box` leaf. Must already
  exist; an unmatched id is a warning, not a throw.
- `x` / `y` — the **param names** the horizontal / vertical drag writes to.
  Either may be omitted, making that axis fixed (a horizontal-only handle).

Example — the epicycles bob, draggable along x only:

```json
{
  "type": "figure",
  "params": [{ "name": "r", "min": 0, "max": 360, "step": 1, "initial": 120 }],
  "derived": [{ "name": "px", "expr": "r * cos(0.6)" }],
  "draggable": [{ "id": "bob", "x": "r" }],
  "elements": [
    { "kind": "dot", "id": "bob", "cx": "px", "cy": 130, "r": 6 }
  ]
}
```

Note the element's own coordinate is *expression-driven*; the drag never writes
coordinates into the Scene. It writes a number into `values`, the same slot the
slider writes, and the existing compile does the rest. **Scene coordinates
never enter the drag path.**

## 5. The value decision

**A drag writes to an existing `param`, not to a new kind of value.**

`buildEnv` (`authored.ts`) seeds one flat namespace from `params[].initial`,
then resolves `derived` against it in order. A second value channel would mean
a second namespace, a second resolution pass, and a second thing to keep
consistent with the SSR initial render — all to reach the same place. Sharing
the param is what makes a slider and a drag consistent *by construction*: if
both are present, the slider thumb follows the dragged element.

But the write is **not** the slider's write. `setParam` currently clamps to
`[min, max]` and the slider supplies values already on the `step` grid. A drag
needs one change and one guard:

- **`step` is ignored on a drag.** It is a slider affordance — it exists so a
  slider lands on round numbers. A pointer has no need for it, and honouring it
  makes a dragged point visibly stick and jump between increments. `min`/`max`
  still bound the drag, and that is correct: an author writing
  `min: 0, max: 360` is describing the canvas, not the slider.
- **Clamp the lower bound last.** `min(max(x, hi), lo)` ordering matters when
  an LLM authors `min > max` (degenerate clamp, `DEBUGGING.md` Part 1). The
  drag path must not be the place that bug reappears.

This is the one place where a drag and a slider deliberately disagree, and it
is scoped to `step` alone.

## 6. Coordinate conversion

A pointer reports client pixels; the scene is a viewBox (360×240 for authored
figures) scaled to fit its column. Every drag needs client → scene.

Primary: `svg.getScreenCTM().inverse()` applied to the pointer point. This is
exact under any CSS transform, zoom, or page scale, which a ratio cannot be.

Fallback: if `getScreenCTM` is unavailable or returns a non-invertible matrix,
derive the scale from `getBoundingClientRect()` against the viewBox and
translate. Weaker (ignores rotation and skew) but keeps the feature working
rather than dead. **A drag must never silently no-op** — if both conversions
fail, the pointer is ignored and no param is written.

The conversion is a pure function over `(clientX, clientY, matrix, rect, viewBox)`
and is unit-tested directly, like `placePopover` in `figureEvents.ts`. No
jsdom is available (vitest node env), so geometry is tested as pure functions
and never through a live DOM.

## 7. Pointer model

- `onPointerDown` on the `.exp-el` wrapper of a declared draggable: record the
  param, the grab offset (pointer position minus the element's current scene
  position), and `setPointerCapture` on the SVG root. Capture is what keeps the
  drag alive when the pointer leaves the element — without it the drag dies the
  moment the cursor outruns a moving handle.
- `onPointerMove`: convert, add the grab offset, write the param. The offset is
  what stops the element from snapping its centre to the cursor on contact.
- `onPointerUp` / `onPointerCancel`: release capture, clear drag state.
- **Cancels cleanly**: a `pointercancel` (browser gesture took over) must leave
  the param at its last written value, not revert. A half-finished drag is not
  an error state.
- Touch: `touch-action: none` on draggable elements, or the browser's own
  scroll gesture cancels the drag mid-flight.

Re-render cost: the existing `useMemo` recompiles the whole figure per value
change. At 60fps that is a full `compileFigure` + `sceneToSvg` per move. The
epicycles figure is small enough to be fine; if a demo figure stutters, the fix
is requestAnimationFrame coalescing of moves, not a different architecture.

## 8. Keyboard access

A drag-only control is not accessible, so this is part of the feature, not a
follow-up.

- A declared draggable gets `tabindex="0"` and `role="slider"`-style semantics
  via `aria-label` describing the element and the axis.
- Arrow keys nudge the bound param by a fixed increment; Shift+Arrow by a
  coarser one. The increment is scene-relative, not the param's `step` (same
  reasoning as §5).
- `Home` / `End` jump to `min` / `max`.
- Focus is visible; the existing `:focus-visible` treatment in `tokens.css`
  applies to the wrapper.

The popover layer already uses `onFocusCapture` for keyboard-reachable tips
(`ElementPopover.tsx`), so this follows an established pattern rather than
inventing one.

## 9. SSR contract

Unchanged, and the thing most at risk of breaking.

- Initial render uses `params[].initial` exactly as today. No drag state is
  read during render, and `getScreenCTM` is never called on the server.
- The static (non-interactive) renderer is **not touched** — this is a React
  runtime feature, like sliders. `renderBlock` output stays byte-identical.
- `draggable` is additive and optional; a figure without it renders exactly as
  it does today.

## 10. Validation

- `draggable` is optional; absent means no draggables.
- Each entry needs an `id` matching the existing element-id rule
  (`/^[\w][\w-]*$/`, ≤100 chars — `authored.ts:94`) and at least one of `x` / `y`.
- `x` / `y` must name a declared `param`. A name that matches nothing is a
  warning (`figure-drag-unknown-param`) and the axis is inert — never a throw.
- An `id` matching no element is a warning (`figure-drag-unknown-id`); lenient
  salvage, per the library's standing rule.
- Max entries bounded (16) to keep the emitted attribute surface small.

## 11. Verification

- **Pure-function tests** for client→scene conversion (matrix path and rect
  fallback, including the degenerate `min > max` clamp and the grab offset).
- **Presence before geometry**, the rule this repo learned the hard way three
  times: assert the draggable attribute is emitted before asserting anything
  about positions.
- Byte-diff the static render against `main` in a worktree, as with the
  timeline — eyeballing is not verification.
- Demo: one figure on `/interactive` with a draggable handle, a bound slider
  that tracks it, and a keyboard-reachable path.

## 12. Risks

- **Re-compile per pointermove** may stutter on a heavy figure. Mitigation is
  rAF coalescing; the architecture does not change either way.
- **`getScreenCTM` under a CSS transform** is the subtlest part of §6. It is
  isolated in one pure function precisely so it can be tested directly.
- **Scope creep toward a figure editor.** The line is §3: authored figures,
  declared handles, no authoring surface. If a change starts letting a reader
  *create* geometry, it has left this spec.

## 13. Sequencing

Own branch `feature/drag-to-vary`, spec → plan → build, merged to `main`
behind the existing `interactive` opt-in. No changes to the static renderer.
