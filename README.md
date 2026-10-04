# explanations

LLM-generated visual explanations as styleable HTML and React.

A language model returns JSON; the library validates it against zod schemas,
salvages what it can, and renders accessible, themeable HTML — server-side or
as React server components. A built-in compiler orchestrates an LLM you supply
to turn a topic into a complete multi-section document. Model text never
becomes markup: output is always data (block IR, drawing Scene IR) validated
before it is rendered.

Principles that hold everywhere in this codebase:

- **Lenient salvage.** Invalid model output degrades (element dropped, block
  degraded, warning emitted); a render never fails on bad data unless you opt
  into `strict: true` (a malformed input) or `failOnWarning: true` (a render
  that degraded).
- **SSR-safe and deterministic.** Seeded sketch randomness; stable output for
  identical input.
- **Dependency-minimal.** Runtime deps are `zod`, `roughjs`, and `temml` (TeX →
  MathML, no fonts shipped). React ≥ 18 is a peer dependency of
  `explanations/react` only.

## Install

```bash
npm install explanations
```

| Import | Purpose |
| --- | --- |
| `explanations` | Core: schemas, validators, HTML renderers, compiler |
| `explanations/react` | React server components (peer: React ≥ 18) |
| `explanations/themes/tokens.css` | Design tokens — required for any styling |
| `explanations/themes/light.css` / `dark.css` | Full themes |

## Pipeline 1 — render IR you already have

Two shapes: a single **explanation**
(`{ version: 1, title?, summary?, blocks }`) and a **document**
(`{ version: 1, title, summary?, sections: [{ title, blocks }] }`).

### HTML

```ts
import { renderExplanation, renderDocument } from "explanations"

const { html, warnings } = renderDocument(ir, { theme: "light", sketch: true })
```

`renderExplanation` options (all optional):

| Option | Default | Meaning |
| --- | --- | --- |
| `theme` | `"none"` | Root class `exp-theme-light` / `exp-theme-dark` |
| `sketch` | `false` | Hand-drawn (rough.js) stroke pass on every figure |
| `strict` | `false` | Throw on an invalid top level instead of degrading |
| `root` | `true` | `false` emits no `.exp` wrapper — style tokens on your own element |
| `datasets` | — | Keyed host data for blocks carrying a `dataset` key — a miss or invalid payload warns and falls back to the block's literal fields |
| `images` | — | Keyed host image catalog for `image` blocks — a miss or invalid entry warns and renders the caption alone |
| `onWarning` | — | Called once with every warning from the pass (`[]` if none) — observation, never throws |
| `failOnWarning` | `false` | Throw if the pass degraded anything, carrying every warning |

`renderDocument` options (all optional):

| Option | Default | Meaning |
| --- | --- | --- |
| `theme` | `"none"` | As above; documents also carry `exp-doc` |
| `sketch` | `false` | As above |
| `strict` | `false` | Throw on document- or section-level diagnostics |
| `toc` | `true` | Emit the derived table of contents |
| `tocSticky` | `true` | `false` renders the TOC in normal flow (theme default pins it) |
| `datasets` | — | Keyed host data for blocks carrying a `dataset` key — a miss or invalid payload warns and falls back to the block's literal fields |
| `images` | — | Keyed host image catalog for `image` blocks — a miss or invalid entry warns and renders the caption alone |
| `onWarning` | — | Called once with every warning from the pass (`[]` if none) — observation, never throws |
| `failOnWarning` | `false` | Throw if the pass degraded anything, carrying every warning |

Both return `{ html, warnings }`. Every degraded piece appends a
`"[code] message"` string to `warnings` — surface or log them, or use the two
options below. Prefer a pre-flight check without rendering:
`validateExplanation(input)` / `validateDocument(input)` return
`{ ok, diagnostics }`.

### Enforcing no degradation

`strict` gates the **input**: it throws when the IR fails validation, before any
block renders. It cannot fire on a degradation, because nearly every
degradation here happens at render time — a missing dataset key, an
unresolvable image, TeX that does not parse.

`failOnWarning` gates the **output**. It throws after rendering, carrying every
warning rather than only the first:

