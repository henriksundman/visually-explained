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

- **Prose that belongs to a picture** (2026-10-05) — the `image` block's
  optional `body`, capped at 1200 chars, rendered in a column beside the image.
  The measured gap: `caption` was the block's *only* text field and capped at
  300 chars, so any longer explanation had to be a sibling `text` block, and
  the picture and its explanation landed as two separate full-width objects.
  One optional field fixes that without a new block type, so the primitive count
  stays at 19 and a `body`-less block renders **byte-identically to `main`**
  (pinned by a unit-level twin of the corpus diff). Two decisions worth keeping:
  the layout is a **flex row whose bases are the breakpoint**, so it responds to
  the width of the *block* rather than the viewport and `tokens.css` gains no
  layout `@media` convention; and a missed image **drops the dashed
  `exp-image-missing` box** when a body is present, because a "this is broken"
  border wrapped around the reader's own legitimate prose is noise — the
  `[image]` warning is the channel a degradation is supposed to be loud on, and
  the prose now survives the failure as an ordinary paragraph. Browser-measured
  at four widths: two columns above ~524px of column, stacked below, and
  **human-judged 2026-10-05** — the 38/62 split reads correctly, so it is
  settled by eye like the math size (thread 3) rather than left a guess
  (open thread 18). Spec:
  `docs/superpowers/specs/2026-10-05-image-body-design.md`.

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

- **Diagram orientation + intrinsic figure sizing** (2026-10-04) — `tb` shown
  on `/` for the first time (every fixture had pinned `direction: "lr"`, so the
  option existed in the schema, the renderer and the LLM contract but was
  invisible). Adding the demo surfaced two real `tb` bugs, both from one
  conflation: same-rank siblings were spaced by node *height* on the
  horizontal axis, so boxes overlapped, and `tb`'s scene width came from a sum
  of heights rather than the rightmost edge, clipping wide nodes. Also fixed
  the emit layer: `.exp-figure` was `width: 100%` with no intrinsic size, so a
  tall narrow `tb` figure scaled *up* to 26px labels filling 1753px of vertical
  space. The SVG now emits `width`/`height` and the rule is `max-width: 100%`,
  so scaling responds to overflow rather than applying in both directions.
  Verified in Chrome across `/`, `/document` and `/interactive`: every figure
  renders 1:1 at 13px unless it is genuinely wider than the column, and **zero
  figures overflow**. Rendered-output diff against b1a1f39: the only change
  anywhere is two attributes per `<svg>` plus the two new demo blocks — proven
  by stripping exactly those and re-comparing byte-for-byte. Three `tb` rough
  edges remain (skip-rank edges route down the source column and overprint;
  edge labels sit at the source column centre so two labelled edges from one
  node collide) and are recorded in the Backlog with the demo fixture shaped
  to avoid them — noted in a comment so the demo cannot hide them again.

- **Mind map** — **SHIPPED** 2026-10-04. `mind-map` block: what nests inside
  what, drawn as a horizontal dendrogram. Spec:
  `docs/superpowers/specs/2026-10-04-mind-map-design.md`.
  - The job is **containment**, not sequence — chosen because `layoutFlow`
    measurably misplaces the same tree (children centred on their own boxes
    rather than their subtree extents, off by 162px), which is what a
    dendrogram has to get right and a flowchart does not.
  - The IR is a **nested** tree, so cycles and orphans are unrepresentable
    rather than merely rejected: there is no `id` to dangle and no back-edge
    to close. A flat `nodes`+`edges` IR would have needed cycle detection.
  - The schema is an **explicitly unrolled 12-level ladder**, not
    `z.lazy()`. A lazy schema re-enters the parser per input level, so a deep
    tree overflows the stack; `safeParse` throws `RangeError` and does not
    catch it, `salvage.ts` calls `safeParse` with no `try/catch`, and the
    exception escapes `renderExplanation` entirely. Same failure shape as the
    Temml `TypeError` found in the math cycle.
  - Two depths, deliberately unequal: the **schema** guards against crashing
    (12), the **renderer** guards against illegibility (5). A 6-deep tree is
    valid but unreadable, so it degrades to a nested list and says so rather
    than being dropped as an invalid block.
  - Width is a function of **depth**, not label length — node labels wrap at
    176px, one column per level — so three 400-character labels measure 314px
    and fit. The measured width check is the guard that matters; node count
    alone is how a long-label timeline once overlapped its own labels.
  - **Interactivity deferred**: the design chose static output, so a collapsing
    node is future work rather than a half-built control.
