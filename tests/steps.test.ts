import { describe, expect, it } from "vitest"
import { renderExplanation } from "../src/core/render"
import "../src/core/registerAll"

describe("step-list", () => {
  it("renders numbered steps with optional detail", () => {
    const { html } = renderExplanation({
      version: 1,
      blocks: [{ type: "step-list", steps: [{ title: "Mix **dry** items" }, { title: "Add eggs", detail: "One at a time" }] }],
    })
    expect(html).toContain(`<div class="exp-block exp-step-list"><ol class="exp-steps">`)
    expect(html).toContain(`<span class="exp-step-num">1</span>`)
    expect(html).toContain(`<span class="exp-step-num">2</span>`)
    expect(html).toContain(`<strong>dry</strong>`)
    expect(html).toContain(`<p class="exp-step-detail">One at a time</p>`)
  })
})

describe("worked-example", () => {
  it("renders problem, steps, and result", () => {
    const { html } = renderExplanation({
      version: 1,
      blocks: [
        { type: "worked-example", problem: "Sum 1..3", steps: [{ title: "Add", detail: "1+2+3" }], result: "6" },
      ],
    })
    expect(html).toContain(`<p class="exp-example-problem">Sum 1..3</p>`)
    expect(html).toContain(`<ol class="exp-example-steps">`)
    expect(html).toContain(`<span class="exp-step-num">1</span>`)
    expect(html).toContain(`<p class="exp-example-result">6</p>`)
  })
})
