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

### Consuming locally (file: install)

Instead of `npm install explanations` (the package is not on a registry),
publishing later is the plan but for now the host can point at this directory
directly:

```bash
# from the HOST app's directory — the sibling repo, wherever it lives
npm install ../explanations
```

npm symlinks (not copies) this directory into the host's `node_modules`, so
imports are `explanations` as usual. The host consumes **`dist/`, the built
package — not `src/`** — so after changing this library, run `npm run build`
here; the host picks the new build up immediately with no reinstall. While
iterating on both sides at once, `npx tsup --watch` in this repo keeps `dist/`
fresh. Two things the host needs: its own `react` ≥ 18 (peer dependency), and
the tokens CSS imported exactly once alongside the render calls.

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
entirely, so a degradation was invisible. Every surface now reports: a `quiz`,
an interactive `figure`'s title and caption, and a popover tip all reach the
same array the host already receives, and the reported set **equals** what the
string renderers produce for the same IR. Note that StrictMode double-invokes
renders in development, so the same set may arrive twice; dedupe by set
membership or rely on `failOnWarning`.

`PopoverDiv` (the `.exp-popover` element) takes its own `onWarning` and has no
`failOnWarning` counterpart: a tip is rendered at hover time rather than during
a render pass, and throwing there would tear down the figure the reader is
looking at. It reports when the popover opens.

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
  The popover is the per-element hover surface and needs this prop: it is not
  mounted otherwise. It opens on pointer hover and on keyboard focus (focusable
  elements are the ones carrying a `tip`), but reports only `hover` and `click`
  events — there is no `"focus"` kind in `FigureElementEvent`. Demonstrated on
  the demo's `/interactive` route.
- `<Explanation ir={ir} components={{ callout: MyCallout }}>` swaps a custom
  renderer for any registered block type.
- `<Document ir={doc}>` accepts the same `strict` / `toc` / `tocSticky` /
  `sketch` options as `renderDocument`.
- Both components accept `onWarning` / `failOnWarning` as described above, and
  report the same warning set as the string renderers for the same IR.

## Compatibility

**Pre-1.0.** This package is `0.1.0`, **not published**, and has no CHANGELOG.
Treat the version number as a signal to *pin exactly*, not as a compatibility
guarantee: there is no published artifact to diff against, so an upgrade is
something you verify, not something you can assume.

What upgrading can and cannot break, measured against the built package and
pinned by `tests/compat.test.ts`:

| Change | Effect on an existing host |
| --- | --- |
| **Optional field added** to a known block | **Safe.** Unknown keys are stripped silently — no warning, and `strict` and `failOnWarning` are both unaffected |
| **New block type added** | **Breaking.** Older renders degrade it to a labelled fallback chip and emit `[unknown-type]` — so any host running `failOnWarning: true` will **throw**. Lenient hosts keep rendering, minus that block's content |
| **IR `version` bumped** | **Breaking.** Emits `[wrong-version]`; `failOnWarning: true` throws |
| **Required field added** to a known block | **Breaking, and silently lossy.** Existing IR that omits it fails validation: the block is **dropped from the page** with an `[invalid-block]` warning, so `failOnWarning` throws — but under the default lenient options the reader simply sees the block missing |
| **Rendered markup of an existing block changed** | **Cosmetic.** No warning fires, so `failOnWarning` will *not* catch it |

The row that matters most: **adding a block type is a breaking change**, and
the failure is a thrown error rather than a visual difference. That is the
intended design — an unknown type must not render as a plausible-looking wrong
thing — but it means a type addition needs a major bump, or a host-side
allowlist.

Two consequences for hosts:

- **Pin the exact version.** Do not float on `^0.1.0` if you run
  `failOnWarning`.
- **Read the version's block-type list before upgrading.** `BLOCK_TYPE_DOCS` is
  the canonical list, so the diff of that string *is* the breaking-change diff:

  ```ts
  import { BLOCK_TYPE_DOCS } from "explanations"
  ```

> **The package root re-exports internals.** `src/index.ts` does
> `export * from "./core/schema"`, `./core/inline`, `./compiler/prompts` and 15
> more, so those modules are reachable public surface: an internal refactor is
> a silent breaking change with nothing signalling it. Import from
> `explanations` (the documented entry points) rather than reaching for a deep
> path. Making the surface explicit in `exports` is the intended fix — see
> `docs/OPEN_THREADS.md` thread 20.

## Block types

20 primitives; each block is `{ type, ...payload }`:

- **Content:** `text`, `code` (verbatim snippet, never markdown/HTML)
- **Structure:** `heading` (a subheading inside a section), `stack` (group of
  blocks, one nesting level), `step-list`
