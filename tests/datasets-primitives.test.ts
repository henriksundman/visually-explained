import { describe, expect, it } from "vitest"
import { renderExplanation } from "../src/core/render"
import "../src/core/registerAll"

describe("data-callout datasets", () => {
  it("materializes metric, series, and context from the dataset", () => {
    const { html, warnings } = renderExplanation(
      {
        version: 1,
        blocks: [{ type: "data-callout", id: "dc", metric: "0", label: "placeholder", dataset: "deploys" }],
      },
      {
        datasets: {
          deploys: { metric: "42", label: "deploys last week", trend: "up", series: [3, 5, 8, 13], context: "From CI." },
        },
      },
    )
    expect(html).toContain(`class="exp-metric">42<`)
    expect(html).toContain("deploys last week")
    expect(html).toContain("exp-spark-box")
    expect(html).toContain("From CI.")
    expect(html).not.toContain(`>0<`)
    expect(warnings).toEqual([])
  })

  it("keeps literal fields the dataset omits and warns on a miss", () => {
    const partial = renderExplanation(
      {
        version: 1,
        blocks: [{ type: "data-callout", id: "dc", metric: "9", label: "kept", delta: "+2", dataset: "p" }],
      },
      { datasets: { p: { metric: "77", label: "overridden" } } },
    )
    expect(partial.html).toContain(`class="exp-metric">77<`)
    expect(partial.html).toContain("overridden") // dataset-defined label wins
    expect(partial.html).toContain("+2") // delta omitted by the dataset → literal kept
    expect(partial.html).not.toContain("kept")

    const miss = renderExplanation({
      version: 1,
      blocks: [{ type: "data-callout", id: "dc", metric: "9", label: "kept", dataset: "nope" }],
    })
    expect(miss.html).toContain(`class="exp-metric">9<`)
    expect(miss.warnings).toEqual([`[dataset] data-callout dc: no dataset named "nope"`])
  })
})

describe("timeline datasets", () => {
  const events = [
    { when: "2024-01", what: "Design", tip: "Kickoff" },
    { when: "2024-06", what: "Launch" },
  ]

  it("materializes events from the dataset", () => {
    const { html, warnings } = renderExplanation(
      {
        version: 1,
        blocks: [{ type: "timeline", id: "tl", events: [{ when: "x", what: "guessed" }], dataset: "milestones" }],
      },
      { datasets: { milestones: { events } } },
    )
    expect(html).toContain("2024-01")
    expect(html).toContain(`data-tip="Kickoff"`)
    expect(html).not.toContain("guessed")
    expect(warnings).toEqual([])
  })

  it("warns and renders literal events on a miss", () => {
    const { html, warnings } = renderExplanation({
      version: 1,
      blocks: [{ type: "timeline", id: "tl", events: [{ when: "x", what: "guessed" }], dataset: "nope" }],
    })
    expect(html).toContain("guessed")
    expect(warnings).toEqual([`[dataset] timeline tl: no dataset named "nope"`])
  })
})
