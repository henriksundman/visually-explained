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
    // Values are bare; the unit is one plot-level label above the plot
    // (figure-label-overflow spec §2.3).
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
    expect(html).toContain(">240</text>")
    expect(html).toContain(">ms</text>")
    expect(html).not.toContain("240ms")
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

  it("carries point tips and derives bar ids", () => {
    const { html } = renderExplanation({
      version: 1,
      blocks: [
        {
          type: "chart",
          kind: "bar",
          points: [
            { label: "Mon", value: 120 },
            { label: "Wed", value: 240, tip: "Deploy day spike" },
          ],
        },
      ],
    })
    expect(html).toContain(`data-el-id="bar:Mon"`) // id present, no tip → no tabindex
    expect(html).toContain(`data-tip="Deploy day spike"`)
  })

  it("derives dot ids for line charts", () => {
    const { html } = renderExplanation({
      version: 1,
      blocks: [
        {
          type: "chart",
          kind: "line",
          points: [
            { label: "Mon", value: 1 },
            { label: "Tue", value: 3, tip: "Spike" },
          ],
        },
      ],
    })
    expect(html).toContain(`data-el-id="dot:Mon"`) // id present, no tip → no tabindex
    expect(html).toContain(`<g class="exp-el" data-el-id="dot:Tue" data-tip="Spike" tabindex="0">`)
  })

  it("keeps the dataset key on an otherwise-valid chart block", () => {
    const parsed = chartBlockSchema.safeParse({
      id: "c1",
      type: "chart",
      kind: "bar",
      points: [{ label: "Mon", value: 4 }],
      dataset: "weekly-deploys",
    })
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.dataset).toBe("weekly-deploys")
  })
})

const deploysDataset = {
  kind: "bar" as const,
  points: [
    { label: "Mon", value: 4 },
    { label: "Tue", value: 9, tip: "Deploy day" },
  ],
  unit: "deploys",
}

describe("chart datasets", () => {
  it("renders dataset numbers over literal fields", () => {
    const { html, warnings } = renderExplanation(
      {
        version: 1,
        blocks: [{ type: "chart", id: "dep", kind: "bar", points: [{ label: "Mon", value: 120 }], dataset: "deploys" }],
      },
      { datasets: { deploys: deploysDataset } },
    )
    expect(html).toContain(">4</text>")
    expect(html).toContain(">deploys</text>")
    expect(html).toContain(`data-tip="Deploy day"`)
    expect(html).not.toContain(">120")
    expect(warnings).toEqual([])
  })

  it("keeps literals for fields the dataset omits", () => {
    const { html } = renderExplanation(
      {
        version: 1,
        blocks: [{ type: "chart", id: "dep", kind: "bar", points: [{ label: "Mon", value: 120 }], unit: "ms", caption: "kept", dataset: "partial" }],
      },
      { datasets: { partial: { kind: "bar", points: [{ label: "Mon", value: 7 }] } } },
    )
    expect(html).toContain(">7")
    expect(html).toContain("kept</p>")
    expect(html).toContain(">7</text>")
    expect(html).toContain(">ms</text>")
  })

  it("warns and renders literals on a key miss", () => {
    const { html, warnings } = renderExplanation({
      version: 1,
      blocks: [{ type: "chart", id: "dep", kind: "bar", points: [{ label: "Mon", value: 120 }], dataset: "nope" }],
    })
    expect(html).toContain(">120")
    expect(warnings).toEqual([`[dataset] chart dep: no dataset named "nope"`])
  })

  it("warns and renders literals on an invalid payload", () => {
    const { html, warnings } = renderExplanation(
      {
        version: 1,
        blocks: [{ type: "chart", id: "dep", kind: "bar", points: [{ label: "Mon", value: 120 }], dataset: "bad" }],
      },
      { datasets: { bad: { kind: "pie" } } },
    )
    expect(html).toContain(">120")
    expect(warnings[0]).toMatch(/^\[dataset\] chart dep: invalid payload — /)
  })

  it("never throws under strict for a dataset miss", () => {
    const { html, warnings } = renderExplanation(
      {
        version: 1,
        blocks: [{ type: "chart", id: "dep", kind: "bar", points: [{ label: "Mon", value: 120 }], dataset: "nope" }],
      },
      { strict: true },
    )
    expect(html).toContain(">120")
    expect(warnings).toHaveLength(1)
  })

  it("applies per-point salvage to dataset points", () => {
    const { html, warnings } = renderExplanation(
      {
        version: 1,
        blocks: [{ type: "chart", id: "dep", kind: "bar", points: [{ label: "Mon", value: 120 }], dataset: "mixed" }],
      },
      { datasets: { mixed: { kind: "bar", points: [{ label: "ok", value: 1 }, { label: "bad" }, "junk"] } } },
    )
    expect(warnings.filter(w => w.includes("figure-point-invalid"))).toHaveLength(2)
    expect((html.match(/>ok<\/text>/g) ?? []).length).toBe(1)
  })
})
