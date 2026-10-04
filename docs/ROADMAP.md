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
- **Real data for visual blocks** (2026-10-01) — hosts pass
  `datasets?: Record<string, unknown>` to any render entry point;
  `chart`/`data-callout`/`timeline` blocks carrying `dataset: "<key>"`
  materialize their data fields from the validated payload at render time
  (field-by-field override; miss/invalid → warning + literal fallback, never
  a throw). Exported per-type dataset schemas; LLM surface untouched. Spec:
  `docs/superpowers/specs/2026-10-01-real-data-visual-blocks-design.md`.
- **Link inline element** (2026-10-01) — `renderInline` gains
  `[label](href)`: scheme-gated (https/http/mailto/#anchor after
  control-char/space normalization), escaped, lenient (gated or malformed
  links render literally); the LLM prompt contracts teach the form. The
  grounded-authoring prerequisite. Spec:
  `docs/superpowers/specs/2026-10-01-link-inline-element-design.md`.
- **Sources block** (2026-10-01) — grounded authoring part 1: a `sources`
  block (numbered, anchorable reference list, `items: [{ id, title, url?,
  detail? }]`) with `source-<id>` anchors matching inline citations
  (`[label](#source-<id>)`); shared `safeHref` gate; `BLOCK_TYPE_DOCS`
  contract + theme styling. Part 2 (compiler grounding) specs next. Spec:
  `docs/superpowers/specs/2026-10-01-sources-block-design.md`.
- **Retrieval practice — quiz block** (2026-10-02) — the first assessment
  primitive: `quiz` (question, 2–6 options, 0-based `answer`, per-option
  `why` rationale, optional `explanation`); static HTML renders options with
  a script-free `<details>` check reveal, the React runtime grades clicks
  (`<Explanation interactive>`) and locks after check; `BLOCK_TYPE_DOCS`
  teaches authoring. Spec:
  `docs/superpowers/specs/2026-10-02-retrieval-practice-quiz-design.md`.
- **Compiler grounding** (2026-10-02) — grounded authoring part 2:
  `compileDocument(topic, { client, sources })` interpolates host
  `SourceExcerpt`s into the outline (ids/titles/urls) and section prompts
  (full text + citation rules), auto-appends the `sources` block to the last
  surviving section, and audits output with `[grounding]` warnings for
  hallucinated anchors and never-cited excerpts. Absent `sources`, compiles
  are byte-identical to ungrounded ones. Spec:
  `docs/superpowers/specs/2026-10-01-compiler-grounding-design.md`.
- **Quiz placement in the compiler** (2026-10-02) — retrieval practice part
  2: `compileDocument(topic, { client, checks: true })` invites the outline
  to declare retrieval-check sections (`check: true`, planned count on
  `outline-done`), instructs those section writers to close with exactly one
  quiz, and warns when a declared check places none; quiz content joins the
  grounding audit for free. Spec:
  `docs/superpowers/specs/2026-10-02-quiz-placement-design.md`.
- **Figure label overflow** (2026-10-02) — one defect class, three layouts.
  Text was being placed at fixed coordinates without ever being measured, so
  labels overlapped their neighbours and were clipped at the scene edge while
  the suite stayed green. Diagram edge labels wrap to their gutter (a wrap
  target wide enough to break on word boundaries — a narrow one reads as
  damaged text); chart prints its unit once above the plot with bare values and
  omits any value label wider than its mark's slot; the sketch pass emits arrow
  labels. Spec:
  `docs/superpowers/specs/2026-10-02-figure-label-overflow-design.md`.
- **Timeline degrades to its text form** (2026-10-02) — the timeline follow-up.
  A figure cannot solve this by scrolling: the SVG carries a `viewBox` with no
  `width` and `.exp-figure` is `width: 100%`, so a wide scene is *scaled down*,
  not overflowed. So `auto` presentation now **measures** (`timelineFigureFits`)
  and renders the text list — which also surfaces `detail` — once labels would
  stop being legible; `layoutTimeline` itself never drops a label, and an
  explicit `presentation` is always honoured. See the spec addendum.
- **Drag-to-vary simulations** (2026-10-02) — direct manipulation for authored
  figures: a `draggable: [{ id, x?, y? }]` handle writes to the same `param` a
  slider writes, so the two are consistent by construction rather than by a
  second code path. The layout does not change: a handle's coordinate is
  expression-driven and the existing `values → compileFigure → sceneToSvg`
  round trip re-solves the figure. Keyboard-operable (arrows, Shift+arrows,
  Home/End) as part of the feature. The static renderer is untouched — verified
  byte-for-byte against `main`. Spec:
  `docs/superpowers/specs/2026-10-02-drag-to-vary-design.md`.
- **Editorial showcase** (2026-10-02) — a demo-only `/editorial` route
  re-skinning a 9-block article in warm paper / oxblood / serif, built
  entirely from the library's public styling surface: **zero changes under
  `src/`**, all 36 tokens overridden from a host stylesheet. Its purpose was
  to hunt for figure-label bugs, and it found all three above. Spec:
  `docs/superpowers/specs/2026-10-02-editorial-showcase-design.md`.
