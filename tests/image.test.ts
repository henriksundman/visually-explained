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

  it("still resolves such a key when the host actually supplies one", () => {
    // The guard exists to stop an INHERITED member resolving, not to reserve
    // names. A host that deliberately keys an image "constructor" owns that
    // key and must be served; conflating the two would be a silent failure.
    const w = fresh()
    expect(resolveImage(ctx({ constructor: ref }), "constructor", "im1")).toEqual({ ok: true, ref })
    expect(w).toEqual([])
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
    expect(html).not.toContain("exp-image-missing")
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
    // The attacker's text survives as escaped DATA inside src/alt, never as a
    // live attribute: every quote is &quot;, so no handler can be introduced.
    expect(html).not.toContain(`onerror="`)
    expect(html).not.toContain("<script>")
    expect(html).toContain(`src="a.png&quot; onerror=&quot;alert(1)"`)
    expect(html).toContain(`alt="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"`)
  })

  it("degrades to caption-only and warns on a miss, never a broken img", () => {
    const { html, warnings: w } = renderExplanation({ version: 1, blocks: [block] }, { images: {} })
    expect(html).not.toContain("<img")
    expect(html).toContain("before") // the caption survives
    expect(html).toContain(`exp-image-missing`)
    expect(w).toEqual([`[image] image im1: no image named "platform"`])
  })

  it("degrades under strict without throwing", () => {
    expect(() =>
      renderExplanation({ version: 1, blocks: [{ type: "image", image: "gone" }] }, { strict: true, images: {} }),
    ).not.toThrow()
  })

  it("treats a block with no image key as invalid-block, not a crash", () => {
    const { warnings } = renderExplanation({ version: 1, blocks: [{ type: "image" }] }, { images: { a: ref } })
    expect(warnings.some(w => w.includes("invalid-block"))).toBe(true)
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