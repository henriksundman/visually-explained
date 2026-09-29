# Figure Interactivity Events — Design

**Date:** 2026-09-29
**Status:** Approved (brainstorm 2026-09-29)
**Predecessor:** Interactive figure runtime (`2026-09-29-interactive-figure-runtime-design.md`)
**Backlog origin:** ROADMAP "Figure interactivity events" (recorded in the runtime cycle)

## 1. Problem & Goal

Figures render as opaque SVG: nothing inside them is addressable, hoverable, or
explainable beyond what the LLM drew as visible labels. The Curio destination —
"editorial pages with interactive simulation cards" — needs element-level
interaction: hover a diagram node to see why it matters, hover a chart point to
see the exact value, click an epicycles dot to learn what it is.

Goal: every scene element can carry **identity** (`id`) and **explanation**
(`tip`) from IR data; the SVG emit layer makes both addressable (`data-el-id`,
`data-tip`); a delegated React layer turns hits into callbacks and a built-in,
themeable popover. Static HTML hosts get CSS-only affordances; no scripts ship
in static output.

## 2. Decisions (from brainstorm)

1. **Events + built-in popover** — presentation is library-owned (matches every
   shipped feature: charts emit labels, callouts own their styling), behavior
   stays headless via callbacks for hosts that want custom UI.
2. **Author id everywhere** — the LLM may name/tip any authored leaf element;
   layouts auto-derive ids for their own elements (diagram arrows from edge
   endpoints, chart points from labels). No positional `el-7` ids (they churn
   on regeneration); no explicit-only mode (charts/timelines would stay
   non-interactive).
3. **Delegated container + IR-driven popover** (approach A) — one listener set
   per figure container reading `closest('[data-el-id]')`; popover content from
   IR `tip` fields; anchoring from the hit element's rect (we know scene
   coordinates at emit time; no floating-ui, no dependency). Hairline elements
   get a transparent twin stroke *inside their own group* for hit area — the
   one good idea borrowed from the shadow-layer approach without its cost.

## 3. Data Model (IR changes)

All lenient per house rules: invalid identity drops with a warning, never
fails a render.

| Surface | Change |
| --- | --- |
| Authored leaf elements (`path`, `curve`, `arc`, `box`, `line`, `dot`, `label`) | Optional `id`, `tip` strings. |
| Authored `group` | No identity in v1 — group-level `id`/`tip` is dropped with `figure-id-unsupported` warning. Groups are structural. |
| `diagramNodeSchema` | Optional `tip` (1–200 chars). Node `id` already flows to `NodeBoxEl.id`. |
| Diagram arrows | No authoring: layout derives `data-el-id` as `"from->to"` from edge endpoints. |
| Chart points | Optional `tip` (points are lenient `z.unknown` today — free). `data-el-id` derives as `"bar:<label>"` / `"dot:<label>"` by chart kind. |
| Timeline events | Optional `tip` in schema; `data-el-id` derives as `"event:<index>"`. |

**Validation:**
- `id` must match `/^[\w][\w-]*$/` (CSS-selectable, collision-safe). Invalid or
  missing → element stays anonymous (warning `figure-id-invalid`).
- `tip` max 200 chars; longer → dropped (warning `figure-tip-too-long`). Empty
  string treated as absent.
- Duplicate `id` within one scene: first wins (warning `figure-id-duplicate`),
  mirroring the existing param-duplicate rule.

## 4. Emit Layer (`src/figures/svg.ts`, `src/figures/sketch.ts`)

- Any element with identity (explicit or derived) is emitted wrapped:
  `<g class="exp-el" data-el-id="…" data-tip="…">…</g>`. `data-tip` only when a
  tip exists. Uniform for clean and sketch modes — sketch paths and separately
  emitted labels land inside the same wrapper.
- Elements with a tip also get `tabindex="0"` on the wrapper (keyboard path to
  the popover).
- **Hairline hit area:** wrappers for `path`/`line`/`line-path`/`arrow` get one
  extra `<path d="…" stroke="transparent" stroke-width="12" fill="none"
  pointer-events="stroke"/>` twin inside the group. Arcs/curves compile to
  paths before this layer, so they get the same treatment via their compiled
  `d`.
- **Determinism:** attributes derive only from IR data; elements without
  identity emit byte-identical SVG to today (regression-guarded by tests).
