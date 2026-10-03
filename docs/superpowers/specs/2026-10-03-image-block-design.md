# Raster Imagery: `image` Block & Host Catalog — Design

**Date:** 2026-10-03
**Status:** Approved (brainstorm 2026-10-03)
**Predecessor:** Drag-to-vary (`2026-10-02-drag-to-vary-design.md`)
**Backlog origin:** ROADMAP backlog "AI-generated raster imagery (shape
undecided)" — the host runs an image model and hands the library a catalog of
image references; the library stitches them into guides. Real images, even
mediocre ones, add atmospheric variety the vector layer cannot.

## 1. Problem & Goal

The library renders a purely vector explanation surface: every block becomes
SVG or escaped HTML. Real raster images are the one thing that layer
structurally cannot produce, and they add atmospheric variety that no amount of
drawing substitutes for.

Images introduce three hazards the vector layer never had:

1. **Bytes.** A document IR is JSON. Embedding image bytes would bloat it,
   break diffing, and put binary in a text-only format.
2. **Fetching.** A render-time `fetch` makes rendering non-deterministic,
   network-dependent, and hostile to SSR and offline replay.
3. **Layout shift.** An image without intrinsic dimensions reflows the document
   as it loads.

Goal: a host-supplied **image catalog**, referenced by key, that renders a
single image as a figure with a caption. Images enter as **references only** —
never bytes, never fetched at render. `alt` and dimensions are required at
schema level, so unattributable alt text and layout shift are unrepresentable
rather than merely discouraged. Every failure degrades to caption-only with a
warning, never a broken-image icon.

## 2. Scope

This cycle ships **shape (a)** only: one `image` block referencing a host
catalog. Two larger shapes from the roadmap discussion are deliberately
deferred:

- **(b)** compiler-driven image briefs (outline gains image briefs; a
  host-injected image client materializes them mid-compile).
- **(c)** `analogy` composite block (one image + an `[{ imagePart,
  conceptPart }]` mapping rendered as a caption-side table) — the novel
  differentiator.

Shape (c) composes cleanly on top of this design: its single image uses the
same one-image-per-block contract and the same catalog key. Building (a) first
means (c) becomes a cheap second cycle once the catalog contract is proven
against a real host.

## 3. Decisions (from brainstorm)

1. **Shape (a) only** — one block type, one image per block. Consistent with
   every other block in the IR: a `chart` is one chart, a `data-callout` is one
   number, a `timeline` is one ordered series.
2. **Key resolved at render** — the block carries `image: "<key>"`; the host
   passes a catalog at render time. Structurally identical to the `datasets`
   registry, so one IR renders against any catalog and a host can regenerate
   every image without rewriting IR.
3. **Sequences are N blocks** — a step-by-step sequence is N consecutive
   `image` blocks in a section. No `image-sequence` type until a real host
   proves N-blocks inadequate (YAGNI).
4. **Prompt-visible catalog menu** — unlike the `datasets` cycle (which pinned
   *zero* prompt changes), the compiler must know which images exist in order
   to place them. `CompileOptions.images` is validated leniently and
   interpolated into prompts. **This is a compiler-surface change.**
5. **Host owns `alt` and dimensions** — required by the catalog schema. The
   compiler's `LlmClient` is strictly text-in/text-out, so the model never
   *sees* the image; an LLM-authored `alt` would be a hallucinated description
   of an unobserved picture written straight into an accessibility attribute.
   The model may write a `caption` — prose about the *concept*, which it can
   legitimately author.
6. **Degrade to caption-only + warning** — a missing or invalid catalog entry
   renders the caption with no broken-image chrome and calls
   `ctx.addWarning`, matching `datasets`. Dropping the whole block would lose
   the caption, which is often the only sentence carrying an analogy — the
   silent-prose-loss failure mode `docs/OPEN_THREADS.md` explicitly warns about.
7. **`imageStyle` deferred** — the roadmap notes cross-image consistency stays
   host-side via style templates, which leaves the library's hint with almost
   nothing to influence. YAGNI until a real host can say what it should do.

## 4. Public Surface

### 4.1 Block schema (`src/core/schema.ts`)

Ships **atomically** with the primitive file and its `BLOCK_TYPE_DOCS` line:
`tests/llm.test.ts` pins "every registered type appears in the snippet", so
registration and contract text cannot be split across commits.

