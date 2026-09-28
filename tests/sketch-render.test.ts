import { describe, expect, it } from "vitest"
import { renderBlock, renderExplanation } from "../src/core/render"
import "../src/core/registerAll"

const ir = {
  version: 1,
  blocks: [
    {
      type: "diagram",
      nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
      edges: [{ from: "a", to: "b" }],
    },
  ],
}

describe("sketch option", () => {
  it("default render is clean; sketch render adds exp-sketch and rough paths", () => {
    const clean = renderExplanation(ir)
    expect(clean.html).not.toContain(`exp-sketch`)
    expect(clean.html).not.toContain(`exp-fig-sketch`)

    const sketchy = renderExplanation(ir, { sketch: true })
    expect(sketchy.html).toContain(`class="exp exp-sketch"`)
    expect(sketchy.html).toContain(`class="exp-fig-sketch"`)
  })

  it("is byte-identical across runs (seeded)", () => {
    expect(renderExplanation(ir, { sketch: true }).html).toBe(renderExplanation(ir, { sketch: true }).html)
  })

  it("renderBlock accepts a sketch opt for the React adapter", () => {
    const html = renderBlock("diagram", ir.blocks[0], 1, { sketch: true })
    expect(html).toContain(`class="exp-fig-sketch"`)
  })
})
