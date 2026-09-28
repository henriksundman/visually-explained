# Design: drawing layer (SVG figures, sketch style, progressive draw)

**Status:** Approved design (2026-09-28)
**Goal:** Let explanations *draw* — real diagrams, charts, and hand-drawn/sketch aesthetics, with figures that can draw themselves progressively — while keeping the library's thesis: one semantic IR, LLM-authored, renderer-owned layout, zero coordinates in the IR.

## Decisions

- **Shared figure layer (Approach B):** one drawing subsystem (`src/figures/`) that both new block types and upgraded existing primitives route through. Scene model in, SVG out.
- **LLM-authored, renderer-laid-out:** the LLM emits meaning (nodes, edges, values, trends); layout engines compute all geometry. The IR contains **no coordinates**.
- **Sketch via rough.js** (~9kb, zero deps of its own), not in-house wobble math. `sketch` is an opt-in render option / theme class, default off.
- **Progressive draw is CSS-only** (`stroke-dasharray` + `animation-delay`, `prefers-reduced-motion` respected), opt-in via the `exp-draw` class on any ancestor — no render option, no JS in core. Phase 2.
- **Phasing:** Phase 1 = figure system, `diagram`/`chart`, presentation upgrades, sketch. Phase 2 = progressive-draw CSS. One plan, two phases.
- **Comparison stays a table** (YAGNI). No free-form canvas block.

## 1. IR contract

**New optional field** `presentation?: "auto" | "text" | "figure"` on the three semantic blocks that gain visual forms:

- `cause-effect` — figure form: arrow chain (chains of ≤5 render well; `auto` falls back to text rows beyond that or when data doesn't fit)
- `timeline` — figure form: drawn spine with alternating event stems
- `data-callout` — figure form: big annotated number with trend sparkline

**Two new block types** (purely semantic, zero coordinates):

```
diagram: { nodes: [{ id, label, shape?: "box"|"round"|"pill"|"note" }],
           edges: [{ from, to, label?, kind?: "causes"|"leads"|"part-of"|"conflict" }],
           direction?: "lr" | "tb" }   // default "lr"

chart:   { kind: "bar" | "line",      // line: points are an ordered series
           points: [{ label, value }],
           unit?, caption? }
```

- Edge `kind` is semantic meaning; the renderer maps it to visual treatment (arrowhead style, stroke, color token).
- Charts accept numeric or numeric-string `value`; unit suffix renders on value labels/caption.
- `presentation` default `"auto"`: renderer picks figure when data fits, text otherwise. Consumers can force `"text"` or `"figure"`.
- All new fields are optional → **no breaking change** to existing IR; old documents render identically.

**Leniency:** figure specs salvage per-part, consistent with library philosophy — dangling edge (unknown node id) drops the edge with a warning; one malformed chart point drops the point; nodes with no valid edges still render; duplicate node ids drop later duplicates with a warning.

## 2. Figure system internals (`src/figures/`)

Pure TypeScript, no DOM dependency (same rules as `src/core/`). Internal implementation, **not** exported from the package root initially.

- **Scene model** — the internal currency. `Scene = { width, height, elements: Element[] }`; elements are node boxes, arrow paths, labels, axes, bars, line paths, sparklines. Layouts compile *into* a Scene; one serializer compiles a Scene *out* to SVG.
- **Layout engines** (pure functions, spec → Scene):
  - `layoutFlow` — layered left-right/top-down routing for diagram nodes + edges; label-aware sizing; orthogonal/curved edges; also used by cause-effect's chain form.
  - `layoutTimeline` — horizontal spine, alternating stems (reuses flow's arrow kit).
  - `layoutChart` — bar/line scales, baseline, value labels, unit suffix.
- **SVG serializer** — Scene → `<svg viewBox>` string. Every color/stroke references CSS custom properties (`var(--exp-ink)`, `var(--exp-accent)`, `var(--exp-edge)`, …) so existing themes and `theme: "none"` work unchanged. `role="img"` + aria-label built deterministically from the block's own fields (caption/label if present, else node or point labels joined with "→"); `<title>` child for a11y.
- **Sketch pass** — rough.js SVG generator applied to Scene elements when `sketch` is on. Deterministic: seeded from block `id` or content hash → same IR renders byte-identical SVG.
- **Progressive draw** — real SVG paths make reveal CSS-only: per-element `stroke-dasharray`/`dashoffset` with `animation-delay`, gated on `prefers-reduced-motion`. Opt-in via `exp-draw` class / render option.

## 3. Renderer integration & API surface

- **Registry:** `diagram` and `chart` primitives registered alongside existing ones (schema + renderer per file in `src/primitives/`). `cause-effect`, `timeline`, `data-callout` renderers gain a `presentation` branch: figure form compiles spec → figure → Scene → SVG; text form is today's markup, unchanged.
- **Public API:**
  - `RenderOptions.sketch?: boolean` (adds `exp-sketch` class; default off — zero change for existing consumers).
  - New root exports: `diagramSchema`, `chartBlockSchema` (+ types), `presentationSchema`. Figures/Scene stay internal for now.
  - `explanationJsonSchema` updates automatically (derived from zod); `systemPromptSnippet` documents the new blocks and the "prefer figure forms for chains ≤5" guidance.
- **Themes:** `tokens.css` gains drawing tokens (`--exp-ink`, `--exp-accent`, `--exp-edge`, `--exp-node-fill`, sketch wobble/roughness variables); light/dark set values. SVG only references `var(…)` → one-class theme switching and `theme: "none"` keep working.
- **Error handling:** same salvage philosophy — warn, degrade, never throw unless `strict`. Unknown block types still render as text fallback.
- **Testing:**
  - Unit: layout engines (pure — assert element positions/kinds), schema accept/reject, per-primitive render snapshots, salvage cases (dangling edge, malformed point).
  - Determinism: same IR → byte-identical SVG (rough seed derived from block id, else content hash).
  - A11y: `role="img"`, aria-label, `<title>` present on figure SVGs.
  - Demo: third fixture in `demo/examples.js` (`diagram` + `chart` + `cause-effect` with `presentation: "figure"`), schema-asserted in `tests/demo-examples.test.ts`; visual check manual via `npm run demo`.

## Out of scope

- Free-form canvas / coordinate-level diagram authoring
- Human-authored figure import (e.g. Excalidraw JSON) — revisit later
- Comparison-as-figure; LaTeX math rendering
- Exporting Scene/layout APIs publicly (revisit on demand)
