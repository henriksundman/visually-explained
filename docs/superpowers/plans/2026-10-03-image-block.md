# Raster Imagery: `image` Block & Host Catalog — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `image` block that renders one image from a host-supplied catalog, referenced by key and resolved at render, plus a prompt-visible catalog menu so the compiler can place images where they earn their place.

**Architecture:** Mirrors the shipped `datasets` registry exactly. The block carries `image: "<key>"`; the host passes `images: Record<string, ImageRef>`; a hit resolves against `imageRefSchema`, a miss degrades to caption-only and warns. The **same Record** serves compile and render, so the catalog key the model writes is literally the key the renderer looks up. Entries are validated twice under two different policies — leniently by hand (`validateImages`, stable warning strings at compile time) and by zod (`resolveImage`, at render time). The compiler sees only keys + subjects, never `src`/`alt`.

**Tech Stack:** TypeScript 5.6, zod 4, React 19, vitest 3, tsup. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-03-image-block-design.md`

## Global Constraints

- **No new dependencies.** `dependencies` stays `roughjs` + `zod`. Do not add a test library.
- **Images are references only.** Never bytes, never a `fetch`, never base64. The renderer emits an `<img src>`; it never loads or inspects it.
- **`alt`, `width`, `height` are REQUIRED on a catalog entry.** A schema that permits their absence is a schema that permits an inaccessible image and a reflowing document. This is the mechanism, not a convention.
- **The model never authors `alt`.** `LlmClient` is text-in/text-out — the model has never seen the image. Only the host supplies `alt`.
- **Never throw from `resolveImage`, even under `strict`.** Block-level salvage, same as `resolveDataset`.
- **Own-property guard is mandatory.** A catalog key of `"constructor"` or `"__proto__"` must not resolve an inherited `Object.prototype` value. Use `Object.hasOwn`.
- **Model-authored text reaches HTML only via `renderInline` / `escapeHtml`.** `subject` reaches prompts only, never markup.
- **Warning prefix is `[image]` for render-time and `[images]` for compile-time**, matching the `[dataset]` / `[grounding]` split.
- **Atomic registration.** `tests/llm.test.ts` pins that every registered block type appears in both `explanationJsonSchema` and `BLOCK_TYPE_DOCS`. Schema, primitive, `registerAll` import, and the `BLOCK_TYPE_DOCS` line must land in ONE commit.
- **Baseline is 432 tests across 45 files**, green, with `tsc --noEmit` and `npm run build` green. Every task must end non-regressing.
- **Commit per task.** Branch is `feature/image-block`.

---

## File Structure

**Created:**
- `src/core/images.ts` — `imageRefSchema`, `ImageRef`, `ImageResolution`, `resolveImage`. The render-time resolution rule (mirrors `datasets.ts`).
- `src/primitives/image.ts` — the `image` primitive's render function + registration.
- `tests/image.test.ts` — schema, resolution, render, degradation.
- `tests/image-compiler.test.ts` — `validateImages`, prompt menus, outline wiring.
- `tests/image-react.test.tsx` — entry-point parity for `<Explanation>` / `<Document>`.

**Modified:**
- `src/core/schema.ts` — `imageBlockSchema`, `ImageBlock`, `Block` union, `blockUnionSchema`.
- `src/core/blockTypes.ts` — one `BLOCK_TYPE_DOCS` line.
- `src/core/registerAll.ts` — side-effect import.
- `src/core/registry.ts` — `RenderContext.images`.
- `src/core/render.ts` — `RenderOptions.images`, `renderBlock` opts, `renderSalvagedBlock` param.
- `src/core/renderDocument.ts` — `RenderDocumentOptions.images`, thread to `renderSectionBlocks`.
- `src/index.ts` — `export * from "./core/images"`.
- `src/compiler/client.ts` — `CompileOptions.images`, `MAX_IMAGES`, `validateImages`.
- `src/compiler/extract.ts` — `outlineSectionSchema.image`.
- `src/compiler/prompts.ts` — menu fragments, `outlineUserPrompt` / `sectionUserPrompt` params.
- `src/compiler/stream.ts` — validate, thread menu, carry declared key per section.
- `src/themes/tokens.css` — `.exp-image`, `.exp-image-img`, `.exp-image-missing`.
- `src/react/Explanation.tsx`, `src/react/Document.tsx` — `images` prop.
- `tests/fixtures.ts` — one image block in `allPrimitivesIr`.
- `tests/block-union-types.test.ts` — `ImageBlock` type pin.
- `tests/demo-examples.test.ts` — section count if a demo section is added.
- `demo/examples.js`, `demo/server.mjs` — demo coverage.
- `README.md`, `docs/ROADMAP.md` — docs.

---

### Task 1: Catalog schema, resolution rule, and block registration

This task lands the whole render-side type surface atomically, because `tests/llm.test.ts` makes schema + registration + contract text indivisible.

**Files:**
- Create: `src/core/images.ts`
- Create: `src/primitives/image.ts`
- Modify: `src/core/schema.ts` (add schema after `quizBlockSchema` at ~line 203; add `ImageBlock` to the `Block` union at ~line 159; add to `blockUnionSchema` at ~line 206-224)
- Modify: `src/core/blockTypes.ts`
- Modify: `src/core/registerAll.ts`
- Modify: `src/index.ts`
- Test: `tests/image.test.ts`

**Interfaces:**
- Consumes: `RenderContext` from `src/core/registry.ts`; `escapeHtml`, `renderInline` from `src/core/inline.ts`.
- Produces (later tasks rely on these exact names):
  - `imageRefSchema: z.ZodType<ImageRef>` with `{ src: string; alt: string; width: number; height: number; subject: string }`
  - `type ImageRef = { src: string; alt: string; width: number; height: number; subject: string }`
  - `type ImageResolution = { ok: true; ref: ImageRef } | { ok: false }`
  - `resolveImage(ctx: RenderContext, key: string, blockId: string | undefined): ImageResolution`
  - `imageBlockSchema` / `ImageBlock` (`{ id?, type: "image", image: string, caption?: string }`)
  - `renderImage(block: ImageBlock, ctx: RenderContext): string`

- [ ] **Step 1: Write the failing test**

Create `tests/image.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { renderExplanation } from "../src/core/render"
import { imageBlockSchema } from "../src/core/schema"
import { imageRefSchema, resolveImage } from "../src/core/images"
import { BLOCK_TYPE_DOCS } from "../src/core/blockTypes"
import type { RenderContext } from "../src/core/registry"
import "../src/core/registerAll"

