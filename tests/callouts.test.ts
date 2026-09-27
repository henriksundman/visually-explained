import { describe, expect, it } from "vitest"
import { renderExplanation } from "../src/core/render"
import "../src/core/registerAll"

describe("callout", () => {
  it("renders each variant class", () => {
    for (const variant of ["note", "tip", "warning"] as const) {
      const { html } = renderExplanation({ version: 1, blocks: [{ type: "callout", variant, body: "**hi**" }] })
      expect(html).toContain(`<div class="exp-block exp-callout exp-callout-${variant}">`)
      expect(html).toContain(`<p class="exp-callout-body"><strong>hi</strong></p>`)
    }
  })
})

describe("data-callout", () => {
  it("renders metric, label, delta with trend class, and context", () => {
    const { html } = renderExplanation({
      version: 1,
      blocks: [
        { type: "data-callout", metric: "42%", label: "Pass rate", delta: "+3.1", trend: "up", context: "vs last week" },
      ],
    })
    expect(html).toContain(`<span class="exp-metric">42%</span>`)
    expect(html).toContain(`<span class="exp-metric-label">Pass rate</span>`)
    expect(html).toContain(`<span class="exp-delta exp-delta-up">+3.1</span>`)
    expect(html).toContain(`<p class="exp-context">vs last week</p>`)
  })

  it("omits optional parts and escapes metric", () => {
    const { html } = renderExplanation({
      version: 1,
      blocks: [{ type: "data-callout", metric: "<x>", label: "L" }],
    })
    expect(html).toContain(`<span class="exp-metric">&lt;x&gt;</span>`)
    expect(html).not.toContain("exp-delta")
    expect(html).not.toContain("exp-context")
  })
})
