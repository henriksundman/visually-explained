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

  it("produces identical figure markup from the html renderer and React", () => {
    const fromHtml = renderDocument(docIr, { images }).html
    const fromReact = renderToStaticMarkup(<Document ir={docIr} images={images} />)
    const figure = (s: string) => s.slice(s.indexOf("<figure"), s.indexOf("</figure>") + 9)
    expect(figure(fromReact)).toBe(figure(fromHtml))
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

  it("resolves an image nested inside a stack (children threading)", () => {
    const { html } = renderExplanation(
      { version: 1, blocks: [{ type: "stack", blocks: [block] }] },
      { images },
    )
    expect(html).toContain(`width="800"`)
  })
})