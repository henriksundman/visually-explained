import { describe, expect, it } from "vitest"
import { renderExplanation } from "../src/core/render"
import { renderDocument } from "../src/core/renderDocument"
import { headingBlockSchema } from "../src/core/schema"
import { BLOCK_TYPE_DOCS } from "../src/core/blockTypes"
import { sectionSystemPrompt } from "../src/compiler/prompts"
import "../src/core/registerAll"

describe("heading schema", () => {
  it("accepts text and rejects a missing or empty one", () => {
    expect(headingBlockSchema.safeParse({ type: "heading", text: "Why it matters" }).success).toBe(true)
    expect(headingBlockSchema.safeParse({ type: "heading" }).success).toBe(false)
    expect(headingBlockSchema.safeParse({ type: "heading", text: "" }).success).toBe(false)
  })

  it("bounds text at 200 characters", () => {
    // A heading longer than this is an authoring error, not a long heading.
    expect(headingBlockSchema.safeParse({ type: "heading", text: "x".repeat(200) }).success).toBe(true)
    expect(headingBlockSchema.safeParse({ type: "heading", text: "x".repeat(201) }).success).toBe(false)
  })

  it("takes an optional id, as every block does", () => {
    expect(headingBlockSchema.safeParse({ type: "heading", text: "T", id: "why" }).success).toBe(true)
  })
})

describe("heading render", () => {
  it("renders an h3 with the text through renderInline", () => {
    const { html, warnings } = renderExplanation({
      version: 1,
      blocks: [{ type: "heading", text: "Why it **matters**" }],
    })
    expect(html).toContain(`<h3 class="exp-heading">`)
    expect(html).toContain(`<strong>matters</strong>`)
    expect(warnings).toEqual([])
  })

  it("emits no id attribute at all when the block has none", () => {
    // Not `id=""` — an empty id is a different attribute and would be picked up
    // by document.getElementById("") style lookups and by fragment links.
    const { html } = renderExplanation({ version: 1, blocks: [{ type: "heading", text: "No anchor" }] })
    expect(html).toContain(`<h3 class="exp-heading">No anchor</h3>`)
    expect(html).not.toContain("id=")
  })

  it("prefixes an authored id with h- so it cannot collide with a section", () => {
    // Sections use the `sec-` prefix (sectionAnchor), so `h-` makes a
    // heading/section id collision structurally impossible rather than merely
    // unlikely.
    const { html } = renderExplanation({
      version: 1,
      blocks: [{ type: "heading", text: "Anchored", id: "why" }],
    })
    expect(html).toContain(`<h3 class="exp-heading" id="h-why">`)
  })

  it("escapes the text and the id", () => {
    const { html } = renderExplanation({
      version: 1,
      blocks: [{ type: "heading", text: '<script>alert(1)</script>', id: '"><script>' }],
    })
    expect(html).not.toContain("<script>")
    expect(html).toContain("&lt;script&gt;")
  })

  it("renders at a fixed h3 — never another level", () => {
    // A `level` field was rejected: it makes a SKIPPED level expressible, which
    // is the real accessibility failure. The block has no way to emit h1, h2 or
    // h4 at all.
    for (const text of ["A", "B", "C"]) {
      const { html } = renderExplanation({ version: 1, blocks: [{ type: "heading", text }] })
      expect(html).toContain("<h3 ")
      expect(html).not.toMatch(/<h[12456]/)
    }
  })

  it("nests inside a stack without disturbing its siblings", () => {
    const { html } = renderExplanation({
      version: 1,
      blocks: [
        {
          type: "stack",
          blocks: [{ type: "heading", text: "Inside" }, { type: "text", body: "after" }],
        },
      ],
    })
    expect(html).toContain(`<h3 class="exp-heading">Inside</h3>`)
    expect(html).toContain("after")
  })

  it("renders inside a document section, filling the empty h3 slot", () => {
    const { html } = renderDocument({
      version: 1,
      title: "Doc",
      sections: [
        { title: "Section", blocks: [{ type: "heading", text: "Sub" }, { type: "text", body: "x" }] },
      ],
    })
    expect(html).toContain(`<h2 class="exp-doc-section-title">Section</h2>`)
    expect(html).toContain(`<h3 class="exp-heading">Sub</h3>`)
  })
})

describe("heading degradation", () => {
  it("drops an invalid heading with a warning and keeps its neighbours", () => {
    const { html, warnings } = renderExplanation({
      version: 1,
      blocks: [
        { type: "text", body: "before" },
        { type: "heading", text: "" },
        { type: "text", body: "after" },
      ],
    })
    expect(html).not.toContain("exp-heading")
    expect(html).toContain("before")
    expect(html).toContain("after")
    expect(warnings.some(w => w.includes("invalid-block"))).toBe(true)
  })

  it("rides the standard input-validation path under strict", () => {
    // A block that fails its SCHEMA is an input error, which is exactly what
    // `strict` gates (open thread 1: strict gates the input, failOnWarning
    // gates the output). So this throws, unlike a render-time degradation.
    // Asserting the throw is the point: it proves heading introduced no new
    // degradation path of its own.
    expect(() =>
      renderExplanation({ version: 1, blocks: [{ type: "heading" }] }, { strict: true }),
    ).toThrow(/invalid-block/)
    // The same block without strict degrades, as every invalid block does.
    expect(() =>
      renderExplanation({ version: 1, blocks: [{ type: "heading" }] }),
    ).not.toThrow()
    // And a VALID heading never trips strict at all.
    expect(() =>
      renderExplanation({ version: 1, blocks: [{ type: "heading", text: "Fine" }] }, { strict: true }),
    ).not.toThrow()
  })
})

describe("heading contract", () => {
  it("is taught in the shared block-type contract and the section system prompt", () => {
    expect(BLOCK_TYPE_DOCS).toContain("- heading:")
    expect(sectionSystemPrompt()).toContain("- heading:")
  })
})