```ts
const { html } = renderDocument(ir, { failOnWarning: true }) // throws if anything degraded
```

It counts lenient-validation diagnostics too — a silently dropped section is a
degradation. `onWarning` is the observational counterpart, called once per
render pass with the full set, for hosts that would rather log than throw:

```ts
renderDocument(ir, { onWarning: w => report(w) })
```

The thrown message is bounded (120 chars per warning, 10 shown); the array you
receive is always complete.

**In React**, warnings reach `onWarning` too — previously they were discarded
entirely, so a degradation was invisible. Note that StrictMode double-invokes
renders in development, so the same set may arrive twice; dedupe by set
membership or rely on `failOnWarning`.

### React

```tsx
import { Explanation, Document } from "explanations/react"

<Document ir={doc} theme="light" />
```

- Server components: no hooks, no client JS by default (RSC-safe in Next.js).
- `theme` defaults to `"light"` here (the core renderers default to `"none"`).
- `<Explanation ir={ir} interactive>` routes `figure` blocks through the
  client runtime (sliders bound to params + play sweep) — opt-in per instance.
- `<Explanation ir={ir} onElementEvent={fn}>` enables hover/click on
  identified figure elements, with a built-in popover
  (`useElementPopover`, `FigureElementEvent` are exported for custom hosts).
- `<Explanation ir={ir} components={{ callout: MyCallout }}>` swaps a custom
  renderer for any registered block type.
- `<Document ir={doc}>` accepts the same `strict` / `toc` / `tocSticky` /
  `sketch` options as `renderDocument`.
- Both components accept `onWarning` / `failOnWarning` as described above, and
  report the same warning set as the string renderers for the same IR.

## Block types

18 primitives; each block is `{ type, ...payload }`:

- **Content:** `text`, `code` (verbatim snippet, never markdown/HTML)
- **Structure:** `stack` (group of blocks, one nesting level), `step-list`
- **Pedagogy:** `concept`, `worked-example`, `derivation`, `comparison`,
  `cause-effect`, `callout`, `data-callout`, `sources`, `quiz` (multiple
  choice with per-option `why` feedback; static `<details>` check reveal, or
  click-graded under `<Explanation interactive>`)
- **Visuals:** `timeline`, `diagram`, `chart`, `figure`, `image` (one image from
  the host catalog, by key)

Host data, not model guesses: `chart`, `data-callout`, and `timeline` accept
`dataset: "<key>"`. At render time the key is looked up in the `datasets`
option and the validated payload's fields override the block's literals
(omitted fields keep the literal). A missing key or invalid payload warns and
renders the literal fields — never a failed render. Payload schemas are
exported for pre-validation: `chartDatasetSchema`, `dataCalloutDatasetSchema`,
`timelineDatasetSchema`.

```ts
renderDocument(ir, { datasets: { "weekly-deploys": { kind: "bar", unit: "deploys", points: [...] } } })
```

### Images

The `image` block renders one picture from a host-supplied catalog, referenced
by key. Images enter as **references only** — never bytes, never a fetch, never
base64 — so a document stays diffable and rendering stays offline-safe:

```ts
const ir = { version: 1, blocks: [{ type: "image", image: "signal-station", caption: "Rush hour." }] }
const images = {
  "signal-station": {
    src: "https://cdn.example.com/signal-station.png",
    alt: "A railway platform under a signal gantry",
    width: 800,
    height: 600,
    subject: "a train platform under a signal gantry",
  },
}
renderDocument({ version: 1, title: "D", sections: [{ title: "S", blocks: ir.blocks }] }, { images })
```

`alt`, `width`, and `height` are **required** — that is what makes an
accessible image and a layout-shift-free document unrepresentable rather than
merely discouraged. `subject` is a word-for-the-prompt-menu description and is
never rendered.

**The host owns `alt`, not the model.** The compiler's `LlmClient` is
text-in/text-out, so a model-authored alt would be a description of a picture
it never saw. The model may write `caption`, which is prose about the concept.

