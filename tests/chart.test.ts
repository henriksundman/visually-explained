import { describe, expect, it } from "vitest"
import { renderExplanation } from "../src/core/render"
import { chartBlockSchema } from "../src/core/schema"
import "../src/core/registerAll"

describe("chart", () => {
  it("schema accepts numeric and numeric-string values", () => {
    expect(
      chartBlockSchema.safeParse({
        type: "chart",
        kind: "bar",
        points: [{ label: "a", value: 1 }, { label: "b", value: "2.5" }],
      }).success,
    ).toBe(true)
  })

  it("renders bar chart with unit and caption", () => {
    const { html, warnings } = renderExplanation({
      version: 1,
      blocks: [
        {
          type: "chart",
          kind: "bar",
          points: [{ label: "Mon", value: 120 }, { label: "Tue", value: 240 }],
          unit: "ms",
          caption: "p95 by day",
        },
      ],
    })
    expect(html).toContain(`<div class="exp-block exp-chart">`)
    expect(html).toContain(`<svg class="exp-figure"`)
    expect(html).toContain(`aria-label="p95 by day"`)
    expect(html).toContain(">240ms</text>")
    expect(html).toContain(`<p class="exp-fig-caption">p95 by day</p>`)
    expect(warnings).toEqual([])
  })

  it("drops malformed points with a warning and keeps the rest", () => {
    const { html, warnings } = renderExplanation({
      version: 1,
      blocks: [
        {
          type: "chart",
          kind: "line",
          points: [{ label: "a", value: 1 }, { label: "b" }, "junk", { label: "c", value: "3" }],
        },
      ],
    })
    expect(warnings.filter(w => w.includes("figure-point-invalid"))).toHaveLength(2)
    expect((html.match(/>a<\/text>/g) ?? []).length).toBe(1)
    expect((html.match(/>c<\/text>/g) ?? []).length).toBe(1)
  })

  it("renders an empty-state message when no point survives", () => {
    const { html, warnings } = renderExplanation({
      version: 1,
      blocks: [{ type: "chart", kind: "bar", points: [{ value: "x" }] }],
    })
    expect(html).toContain("exp-fig-empty")
    expect(warnings.some(w => w.includes("figure-point-invalid"))).toBe(true)
  })

  it("escapes labels and captions", () => {
    const { html } = renderExplanation({
      version: 1,
      blocks: [{ type: "chart", kind: "bar", points: [{ label: "<x>", value: 1 }], caption: "<script>y</script>" }],
    })
    expect(html).not.toContain("<script>")
    expect(html).toContain("&lt;script&gt;")
  })
})