- **Raster imagery: the `image` block** (2026-10-03) — shape (a) of the raster
  imagery thread: an `image` block referencing a host-supplied catalog by key,
  resolved at render. Images enter as **references only** — never bytes, never a
  fetch — so documents stay diffable and rendering stays offline-safe. `alt`,
  `width`, and `height` are required by `imageRefSchema`, which is what makes an
  inaccessible image and a layout-shift-free document unrepresentable rather
  than merely discouraged. The host owns `alt` because the compiler's
  `LlmClient` is text-only: a model-authored alt would describe a picture the
  model never saw. A miss degrades to the caption with a warning, never a broken
  `<img>` and never the host-internal catalog key. The catalog is the same
  `Record` for compile and render, so the key the model writes is the key the
  renderer looks up. The compiler sees only keys and subjects. Spec:
  `docs/superpowers/specs/2026-10-03-image-block-design.md`.

- **Math typesetting** (2026-10-03) — `derivation.expression` and
  `derivation.conclusion` are TeX and compile to MathML through
  [temml](https://github.com/temml-org/temml): no fonts ship, formulas inherit
  the surrounding font and color, and the engine sits behind one internal
  boundary (`renderMath`, not exported) so it is swappable. A stale assumption
  about the dependency rule had to bend once, and it is recorded rather than
  quietly rewritten: real TeX is what an LLM can actually write, and the
  hand-rolled sup/sub + fraction-stacking subset that was planned for loses to
  the engine on fidelity and on the parsing surface a hostile model can aim at
  it. `\frac{3}{1/2}` over `\frac{3}{\frac{1}{2}}` is the house style — a
  single level reads faster, and nested fractions shrink at every level. Temml
  *throws* on markup-producing commands (`\href`, `\url`, `\includegraphics`,
  `\htmlClass`, `\htmlId`), which is stronger than KaTeX's `trust: false`: those
  constructs cannot reach output at all. Unparseable TeX degrades to its literal
  source with a `[math]` warning. The demo's `/math` route renders one corpus
  through Temml and KaTeX side by side, so browser fidelity is judged by eye
  rather than from vendor docs. Spec:
  `docs/superpowers/specs/2026-10-03-math-typesetting-design.md`.

- **Enforceable no-degradation policy** (2026-10-04) — two new options on all
  four render entry points: `onWarning(warnings)` fires once per render pass
  with the full set (observation), and `failOnWarning: true` throws after
  rendering, carrying every warning rather than only the first. `strict` was
  deliberately **not** widened — it gates the *input* (validation, before any
  block renders) while this gates the *output*, and merging them would silently
  change behavior for every existing caller. `failOnWarning` counts
  lenient-validation diagnostics too: a silently dropped section is a
  degradation. Reading the code for this cycle found the gap was two-sided —
  the string renderers already returned `warnings`, but `renderBlock`
  hardcoded a throwaway sink, so `<Explanation>` and `<Document>` discarded
  them entirely and a React host could not observe a degradation at all. Both
  now thread a per-pass array and report the same set as the string renderers
  (test-locked); they stay server components, so StrictMode's dev-only
  double-invoke is documented rather than fixed. Spec:
  `docs/superpowers/specs/2026-10-04-enforceable-no-degradation-design.md`.
- **Cycle-aware diagram layering + return paths** (2026-10-04) — a `diagram`
  whose graph contains a feedback loop no longer explodes its rank count.
  Longest-path relaxation cannot terminate on a cycle (the 5-node pipeline
  diagram reached layer 16, leaving 13 empty ranks that still consumed width,
  so the figure scaled to 0.49x and its 13px labels to 6.4px), and the resulting
  inversion gave one edge a **negative** gutter, wrapping "miss / stale" into
  two-character lines. Cycles are now broken by DFS back-edge classification
  for ranking only; the closing edge keeps its authored direction and is drawn
  as a return path around the outside. Separately, the scene clamp now shifts
  node placement *before* edge paths are serialized — it previously moved node
  boxes and label anchors but not the already-built path strings, leaving every
  arrow floating above its node's centre. Spec:
  `docs/superpowers/specs/2026-10-04-flow-cycle-layering-design.md`.

## Open threads

Deliberately-deferred judgement calls and known-rough edges in shipped work —
what to read *before* changing the code involved, and what to revisit if.
See `docs/OPEN_THREADS.md`.

## Decisions That Bind Future Work

- **Scene JSON, never raw SVG.** LLM output is always data validated by the
  renderer; no LLM text becomes markup. Any future "draw" capability must
  route through Scene IR + grammar validation, not model-authored markup.
- **Dependency-minimal.** Hand-rolled utilities (highlighter, and now the
  expression evaluator) over heavy deps. New deps need a strong case — and one
  now exists: `temml` parses the TeX a model actually writes, where the planned
  hand-rolled fraction/sup-sub subset would have had to re-derive a parser and
  would still have been easier to aim hostile input at. Deps stay few, small,
  and each one is named in the README's opening principles.
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
2026-09-30, re-surveyed 2026-10-02 — each needs its own spec → plan → build
cycle):
- **Drag-to-vary simulations** — SHIPPED (see above). Remaining: groups carry no
  identity so they cannot be grabbed, and there is no multi-touch, snapping or
  undo. Any of those is its own cycle.
