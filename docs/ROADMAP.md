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
- **Figure interactivity events** (2026-09-29) — element `id`/`tip` through
  Scene IR (authored leaves, diagram nodes, chart points, timeline events;
  arrows/points/events derive ids), `data-el-id`/`data-tip` at SVG emit with
  twin-stroke hit areas, delegated React events (`onElementEvent`) and a
  built-in popover. Spec:
  `docs/superpowers/specs/2026-09-29-figure-interactivity-events-design.md`.
- **Document IR + sections** (2026-09-30) — sibling `documentSchema` composing
  the existing block union into flat h2 sections with a derived, data-only
  TOC; `renderDocument()` HTML composer with lenient section salvage, static
  React `<Document>` with parity guarantees, LLM contract (JSON schema + prompt
  snippet sharing block-type text), demo `/document` page. Spec:
  `docs/superpowers/specs/2026-09-30-document-ir-sections-design.md`.
- **Curio compiler / orchestrator** (2026-09-30) — `compileDocument(topic,
  { client })`: outline call → per-section calls with bounded repair (zod
  issues + offending fragment re-asks), lenient section salvage, canonical
  outline titles, structured events + warnings; provider-agnostic via a
  minimal host-injected text-in/text-out client; `/compile` demo on a stub
  client. Spec: `docs/superpowers/specs/2026-09-30-curio-compiler-design.md`.
- **Sticky document TOC by default** (2026-09-30) — `.exp-doc-toc` pins itself
  as a compact right-hand card in `tokens.css`: the treatment every host was
  re-declaring per page, and one demo shipped without, leaving the nav dead
  off-screen. `tocSticky: false` on `renderDocument` / `<Document>` opts out
  per instance via an `exp-doc-toc-inline` modifier; demo pages consume the
  default with no per-page TOC rules.
- **TOC active-section styling** (2026-09-30) — theme styles the standard
  `aria-current="true"` state on `.exp-doc-toc-list a` (accent, weight,
  underline), so scroll-spy hosts get the treatment for free while the
  library's script-free SSR contract holds; the script stays host-side —
  `/document` and `/compile` demo a ~15-line IntersectionObserver reading-band
  spy with a page-bottom fallback.
- **Host README** (2026-09-30) — root `README.md` for hosts (primary audience:
  coding agents): both pipelines with verified snippets, block-type groups,
  figures/interactive, theme + sticky-TOC contract, `compileDocument` with the
  full event table and failure semantics, the LLM authoring contract, explicit
  host responsibilities, and a codebase map. Spec:
  `docs/superpowers/specs/2026-09-30-readme-for-hosts-design.md`.
- **Streaming compile** (2026-10-01) — `compileDocumentStream(topic, { client })`:
  async generator yielding the v1 event vocabulary live plus a terminal
  `compile-done` event carrying `{ document, warnings }`; `compileDocument`
  is a drain of the stream (one code path, contract tests lock both APIs);
  `/compile` consumes the stream client-side with a paced stub. Spec:
  `docs/superpowers/specs/2026-10-01-streaming-compile-design.md`.

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

The arc is complete; new work starts here. Candidate threads (recorded
2026-09-30, unplanned — each needs its own spec → plan → build cycle):

- **Grounded authoring** — hosts supply source material (documents, notes)
  that constrains outline/section prompts; output carries provenance:
  citation blocks or inline references, which need a link inline element
  (renderInline's v1 subset is bold/italic/code only). The gap between a
  demo and real content.
- **Real data for visual blocks** — host-supplied datasets (keyed,
  schema-validated) interpolated into `chart`/`data-callout`/`timeline` at
  render time, so numbers are true instead of model-guessed. Renderer/schema
  work; no LLM-surface changes.
- **Retrieval practice** — an assessment primitive in the block library
  (quiz / reveal-the-answer), the missing complement to the exposition-side
  blocks; retrieval beats re-reading for learning that sticks.
- **Drag-to-vary simulations** — the interactive runtime has sliders +
  play; direct manipulation (drag a point, scrub a timeline) was deferred
  from the interactive-runtime cycle and is what makes a card a simulation
  rather than an animation player.
- **Math typesetting subset** — hand-rolled sup/sub inline syntax and
  fraction stacking for derivation steps; most of KaTeX's benefit without
  breaking the dependency rule.
- **Compiler v1 deferrals** (spec §9) — parallel section calls; client
  surface growth (usage reporting, abort signals, retries); caching;
  human-in-the-loop outline approval.
- **Curio Editorial Learning theme tokens** — the Stitch destination look,
  off `docs/design/stitch/*/DESIGN.md`; deliberately kept out of the
  compiler cycle.
- **AI-generated raster imagery** (discussed 2026-09-30, shape undecided) —
  the host runs an image model and hands the library a catalog of images
  with instructions; the library stitches them into guides/explanations
  (step-by-step sequences, explanation-by-analogy). Real images, even
  mediocre ones, add atmospheric variety the vector layer can't. Design
  constraints surfaced in discussion: images enter as *references*
  (src/alt/width/height/caption — never bytes, never fetched at render,
  lenient salvage on broken refs); `alt` and dimensions required at schema
  level (a11y + no layout shift); "no text in image" in the prompt contract
  (labels are HTML overlays/captions); per-document `imageStyle` hint passed
  through (cross-image consistency stays host-side via style templates);
  editorial role rules in `BLOCK_TYPE_DOCS` (images anchor analogies and
  set scenes, they don't illustrate derivations). Candidate shapes, in
  ascending ambition: **(a)** `image` block + host-supplied catalog, LLM
  assigns to sections; **(b)** compiler-driven: outline gains image briefs,
  host-injected image client materializes them mid-compile; **(c)**
  `analogy` composite block: image + `[{ imagePart, conceptPart }]` mapping
  rendered as a caption-side table — the novel differentiator. Decision
  pending: which shape specs first (leaning a → c, b later).
