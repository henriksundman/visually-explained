import { describe, expect, it } from "vitest"
import { renderExplanation } from "../src/core/render"
import { diagramBlockSchema } from "../src/core/schema"
import "../src/core/registerAll"

describe("diagram", () => {
  const ir = {
    version: 1,
    blocks: [
      {
        type: "diagram",
        nodes: [
          { id: "a", label: "Deploy ships", shape: "pill" },
          { id: "b", label: "Latency spikes" },
          { id: "c", label: "Rollback", shape: "round" },
        ],
        edges: [
          { from: "a", to: "b", kind: "causes" },
          { from: "b", to: "c", kind: "leads", label: "then" },
          { from: "a", to: "ghost", kind: "causes" },
        ],
        direction: "lr" as const,
      },
    ],
  }

  it("schema accepts a diagram block", () => {
    expect(diagramBlockSchema.safeParse(ir.blocks[0]).success).toBe(true)
  })

  it("renders themed svg with node labels and edge classes", () => {
    const { html, warnings } = renderExplanation(ir)
    expect(html).toContain(`<div class="exp-block exp-diagram">`)
    expect(html).toContain(`<svg class="exp-figure"`)
    expect(html).toContain(`role="img"`)
    expect(html).toContain(`aria-label="Diagram: Deploy ships → Latency spikes → Rollback"`)
    expect(html).toContain(`Deploy ships`)
    expect(html).not.toContain(`exp-edge-conflict`) // no conflict edge in this fixture
    expect(html).toContain(`>then</text>`)
    expect(warnings.some(w => w.includes("figure-edge-dangling"))).toBe(true)
  })

  it("escapes node labels", () => {
    const { html } = renderExplanation({
      version: 1,
      blocks: [
        {
          type: "diagram",
          nodes: [{ id: "a", label: "<img src=x onerror=alert(1)>" }],
          edges: [],
        },
      ],
    })
    expect(html).not.toContain("<img")
    expect(html).toContain("&lt;img")
  })

  it("derives arrow ids and carries node tips into the scene", () => {
    const { html } = renderExplanation({
      version: 1,
      blocks: [
        {
          type: "diagram",
          nodes: [
            { id: "dep", label: "Deploy ships", tip: "Start of every incident" },
            { id: "lat", label: "Latency spikes" },
          ],
          edges: [{ from: "dep", to: "lat" }],
        },
      ],
    })
    expect(html).toContain(`data-el-id="dep"`)
    expect(html).toContain(`data-tip="Start of every incident"`)
    expect(html).toContain(`data-el-id="dep-&gt;lat"`) // derived arrow id, escaped >
  })
})
