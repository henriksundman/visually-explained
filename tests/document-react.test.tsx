import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { Document } from "../src/react/Document"
import { renderDocument } from "../src/core/renderDocument"

const doc = {
  version: 1,
  title: "A Curio Page",
  summary: "One page, many sections.",
  sections: [
    { id: "Intro", title: "Introduction", blocks: [{ type: "text", body: "hello **world**" }] },
    { title: "Numbers", blocks: [{ type: "callout", variant: "note", body: "n" }] },
  ],
}

describe("Document (React)", () => {
  it("renders the same skeleton as the HTML renderer", () => {
    const html = renderToStaticMarkup(<Document ir={doc} theme="none" />)
    expect(html).toContain(`class="exp exp-doc"`)
    expect(html).toContain(`id="sec-intro"`)
    expect(html).toContain(`href="#sec-intro"`)
    expect(html).toContain(`id="sec-numbers"`)
    expect(html).toContain(`<h2 class="exp-doc-section-title">Introduction</h2>`)
    expect(html).toContain("<strong>world</strong>")
  })

  it("agrees with the HTML renderer on ids, anchors, and section count", () => {
    const reactHtml = renderToStaticMarkup(<Document ir={doc} theme="none" />)
    const { html } = renderDocument(doc)
    const ids = (s: string) => (s.match(/id="sec-[^"]+"/g) ?? []).sort()
    expect(ids(reactHtml)).toEqual(ids(html))
    expect((reactHtml.match(/exp-doc-section-title/g) ?? []).length).toBe(
      (html.match(/exp-doc-section-title/g) ?? []).length,
    )
  })

  it("drops malformed sections and renders leniently by default", () => {
    const html = renderToStaticMarkup(
      <Document ir={{ version: 1, title: "T", sections: [{ title: "", blocks: [] }, { title: "ok", blocks: [] }] }} />,
    )
    expect((html.match(/exp-doc-section-title/g) ?? []).length).toBe(1)
  })

  it("strict mode throws; toc: false omits the nav", () => {
    expect(() =>
      renderToStaticMarkup(<Document ir={{ version: 2, title: "T", sections: [{ title: "S", blocks: [] }] }} strict />),
    ).toThrow()
    const noToc = renderToStaticMarkup(<Document ir={doc} theme="none" toc={false} />)
    expect(noToc).not.toContain("exp-doc-toc")
  })
})