```ts
export const imageBlockSchema = z.object({
  id: idSchema,
  type: z.literal("image"),
  image: z.string().min(1),  // catalog key
  caption: z.string().min(1).max(300).optional(),
})
export type ImageBlock = z.infer<typeof imageBlockSchema>
```

`imageBlockSchema` joins `blockUnionSchema` (and the `Block` type union — the
omission that was a shipped minor until `89c1fe5`). Keyed lookups are resolved
at render, so the key itself needs only a non-empty bound.

### 4.2 Catalog entry (`src/core/images.ts`, new)

```ts
export const imageRefSchema = z.object({
  src: z.string().min(1),                          // host-controlled URL
  alt: z.string().min(1).max(300),                 // REQUIRED — a11y
  width: z.number().int().positive().max(4000),    // REQUIRED — no layout shift
  height: z.number().int().positive().max(4000),   // REQUIRED
  subject: z.string().min(1).max(200),             // prompt menu only, never markup
})
export type ImageRef = z.infer<typeof imageRefSchema>
```

`alt` and the dimensions being **required** is the mechanism: a schema that
permits an image without them is a schema that permits an inaccessible image
and a reflowing document. `subject` exists so the prompt menu can describe the
image to the model in words; it is never rendered.

### 4.3 Resolution (mirrors `src/core/datasets.ts`)

```ts
export type ImageResolution = { ok: true; ref: ImageRef } | { ok: false }

export function resolveImage(
  ctx: RenderContext,
  key: string,
  blockId: string | undefined,
): ImageResolution
```

- **Own-property guard** (`Object.hasOwn`) so a host key of `"constructor"` or
  `"__proto__"` cannot resolve an inherited `Object.prototype` value. Same
  threat and same fix as the `datasets` registry (the null-prototype finding
  from the security review).
- `safeParse` against `imageRefSchema`; a malformed entry warns and degrades.
- Warnings use a `[image]` prefix and the block id (or the key), matching
  `[dataset]`.
- Never throws, even under `strict` — block-level salvage, exactly as
  `resolveDataset` behaves.

### 4.4 Render options

`images?: Record<string, unknown>` added to `renderExplanation`
(`RenderOptions`), `renderDocument` (`RenderDocumentOptions`), `<Explanation>`
(`ExplanationProps`), and `<Document>` (`DocumentProps`), threaded through
`RenderContext` (`registry.ts`) alongside `datasets`.

The registry stays a dumb `Record<string, unknown>` — each block type owns its
read rule; no generic-bag conventions. Per-call and SSR-safe (no module-global
state). Diagnostics flow out the existing `{ html, warnings }` channel.

### 4.5 Compile options (`src/compiler/client.ts`)

```ts
export interface CompileOptions {
  // ...
  images?: ImageRef[]
}

export const MAX_IMAGES = 24   // mirrors MAX_SOURCES

export function validateImages(
  raw?: unknown[],
): { refs: ImageRef[]; warnings: string[] }
```

Hand-rolled checks — **not** zod — so warning strings stay stable across zod
versions, exactly as `validateSources` does (a deliberate divergence from the
render-time path). Drops, each with a `[images]` warning: non-objects,
malformed fields, duplicate keys (first wins), and entries past `MAX_IMAGES`.

## 5. Rendering & Safety

```html
<figure class="exp-block exp-image">
  <img class="exp-image-img" src="…" alt="…" width="…" height="…"
       loading="lazy" decoding="async">
  <figcaption class="exp-fig-caption">…</figcaption>
</figure>
```

- `src` and `alt` pass through `escapeHtml`; `width`/`height` are validated
  positive integers and therefore cannot carry markup.
- `caption` passes through `renderInline`, matching every other primitive.
- `loading="lazy"` + `decoding="async"` on a document that may hold N images.
- `figcaption` reuses the existing `.exp-fig-caption` token; `.exp-image` and
  `.exp-image-img` are added to `src/themes/tokens.css` (block layout plus
  `max-width: 100%; height: auto` so a narrow column scales rather than
  overflows).