- **One hover surface per figure** (2026-10-05) — a figure `<svg>` carried its
  accessible name **twice**, as `aria-label` and as a `<title>` element emitted
  from the same variable on the adjacent line. `<title>` is a user-agent
  tooltip, so every figure showed one per *figure*, identical over every node;
  on a mind map it was the whole tree linearised into a single sentence, which
  is the mess that prompted the change. Suppressed, and it is **free**: for
  `role="img"` the accessible name is computed from `aria-label`, with
  `<title>` only a fallback, and `ariaLabel` is a *required* `SceneSvgOptions`
  field emitted with no conditional between the two — so no input reaches the
  `<title>` without the `aria-label` beside it. No opt-in flag was added to
  restore it; a switch for reinstating what was just removed is speculative,
  and a host that wants a tooltip can add one in host CSS.
  The complementary surface is now **reachable**: `.exp-popover` mounts only
  when a host passes `onElementEvent`, and no demo route did, so the per-node
  detail was inspectable only by writing a host app. `/interactive` now passes
  it and carries a `mindMapIr` section. The two surfaces were never redundant —
  whole-figure summary vs per-element detail — so this was a choice of which
  one the *pointer* shows, not a merge. Verified by rendered-output diff (15
  `<title>` elements removed, 0 remaining, no other change, and stripping them
  restores the baseline byte-for-byte) and in Chrome on the real route.
  Spec: `docs/superpowers/specs/2026-10-05-figure-hover-surfaces-design.md`.
- **The React warning surface closed** (2026-10-05) — `Quiz`, `InteractiveFigure`
  and `ElementPopover` reported **no** degradations, so the enforceable
  no-degradation policy shipped the day before was silently defeated on all
  three. Measured: an unparseable formula in a quiz question rendered
  **byte-identical** HTML with and without a sink, so the degradation was
  invisible in the DOM, to diffing and to `onWarning`, and `failOnWarning` did
  **not** throw. The fix is neither a prop nor an effect but a **synchronous
  pre-pass**: `Explanation` runs the same `renderBlock` the static path runs,
  inside its own body, keeping the warnings and discarding the HTML. That is
  forced by a measured fact — **a child component's side effects land after the
  parent's body has run**, so threading the shared array into `Quiz` reported
  nothing while `Quiz` given that array directly reported perfectly. An effect
  was rejected on measurement too: effects do not run under
  `renderToStaticMarkup`, so `onWarning` would stop firing under SSR.
  `InteractiveFigure` and `Quiz` needed **no changes at all** — `renderFigure`
  already sinks the title and caption, and the React component was duplicating
  that prose solely to make it interactive. `PopoverDiv` keeps its own `onWarning`
  (a tip has no static render pass) and deliberately has **no** `failOnWarning`,
  because it mounts from a hover and throwing would tear down the figure the
  reader is looking at. One test now asserts React's reported set **equals** the
  string renderer's across every surface, comparing sorted sets rather than
  counts — count-only comparison is what passed in the math cycle while React
  reported 1 where the string renderer reported 4. Rendered output is
  **byte-identical** to before: this cycle changes what is reported, never what
  is rendered. Spec:
  `docs/superpowers/specs/2026-10-05-react-warning-surface-design.md`.

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

### Integration: a "visual explanation mode" in a learning app (Luma)

Recorded 2026-10-05. **All Luma-side facts below are second-hand**, read off
that repo by its own agent; none is verified from here, so treat the file
references as leads rather than as confirmed measurements. The library-side
facts marked "measured" were checked in this repo.

**Intent, as clarified after the first analysis was written:** this is for a
**new mode built from scratch**, not a replacement of the existing lesson
viewer. That distinction changes the conclusion, and the earlier version of
this entry — written for a viewer-replacement integration — was wrong about the
one thing it called the blocker.

**What Luma is, per its agent.** Its own in-repo IR (`LessonBlock`, 9 types:
heading | paragraph | example | practice | project_step | recap | code |
math | diagram), its own renderer described as "a dumb full-width flow" of
per-block `<section>` elements. Its LLM returns the whole `blocks` array in one
JSON response against an app-controlled type enum, then the app re-validates
and rewrites every block (`normalizeBlock`), with a structural-rejection retry
round-trip. Its diagram pipeline is fenced **mermaid**, auto-promoted to
diagram blocks. Blocks carry **no ids**, and its server-side whitelist
explicitly *rejects* unknown keys, `id` included.

**The reframe.** For a greenfield mode the integration cost is near zero — no
IR mapping, no rewrite, no 9-to-19 vocabulary translation. Two consequences:

