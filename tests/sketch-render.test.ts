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

describe("sketch keeps text labels", () => {
  const labelled = {
    version: 1,
    blocks: [
      {
        type: "diagram",
        nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
        edges: [{ from: "a", to: "b", label: "canary only" }],
      },
    ],
  }

  it("keeps edge labels crisp in the sketch pass (text is never roughed)", () => {
    // rough.js cannot draw text, so sketchElementSvg deliberately returns
    // nothing for labels; sceneToSvg owns emitting them. It used to do so
    // only for node boxes and plain labels, silently dropping edge labels.
    const clean = renderExplanation(labelled).html
    const sketchy = renderExplanation(labelled, { sketch: true }).html
    expect(clean).toContain("canary only")
    expect(sketchy).toContain("canary only")
    expect(sketchy).toContain(`class="exp-fig-sketch"`) // strokes still roughed
  })

  it("keeps a wrapped multi-line edge label whole in the sketch pass", () => {
    const long = {
      version: 1,
      blocks: [
        {
          type: "diagram",
          nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
          edges: [{ from: "a", to: "b", label: "a label far too long for one gutter to hold" }],
        },
      ],
    }
    const sketchy = renderExplanation(long, { sketch: true }).html
    const lines = [...sketchy.matchAll(/<tspan[^>]*>([^<]*)</g)].map(m => m[1])
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.join(" ")).toBe("a label far too long for one gutter to hold")
  })
})