- **Pedagogy:** `concept`, `worked-example`, `derivation`, `comparison`,
  `cause-effect`, `callout`, `data-callout`, `sources`, `quiz` (multiple
  choice with per-option `why` feedback; static `<details>` check reveal, or
  click-graded under `<Explanation interactive>`)
- **Visuals:** `timeline`, `mind-map`, `diagram`, `chart`, `figure`, `image`
  (one image from the host catalog, by key)

`mind-map` takes `{ root: { label, children?, tip? } }` and draws what nests
inside what — a taxonomy as a horizontal dendrogram, or a nested list when the
tree would be too deep, too large, or too wide to read legibly (`presentation`
forces either form). Use it for containment, never for a sequence:
`timeline` and `step-list` already do that, and a dendrogram encodes order as
ancestry rather than position.

Every node carries a `data-el-id` (`n0`, `n1`, … in pre-order), so a host
passing `onElementEvent` receives hover and click for any node without wiring
anything. A node's optional `tip` (1–200 chars) is what makes it **keyboard
reachable** — the popover, `tabindex` and Escape-to-close come with it. Without
a tip a node is pointer-only, so give one to any node whose label alone leaves
a reader guessing, and skip it elsewhere.

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

**`body` puts the explanation beside the picture.** Give an image a `body` and
the prose that belongs to it renders in its own column next to the image,
collapsing to a full-width stack when the column is too narrow for two:

```ts
{ type: "image", image: "release-gates", body: "A change crosses three gates…" }
```

This is what makes a *series* of generated images work — a step-by-step with a
picture per step is just consecutive `image` blocks, each with its own `body`.
No sequence or group type is needed, because there is nothing to group: the
blocks are already in order in the `blocks` array.

`body` is capped at 1200 characters, because it means *the paragraph or two
that explains this picture*, not an article. Reach for a `text` block for more.
Override the layout in your own CSS (`.exp-image-prose { flex-basis: 100% }`
stacks it permanently); `tokens.css` sets it as a flex row whose bases are the
breakpoint, so it responds to the width of the block rather than the viewport.

**The host owns `alt`, not the model.** The compiler's `LlmClient` is
text-in/text-out, so a model-authored alt would be a description of a picture
it never saw. The model may write `caption` and `body`, which are prose about
the concept.

If your images are generated, note that **nobody has seen the picture** — your
host holds the prompt, not the output — so a prompt-derived `alt` describes an
image that may not match what came back. That is a legitimate host choice and
the only one available, but a confidently wrong alt is worse for a screen
reader than a generic one, and nothing in the library can detect the mismatch.

A miss or invalid entry degrades to the caption with a warning: never a broken
`<img>`, and never the catalog key — that identifier is host-internal. With no
caption either, nothing renders and the warning still fires. `imageRefSchema`
is exported for pre-validation.

**With a `body`, a miss costs the reader only the picture.** The prose still
renders as an ordinary paragraph and the caption still sits beneath it — and the
dashed "missing image" box is deliberately *not* drawn, because it would wrap
the reader's own legitimate text. The host hears about it through the `[image]`
warning, which is the channel a degradation is supposed to be loud on. Before
`body` existed, the same failure left an orphan caption marooned between two
paragraphs.

**Withhold the block until the image exists.** Rendering is a pure function of
IR plus catalog, with no lifecycle — there is no "pending" state to render and
nothing to re-render when a generation lands. So if you generate images
asynchronously, hold the `image` block back until its key resolves. Rendering
mid-flight is not an error, but it *is* a degradation from the renderer's point
of view: you get an `[image]` warning, and `failOnWarning: true` will throw on
an expected transient.

Pass the same object as `compileDocument({ images })` to let the compiler place
images: the outline sees the key and subject of each and may mark a section,
and the section prompt pins one image block for it. Images anchor analogies and
set scenes; they never illustrate a derivation.

> **Upgrade note:** adding the `image` block type adds one line to the block-type
> contract, so the compile *system* prompt changes for every host on upgrade,
> catalog or not. No flag can prevent this — the contract is interpolated
> unconditionally, and a test pins every registered type into it. The *user*
> prompts stay byte-identical when no catalog is passed.
>
> Adding `body` widens that same line, so it is a prompt diff for every host
> too — one block-type line, no more. Compiles with no catalog are unaffected.

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

Inline emphasis only: `**bold**`, `*italic*`, `` `code` ``, `[text](url)`,
and inline math — links are scheme-gated to http(s), `mailto:`, and
`#anchors`; anything else degrades to literal text. No HTML in any
field.

### Inline math in prose

A formula can live inside any prose field, in the same engine and under the
same security argument as `derivation`:

