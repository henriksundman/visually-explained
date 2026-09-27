import { describe, expect, it } from "vitest"
import { renderExplanation } from "../src/core/render"
import "../src/core/registerAll"

describe("comparison", () => {
  it("renders items as columns and dimensions as rows", () => {
    const { html } = renderExplanation({
      version: 1,
      blocks: [
        {
          type: "comparison",
          items: [{ name: "RPC" }, { name: "Queue" }],
          dimensions: [{ name: "Latency", values: ["low", "higher"] }],
        },
      ],
    })
    expect(html).toContain(`<table class="exp-table">`)
    expect(html).toContain(`<th class="exp-th exp-corner"></th>`)
    expect(html).toContain(`<th class="exp-th">RPC</th>`)
    expect(html).toContain(`<th class="exp-th exp-row-th">Latency</th>`)
    expect(html).toContain(`<td class="exp-td">low</td>`)
  })

  it("pads short value lists and truncates long ones with a warning", () => {
    const { html, warnings } = renderExplanation({
      version: 1,
      blocks: [
        {
          type: "comparison",
          items: [{ name: "A" }, { name: "B" }],
          dimensions: [{ name: "D", values: ["x"] }, { name: "E", values: ["1", "2", "3"] }],
        },
      ],
    })
    expect(html).toContain(`<td class="exp-td"></td>`)
    expect((html.match(/exp-td/g) ?? []).length).toBe(4)
    expect(warnings.filter(w => w.includes("comparison-value-count"))).toHaveLength(2)
  })
})

describe("timeline", () => {
  it("renders events with optional details", () => {
    const { html } = renderExplanation({
      version: 1,
      blocks: [
        { type: "timeline", events: [{ when: "1928", what: "Penicillin", detail: "Fleming" }] },
      ],
    })
    expect(html).toContain(`<ol class="exp-timeline-events">`)
    expect(html).toContain(`<span class="exp-event-when">1928</span>`)
    expect(html).toContain(`<p class="exp-event-what">Penicillin</p>`)
    expect(html).toContain(`<p class="exp-event-detail">Fleming</p>`)
  })
})