const ref = {
  src: "https://cdn.example.com/a.png",
  alt: "A crowded train platform at rush hour",
  width: 800,
  height: 600,
  subject: "a rush-hour platform",
}

let warnings: string[] = []
const ctx = (images?: Record<string, unknown>): RenderContext => ({
  depth: 1,
  sketch: false,
  images,
  addWarning: m => warnings.push(m),
  renderChildren: () => "",
})
const fresh = () => {
  warnings = []
  return warnings
}

describe("image schema", () => {
  it("accepts a keyed block and rejects out-of-bounds shapes", () => {
    expect(imageBlockSchema.safeParse({ type: "image", image: "platform" }).success).toBe(true)
    expect(imageBlockSchema.safeParse({ type: "image" }).success).toBe(false)
    expect(imageBlockSchema.safeParse({ type: "image", image: "" }).success).toBe(false)
    expect(imageBlockSchema.safeParse({ type: "image", image: "p", caption: "x".repeat(301) }).success).toBe(false)
  })

  it("requires alt and both dimensions on a catalog entry", () => {
    expect(imageRefSchema.safeParse(ref).success).toBe(true)
    expect(imageRefSchema.safeParse({ ...ref, alt: "" }).success).toBe(false)
    expect(imageRefSchema.safeParse({ ...ref, alt: undefined }).success).toBe(false)
    expect(imageRefSchema.safeParse({ ...ref, width: undefined }).success).toBe(false)
    expect(imageRefSchema.safeParse({ ...ref, height: 0 }).success).toBe(false)
    expect(imageRefSchema.safeParse({ ...ref, width: -10 }).success).toBe(false)
  })
})

describe("resolveImage", () => {
  it("returns the validated ref on a key hit", () => {
    const w = fresh()
    const r = resolveImage(ctx({ platform: ref }), "platform", "im1")
    expect(r).toEqual({ ok: true, ref })
    expect(w).toEqual([])
  })

  it("warns with the block id on a miss and on an invalid entry", () => {
    let w = fresh()
    expect(resolveImage(ctx({}), "nope", "im1").ok).toBe(false)
    expect(w).toEqual([`[image] image im1: no image named "nope"`])

    w = fresh()
    expect(resolveImage(ctx({ bad: { ...ref, alt: "" } }), "bad", "im1").ok).toBe(false)
    expect(w[0]).toMatch(/^\[image\] image im1: invalid entry — /)
  })

  it("falls back to the key when the block has no id", () => {
    const w = fresh()
    resolveImage(ctx({}), "nope", undefined)
    expect(w).toEqual([`[image] image nope: no image named "nope"`])
  })

  it("never resolves an inherited Object.prototype member", () => {
    const w = fresh()
    expect(resolveImage(ctx({}), "constructor", "im1").ok).toBe(false)
    expect(resolveImage(ctx({}), "__proto__", "im1").ok).toBe(false)
    expect(resolveImage(ctx({}), "toString", "im1").ok).toBe(false)
    expect(w.every(m => m.includes("no image named"))).toBe(true)
  })
})

