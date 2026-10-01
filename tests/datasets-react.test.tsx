import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { renderDocument } from "../src/core/renderDocument"
import { Explanation, Document } from "../src/react"
import "../src/core/registerAll"

const chartBlock = {
  type: "chart",
  id: "dep",
  kind: "bar",
  points: [{ label: "Mon", value: 120 }],
  dataset: "deploys",
}
const datasets = { deploys: { kind: "bar", points: [{ label: "Mon", value: 4 }] } }
const docIr = {
  version: 1,
  title: "Doc",
  sections: [{ title: "S", blocks: [chartBlock] }],
}

describe("datasets entry-point parity", () => {
  it("renderDocument resolves datasets", () => {
    const { html } = renderDocument(docIr, { datasets })
    expect(html).toContain(">4</text>")
    expect(html).not.toContain(">120")
  })

  it("<Explanation> resolves datasets", () => {
    const html = renderToStaticMarkup(
      <Explanation ir={{ version: 1, blocks: [chartBlock] }} datasets={datasets} />,
    )
    expect(html).toContain(">4</text>")
    expect(html).not.toContain(">120")
  })

  it("<Document> resolves datasets", () => {
    const html = renderToStaticMarkup(<Document ir={docIr} datasets={datasets} />)
    expect(html).toContain(">4</text>")
    expect(html).not.toContain(">120")
  })

  it("react output matches the html renderer's dataset numbers", () => {
    const { html } = renderDocument(docIr, { theme: "none", datasets })
    const react = renderToStaticMarkup(<Document ir={docIr} theme="none" datasets={datasets} />)
    expect(react).toContain(">4</text>")
    expect(html).toContain(">4</text>")
  })
})
