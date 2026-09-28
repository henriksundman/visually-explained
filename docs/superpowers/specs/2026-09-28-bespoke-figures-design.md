# Bespoke LLM-Authored Figures (Interactive-Ready Format, Static Render)

Date: 2026-09-28
Status: Approved
Follows: 2026-09-28-drawing-layer-design.md (shipped)

## Problem

The library renders LLM-authored explanations, but its figures are limited to
auto-layout diagrams, charts, and timelines. The Stitch design explorations
(`docs/design/stitch/`) show the destination: explanation pages with bespoke,
authored visuals — plotted curves, annotated constructs, free-form diagrams.
Today an LLM that wants to draw anything outside the auto-layout vocabulary has
no way to express it.

## Goal

Let an LLM author bespoke figures as **data** — a parametrized Scene IR with
free-form elements and expressions — that the renderer compiles to themed,
sketchable, progressively-drawn SVG. The format is designed so a follow-up
interactive runtime (sliders, play controls) can consume it **unchanged**;
this spec ships only static rendering with initial parameter values.

## Non-Goals (YAGNI)

- Sliders, play/scrub controls, or any client-side re-render (next spec).
- Text-on-path, gradients, embedded images, clip paths.
- Multi-level element nesting (groups nest at most one level).
- Animation of parameters.
- Raw SVG from the LLM — rejected by design: SVG strings from a model would
  break the library's core guarantee that no LLM text becomes markup.

## Decisions Locked (from brainstorming, 2026-09-28)

1. **Scene JSON, never raw SVG.** The LLM authors Scene IR data. All numbers,
   structure, and colors pass through the renderer; nothing is interpolated
   into markup unescaped. This keeps the injection-safety story identical to
   every other block.
2. **Option-2 scoping.** Params + expressions live in the format now (evaluated
   once with initial values); the interactive runtime is a follow-up spec that
   consumes the same format without breaking changes. Chosen over static-only
   (format would evolve later) and full-interactive-now (first usable result
   too far away).
3. **Hybrid element vocabulary.** Structured primitives (curve, arc, box, …)
   plus a `path` element taking an SVG path `d` string validated against a
   strict whitelist grammar. LLMs write path data well; a grammar keeps it data.
4. **Sliders + derived values in the param model.**
   `params: [{ name, min, max, step, initial }]` and ordered
   `derived: [{ name, expr }]` evaluated against `{params} ∪ {derived}`.
5. **Hand-rolled expression evaluator.** ~200-line recursive-descent parser,
   dependency-free (same ethos as `src/core/highlight.ts`), safe by
   construction, no `eval`/`new Function`, CSP-safe, SSR-deterministic.

## Block Schema

New primitive type `figure`:

```jsonc
{
  "type": "figure",
  "title": "Lissajous curves",
  "caption": "Two perpendicular oscillations compose into a closed orbit.",
  "width": 360, "height": 240,          // optional, defaults 360x240
  "params": [                            // optional
    { "name": "a", "min": 1, "max": 9, "step": 0.5, "initial": 3 },
    { "name": "b", "min": 1, "max": 9, "step": 0.5, "initial": 2 }
  ],
  "derived": [                           // optional, evaluated in order
    { "name": "scale", "expr": "18/PI" }
  ],
  "elements": [ /* SceneElement[], see below */ ]
}
```

- Zod schema lives in `src/core/schema.ts` beside the other figure blocks.
- Registered in `src/core/registerAll.ts`; React and HTML rendering flow
  through the existing `renderBlock` — no new public API.
- `systemPromptSnippet` in `src/core/llm.ts` documents the block with authoring
  guidance: draw in a fixed canvas (default 360×240), prefer named params over
  magic numbers, label everything, keep scenes under ~60 elements.

### Salvage rules (lenient, like every other block)

- Invalid single elements (bad expression, bad path grammar, unknown kind) are
  dropped individually; the rest of the scene renders.
- A scene whose elements all drop renders as a caption-only figure callout —
  never a render failure, never empty output.
- Unknown element `kind` → dropped element, not a schema rejection.

## Element Vocabulary