describe("image render", () => {
  const block = { type: "image", id: "im1", image: "platform", caption: "Rush hour, **before** the signal turns green." }

  it("renders the figure with lazy loading and both dimensions", () => {
    const { html, warnings: w } = renderExplanation(
      { version: 1, blocks: [block] },
      { images: { platform: ref } },
    )
    expect(html).toContain(`<figure class="exp-block exp-image">`)
    expect(html).toContain(`<img class="exp-image-img"`)
    expect(html).toContain(`alt="A crowded train platform at rush hour"`)
    expect(html).toContain(`width="800"`)
    expect(html).toContain(`height="600"`)
    expect(html).toContain(`loading="lazy"`)
    expect(html).toContain(`decoding="async"`)
    expect(html).toContain(`<figcaption class="exp-fig-caption">`)
    expect(html).toContain(`<strong>before</strong>`) // caption via renderInline
    expect(w).toEqual([])
  })

  it("escapes src and alt against attribute breakout", () => {
    const { html } = renderExplanation(
      { version: 1, blocks: [{ type: "image", image: "x" }] },
      { images: { x: { ...ref, src: 'a.png" onerror="alert(1)', alt: '"><script>alert(1)</script>' } } },
    )
    expect(html).not.toContain("onerror=")
    expect(html).not.toContain("<script>")
    expect(html).toContain("&quot;")
    expect(html).toContain("&lt;script&gt;")
  })

  it("degrades to caption-only and warns on a miss, never a broken img", () => {
    const { html, warnings: w } = renderExplanation({ version: 1, blocks: [block] }, { images: {} })
    expect(html).not.toContain("<img")
    expect(html).toContain("before") // the caption survives
    expect(html).toContain(`class="exp-image-missing"`)
    expect(w).toEqual([`[image] image im1: no image named "platform"`])
  })

  it("never leaks the catalog key into visible markup when degraded", () => {
    const { html } = renderExplanation(
      { version: 1, blocks: [{ type: "image", image: "secret-internal-key" }] },
      { images: {} },
    )
    expect(html).not.toContain("secret-internal-key")
  })

  it("emits nothing visible when degraded and there is no caption", () => {
    const { html, warnings: w } = renderExplanation(
      { version: 1, blocks: [{ type: "image", image: "gone" }] },
      { images: {} },
    )
    expect(html).not.toContain("gone")
    expect(w).toHaveLength(1) // still loud
  })

  it("is taught in the block-type contract", () => {
    expect(BLOCK_TYPE_DOCS).toContain("image:")
    expect(BLOCK_TYPE_DOCS).toContain("caption?")
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/image.test.ts`

Expected: FAIL — `Cannot find module '../src/core/images'`.

- [ ] **Step 3: Write `src/core/images.ts`**

```ts
import { z } from "zod"
import type { RenderContext } from "./registry"

/** A host-catalog image entry. `alt` and both dimensions are REQUIRED, not
 *  optional: an image without alt is inaccessible and an image without
 *  intrinsic dimensions reflows the document as it loads (image spec §4.2).
 *  `subject` describes the image in words for the prompt menu and is never
 *  rendered — the LLM is text-only and cannot see the picture. */
export const imageRefSchema = z.object({
  src: z.string().min(1),
  alt: z.string().min(1).max(300),
  width: z.number().int().positive().max(4000),
  height: z.number().int().positive().max(4000),
  subject: z.string().min(1).max(200),
})
export type ImageRef = z.infer<typeof imageRefSchema>

export type ImageResolution = { ok: true; ref: ImageRef } | { ok: false }

/** Look up a block's catalog key and validate it. Emits a lenient warning on
 *  miss/invalid and never throws — block-level salvage, even under strict
 *  (image spec §4.3). Own-property guard: a host key must not resolve
 *  "constructor"/"__proto__"/"toString" to inherited Object members. */
export function resolveImage(ctx: RenderContext, key: string, blockId: string | undefined): ImageResolution {
  const label = blockId ?? key
  const images = ctx.images
  if (!images || !Object.hasOwn(images, key)) {
    ctx.addWarning(`[image] image ${label}: no image named "${key}"`)
    return { ok: false }
  }
  const parsed = imageRefSchema.safeParse(images[key])
  if (!parsed.success) {
    const issues = parsed.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")
    ctx.addWarning(`[image] image ${label}: invalid entry — ${issues}`)
    return { ok: false }
  }
  return { ok: true, ref: parsed.data }
}
```

- [ ] **Step 4: Add the block schema to `src/core/schema.ts`**

Immediately after the `quizBlockSchema` / `QuizBlock` pair (around line 203), add:

```ts
export const imageBlockSchema = z.object({
  id: idSchema,
  type: z.literal("image"),
  // Host catalog key, resolved at render time (image spec §4.1).
  image: z.string().min(1),
  caption: z.string().min(1).max(300).optional(),
})
export type ImageBlock = z.infer<typeof imageBlockSchema>
```

Then add `| ImageBlock` to the `Block` union (after `| QuizBlock`, around line 159) — the union pin in `tests/block-union-types.test.ts` exists precisely because this was silently omitted for `sources` once.

Then add `imageBlockSchema,` to `blockUnionSchema`'s `z.discriminatedUnion("type", [...])` array, after `quizBlockSchema`.

- [ ] **Step 5: Create `src/primitives/image.ts`**

```ts
import { registerPrimitive, type RenderContext } from "../core/registry"
import { imageBlockSchema, type ImageBlock } from "../core/schema"
import { resolveImage } from "../core/images"
import { escapeHtml, renderInline } from "../core/inline"

/** One image from the host catalog. A miss or invalid entry degrades to the
 *  caption alone and warns (image spec §5) — never a broken <img>, and never
 *  the catalog key, which is a host-internal identifier. With no caption there
 *  is nothing worth showing, so the block renders nothing visible and the
 *  warning stands alone. */
export function renderImage(block: ImageBlock, ctx: RenderContext): string {
  const resolved = resolveImage(ctx, block.image, block.id)
  const caption = block.caption
    ? `<figcaption class="exp-fig-caption">${renderInline(block.caption)}</figcaption>`
    : ""
  if (!resolved.ok) {
    if (!caption) return ""
    return `<figure class="exp-block exp-image exp-image-missing">${caption}</figure>`
  }
  const { src, alt, width, height } = resolved.ref
  return (
    `<figure class="exp-block exp-image">` +
    `<img class="exp-image-img" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"` +
    ` width="${width}" height="${height}" loading="lazy" decoding="async">` +
    caption +
    `</figure>`
  )
}

registerPrimitive("image", { schema: imageBlockSchema, render: renderImage })
```

- [ ] **Step 6: Register the primitive in `src/core/registerAll.ts`**

Add `import "../primitives/image"` after the `../primitives/quiz` line.

- [ ] **Step 7: Add the `BLOCK_TYPE_DOCS` line in `src/core/blockTypes.ts`**

Insert after the `- quiz:` line and before `- stack:`:

```
- image: { image, caption? } — one image from the host catalog, referenced by key. Place it only to anchor an analogy or set a scene; never to illustrate a derivation (a drawn figure does that better). Put no text in the image itself — labels belong in the caption.
```

- [ ] **Step 8: Export the new module in `src/index.ts`**

Add `export * from "./core/images"` after `export * from "./core/datasets"`.

- [ ] **Step 9: Run the new test**

Run: `npx vitest run tests/image.test.ts`

Expected: PASS, 14 tests.

- [ ] **Step 10: Run the full suite — the atomic-registration pin must hold**

Run: `npm test`

Expected: PASS. `tests/llm.test.ts` "mentions every registered block type" now covers `image` in both `explanationJsonSchema` and `systemPromptSnippet`; if either fails, the schema, the `registerAll` import, or the `BLOCK_TYPE_DOCS` line is missing.

- [ ] **Step 11: Typecheck**

Run: `npx tsc --noEmit`

Expected: clean, exit 0.

- [ ] **Step 12: Commit**

```bash
git add src/core/images.ts src/primitives/image.ts src/core/schema.ts src/core/blockTypes.ts src/core/registerAll.ts src/index.ts tests/image.test.ts
git commit -m "add the image block and its host catalog resolution rule"
```
---

### Task 2: Thread `images` through the render and React entry points

The catalog has to reach the primitive. `datasets` already threads an identical
optional record through four surfaces; this mirrors that exactly.

**Files:**
- Modify: `src/core/registry.ts` (`RenderContext`)
- Modify: `src/core/render.ts` (`RenderOptions`, `renderBlock`, `renderSalvagedBlock`, `renderChildrenLenient`)
- Modify: `src/core/renderDocument.ts` (`RenderDocumentOptions`, `renderSectionBlocks`)
- Modify: `src/react/Explanation.tsx` (`ExplanationProps`, the `renderBlock` call sites)
- Modify: `src/react/Document.tsx` (`DocumentProps`, the `renderBlock` call)
- Create: `tests/image-react.test.tsx`

**Interfaces:**
- Consumes: `resolveImage` and `ImageBlock` from Task 1.
- Produces: `RenderContext.images?: Record<string, unknown>`, `RenderOptions.images?`, `RenderDocumentOptions.images?`, `ExplanationProps.images?`, `DocumentProps.images?`.

**Note on `renderSalvagedBlock`:** it already takes positional `(b, depth, warnings, sketch, datasets)`. Add `images` as a further positional parameter after `datasets` and update every call site — `renderExplanation`, `renderBlock`, `renderChildrenLenient`, and (in Task 2) `renderDocument.ts`'s `renderSectionBlocks`.

- [ ] **Step 1: Write the failing parity test**

Create `tests/image-react.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { renderExplanation } from "../src/core/render"
import { renderDocument } from "../src/core/renderDocument"
import { Explanation, Document } from "../src/react"
import "../src/core/registerAll"

const block = { type: "image", id: "im1", image: "platform", caption: "Rush hour." }
const images = {
  platform: {
    src: "https://cdn.example.com/a.png",
    alt: "A crowded train platform at rush hour",
    width: 800,
    height: 600,
    subject: "a rush-hour platform",
  },
}
const docIr = { version: 1, title: "Doc", sections: [{ title: "S", blocks: [block] }] }

describe("images entry-point parity", () => {
  it("renderExplanation resolves images", () => {
    const { html, warnings } = renderExplanation({ version: 1, blocks: [block] }, { images })
    expect(html).toContain(`width="800"`)
    expect(warnings).toEqual([])
  })

  it("renderDocument resolves images", () => {
    const { html, warnings } = renderDocument(docIr, { images })
    expect(html).toContain(`width="800"`)
    expect(warnings).toEqual([])
  })

  it("<Explanation> resolves images", () => {
    const html = renderToStaticMarkup(<Explanation ir={{ version: 1, blocks: [block] }} images={images} />)
    expect(html).toContain(`width="800"`)
  })

  it("<Document> resolves images", () => {
    const html = renderToStaticMarkup(<Document ir={docIr} images={images} />)
    expect(html).toContain(`width="800"`)
  })

  it("degrades identically to a miss on every surface", () => {
    const fromDoc = renderDocument(docIr, { images: {} })
    const fromReact = renderToStaticMarkup(<Document ir={docIr} images={{}} />)
    expect(fromDoc.html).not.toContain("<img")
    expect(fromDoc.warnings).toEqual([`[image] image im1: no image named "platform"`])
    expect(fromReact).not.toContain("<img")
  })

  it("omits images entirely and stays inert when the prop is absent", () => {
    const { html, warnings } = renderDocument(docIr, {})
    expect(html).not.toContain("<img")
    expect(warnings).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/image-react.test.tsx`

Expected: FAIL — `images` is not a known prop / no `images` on the render options.

- [ ] **Step 3: Add `images` to `RenderContext` in `src/core/registry.ts`**

```ts
  /** Host datasets for blocks carrying a `dataset` key (real-data spec §4). */
  datasets?: Record<string, unknown>
  /** Host image catalog for `image` blocks, keyed by the block's `image`
   *  value (image spec §4.4). Same shape and threading as `datasets`. */
  images?: Record<string, unknown>
```

- [ ] **Step 4: Thread it through `src/core/render.ts`**

In `RenderOptions`, add:

```ts
  /** Host-supplied image catalog for `image` blocks. */
  images?: Record<string, unknown>
```

Change `renderBlock`'s options parameter type and the `renderSalvagedBlock` signature:

```ts
export function renderBlock(type: string, data: unknown, depth = 1, opts: { sketch?: boolean; datasets?: Record<string, unknown>; images?: Record<string, unknown> } = {}): string {
  // ...
  return renderSalvagedBlock(b, depth, [], opts.sketch ?? false, opts.datasets, opts.images)
}

export function renderSalvagedBlock(
  b: SalvagedBlock,
  depth: number,
  warnings: string[],
  sketch: boolean,
  datasets?: Record<string, unknown>,
  images?: Record<string, unknown>,
): string {
  // ...
  const ctx: RenderContext = {
    depth,
    sketch,
    datasets,
    images,
    addWarning: m => warnings.push(m),
    renderChildren: (children, d) => renderChildrenLenient(children, d ?? depth + 1, warnings, sketch, datasets, images),
  }
  return entry.render(b.data as Block, ctx)
}

function renderChildrenLenient(children: unknown[], depth: number, warnings: string[], sketch: boolean, datasets?: Record<string, unknown>, images?: Record<string, unknown>): string {
  // ...
  return blocks.map(b => renderSalvagedBlock(b, depth, warnings, sketch, datasets, images)).join("")
}
```

Also update the `renderExplanation` call site to pass `opts.images`.

- [ ] **Step 5: Thread it through `src/core/renderDocument.ts`**

Add `images?: Record<string, unknown>` to `RenderDocumentOptions`, add a parameter to `renderSectionBlocks`, and pass it at both the call site and into `renderSalvagedBlock`:

```ts
function renderSectionBlocks(rawBlocks: unknown[], warnings: string[], sketch: boolean, datasets?: Record<string, unknown>, images?: Record<string, unknown>): string {
  // ...
  return blocks.map(b => renderSalvagedBlock(b, 1, warnings, sketch, datasets, images)).join("")
}
```

In `renderDocument`'s body: `renderSectionBlocks(s.blocks, warnings, opts.sketch ?? false, opts.datasets, opts.images)`.

- [ ] **Step 6: Add the props to both React components**

In `src/react/Explanation.tsx`, add to `ExplanationProps`:

```ts
  /** Host-supplied image catalog for `image` blocks. */
  images?: Record<string, unknown>
```

Destructure `images` from props, and pass `{ sketch, datasets, images }` to **both** `renderBlock` call sites (the `onElementEvent` branch and the fallback branch).

In `src/react/Document.tsx`, add the same prop, destructure it, and pass `{ sketch, datasets, images }` to its `renderBlock` call.

- [ ] **Step 7: Run the parity test**

Run: `npx vitest run tests/image-react.test.tsx`

Expected: PASS, 6 tests.

- [ ] **Step 8: Run the full suite and typecheck**

Run: `npm test && npx tsc --noEmit`

Expected: all green, typecheck clean. Both surfaces must agree — a threading gap in either shows up here.

- [ ] **Step 9: Commit**

```bash
git add src/core/registry.ts src/core/render.ts src/core/renderDocument.ts src/react/Explanation.tsx src/react/Document.tsx tests/image-react.test.tsx
git commit -m "thread the image catalog through every render entry point"
```

---

### Task 3: Theme tokens and the fixtures pin

**Files:**
- Modify: `src/themes/tokens.css` (after the `.exp-fig-caption` rule, ~line 546)
- Modify: `tests/fixtures.ts` (`allPrimitivesIr`)
- Modify: `tests/block-union-types.test.ts`

**Interfaces:**
- Consumes: the `exp-image`, `exp-image-img`, `exp-image-missing` class names emitted by Task 1.
- Produces: no new types.

**Why this is its own task:** `tests/themes.test.ts` scans the rendered output of `allPrimitivesIr` and fails on any `exp-*` class with no CSS definition. Adding an image block to that fixture without adding the CSS is a guaranteed red — so the two must land together.

- [ ] **Step 1: Add an image block to `tests/fixtures.ts`**

Add as the last entry in the `blocks` array of `allPrimitivesIr`:

```ts
    { type: "image", id: "fixture-image", image: "fixture-platform", caption: "A **host** image." },
```

- [ ] **Step 2: Run the themes test to confirm it now fails (RED)**

Run: `npx vitest run tests/themes.test.ts`

Expected: FAIL — `exp-image` and `exp-image-img` are undefined in CSS.

- [ ] **Step 3: Add the token rules to `src/themes/tokens.css`**

Insert after the `.exp-fig-caption` block:

```css
.exp-image {
  margin: 0 0 var(--exp-gap);
  padding: 0;
}

.exp-image-img {
  display: block;
  max-width: 100%;
  height: auto;
  border-radius: var(--exp-radius);
}

.exp-image-missing {
  padding: var(--exp-pad);
  border: 1px dashed var(--exp-border);
  border-radius: var(--exp-radius);
  background: var(--exp-surface-muted);
}
```

`max-width: 100%; height: auto` is what makes a wide image scale in a narrow column instead of overflowing — the same lesson as the timeline's 825px budget, applied cheaply here.

- [ ] **Step 4: Re-run the themes test (GREEN)**

Run: `npx vitest run tests/themes.test.ts`

Expected: PASS.

- [ ] **Step 5: Extend the `Block` union type pin**

In `tests/block-union-types.test.ts`, change the import and add the assertion:

```ts
import type { Block, ImageBlock, SourcesBlock } from "../src/core/schema"
```

```ts
    expectTypeOf<SourcesBlock>().toExtend<Block>()
    expectTypeOf<ImageBlock>().toExtend<Block>()
```

- [ ] **Step 6: Run the full suite**

Run: `npm test && npx tsc --noEmit`

Expected: green. Note that adding to the shared fixture shifts nothing else — `allPrimitivesIr` is only used by the themes gate and a few render tests.

- [ ] **Step 7: Commit**

```bash
git add src/themes/tokens.css tests/fixtures.ts tests/block-union-types.test.ts
git commit -m "style the image figure and pin it into the theme gate"
```

---

### Task 4: Compiler catalog menu and outline wiring

This is the only task that touches prompt text. Two costs, kept strictly apart
(spec §6):

- **Gateable:** the user-prompt menu fragments. Absent a catalog, `outlineUserPrompt`
  and `sectionUserPrompt` must stay byte-identical — the existing exact-equality
  assertions in `tests/compiler-prompts.test.ts` are the pin.
- **Ungateable:** the `BLOCK_TYPE_DOCS` line landed in Task 1. It changes the
  section system prompt for every host regardless. Do **not** write a test
  asserting a catalog-less compile is byte-identical to a pre-`image` one; it is
  false by construction.

**Files:**
- Modify: `src/compiler/client.ts` (`CompileOptions.images`, `MAX_IMAGES`, `validateImages`)
- Modify: `src/compiler/extract.ts` (`outlineSectionSchema.image`)
- Modify: `src/compiler/prompts.ts` (menu fragments + both prompt builders)
- Modify: `src/compiler/stream.ts` (validate, thread, carry the declared key)
- Create: `tests/image-compiler.test.ts`

**Interfaces:**
- Consumes: `ImageRef` from `src/core/images.ts`.
- Produces: `MAX_IMAGES: 24`, `validateImages(raw?: Record<string, unknown>): { catalog: Record<string, ImageRef>; warnings: string[] }`, `outlineSectionSchema.image?: string`, `outlineUserPrompt(topic, guidance?, sources?, checks?, images?)`, `sectionUserPrompt({ ..., images?, image? })`.

- [ ] **Step 1: Write the failing tests**

Create `tests/image-compiler.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { validateImages, MAX_IMAGES } from "../src/compiler/client"
import { outlineUserPrompt, sectionUserPrompt, sectionSystemPrompt } from "../src/compiler/prompts"
import { outlineSectionSchema } from "../src/compiler/extract"
import { BLOCK_TYPE_DOCS } from "../src/core/blockTypes"

const ref = {
  src: "https://cdn.example.com/a.png",
  alt: "A crowded train platform",
  width: 800,
  height: 600,
  subject: "a rush-hour platform",
}

describe("validateImages", () => {
  it("accepts a well-formed catalog and preserves key order", () => {
    const { catalog, warnings } = validateImages({ platform: ref, platformTwo: ref })
    expect(Object.keys(catalog)).toEqual(["platform", "platformTwo"])
    expect(catalog.platform).toEqual(ref)
    expect(warnings).toEqual([])
  })

  it("drops malformed entries with a stable warning naming the key", () => {
    const { catalog, warnings } = validateImages({
      nope: null,
      bad: { ...ref, alt: "" },
      ugly: { ...ref, width: -1 },
    })
    expect(Object.keys(catalog)).toEqual([])
    expect(warnings).toHaveLength(3)
    expect(warnings[0]).toBe('[images] image "nope" dropped — not an object')
    expect(warnings[1]).toContain("alt must be 1-300 chars")
    expect(warnings[2]).toContain("width must be a positive integer")
  })

  it("caps the set, reporting each overflow by key", () => {
    const many: Record<string, unknown> = {}
    for (let i = 0; i < MAX_IMAGES + 3; i++) many[`k${i}`] = { ...ref, subject: `subject ${i}` }
    const capped = validateImages(many)
    expect(Object.keys(capped.catalog)).toHaveLength(MAX_IMAGES)
    expect(capped.warnings).toHaveLength(3)
    expect(capped.warnings[0]).toBe(`[images] image "k${MAX_IMAGES}" dropped — at most ${MAX_IMAGES} images`)
  })

  it("never lets an inherited Object member become a catalog entry", () => {
    const { catalog, warnings } = validateImages({ constructor: ref, toString: ref })
    // Own enumerable keys only: a literal's inherited members are not entries.
    expect(Object.keys(catalog)).toEqual(["constructor", "toString"])
    // ...and each still had to survive its own value validation.
    expect(catalog.constructor).toEqual(ref)
    expect(warnings).toEqual([])
  })

  it("returns an empty catalog for undefined input", () => {
    expect(validateImages(undefined)).toEqual({ catalog: {}, warnings: [] })
  })
})

describe("image prompt menus", () => {
  it("lists the record key beside its subject, never src or alt", () => {
    const p = outlineUserPrompt("signals", undefined, undefined, undefined, { platform: ref })
    expect(p).toContain("- platform: a rush-hour platform")
    expect(p).toContain("Images available")
    expect(p).not.toContain("cdn.example.com")
    expect(p).not.toContain("A crowded train platform")
  })

  it("states the editorial placement rule in the section prompt", () => {
    const p = sectionUserPrompt({
      index: 0,
      title: "Why",
      goal: "Explain.",
      images: { platform: ref },
    })
    expect(p).toContain("Images available")
    expect(p).toContain("anchor an analogy or set a scene")
    expect(p).toContain("No text in the image")
  })

  it("stays byte-identical when no catalog is supplied", () => {
    // The absence-of-effect pin: these literal strings must not drift.
    expect(outlineUserPrompt("entropy")).toBe(
      "Topic: entropy\nDesign the outline. Reply with the JSON object ONLY.",
    )
    expect(sectionUserPrompt({ index: 0, title: "Why", goal: "Explain." })).toBe(
      'Write section 1 of the document: "Why"\nGoal: Explain.\n' +
        'Reply with the section JSON object ONLY: { "title": string, "blocks": Block[] }.',
    )
    // An empty record is the same as absent — no empty menu header.
    expect(outlineUserPrompt("entropy", undefined, undefined, undefined, {})).toBe(
      outlineUserPrompt("entropy"),
    )
  })

  it("teaches the block in the shared contract and the section system prompt", () => {
    expect(BLOCK_TYPE_DOCS).toContain("- image:")
    expect(sectionSystemPrompt()).toContain("- image:")
  })
})

describe("outline image declaration", () => {
  it("accepts an optional image key on a section", () => {
    expect(outlineSectionSchema.safeParse({ title: "S", goal: "G", image: "platform" }).success).toBe(true)
    expect(outlineSectionSchema.safeParse({ title: "S", goal: "G" }).success).toBe(true)
    expect(outlineSectionSchema.safeParse({ title: "S", goal: "G", image: "" }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/image-compiler.test.ts`

Expected: FAIL — `validateImages` is not exported.

- [ ] **Step 3: Add `MAX_IMAGES` and `validateImages` to `src/compiler/client.ts`**

Add to `CompileOptions`:

```ts
  /** Host image catalog the compiler may place (image spec §4.5). Deliberately
   *  the SAME Record shape as the render-side `images` option, so one object
   *  serves both compileDocument and renderDocument. Validated leniently before
   *  any prompting; absent or empty means the compile behaves exactly like an
   *  ungrounded one. */
  images?: Record<string, ImageRef>
```

And import `ImageRef` from `../core/images`. Then add:

```ts
/** Largest catalog the compiler accepts — the same budget as MAX_SOURCES, so
 *  the interpolated menu stays bounded. */
export const MAX_IMAGES = 24

/** Lenient validation of the host catalog (image spec §4.5). Hand-rolled, not
 *  zod, so warning strings stay stable across zod versions — the same
 *  deliberate choice as validateSources.
 *
 *  The Record key IS the catalog key: the model writes it into `image` and
 *  resolveImage looks it up, so the prompt menu and the renderer cannot drift.
 *  (An array could not carry a key at all — that is why this is not one.)
 *  Iteration is Object.entries order = host key order, unsorted. Own enumerable
 *  keys only, so an inherited member never becomes an entry. */
export function validateImages(raw?: Record<string, unknown>): { catalog: Record<string, ImageRef>; warnings: string[] } {
  const warnings: string[] = []
  const catalog: Record<string, ImageRef> = {}
  const entries = Object.entries(raw ?? {})
  for (const [key, value] of entries) {
    if (catalog && Object.keys(catalog).length >= MAX_IMAGES) {
      warnings.push(`[images] image "${key.slice(0, 64)}" dropped — at most ${MAX_IMAGES} images`)
      continue
    }
    const r = value as Partial<ImageRef> | null
    if (typeof r !== "object" || r === null || Array.isArray(r)) {
      warnings.push(`[images] image "${key.slice(0, 64)}" dropped — not an object`)
      continue
    }
    const issues: string[] = []
    if (typeof r.src !== "string" || r.src.length < 1) issues.push("src must be a non-empty string")
    if (typeof r.alt !== "string" || r.alt.length < 1 || r.alt.length > 300) issues.push("alt must be 1-300 chars")
    if (typeof r.width !== "number" || !Number.isInteger(r.width) || r.width <= 0 || r.width > 4000)
      issues.push("width must be a positive integer")
    if (typeof r.height !== "number" || !Number.isInteger(r.height) || r.height <= 0 || r.height > 4000)
      issues.push("height must be a positive integer")
    if (typeof r.subject !== "string" || r.subject.length < 1 || r.subject.length > 200)
      issues.push("subject must be 1-200 chars")
    if (issues.length > 0) {
      warnings.push(`[images] image "${key.slice(0, 64)}" dropped — ${issues.join("; ")}`)
      continue
    }
    catalog[key] = {
      src: r.src as string,
      alt: r.alt as string,
      width: r.width as number,
      height: r.height as number,
      subject: r.subject as string,
    }
  }
  return { catalog, warnings }
}
```

Note the `key.slice(0, 64)` — model-free host keys can be long, and an unbounded key in a warning string is the same bloat risk `compileDocumentStream` guards against for citation ids.

- [ ] **Step 4: Add `image` to the outline section schema**

In `src/compiler/extract.ts`, add to `outlineSectionSchema`:

```ts
  // Host-catalog image this section wants (image spec §6). Flag-gated in the
  // prompt like `check`: the outline is only invited to set it when a catalog
  // exists, but the schema accepts it unconditionally.
  image: z.string().min(1).optional(),
```

- [ ] **Step 5: Add the menu fragments to `src/compiler/prompts.ts`**

Add near the existing sources block helpers:

```ts
/** Catalog menu (image spec §6): the record key + subject ONLY. The key is
 *  exactly what the model writes into `image` and what resolveImage looks up,
 *  so prompt and renderer cannot drift. The LLM is text-only and has never
 *  seen these pictures — no URL, no alt, just a word for what each shows. */
function imageMenuBlock(images: Record<string, ImageRef>): string {
  return [
    "Images available (place by key where one earns its place):",
    ...Object.entries(images).map(([key, r]) => `- ${key}: ${r.subject}`),
    "",
    "Place an image only to anchor an analogy or set a scene. Images never illustrate a derivation — a drawn figure does that better. Put no text in the image itself: labels belong in the caption.",
  ].join("\n")
}
```

In `outlineUserPrompt`, add a trailing `images?: Record<string, ImageRef>` parameter and a `.filter(Boolean)`-joined entry **after** the sources block (preserving the documented fragment order topic → guidance → checks → sources → images):

```ts
    sources && sources.length > 0 ? outlineSourcesBlock(sources) : "",
    images && Object.keys(images).length > 0 ? imageMenuBlock(images) : "",
```

In `sectionUserPrompt`, add `images?: Record<string, ImageRef>` and `image?: string` to the args object, a menu entry after the sources block, and a per-section pin mirroring `args.check`:

```ts
    args.image
      ? "Include exactly ONE image block in this section, using the catalog key this section planned."
      : "",
```

Place that line immediately after the `args.check` line so the two pins read together, and add `images && Object.keys(args.images).length > 0 ? imageMenuBlock(args.images) : ""` after the sources block.

Import `ImageRef` as a type from `../core/images`.

- [ ] **Step 6: Wire it in `src/compiler/stream.ts`**

After the `validateSources` block, add:

```ts
  // Image catalog (image spec §6): validated once, before any prompting. Empty
  // after validation means byte-identical user prompts to an ungrounded one.
  const { catalog, warnings: imageWarnings } = validateImages(opts.images)
  warnings.push(...imageWarnings)
  const images = Object.keys(catalog).length > 0 ? catalog : undefined
```

Pass `images` to `outlineUserPrompt(...)` as the new fifth argument. In the per-section `sectionUserPrompt({...})` call add:

```ts
        images,
        image: images && entry.image !== undefined ? entry.image : undefined,
```

- [ ] **Step 7: Run the compiler tests**

Run: `npx vitest run tests/image-compiler.test.ts tests/compiler-prompts.test.ts tests/compiler-grounding.test.ts`

Expected: all PASS. `compiler-prompts.test.ts` is the critical one — its literal-string assertions prove the gateable fragments stayed inert.

- [ ] **Step 8: Run the full suite**

Run: `npm test && npx tsc --noEmit`

Expected: green. Any failure in `compiler-grounding.test.ts`'s "does not audit citations when sources are absent" style tests means the catalog is leaking into ungrounded compiles.

- [ ] **Step 9: Commit**

```bash
git add src/compiler/client.ts src/compiler/extract.ts src/compiler/prompts.ts src/compiler/stream.ts tests/image-compiler.test.ts
git commit -m "let the compiler place host-catalog images by key"
```

---

### Task 5: Demo, docs, and the final gate

**Files:**
- Modify: `demo/examples.js` (a new section in `demoDocIr`)
- Modify: `demo/server.mjs` (the `/document` `renderDocument` call gains `images`)
- Modify: `tests/demo-examples.test.ts` (section count 6 → 7)
- Modify: `README.md`, `docs/ROADMAP.md`

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces: no new types.

- [ ] **Step 1: Add the demo section**

In `demo/examples.js`, add a section to `demoDocIr` between the real-data and quiz sections. A hit and a deliberate miss, so the degraded path is visible on the page exactly as the datasets section shows true-vs-guessed:

```js
    {
      id: "fig-images",
      title: "Host images",
      blocks: [
        { type: "text", body: "Both image blocks name a key in the **host** catalog, so the browser never fetches anything the library invented. The first resolves; the second names a key the catalog does not have, so it degrades to its caption and warns." },
        { type: "image", id: "img-signal", image: "signal-station", caption: "A train platform where the signal is the subject — atmosphere the vector layer cannot draw." },
        { type: "image", id: "img-missing", image: "not-in-catalog", caption: "This caption survives the miss; the image never renders." },
      ],
    },
```

Also update the `summary` string so it does not still say "Six angles" — change "…the rollout, true numbers from the host, and a retrieval check." to mention host images.

- [ ] **Step 2: Supply the catalog in `demo/server.mjs`**

In the `/document` route's `renderDocument(demoDocIr, {...})` options, add an `images` entry next to `datasets`. Use a real, hotlinkable placeholder so the demo shows an actual picture rather than a broken one:

```js
      images: {
        "signal-station": {
          src: "https://picsum.photos/seed/signal-station/800/600",
          alt: "A crowded railway platform under a signal gantry",
          width: 800,
          height: 600,
          subject: "a train platform under a signal gantry",
        },
      },
```

- [ ] **Step 3: Update the demo test's section count**

In `tests/demo-examples.test.ts`, the test asserts six sections. Change it to seven and rename the test:

```ts
  it("renders a page with a TOC and all seven sections", () => {
    const { html } = renderDocument(demoDocIr, { theme: "none" })
    expect((html.match(/class="exp-doc-section"/g) ?? []).length).toBe(7)
```

- [ ] **Step 4: Run the demo tests**

Run: `npx vitest run tests/demo-examples.test.ts`

Expected: PASS. If it still says six, a section was not added or was added to the wrong array.

- [ ] **Step 5: Document it in the README**

Add a short subsection next to the existing `datasets` prose covering: the `image` block shape, the `images` prop on all four entry points, that `alt`/`width`/`height` are required, that the host owns `alt` because the model never sees the image, and that a miss degrades to the caption with a warning. Add one line noting the block-type line in the section system prompt changes for all hosts on upgrade (spec §6).

- [ ] **Step 6: Update the ROADMAP**

Move "AI-generated raster imagery" out of the candidate list into shipped, recording that shape (a) shipped and that (c) `analogy` and (b) compiler-driven briefs remain.

- [ ] **Step 7: Build and smoke the demo**

```bash
npm run build
launchctl remove explanations-demo 2>/dev/null; launchctl submit -l explanations-demo -- "$(command -v node)" "$PWD/demo/server.mjs"
```

Then in a **separate** tool call:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4173/document
curl -s http://localhost:4173/document | grep -c "exp-image-img"
curl -s http://localhost:4173/document | grep -o "exp-image-missing" | head -1
```

Expected: `200`, then `1` (exactly one image resolves — the second degrades), then `exp-image-missing` present.

- [ ] **Step 8: Full verification gate**

```bash
npm test && npx tsc --noEmit && npm run build
```

Expected: every test green (432 baseline + new), typecheck clean, build green.

- [ ] **Step 9: Diff the pre-existing demo output against `main`**

The `OPEN_THREADS.md` convention: verify by measurement. Confirm no existing figure changed:

```bash
git stash list; git diff main --stat -- demo/examples.js
```

Expect the diff to be additive only — one new section, one new summary string. Any change to an existing section is a regression; investigate before proceeding.

- [ ] **Step 10: Commit**

```bash
git add demo/examples.js demo/server.mjs tests/demo-examples.test.ts README.md docs/ROADMAP.md
git commit -m "demo the host image catalog and document the block"
```

---

## Final Review Checklist

Before declaring the branch done:

- [ ] `npm test` green; `npx tsc --noEmit` clean; `npm run build` green.
- [ ] Every demo route returns 200 (`/`, `/document`, `/interactive`, `/compile`, `/editorial`).
- [ ] `resolveImage` never resolves `"constructor"`, `"__proto__"`, or `"toString"`.
- [ ] A miss renders no `<img>`, keeps the caption, and warns.
- [ ] A miss with no caption renders nothing visible but still warns.
- [ ] The catalog key never appears in visible markup on the degraded path.
- [ ] `alt`/`width`/`height` are required by `imageRefSchema`.
- [ ] Model text reaches HTML only via `renderInline`/`escapeHtml`; `subject` never renders.
- [ ] `outlineUserPrompt("entropy")` and the bare `sectionUserPrompt` literals in `tests/compiler-prompts.test.ts` are unchanged.
- [ ] Pre-existing demo sections are byte-identical to `main`.
- [ ] **Security walk** (the diff touches untrusted input — a host catalog and model-authored captions): confirm no new sink, no new dependency, no `eval`, no fetch. Then run `rafter run` and triage findings; the known `.vexp/manifest.json` false positive is expected.
- [ ] Append an entry to `docs/OPEN_THREADS.md` recording the judgement calls: alt *quality* is the host's responsibility (the schema guarantees an alt exists, not that it is accurate), and `src` deliberately has no scheme gate.