A miss or invalid entry degrades to the caption with a warning: never a broken
`<img>`, and never the catalog key — that identifier is host-internal. With no
caption either, nothing renders and the warning still fires. `imageRefSchema`
is exported for pre-validation.

Pass the same object as `compileDocument({ images })` to let the compiler place
images: the outline sees the key and subject of each and may mark a section,
and the section prompt pins one image block for it. Images anchor analogies and
set scenes; they never illustrate a derivation.

> **Upgrade note:** adding the `image` block type adds one line to the block-type
> contract, so the compile *system* prompt changes for every host on upgrade,
> catalog or not. No flag can prevent this — the contract is interpolated
> unconditionally, and a test pins every registered type into it. The *user*
> prompts stay byte-identical when no catalog is passed.

### Math

In a `derivation`, `expression` and `conclusion` are **TeX**, not prose. They
compile to MathML via [temml](https://github.com/temml-org/temml) and inherit
the surrounding font and color, so a formula themes through tokens like
everything else and no math font files ship:

```ts
const ir = {
  version: 1,
  blocks: [{
    type: "derivation",
    steps: [{ expression: String.raw`\frac{3}{1/2}`, note: "Split the division." }],
    conclusion: String.raw`\frac{3}{1/2} = 6`,
  }],
}
```

No `$` delimiters and no wrapping — the field is TeX and spans its whole line.
`note` stays prose. Prefer a single level: `\frac{3}{1/2}` reads faster than
`\frac{3}{\frac{1}{2}}`, and a nested fraction shrinks at every level.

The engine is behind one boundary (`renderMath` in `src/core/math.ts`), but it
is deliberately **not** exported from the package: the TeX surface is what
`derivation` promises, not a general LaTeX API. Temml *throws* on the markup-
producing commands (`\href`, `\url`, `\includegraphics`, `\htmlClass`,
`\htmlId`), which is stronger than KaTeX's `trust: false` — those constructs
cannot reach the output at all. `\text{…}` is escaped text, not HTML.

Unparseable TeX degrades to the literal source in `<code class="exp-math-literal">`
with a `[math]` warning — never a failed render. To see both engines side by
side, run the demo and open `/math`.

> **Upgrade note:** `conclusion` used to be free text and is now TeX, so a
> document whose conclusion contains a bare `&` or an unpaired `_` will
> **degrade visibly after upgrade** — it renders as the literal source in the
> warning color instead of as intended math. `expression` and `note` are
> unchanged in shape. No flag can prevent this.

Exact payloads are documented in `BLOCK_TYPE_DOCS` — the same string the LLM
prompts interpolate, so it never drifts:

```ts
import { BLOCK_TYPE_DOCS } from "explanations"
```

Inline emphasis only: `**bold**`, `*italic*`, `` `code` ``, `[text](url)` —
links are scheme-gated to http(s), `mailto:`, and `#anchors`; anything else
degrades to literal text. No HTML in any
field.

## Figures

A `figure` block draws a bespoke figure on a 360×240 canvas from Scene
elements (`path`, `curve`, `arc`, `box`, `line`, `dot`, `label`, `group`) with `params`, `derived` expression chains, and `{{expr}}` slots
inside path data. Static SVG at the initial param values is the SSR default;
the interactive runtime is the React opt-in above.

Leaf elements accept `id` and `tip` (hover text); the SVG carries
`data-el-id` / `data-tip`. In React, pass `onElementEvent` to receive
hover/click events with the built-in popover.

A `diagram` block names nodes and edges and lets the renderer place them. Set
`direction: "tb"` to flow top-to-bottom instead of the default `"lr"`. If
the graph contains a cycle — a feedback loop like "revalidate → cache" — the
layout breaks that cycle for ranking purposes and draws the closing edge as a
return path around the outside, so a loop stays as compact as an acyclic
graph instead of expanding into ranks that are empty but still consume width.
Figures scale to their container via `viewBox`, so an over-wide scene shrinks
its own labels; keeping the scene honest is what keeps text legible.

## Themes

```ts
import "explanations/themes/tokens.css"
import "explanations/themes/light.css" // or dark.css
```

- Styling scopes off the renderer's root class: `.exp` (plus
  `.exp-theme-light` / `.exp-theme-dark`, `.exp-sketch`); documents add
  `.exp-doc`.
