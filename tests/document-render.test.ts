import { describe, expect, it } from "vitest"
import { renderDocument } from "../src/core/renderDocument"
import "../src/core/registerAll"

const doc = {
  version: 1,
  title: "A Curio Page",
  summary: "One page, many sections.",
  sections: [
    { id: "Intro", title: "Introduction", blocks: [{ type: "text", body: "hello" }] },
    { title: "Numbers", blocks: [{ type: "callout", variant: "note", body: "n" }] },
  ],
}

describe("renderDocument", () => {
  it("emits the exp-doc skeleton with header, TOC, and sections", () => {
    const { html, warnings } = renderDocument(doc)
    expect(warnings).toEqual([])
    expect(html).toContain(`<article class="exp exp-doc">`)
    expect(html).toContain(`<h1 class="exp-doc-title">A Curio Page</h1>`)
    expect(html).toContain(`<p class="exp-doc-summary">One page, many sections.</p>`)
    expect(html).toContain(`<nav class="exp-doc-toc" aria-label="On this page">`)
    expect(html).toContain(`<a href="#sec-intro">Introduction</a>`)
    expect(html).toContain(`<a href="#sec-numbers">Numbers</a>`)
    expect(html).toContain(`<section class="exp-doc-section" id="sec-intro">`)
    expect(html).toContain(`<h2 class="exp-doc-section-title">Introduction</h2>`)
    expect(html).toContain(`<h2 class="exp-doc-section-title">Numbers</h2>`)
    expect(html).toContain(`<div class="exp-block exp-text"><p>hello</p></div>`)
  })

  it("order is header → nav → sections", () => {
    const { html } = renderDocument(doc)
    expect(html.indexOf("exp-doc-header")).toBeLessThan(html.indexOf("exp-doc-toc"))
    expect(html.indexOf("exp-doc-toc")).toBeLessThan(html.indexOf("exp-doc-section"))
  })

  it("omits TOC when toc: false", () => {
    const { html } = renderDocument(doc, { toc: false })
    expect(html).not.toContain("exp-doc-toc")
  })

  it("theme and sketch options land on the root", () => {
    const { html } = renderDocument(doc, { theme: "dark", sketch: true })
    expect(html).toContain(`<article class="exp exp-doc exp-theme-dark exp-sketch">`)
  })

  it("renders section titles through the inline renderer and escapes IR text", () => {
    const { html } = renderDocument({
      version: 1,
      title: "<b>T</b>",
      sections: [{ title: "A *real* <em>section</em>", blocks: [] }],
    })
    expect(html).toContain("&lt;b&gt;T&lt;/b&gt;")
    expect(html).toContain("A <em>real</em> &lt;em&gt;section&lt;/em&gt;")
    expect(html).not.toContain("<b>T</b>")
  })

  it("drops one malformed section alone and keeps the rest", () => {
    const { html, warnings } = renderDocument({
      version: 1,
      title: "T",
      sections: [{ title: "ok", blocks: [] }, { title: "", blocks: [] }, { title: "also ok", blocks: [] }],
    })
    expect((html.match(/class="exp-doc-section"/g) ?? []).length).toBe(2)
    expect(html).toContain("ok")
    expect(warnings.some(w => w.includes("section 1"))).toBe(true)
  })

  it("renders an empty shell with a warning when the top level is broken", () => {
    const { html, warnings } = renderDocument({ version: 2, sections: "nope" })
    expect(html).toBe(`<article class="exp exp-doc"></article>`)
    expect(warnings.length).toBeGreaterThan(0)
    const { html: nonArray } = renderDocument({ version: 1, title: "T", sections: [null] })
    expect((nonArray.match(/class="exp-doc-section"/g) ?? []).length).toBe(0)
  })

  it("strict mode throws on any diagnostic", () => {
    expect(() => renderDocument({ version: 2, title: "T", sections: [{ title: "S", blocks: [] }] }, { strict: true })).toThrow(/version/)
    expect(() =>
      renderDocument(
        { version: 1, title: "T", sections: [{ title: "S", blocks: [] }, { title: "", blocks: [] }] },
        { strict: true },
      ),
    ).toThrow(/section 1/) // section-level diagnostics count in strict mode too
    expect(() => renderDocument(doc, { strict: true })).not.toThrow()
  })

  it("is deterministic and script-free", () => {
    expect(renderDocument(doc).html).toBe(renderDocument(doc).html)
    expect(renderDocument(doc).html).not.toContain("<script")
  })

  it("blocks render with block-level leniency and sketch passthrough", () => {
    const { html, warnings } = renderDocument({
      version: 1,
      title: "T",
      sections: [{ title: "S", blocks: [{ type: "text" }, { type: "text", body: "fine" }] }],
    })
    expect((html.match(/exp-block exp-text/g) ?? []).length).toBe(1)
    expect(warnings.some(w => w.includes("skipped"))).toBe(true)
    const sketched = renderDocument(
      { version: 1, title: "T", sections: [{ title: "S", blocks: [{ type: "diagram", nodes: [{ id: "a", label: "A" }], edges: [] }] }] },
      { sketch: true },
    )
    expect(sketched.html).toContain("exp-fig-sketch") // sketch pass reached the block layer
    const unknown = renderDocument({ version: 1, title: "T", sections: [{ title: "S", blocks: [{ type: "mindmap", title: "Sales" }] }] })
    expect(unknown.html).toContain("exp-fallback") // unknown types reuse render.ts's escaped fallback
  })
})