- Scene identity travels on scene elements: `NodeBoxEl.id` exists; a shared
  optional `id`/`tip` pair is added to the other scene element types that need
  it (derived or authored identity set at layout/compile time, consumed only by
  the emit layer).

## 5. React Layer

**Pure hit logic** — `src/react/figureEvents.ts` (no React imports; unit-testable):
- `hitElement(target): { elId, tip, node } | null` — `closest('.exp-el')` walk.
- `resolveTip(text): string | null` — empty/oversized → null; content is
  rendered through the existing escaped inline renderer, never raw HTML.
- `placePopover(anchor, stage): { top, left, placement }` — prefer above,
  flip below if clipped, nudge horizontally into view. Pure function over two
  rects; measured in `useLayoutEffect` after mount.

**Callback** — on both `Explanation` and `InteractiveFigure`:
```ts
type FigureElementEvent =
  | { kind: "hover"; elId: string; phase: "start" | "end" }
  | { kind: "click"; elId: string }
```
Optional prop `onElementEvent?`; hosts may ignore it. Events fire only for
elements with identity.

**Popover** — `src/react/ElementPopover.tsx`, one per figure container:
- State `{ elId, tip, anchorRect } | null`; opens on `pointerover` of a
  tip-bearing element (and `focuscapture`), closes on `pointerout`, `blurcapture`,
  Escape (container `keydown`), or click on empty stage. Clicking another
  element re-targets. No scroll-tracking in v1 (pointerout closes on scroll).
- Renders `<div class="exp-popover" role="tooltip">` as a stage sibling;
  positioned from `placePopover`.
- `--exp-popover-bg/-fg/-border/-shadow` tokens; both shipped themes get
  entries.

**Delegation wiring** — a small `exp-fig-hit` container div wraps the stage in
both static and interactive paths (static path gets it via a tiny client
wrapper used when either `onElementEvent` or popover-relevant data is present;
`Explanation` stays RSC-safe when no identity-bearing data exists, same pattern
as the existing `interactive` opt-in).

**SSR/determinism:** popover state is client-only; closed-popover markup is
identical server/client — the static-identical SSR contract holds.

**Accessibility:** tip-bearing wrappers are focusable (`tabindex="0"`);
focus/blur mirror hover; `role="tooltip"` on the popover; Escape is the
keyboard dismissal.

## 6. Demo & Rollout

- `demo/examples.js`: diagram node tips (hover → popover), chart point tips,
  a tip on the epicycles sampling dot — covers diagram, chart, and authored
  figure families. No server changes.
- CSS appended to `tokens.css` via bash heredoc (large-file write lesson):
  popover styles + `.exp-el` hover affordance (CSS-only, works without React).
- ROADMAP backlog entry → Shipped; ledger updated. Zero breaking changes:
  optional fields only, no SVG delta without identity, static hosts unaffected.

## 7. Testing

- **Emit:** wrapper carries `data-el-id`/`data-tip`; twin transparent stroke on
  hairlines; **byte-identical output when no identity exists** (guards the
  whole existing corpus); sketch mode keeps attributes through rough drawables;
  derived arrow/point/event ids correct.
- **Parse/validation:** authored id/tip rules (invalid id dropped + warning,
  group id warning, tip cap, duplicate rule), chart/timeline tip paths.
- **Pure logic:** `hitElement` (through nested children; null on chrome),
  `resolveTip` sanitization, `placePopover` placement matrix (above / flip
  below / nudge).
- **React:** SSR markup identical to today plus focusability; popover closed
  initially; callback fires with expected payloads (renderToStaticMarkup + jsdom
  events where possible). Live hover/click verified by browser eyes on the demo.
- **Demo tests:** served examples contain tips; import-map regression green.

## 8. Out of Scope (v1)

- Popover scroll-tracking/repositioning (closes instead).
- Group-level identity; element selection state (CSS `:hover` only).
- Multi-subscriber event bus (context/hook architecture) — revisit if a host
  needs it; `onElementEvent` covers the known need.
- Popovers in non-React hosts (static HTML gets CSS hover affordances only).

## 9. Plan Sizing (input to writing-plans)

Estimated 6–7 tasks: emit layer + scene identity → sketch carry-through →
parse/IR validation → hit logic + callbacks → popover component + CSS →
demo + docs → full verification.