- **Math typesetting subset** — SHIPPED (2026-10-03), but not as planned: the
  hand-rolled subset was replaced by real TeX through the `temml` dependency
  (see above). If it is ever revisited, the remaining gaps are inline math in
  `text` fields (today only `derivation` is a TeX field) and display-mode
  centering of a formula on its own paragraph.
- **Next up** — the thread the 2026-10-03 math cycle left named, now the only
  one left in this queue:
  1. **Inline math in prose.** `renderInline` gains `$…$` (or another delimiter)
     so a formula can live inside a `text` field, which is where an explanation
     actually talks about one. This is the one place the new boundary could
     leak: inline parsing is a second context (scriptlevel, `math-style: compact`
     by default, a delimiter that can appear literally) and the security
     reasoning from the math spec has to be re-derived for it rather than
     assumed. Its degradations ride the `warnings` channel shipped above, so a
     host's `failOnWarning` policy covers inline math with no extra wiring.
- **Diagram orientation** — recorded 2026-10-04 from a user question; split
  because the two halves have very different costs.
  - **Show `tb` (small).** `direction: "lr" | "tb"` has been in the IR schema
    (`src/core/schema.ts`) and implemented in `layoutFlow` all along, and the
    LLM contract already advertises it — but **every demo fixture declares
    `direction: "lr"`**, so nothing on any page shows a top-down diagram, and a
    host has no way to see the option works or judge when it is the better
    choice. Cheap: add a `tb` diagram beside the existing one in the `/`
    figures showcase, and a line in the README. Worth noting the `tb` path is
    *not* untrodden — the 2026-10-04 cycle extended it with `tb` back-edge
    return paths and found a tb-only bug (the return lane was offset by the
    vertical extent while travelling horizontally, so it cut through the nodes
    it exists to pass outside of), which is exactly the kind of branch that
    needs a demo to keep honest.
  - **`rl` (parked, gated on RTL text).** Right-to-left is **not** a mirror of
    `lr`, for two reasons. (1) The label gutter is `b.x - (a.x + a.w)`, which
    the 2026-10-04 cycle made *structurally* non-negative — forward edges always
    run to a strictly later rank, verified exhaustively over all 4-node graphs.
    Mirror the placement and that expression goes negative for **every** edge,
    which is precisely the defect that shredded `"miss / stale"` into
    `["miss","/","stal","e"]`; `rl` needs its own gutter derivation and loses
    the invariant that made the code simple. (2) `lr` emits arrowhead wings at
    `tx - 9`, behind the tip, so heads must flip too — including skip-rank and
    return paths. The cheap route is a post-process mirror (`x → width - x - w`
    plus head flips) rather than a third branch through placement, but it is
    still geometry and needs its own invariant tests.
    **The gating question is not "which orientations are useful" but "who
    decides".** A model choosing `rl` for one diagram in an LTR document is
    more likely a mistake than a design decision. RTL reading order is really a
    property of the *text*: if the library ever supports Arabic or Hebrew prose,
    diagram, chart and timeline should mirror *together* and `direction` should
    inherit from the document rather than be chosen per block. Take this up when
    there is a real RTL text requirement to drive it, not before.
- **Compiler v1 deferrals** (spec §9) — parallel section calls; client
  surface growth (usage reporting, abort signals, retries); caching;
  human-in-the-loop outline approval.
- **Curio Editorial Learning theme tokens** — the Stitch destination look,
  off `docs/design/stitch/*/DESIGN.md`; deliberately kept out of the
  compiler cycle. The `/editorial` showcase (shipped above) is a working
  proof of the approach — a full re-skin from host CSS alone — but it is
  demo-scoped, not a shipped theme.
- **AI-generated raster imagery** — shape **(a) SHIPPED** 2026-10-03 (see
  above): the `image` block over a host catalog. Design constraints carried
  forward from the 2026-09-30 discussion and now honored in the shipped
  contract: images enter as *references* (never bytes, never fetched at
  render, lenient salvage on broken refs); `alt` and dimensions required at
  schema level (a11y + no layout shift); "no text in image" in the prompt
  contract (labels are captions); editorial role rules in `BLOCK_TYPE_DOCS`
  (images anchor analogies and set scenes, they don't illustrate derivations).
  Still open, each its own cycle:
  - **(c) `analogy` composite block** — image + `[{ imagePart, conceptPart }]`
    rendered as a caption-side table. The novel differentiator, and it
    composes on the shipped single-image contract.
  - **(b) compiler-driven briefs** — the outline gains image briefs and a
    host-injected image client materializes them mid-compile. What would
    make the library request images rather than only place them.
  - **Step-by-step sequences** — currently N consecutive `image` blocks.
    Revisit only if a host proves N-blocks inadequate.
  - **`imageStyle` hint** — deliberately deferred: the roadmap's own analysis
    says cross-image consistency stays host-side via style templates, which
    leaves the library's hint with little to influence.
