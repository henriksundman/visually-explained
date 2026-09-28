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

- **Interactive figure runtime** (first follow-up after step 1): React
  runtime consuming the bespoke-figure format *unchanged* — sliders bound to
  `params`, play/scrub controls, re-render via cached expression ASTs, SSR
  fallback showing `initial`-value render (already shipped by step 1).
- Demo gallery of bespoke figures (step-1 follow-up polish).
- Steps 2–3 specs (see arc above) — write when their turn comes.