- **`heading` drops from blocker to nice-to-have.** It was blocking only
  because a heading cannot be expressed inside a linear block flow, which
  matters when mapping into an *existing* linear IR. Greenfield can use
  `sections[].title`, which renders as `<h2>` (`renderDocument.ts:168`).
  Still worth having for breaking up a long explanation — measured: this
  library emits no heading element of its own; the only ones are that `<h2>`
  and a figure's `<h4>`.
- **`compileDocument` comes back into scope.** Under a viewer replacement the
  advice was "adopt the renderer, keep Luma's generator" — its generation
  pipeline was working and tuned. For a new mode there is no such pipeline to
  keep, and authoring figures, diagrams, quizzes and timelines is precisely
  what Luma's generator cannot do. Both pipelines are usable.

**Gaps that survive the reframe, measured here:** no mermaid support anywhere
(zero hits in `src/`, README, ROADMAP — and it should stay that way; parsing a
text DSL at render time would break the pure-function-of-IR property). Luma
already owns a mermaid→structured-blocks converter, so the question to ask it
is whether its output shape matches `diagram`'s
`{nodes:[{id,label,shape?}], edges:[{from,to,label?,kind?}]}` — which is what
that kind of conversion naturally produces, so they may already be close. And
`renderText` emits a **single** `<p>`, so a body containing blank lines renders
as one run-on paragraph; fine if their paragraphs are single-paragraph, worth
confirming.

**The load-bearing unknown, and it is not a gap.** Nobody has run this
compiler on real course topics and looked at what comes out. Every
recommendation above is about what Luma *can* express; none of it says whether
`compileDocument` produces an explanation anyone would want to read. For a mode
whose entire premise is "type a topic, get a good visual explanation," that is
the question worth answering before more cycles are spent — and it is
answerable without writing any code.

**Also recorded, since it becomes live on adoption:** mapping a `math` block
onto `derivation` puts LLM-authored content in a TeX field, which is exactly
open thread 2's trap — prose is valid TeX, so an English sentence renders as
one `<mi>` per letter with **zero warnings**.

### Candidates

- **Drag-to-vary simulations** — SHIPPED (see above). Remaining: groups carry no
  identity so they cannot be grabbed, and there is no multi-touch, snapping or
  undo. Any of those is its own cycle.
