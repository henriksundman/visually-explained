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

  it("bounds the body field independently of the caption", () => {
    // 1200 is reasoned from the 300-char caption and the "a paragraph or two"
    // intent, not measured against real course content (image-body spec §8).
    expect(imageBlockSchema.safeParse({ type: "image", image: "p", body: "x".repeat(1200) }).success).toBe(true)
    expect(imageBlockSchema.safeParse({ type: "image", image: "p", body: "x".repeat(1201) }).success).toBe(false)
    expect(imageBlockSchema.safeParse({ type: "image", image: "p", body: "" }).success).toBe(false)
    // Omitted is the shipped shape and must keep parsing.
    expect(imageBlockSchema.safeParse({ type: "image", image: "p" }).success).toBe(true)
    // The two caps are independent: a long body does not excuse a long caption.
    expect(
      imageBlockSchema.safeParse({ type: "image", image: "p", body: "b", caption: "x".repeat(301) }).success,
    ).toBe(false)
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
    expect(BLOCK_TYPE_DOCS).toContain("body?")
  })
})

describe("image body", () => {
  const withBody = {
    type: "image",
    id: "im2",
    image: "platform",
    caption: "Rush hour.",
    body: "The **head** is red, so the train is stopped.",
  }
  const images = { platform: ref }

  it("renders the prose in its own column beside the picture", () => {
    const { html, warnings: w } = renderExplanation({ version: 1, blocks: [withBody] }, { images })
    expect(html).toContain(`<figure class="exp-block exp-image exp-image-body">`)
    expect(html).toContain(`<div class="exp-image-prose">`)
    expect(html).toContain(`<strong>head</strong>`) // body via renderInline
    expect(html).toContain(`alt="A crowded train platform at rush hour"`)
    expect(w).toEqual([])
  })

  it("keeps the caption as the LAST child of the figure", () => {
    // HTML permits <figcaption> only as the first or last child of its <figure>.
    // Nesting it inside .exp-image-prose would style better and be invalid, so
    // the ordering is pinned rather than assumed.
    const { html } = renderExplanation({ version: 1, blocks: [withBody] }, { images })
    expect(html.indexOf(`class="exp-fig-caption"`)).toBeGreaterThan(html.indexOf(`class="exp-image-prose"`))
    // Immediately closed by its figure = last child, which is what the HTML
    // content model requires. (The whole document also ends in </figure>, but
    // that proves nothing: it would hold with the caption nested in the prose.)
    expect(html).toContain("</figcaption></figure>")
  })

  it("renders prose with no caption at all", () => {
    const { html, warnings: w } = renderExplanation(
      { version: 1, blocks: [{ type: "image", image: "platform", body: "Just prose." }] },
      { images },
    )
    expect(html).toContain(`Just prose.`)
    expect(html).not.toContain("exp-fig-caption")
    expect(w).toEqual([])
  })

  it("escapes the body rather than emitting it as markup", () => {
    const { html } = renderExplanation(
      { version: 1, blocks: [{ type: "image", image: "platform", body: "<script>alert(1)</script>" }] },
      { images },
    )
    expect(html).not.toContain("<script>")
    expect(html).toContain("&lt;script&gt;")
  })

  it("keeps the prose readable when the image misses, without the dashed box", () => {
    // The improvement this field buys: before it, the same failure left an
    // orphan caption marooned between paragraphs. The dashed border is dropped
    // because it would wrap the reader's own legitimate prose -- and the
    // warning, not the chrome, is how a host learns (image-body spec §3.6).
    const { html, warnings: w } = renderExplanation({ version: 1, blocks: [withBody] }, { images: {} })
    expect(html).not.toContain("<img")
    expect(html).toContain(`<strong>head</strong>`)
    expect(html).toContain("Rush hour.")
    expect(html).not.toContain("exp-image-missing")
    expect(w).toEqual([`[image] image im2: no image named "platform"`])
  })

  it("still renders prose on a miss when there is no caption", () => {
    const { html, warnings: w } = renderExplanation(
      { version: 1, blocks: [{ type: "image", image: "gone", body: "Kept anyway." }] },
      { images: {} },
    )
    expect(html).toContain("Kept anyway.")
    expect(w).toHaveLength(1)
  })

  it("does not throw on a miss under strict", () => {
    expect(() =>
      renderExplanation({ version: 1, blocks: [withBody] }, { strict: true, images: {} }),
    ).not.toThrow()
  })

  it("still never leaks the catalog key when degraded", () => {
    const { html } = renderExplanation(
      { version: 1, blocks: [{ type: "image", image: "secret-internal-key", body: "b", caption: "c" }] },
      { images: {} },
    )
    expect(html).not.toContain("secret-internal-key")
  })

  it("leaves a body-less block byte-identical to the shipped output", () => {
    // The unit-level twin of the corpus diff. A `toContain` family of asserts
    // would still pass if a wrapper div appeared around the caption, which is
    // exactly the kind of drift the corpus gate exists to catch.
    const { html, warnings: w } = renderExplanation(
      { version: 1, blocks: [{ type: "image", id: "im1", image: "platform", caption: "Rush **hour**." }] },
      { images },
    )
    expect(html).toBe(
      `<div class="exp">` +
        `<figure class="exp-block exp-image">` +
        `<img class="exp-image-img" src="${ref.src}" alt="${ref.alt}"` +
        ` width="${ref.width}" height="${ref.height}" loading="lazy" decoding="async">` +
        `<figcaption class="exp-fig-caption">Rush <strong>hour</strong>.</figcaption>` +
        `</figure>` +
        `</div>`,
    )
    expect(html).not.toContain("exp-image-body")
    expect(html).not.toContain("exp-image-prose")
    expect(w).toEqual([])
  })
})