import { describe, expect, it } from "vitest"
import { renderExplanation } from "../src/core/render"
import { renderDocument } from "../src/core/renderDocument"
import { sourcesBlockSchema } from "../src/core/schema"
import { BLOCK_TYPE_DOCS } from "../src/core/blockTypes"
import "../src/core/registerAll"

const sourcesBlock = {
  type: "sources" as const,
  id: "src",
  title: "References",
  items: [
    { id: "s1", title: "The main paper", url: "https://example.com/paper", detail: "Where the **counting** argument comes from." },
    { id: "s2", title: "Private notes" },
    { id: "s3", title: "Bad link attempt", url: "javascript:alert(1)" },
  ],
}

describe("sources schema", () => {
  it("accepts a valid block and rejects out-of-bounds shapes", () => {
    expect(sourcesBlockSchema.safeParse(sourcesBlock).success).toBe(true)
    expect(sourcesBlockSchema.safeParse({ ...sourcesBlock, items: [] }).success).toBe(false)
    expect(
      sourcesBlockSchema.safeParse({
        ...sourcesBlock,
        items: Array.from({ length: 25 }, (_, i) => ({ id: `x${i}`, title: "t" })),
      }).success,
    ).toBe(false)
    expect(sourcesBlockSchema.safeParse({ ...sourcesBlock, items: [{ id: "", title: "t" }] }).success).toBe(false)
  })
})

describe("sources render", () => {
  it("renders the list with anchors, links, and details", () => {
    const { html, warnings } = renderExplanation({ version: 1, blocks: [sourcesBlock] })
    expect(html).toContain(`<div class="exp-block exp-sources">`)
    expect(html).toContain(`<p class="exp-sources-title">References</p>`)
    expect(html).toContain(`id="source-s1"`)
    expect(html).toContain(`<a class="exp-source-link" href="https://example.com/paper">The main paper</a>`)
    expect(html).toContain(`<strong>counting</strong>`) // detail passes through renderInline
    expect(html).toContain(`id="source-s2"`)
    expect(warnings).toEqual([])
  })

  it("renders url-less titles as plain text and degrades gated URLs", () => {
    const { html } = renderExplanation({ version: 1, blocks: [sourcesBlock] })
    // s2 has no url: title is text, not a link to itself.
    expect(html).not.toContain(`href="#source-s2"`)
    expect(html).toContain(`>Private notes</li>`)
    // s3's javascript: URL fails the gate: item survives, link does not.
    expect(html).toContain(`id="source-s3"`)
    expect(html).not.toContain(`href="javascript:`)
    expect(html).toContain(`>Bad link attempt</li>`)
  })

  it("escapes ids, titles, and details", () => {
    const { html } = renderExplanation({
      version: 1,
      blocks: [
        {
          type: "sources",
          id: "s",
          items: [{ id: `x"y`, title: `<script>alert(1)</script>`, detail: `a & b` }],
        },
      ],
    })
    expect(html).toContain(`id="source-x&quot;y"`)
    expect(html).not.toContain("<script>")
    expect(html).toContain("&lt;script&gt;")
    expect(html).toContain("a &amp; b")
  })

  it("is taught in the block-type contract", () => {
    expect(BLOCK_TYPE_DOCS).toContain("sources:")
    expect(BLOCK_TYPE_DOCS).toContain("source-<id>")
  })
})

describe("inline citation end-to-end", () => {
  it("cites a source item from body text", () => {
    const { html } = renderExplanation({
      version: 1,
      blocks: [
        { type: "text", body: "The counting argument is standard [S1](#source-s1)." },
        {
          type: "sources",
          id: "refs",
          items: [{ id: "s1", title: "The main paper", url: "https://example.com/paper" }],
        },
      ],
    })
    expect(html).toContain(`href="#source-s1"`) // the citation anchor
    expect(html).toContain(`id="source-s1"`) // the target
    expect(html.indexOf(`href="#source-s1"`)).toBeLessThan(html.indexOf(`id="source-s1"`))
  })

  it("arrives through renderDocument sections too", () => {
    const { html } = renderDocument({
      version: 1,
      title: "Doc",
      sections: [
        {
          title: "S",
          blocks: [
            { type: "text", body: "Grounded claim [S1](#source-s1)." },
            { type: "sources", id: "refs", items: [{ id: "s1", title: "Paper" }] },
          ],
        },
      ],
    })
    expect(html).toContain(`href="#source-s1"`)
    expect(html).toContain(`id="source-s1"`)
  })
})