All numeric fields (including coordinates inside compound fields) may be
either a number or an expression string referencing params/derived values.
Colors are a single named `tone` slot — `"ink" | "muted" | "accent"` (accent
resolves to the theme's `--exp-accent` token) — rendered as
`var(--exp-*)`; never literal hex from the LLM.

**Layering.** The `figure` block carries its own *authored* element types
(`FigureEl` — expressions, groups, authored coordinates). A compile step in
the `figure` primitive resolves every expression against the initial-value
environment, flattens `group` elements (translate-only: child coordinates are
offset by `dx`/`dy`), and emits the internal numeric `SceneElement[]` that
`sceneToSvg` already consumes. `Scene` stays internal — its invariant "no
expressions, no groups, numeric only" is preserved; the *authoring* IR is a
separate, validated type.

| Kind | Fields | Renders as |
|---|---|---|
| `path` | `d`, `tone?`, `fill?`, `width?` | Sanitized path `d` |
| `curve` | `from{x,y}`, `cp1{x,y}`, `cp2{x,y}`, `to{x,y}`, tone fields | Cubic Bézier |
| `arc` | `cx`, `cy`, `rx`, `ry`, `start`, `end`, tone fields | Elliptical arc |
| `box` | `x`, `y`, `w`, `h`, `r?`, `label?`, tone fields | Rounded rect + optional centered label |
| `line` | `x1`, `y1`, `x2`, `y2`, tone fields | Segment |
| `dot` | `cx`, `cy`, `r?`, tone fields | Circle (default r 3) |
| `label` | `x`, `y`, `text`, `size?`, `anchor?` | Positioned text (anchored start/middle/end) |
| `group` | `elements` (one level max), `dx?`, `dy?` | Flattened at compile into absolute elements |

- The internal `Scene` gains element kinds for the new visuals (positioned
  shape, curve, arc, stroked path); `svg.ts` and `sketch.ts` gain compile
  cases for them. rough.js natively supports paths, curves, arcs, circles and
  polygons, so sketch mode has no gaps. `svg.ts` maps `tone` → `var(--exp-*)`
  at emit time; Scene elements carry only the tone name.
- Progressive draw: new elements participate in the `--draw-i` index and the
  existing `exp-draw` keyframes.

## Path Grammar

`path.d` is validated by a strict whitelist before use; anything else rejects
the element (salvage, not schema error):

- Allowed commands: `M L H V C S Q T A Z` (absolute) and `m l h v c s q t a z`
  (relative).
- Numbers with optional sign/decimal/exponent; commas and whitespace as
  separators; flags in `A` are 0/1.
- Any other token — unknown letters, `<`, `{`, comments, entity encodings —
  rejects the element. The grammar is a pure function, fully table-tested.

## Expression Evaluator (`src/figures/expr.ts`)

Recursive-descent parser producing a cached AST:

- Grammar: number · identifier · `(expr)` · unary `-` · binary
  `^` (right-assoc) · `* / %` · `+ -` · function calls `f(a, b)`.
- Function table (fixed, no host access): `sin cos tan asin acos atan atan2
  sqrt abs min max pow log exp floor ceil round sign hypot`.
- Constants: `PI`, `E`, `TAU`.
- Unknown identifier, unknown function, or syntax error → parse error →
  element dropped at render (logged via the existing debug channel).
- Parse once per expression when the scene is loaded; evaluate per render.
  The cached-AST shape is what makes the follow-up interactive runtime cheap.

## Params & Derived Values

- `params`: name, `min`, `max`, `step`, `initial`; schema enforces
  `min ≤ initial ≤ max`, `step > 0`, unique names.
- `derived`: ordered `[{ name, expr }]`; each evaluates against
  `{params} ∪ {derived-so-far}`; duplicate names rejected; cycles impossible
  by construction (ordered, non-recursive).
- Static render evaluates `params` at `initial` and `derived` once, then
  resolves every expression field against that environment.

## Rendering & Theming

- `svg.ts`: new compile cases emit plain SVG with the same escaping and
  `var(--exp-*)` discipline as existing elements; `n2()` remains the number
  formatter; `tone` maps to tokens at emit time.
- `sketch.ts`: rough.js equivalents per element kind; seeded determinism
  unchanged (`hashSeed`/`seedNumber`).
- Themes: at most additive token slots (accent slots largely exist from the
  chart work). No breaking CSS changes; light/dark keep working.

## Testing (TDD)

- `tests/figures/expr.test.ts` — grammar, precedence, right-assoc `^`, unary
  minus, functions, constants, error cases.
- `tests/figures/path-grammar.test.ts` — per-command tables, malformed inputs,
  hostile tokens.
- `tests/figures/svg.test.ts` / `sketch.test.ts` — new element kinds, groups,
  expression resolution, escaped labels.
- `tests/figure.test.ts` — primitive registration, schema acceptance,
  salvage/drop paths, caption-only degradation.
- `tests/presentation.test.ts` — prompt-snippet coverage for `figure`.
- Demo: `figuresIr` gains a bespoke parametrized figure (Lissajous driven by
  `a`/`b` params) rendered in both plain and sketch sections.

## Roadmap Position

Documented in `docs/ROADMAP.md`: this is step 1 of 3 (bespoke figures →
document IR/sections → Curio compiler). The follow-up interactive-runtime spec
consumes this format unchanged.