- **Math typesetting subset** — SHIPPED (2026-10-03), but not as planned: the
  hand-rolled subset was replaced by real TeX through the `temml` dependency
  (see above). Inline math in prose followed on 2026-10-04 (see "Inline math
  in prose" below). The one remaining gap is display-mode centering of a
  formula on its own paragraph.
- **Inline math in prose** — **SHIPPED** 2026-10-04. `renderInline` is the
  chokepoint for every model prose field, so this reached all 40 of them from
  one implementation. The delimiter turned out to be the whole design:
  - **The `$…$` collision is real and silent.** Probing Temml with real prose,
    "It costs $5 and returns $10" captures " and returns", which parses
    cleanly as four `<mi>` and emits **zero warnings**. Open thread 2 already
    records that prose is valid TeX, so the `not TeX` degradation
    structurally cannot catch it — a naive dollar scanner is a
    silent-corruption engine, and its output looks deliberate.
  - **`\(…\)` is honored unconditionally**; backslash-paren does not occur in
    prose. `$…$` must clear Pandoc's two delimiter rules plus a plausibility
    check (a strong TeX signal, or a tight whitespace-free expression with a
    letter). Anything that fails is left as literal text, byte-identical to
    the pre-math output, so a false negative is the status quo rather than a
    degradation. Accepted false negatives: `$a + b$`, `$5$`. **No `\$`
    escape** — the gate makes it unnecessary and it would collide with Windows
    paths.
  - Measured before designing: 27/27 scanner cases behave as specified, and
    **0 of the 410 strings** in the demo/README/ROADMAP corpus become math.
  - **Math is substituted as a placeholder**, not by splitting prose into
    fragments, so emphasis and links pair across a math boundary. A math
    candidate inside a link *target* is skipped, because `safeHref` strips the
    placeholder's NUL and would emit a silently corrupted href.
  - Unparseable math degrades to **its own source text** plus a `[math]`
    warning, riding the `warnings` channel, so `failOnWarning` gates it with no
    extra wiring. Inline math renders at 1em / `math-style: compact` under
    `.exp-math-inline`, which settles open thread 3's size question.
  - Found on the way: Temml throws a **TypeError**, not a `ParseError`, on a
    dangling super/subscript (`x^`, `x_`, `^`, `_`, `x^{^{^}}`, `x^&`,
    `x_^{\`). `mathOrLiteral` narrowed to `MathParseError` and rethrew the
    rest, so a `derivation` step of `x^` **crashed the whole render pass** —
    a shipped bug, now degrading.
- **Next up** — the queue is empty. Candidates, none committed:
  - ~~Display-mode centering~~ — **DROPPED 2026-10-05.** It was one line written
    while surveying gaps after Temml replaced the hand-rolled subset
    (`7b4ca17`), never discussed and never seen by anyone. Measured before
    dropping: **there is no display-mode path in this library.** A `derivation`
    step is a formula chip plus its note sharing one left edge
    (both at `left: 92px`, which is deliberate), and the formula measures
    **43px inside a 702px step** — so `margin: 0 auto` computes to `0px` and
    nothing moves. Centring would maroon a 43px chip mid-row with its note
    stranded left beneath it. Nothing in the demo dislikes the current layout;
    the item survived only because it was written down.
  - **A host switch to disable inline math.** `renderInline` is public and
    deliberately un-decorated; a host whose prose is full of `$` may want the
    old behaviour. Not added without being asked for.
- **Diagram orientation** — recorded 2026-10-04 from a user question; split
  because the two halves have very different costs.
  - **Show `tb`** — **SHIPPED** 2026-10-04. `direction: "lr" | "tb"` was
    already in the IR schema, implemented in `layoutFlow`, and advertised in
    the LLM contract; what was missing was that every demo fixture declared
    `"lr"`, so nothing showed a top-down diagram. Adding one exposed that `tb`
    had **two real bugs and three rough edges**, all pre-existing and all
    invisible precisely because nothing exercised it:
    - **Fixed.** Same-rank siblings were spaced by node *height* on what is
      the horizontal axis, so a 129px and a 144px box landed 72px apart and
      **overlapped**; and `tb`'s scene *width* was derived from a sum of node
      heights rather than the rightmost edge, clipping a 227px box inside a
      240-unit viewBox. One line fixed both.
    - **Fixed.** `.exp-figure` was `width: 100%` with no intrinsic size, so a
      tall narrow `tb` figure was stretched *up* — 26px labels filling 1753px
      of vertical space. The SVG now emits `width`/`height` and the rule is
      `max-width: 100%`, so scaling responds to overflow instead of applying
      in both directions at once.
    - **Still rough, recorded not hidden.** A skip-rank edge routes down the
      **source column**, where it overprints an adjacent edge; and an edge
      label is placed at the source column centre, so two labelled edges out
      of one node land on the **same point** and a label can sit on a sibling
      edge. The demo fixture is shaped to avoid both (all edges
      rank-adjacent, one labelled edge per source) and says so in a comment —
      a demo that silently dodged these would have hidden them again.
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
  - ~~**(c) `analogy` composite block**~~ — **RETIRED 2026-10-05**, measured, not
    deferred. It was proposed as image + `[{ imagePart, conceptPart }]` in a
    caption-side table, and described here as "the novel differentiator". Two
    measurements dissolve it. First, a part-mapping table is *one presentation
    of prose that belongs to an image*; a procedure with three pictures and a
    concept explained by one want the same thing under other names, so naming
    one of them produced a type the other two could not use. Second, and
    decisively, its central field had **no honest author**: `imagePart` asks
    the model to name parts of an image it has never seen — the same failure
    the "host owns `alt`" rule exists to prevent — and a host running an image
    model holds the *prompt*, not the picture. The general need behind it
    shipped instead as the `image` block's optional `body` (Shipped, above),
    which is the layout version of the same idea and needs no new type.
  - **(b) compiler-driven briefs** — the outline gains image briefs and a
    host-injected image client materializes them mid-compile. What would
    make the library request images rather than only place them. Distinct from
    everything above: it moves *generation* into the compile loop, where (a)
    and `body` only ever place images the host already has.
  - ~~**Step-by-step sequences**~~ — **ANSWERED 2026-10-05.** The open question
    was whether "currently N consecutive `image` blocks" is good enough for a
    generated step-by-step. It is: a run of images with their own prose is just
    consecutive blocks each carrying a `body`, already in order in `blocks`, and
    the demo shows two side by side. There was never anything to group, so no
    sequence type was needed. Revisit only if a host proves consecutive blocks
    inadequate for something other than ordering.
  - **`imageStyle` hint** — deliberately deferred: the roadmap's own analysis
    says cross-image consistency stays host-side via style templates, which
    leaves the library's hint with little to influence.