- The document TOC (`.exp-doc-toc`) pins itself as a compact right-hand card
  by default; `tocSticky: false` opts out per instance
  (`.exp-doc-toc-inline`).
- Scroll-spy is host-side: the theme styles `aria-current="true"` on
  `.exp-doc-toc-list a` — run your own observer (the demo pages ship a
  ~15-line IntersectionObserver example) and the active treatment is free.

## Pipeline 2 — compile a topic into a document

`compileDocument(topic, opts)` runs an outline call, then one call per
section with bounded schema repair, and returns
`{ document, events, warnings }`.

```ts
import { compileDocument, type LlmClient } from "explanations"

const client: LlmClient = async ({ system, user }) => myLlm.complete({ system, user })

const { document, events, warnings } = await compileDocument("How Fourier series work", {
  client,
  guidance: "Audience: curious programmers. Keep the math light.",
  maxSections: 8, // default 12
  maxRepairs: 2,  // default 2
  checks: true,   // retrieval checks (off by default)
})
```

The one LLM surface the library knows — provider-agnostic, JSON mode not
required (the compiler owns extraction, validation, and repair):

```ts
type LlmClient = (req: { system: string; user: string }) => Promise<string>
```

Failure semantics:

- Outline still invalid after `maxRepairs` → **throws** (nothing to salvage
  from a document without an outline).
- A section still invalid after `maxRepairs` → **dropped** with a
  `[compile] section N dropped — …` warning; the document assembles from the
  survivors. One bad section never fails a compile.
- `document` is document-IR data — run `validateDocument` before rendering.

Events — one entry per notable step, in this order
(`outline-start` → `outline-done` → per section:
`section-start` → zero or more `repair-attempt` → `section-done` |
`section-failed`):

| `kind` | Payload |
| --- | --- |
| `outline-start` | `{ topic }` |
| `outline-done` | `{ title, summary?, sections, visualHints, sectionTitles, checks? }` |
| `section-start` | `{ index, title }` |
| `section-done` | `{ index, title, blocks: Block[] }` |
| `section-failed` | `{ index, title }` |
| `repair-attempt` | `{ stage: "outline" \| "section", index?, attempt, issues }` |
| `compile-done` | `{ document, warnings }` — terminal, stream API only |

`index` is absent on outline-stage `repair-attempt` events. Events resolve
with the result — or stream live via `compileDocumentStream` (below).
`CompileEvent` carries open extra
fields; `CompileResult.document` is typed `unknown` but contract-locked to
`documentSchema` in tests — validate at your boundary.

### Streaming

`compileDocumentStream` yields the same events live as an async generator,
plus a terminal `compile-done` carrying `{ document, warnings }`:

```ts
import { compileDocumentStream } from "explanations"

for await (const event of compileDocumentStream("How Fourier series work", { client })) {
  if (event.kind === "outline-done") renderShell(event.title, event.summary, event.sectionTitles)
  if (event.kind === "section-done") appendSection(event.title, event.blocks)
  if (event.kind === "compile-done") finish(event.document, event.warnings)
}
```

`outline-done` additionally carries `summary` and the clamped
`sectionTitles` — the shell always matches the final document — and
`section-done` carries the section's `blocks` array for live appending.
Both APIs emit from one code path; `compileDocument` is a drain of the
stream. Outline exhaustion still throws through `for await`.

Abandonment: `break` stops event delivery immediately and no further LLM
calls are started, but the in-flight call still completes in the background
and its result is discarded. For true cancellation, wrap your own
`LlmClient` with an abort signal.

### Grounded compiles

Pass host-supplied source excerpts and the compiler grounds the document in
them: excerpt text is interpolated into the section prompts, the model is
taught the citation contract, and a `sources` block is appended to the last
surviving section automatically:

```ts
const { document, warnings } = await compileDocument("How Fourier series work", {
  client,
  sources: [
    { id: "fourier-notes", title: "Lecture notes", text: "A Fourier series…", url: "https://…" },
    { id: "worked-examples", title: "Worked examples", text: "Example 1: a square wave…" },
  ],
})
```