- **Degraded path**: caption only, inside `.exp-image-missing`, with the
  `ctx.addWarning` call. **If there is no caption either, the block emits
  nothing visible at all** — just the warning. It deliberately does *not*
  render the catalog key as a placeholder: keys are host-internal identifiers,
  and showing one to a reader leaks host internals for no reader's benefit.
  (This is why the "placeholder box" option was rejected during brainstorm.)

Security posture, matching the quiz/sources precedent:

- Model-authored text reaches HTML **only** through `renderInline`/
  `escapeHtml`.
- `src` is host-supplied, not model-supplied, and is always escaped. There is
  no scheme allowlist on `src` (the host owns its own asset URLs and may
  legitimately serve from a relative path or a CDN); the value is escaped and
  never interpolated into a `<script>`, style, or event-handler position.
- `subject` reaches prompts only, never markup.
- No new dependencies, no network calls at render, no `eval`. The React path
  reuses `renderBlock`'s existing `dangerouslySetInnerHTML`.

## 6. Compiler Menu

Mirrors the existing sources split:

- **Outline** sees keys + subjects only — it plans structure and needs to know
  which images are available in order to mark sections that want one.
- **Section** sees the same menu plus the assignment rule. Neither sees `src` or
  `alt`: the model has no use for a URL, and keeping the menu to keys +
  subjects keeps prompts small and text-only.

```
Images available (place by key where one earns its place):
- <key>: <subject>

Place an image only to anchor an analogy or set a scene. Images never
illustrate a derivation — a drawn figure does that better. Put no text in the
image itself: labels belong in the caption.
```

`outlineSectionSchema` (`src/compiler/extract.ts`) gains
`image: z.string().min(1).optional()`, following the `check` precedent exactly:
the outline *prompt* only invites it when a catalog is present, but the schema
accepts it unconditionally (zod leniency — an undeclared image is also allowed,
and the section prompt may still choose one). `sectionUserPrompt` receives the
declared key as `args.image` and instructs that section to include exactly one
`image` block, mirroring how `args.check` pins a quiz.

Absent the flag or an empty catalog, **prompts are byte-identical to today's** —
the same absence-of-effect pin `checks` already relies on. `BLOCK_TYPE_DOCS`
gains:

```
- image: { image, caption? } — one image from the host catalog, by key. ...
```

## 7. Testing & Verification

**Schema** — block parses; blank/missing `image` rejected; caption capped at
300; `Block` union pins `ImageBlock`.

**Resolution** — hit resolves; miss warns and degrades; invalid entry warns;
keys `"constructor"` / `"__proto__"` do not resolve inherited values.

**Render** — `alt`/`src` escaped with an attribute-breakout fixture; width and
height emitted as validated integers; `loading="lazy"` present; caption goes
through `renderInline`; degraded path emits **no** `<img>`, does **not** leak
the catalog key into visible markup, and does warn.

**React parity** — `<Document>` and `<Explanation>` markup matches
`renderDocument` / `renderExplanation` byte-for-byte given the same catalog.

**Compiler** — outline menu shows keys + subjects but never `src`; section menu
adds the rule; a catalog-less compile is byte-identical to an unflagged one;
over-cap and malformed entries drop with `[images]` warnings.

**Demo** — an image section on `/document` with the catalog supplied host-side;
curl-verified.

**Gate** — full suite green (432 baseline plus new tests), `tsc --noEmit`
clean, `npm run build` green, all demo routes 200, and the pre-existing demo
output **diffed against `main`** per the `OPEN_THREADS.md` convention ("verify
by measurement, and diff rendered output against `main`" — three defects last
cycle were invisible to the suite).

## 8. Out of Scope

- `analogy` composite block (shape c) and compiler-driven briefs (shape b).
- `imageStyle` rendering hints.
- Image generation, upload, storage, or CDN management — entirely host-side.
- Multi-image blocks, `image-sequence`.
- Lightbox / zoom, lazy-loading orchestration beyond the attribute.

## 9. Risks

- **Alt text quality is the host's responsibility.** The schema guarantees an
  alt *exists*; nothing guarantees it is *accurate*. A wrong alt is worse than
  a generic one. Recorded as an open thread at branch finish.
- **`src` has no scheme gate.** Deliberate (hosts serve their own assets, often
  relatively), but it means the library does not defend against a host passing
  a `javascript:` URL. Worth revisiting if untrusted catalogs ever enter.