import { describe, expect, it } from "vitest"
import { renderExplanation } from "../src/core/render"
import { explanationSchema } from "../src/core/schema"
import "../src/core/registerAll"

const chain3 = [
  { because: "b1", therefore: "t1" },
  { because: "b2", therefore: "t2" },
  { because: "b3", therefore: "t3" },
]
const chain7 = Array.from({ length: 7 }, (_, i) => ({ because: `b${i}`, therefore: `t${i}` }))

describe("presentation: cause-effect", () => {
  it("auto renders a figure for chains of ≤5 links", () => {
    const { html, warnings } = renderExplanation({ version: 1, blocks: [{ type: "cause-effect", chain: chain3 }] })
    expect(html).toContain(`<svg class="exp-figure"`)
    expect(html).toContain(`aria-label="Cause and effect: b1 → t1; b2 → t2; b3 → t3"`)
    expect(warnings).toEqual([])
  })

  it("auto falls back to text rows beyond 5 links", () => {
    const { html } = renderExplanation({ version: 1, blocks: [{ type: "cause-effect", chain: chain7 }] })
    expect(html).toContain(`<ol class="exp-cause-chain">`)
    expect(html).not.toContain(`exp-figure`)
  })

  it("presentation text forces the legacy markup; figure forces svg even for 1 link", () => {
    const text = renderExplanation({
      version: 1,
      blocks: [{ type: "cause-effect", chain: chain3, presentation: "text" }],
    })
    expect(text.html).toContain(`<ol class="exp-cause-chain">`)
    const fig = renderExplanation({
      version: 1,
      blocks: [{ type: "cause-effect", chain: [{ because: "b", therefore: "t" }], presentation: "figure" }],
    })
    expect(fig.html).toContain(`<svg class="exp-figure"`)
  })
})

describe("presentation: timeline", () => {
  it("auto renders a figure for up to 12 events", () => {
    const events = Array.from({ length: 3 }, (_, i) => ({ when: `t${i}`, what: `what ${i}` }))
    const { html } = renderExplanation({ version: 1, blocks: [{ type: "timeline", events }] })
    expect(html).toContain(`<svg class="exp-figure"`)
    expect(html).toContain(`aria-label="Timeline: t0 what 0 → t1 what 1 → t2 what 2"`)
  })

  it("auto falls back to text beyond 12 events; text forces legacy markup", () => {
    const many = Array.from({ length: 13 }, (_, i) => ({ when: `t${i}`, what: `w${i}` }))
    const auto = renderExplanation({ version: 1, blocks: [{ type: "timeline", events: many }] })
    expect(auto.html).toContain(`<ol class="exp-timeline-events">`)
    const forced = renderExplanation({
      version: 1,
      blocks: [{ type: "timeline", events: [{ when: "1990", what: "Penicillin" }], presentation: "text" }],
    })
    expect(forced.html).toContain(`<span class="exp-event-when">1990</span>`)
  })
})

describe("presentation: data-callout", () => {
  it("auto renders the sparkline figure when a series is present", () => {
    const { html } = renderExplanation({
      version: 1,
      blocks: [{ type: "data-callout", metric: "42%", label: "Pass rate", trend: "up", series: [1, 2, 4, 3, 5] }],
    })
    expect(html).toContain(`class="exp-sparkline exp-sparkline-up"`)
    expect(html).toContain(`aria-label="42% Pass rate trend up"`)
    expect(html).toContain(`<span class="exp-metric">42%</span>`) // number stays HTML
  })

  it("auto stays text without a series; figure without a series degrades to text", () => {
    const base = { type: "data-callout", metric: "42%", label: "L" } as const
    const auto = renderExplanation({ version: 1, blocks: [base] })
    expect(auto.html).not.toContain(`exp-figure`)
    const forced = renderExplanation({ version: 1, blocks: [{ ...base, presentation: "figure" }] })
    expect(forced.html).not.toContain(`exp-figure`)
  })
})

describe("presentation: data-callout schema", () => {
  it("rejects a one-sample series and accepts two-plus", () => {
    expect(
      explanationSchema.safeParse({
        version: 1,
        blocks: [{ type: "data-callout", metric: "m", label: "l", series: [1] }],
      }).success,
    ).toBe(false)
    expect(
      explanationSchema.safeParse({
        version: 1,
        blocks: [{ type: "data-callout", metric: "m", label: "l", series: [1, 2] }],
      }).success,
    ).toBe(true)
  })
})