Chunking is host-side (`text` is 1–2000 chars, interpolated verbatim — treat
excerpts with the same trust you give `guidance`; model output is
schema-validated and escaped either way). The outline prompt sees
ids/titles/urls only; section prompts see the excerpt text plus the citation
contract (`[label](#source-<id>)`, or `[label](url)` when the source has one).

Grounding is constrained, not enforced — the compiler audits and warns, it
never drops or rewrites content:

| Warning | Meaning |
| --- | --- |
| `[grounding] source N dropped — <issue>` | Excerpt failed validation (id/title/text/url bounds, non-http(s) url) or the 24-source cap |
| `[grounding] duplicate source id "x" dropped` | Duplicate ids — first wins |
| `[grounding] section N cites unknown source "x"` | Citation anchor matching no excerpt (dead link) |
| `[grounding] source "x" never cited` | Validated excerpt the model never used |
| `[grounding] sources block not appended — no surviving section` | Every section was dropped |

Absent `sources`, compiles are byte-identical to ungrounded ones.

### Retrieval checks

With `checks: true`, the outline may mark sections where a retrieval check
consolidates the learning, and those section prompts are told to close with
exactly one `quiz`. The plan surfaces as `checks: <count>` on `outline-done`;
a declared section whose reply places no quiz warns
`[checks] section N declared a check but placed no quiz`. Off by default —
absent the flag, compiles are byte-identical to unflagged ones. Quiz
citations participate in the grounding audit like any other block, and a quiz
nested in a `stack` still satisfies its declaration.

## Authoring prompts yourself

If you prompt the LLM directly instead of using the compiler, ship the tested
contract with your request:

- `systemPromptSnippet` / `documentSystemPromptSnippet` — instruction blocks
  to paste into your system prompt.
- `explanationJsonSchema` / `documentJsonSchema` — JSON Schema for
  structured-output / tool-calling modes.
- `BLOCK_TYPE_DOCS` — the canonical block-type documentation.

All exported from the package root.

## What the host supplies

The library deliberately leaves to the embedding application:

- the LLM client and API keys (`LlmClient` is injected);
- page scripts such as scroll-spy;
- progress/streaming UI built on compile events;
- collections, routing, and caching of generated documents;
- link opening behavior — the library emits plain `<a href>` (no `target`/
  `rel`). To open external links in a new tab, add a delegated listener
  host-side (scope it however you like):

  ```js
  document.addEventListener("click", e => {
    const a = e.target.closest('.exp a[href^="http"]')
    if (a) window.open(a.href, "_blank", "noopener")
  })
  ```

## Codebase map

| Path | Responsibility |
| --- | --- |
| `src/core/` | Schemas, salvage, validators, HTML renderers, LLM contract exports |
| `src/core/datasets.ts` | Dataset schemas + lenient resolver shared by the visual primitives |
| `src/core/images.ts` | Image catalog entry schema + lenient resolver for `image` blocks |
| `src/primitives/` | One file per block type, wired via `registerPrimitive` |
| `src/figures/` | Scene IR → SVG: diagram/chart/timeline layout, expression evaluator, path grammar, rough.js sketch pass, authored figures |
| `src/react/` | RSC components, interactive figure runtime, element events/popover |
| `src/compiler/` | `compileDocument` + `compileDocumentStream`: prompts, JSON extraction, repair, events |
| `demo/` | Static server over `dist/` — all examples, `/document`, `/interactive`, `/compile` (stub client, streamed live) |

Docs: `docs/ROADMAP.md` (the arc and binding decisions);
`docs/superpowers/specs/` (one design spec per shipped feature);
`docs/superpowers/plans/` (implementation plans).

Development:

- `npm test` — vitest; compiler tests use fake `LlmClient`s, no network.
- `npm run typecheck` — `tsc --noEmit`.
- `npm run build` — tsup, then copies theme CSS into `dist/themes/`.
- `npm run demo` — builds, then serves on port 4173; build first or routes
  404, and restart a long-lived server after rebuilds.