```ts
{ type: "text", body: "Dividing by \\(\\frac{p}{q}\\) multiplies by \\(\\frac{q}{p}\\)." }
```

- **`\\(...\\)`** is always honored. Backslash-paren does not occur in English
  prose, so there is nothing to collide with.
- **`$...$`** is honored only when it plausibly is math: no whitespace against
  either delimiter, the closing `$` not followed by a digit, and the content
  containing a TeX signal (`\ ^ _ { } = < >`) or being a tight whitespace-free
  expression with a letter in it.

Anything failing that is left as literal text, byte-identical to the pre-math
output. So **a dollar amount in prose needs no escaping** — "costs $5 and
returns $10" renders as itself. Prefer `\\(...\\)`: it has no gate, and a
`$...$` that looks like prose (`$a + b$`, `$5$`) is deliberately left alone.

Unparseable math degrades to its own source text — not a code chip — with a
`[math]` warning, so `failOnWarning` still gates it. Inline math renders at
body size in compact style (`.exp-math-inline`), where a `derivation` step
renders at `--exp-math-size` in display style.

## Figures

A `figure` block draws a bespoke figure on a 360×240 canvas from Scene
elements (`path`, `curve`, `arc`, `box`, `line`, `dot`, `label`, `group`) with `params`, `derived` expression chains, and `{{expr}}` slots
inside path data. Static SVG at the initial param values is the SSR default;
the interactive runtime is the React opt-in above.

Leaf elements accept `id` and `tip` (hover text); the SVG carries
`data-el-id` / `data-tip`. In React, pass `onElementEvent` to receive
hover/click events with the built-in popover.

A figure's content may stray outside its 360×240 canvas — hand-authored
figures stay inside, model-authored ones sometimes don't. The renderer grows
the `viewBox` to contain whatever is there (possibly scaling the figure down
slightly), so out-of-canvas content degrades to "a bit small" instead of
disappearing. Box labels wrap to the box width, and a `label` on a
`dot`/`line`/`curve`/`arc` renders beside the shape — the model's most
natural spelling of "name this thing".

A figure's accessible name is carried once, in `aria-label`. There is no
`<title>` element, so the browser shows no native tooltip over a figure — the
whole-figure summary is an accessible name, not something to hover for, and on
a dense figure it was long enough to be worse than nothing. Per-element detail
is the popover's job.

A `diagram` block names nodes and edges and lets the renderer place them. Set
`direction: "tb"` to flow top-to-bottom instead of the default `"lr"`. If
the graph contains a cycle — a feedback loop like "revalidate → cache" — the
layout breaks that cycle for ranking purposes and draws the closing edge as a
return path around the outside, so a loop stays as compact as an acyclic
graph instead of expanding into ranks that are empty but still consume width.
Figures scale to their container via `viewBox`, so an over-wide scene shrinks
its own labels; keeping the scene honest is what keeps text legible.

On a wide layout the theme can let a figure squeezed by a narrow article
column borrow the page gutters: the theme reads a **container query on `.exp`
itself**, so it fires on the space the article was actually given — put the
article beside a sidebar and the container narrows, whatever the window does.
Only the *maximum* width is raised (never forced), so a small figure keeps
its intrinsic size and never scales up; a too-wide one gets up to
`--exp-figure-breakout` of extra room each side, centred on the column — the
query zeroes the figure's auto margins because the `left: 50%` +
`translate: -50%` centering trick only cancels when the box is not also
centering itself by margin. The query targets figures that are direct
children of a block (sparklines live inside their metric card and are never
displaced); mind-map figures are such children too and get the same
treatment. The sticky TOC card paints above breakout figures.

**The token defaults to `0px`: figures fit the column by default.** Raise it
(e.g. `--exp-figure-breakout: 48px`) to let a too-wide figure spill a bounded
amount into the page gutters instead of scaling down — useful when a wide
diagram's labels would otherwise shrink below comfortable size.

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

### Diagram chain audit

With `diagramAudit: true`, a `diagram` block whose every node has at most one
edge in and one out — a *chain* — warns
`[diagram] section N: a diagram reads as a chain (every node has at most one
edge in and out) — consider a step-list`. A chain is the shape a `step-list`
renders better, and real compiles emit them despite the prompt saying not to
(the "DNA → mRNA → Ribosome → Protein" class). Warn-only, recursing into
`stack` children, tolerant of malformed payloads: nothing is dropped or
rewritten. Off by default like `checks` — under `failOnWarning: true` a
default-on quality heuristic would throw on every compile, and the prompt's
chain guidance (block-types `diagram` line) remains the first line of defense.

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
