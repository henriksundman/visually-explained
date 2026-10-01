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
  into `strict: true`.
- **SSR-safe and deterministic.** Seeded sketch randomness; stable output for
  identical input.
- **Dependency-minimal.** Runtime deps are `zod` and `roughjs`. React ≥ 18 is
  a peer dependency of `explanations/react` only.

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

`renderDocument` options (all optional):

| Option | Default | Meaning |
| --- | --- | --- |
| `theme` | `"none"` | As above; documents also carry `exp-doc` |
| `sketch` | `false` | As above |
| `strict` | `false` | Throw on document- or section-level diagnostics |
| `toc` | `true` | Emit the derived table of contents |
| `tocSticky` | `true` | `false` renders the TOC in normal flow (theme default pins it) |
| `datasets` | — | Keyed host data for blocks carrying a `dataset` key — a miss or invalid payload warns and falls back to the block's literal fields |

Both return `{ html, warnings }`. Every degraded piece appends a
`"[code] message"` string to `warnings` — surface or log them. Prefer a
pre-flight check without rendering: `validateExplanation(input)` /
`validateDocument(input)` return `{ ok, diagnostics }`.

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

## Block types

15 primitives; each block is `{ type, ...payload }`:

- **Content:** `text`, `code` (verbatim snippet, never markdown/HTML)
- **Structure:** `stack` (group of blocks, one nesting level), `step-list`
- **Pedagogy:** `concept`, `worked-example`, `derivation`, `comparison`,
  `cause-effect`, `callout`, `data-callout`
- **Visuals:** `timeline`, `diagram`, `chart`, `figure`

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
| `outline-done` | `{ title, summary?, sections, visualHints, sectionTitles }` |
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
- collections, routing, and caching of generated documents.

## Codebase map

| Path | Responsibility |
| --- | --- |
| `src/core/` | Schemas, salvage, validators, HTML renderers, LLM contract exports |
| `src/core/datasets.ts` | Dataset schemas + lenient resolver shared by the visual primitives |
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
