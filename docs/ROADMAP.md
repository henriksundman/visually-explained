# Roadmap

Where the `explanations` library is headed and why. Each step gets its own
spec → plan → implementation cycle; this file records the arc and the
decisions that survive across sessions.

## Shipped

- **Block library + themes** — LLM-authored explanation trees rendered as
  styleable HTML: 15+ primitives, zod schema with lenient salvage, JSON-schema
  export + tested system prompt, light/dark themes, React and HTML renderers.
- **Drawing layer** (2026-09-28) — Scene IR → SVG pipeline (`src/figures/`),
  auto-layout for diagrams/charts/timelines, sketch mode via rough.js,
  CSS-only progressive draw, dependency-free syntax highlighting, `code`
  block. Spec: `docs/superpowers/specs/2026-09-28-drawing-layer-design.md`.
- **Bespoke LLM-authored figures** (2026-09-28) — `figure` block: authored
  Scene elements (path/curve/arc/box/line/dot/label/group), params + derived
  values resolved by a hand-rolled expression evaluator, strict path grammar,
  static render at initial values. Spec:
  `docs/superpowers/specs/2026-09-28-bespoke-figures-design.md`.
- **Path slots + epicycles showcase** (2026-09-29) — authored `path` d strings
  accept `{{expr}}` slots (evaluated against params/derived, grammar-gated
  after expansion); the demo gains a Fourier-epicycles figure exercising
  params, derived chains, expression-offset groups and slots. Spec:
  `docs/superpowers/specs/2026-09-29-path-slots-epicycles-demo-design.md`.
- **Interactive figure runtime** (2026-09-29) — React client component
  consuming the bespoke-figure format unchanged: sliders bound to `params`,
  play sweep over an author-declared `sweep` param, re-render via
  `compileFigure`/`sceneToSvg` with memoized expression ASTs. `interactive`
  opt-in on `<Explanation>`; static render remains the SSR path. Spec:
  `docs/superpowers/specs/2026-09-29-interactive-figure-runtime-design.md`.

## Decisions That Bind Future Work

- **Scene JSON, never raw SVG.** LLM output is always data validated by the
  renderer; no LLM text becomes markup. Any future "draw" capability must
  route through Scene IR + grammar validation, not model-authored markup.
- **Dependency-free.** Hand-rolled utilities (highlighter, and now the
  expression evaluator) over heavy deps. New deps need a strong case.
- **Lenient salvage everywhere.** Invalid model output degrades gracefully
  (drop element / degrade block), never fails a render.
- **Determinism.** Seeded sketch randomness; SSR-safe, SSR-stable output.

## The Arc: Curio Compiler (agreed 2026-09-28)

The Stitch design explorations (`docs/design/stitch/`, "Curio Editorial
Learning") define the destination: editorial explanation pages with bespoke
authored visuals and interactive simulation cards. Three sequential
sub-projects, each its own spec → plan → build:

1. **Bespoke LLM-authored figures** — free-form Scene elements (paths,
   curves, arcs, groups), parametrized by expressions; static render with
   initial values now, format designed for interactivity later.
   Spec: `docs/superpowers/specs/2026-09-28-bespoke-figures-design.md`.
2. **Document IR + sections** — sections/chapters with headings, navigation,
   page composition: the structural foundation for Curio-style pages and the
   substrate the compiler orchestrates.
3. **Curio compiler / orchestrator** — topic → outline → sections → blocks +
   bespoke figures, multi-step generation with schema-repair loops,
   provider-agnostic (host supplies the LLM client). Built last; consumes 1+2.

## Backlog

- **Figure interactivity events**: `data-node-id`/`data-el-id` attributes at
  SVG emit time + React event delegation → hover/click callbacks and popover
  plumbing. Generalizes across diagrams, charts, timelines and bespoke
  figures; sketch mode needs the attributes carried through rough drawables.
  Own spec when its turn comes.
- Steps 2–3 specs (see arc above) — write when their turn comes.
