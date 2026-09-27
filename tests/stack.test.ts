import { describe, expect, it } from "vitest"
import { renderExplanation } from "../src/core/render"
import "../src/core/registerAll"

describe("stack", () => {
  it("renders children inside a stack wrapper", () => {
    const { html, warnings } = renderExplanation({
      version: 1,
      blocks: [{ type: "stack", blocks: [{ type: "text", body: "a" }, { type: "text", body: "b" }] }],
    })
    expect(html).toContain(`<div class="exp-block exp-stack">`)
    expect((html.match(/exp-block exp-text/g) ?? []).length).toBe(2)
    expect(warnings).toEqual([])
  })

  it("leniently salvages invalid children", () => {
    const { html, warnings } = renderExplanation({
      version: 1,
      blocks: [{ type: "stack", blocks: [{ type: "text" }, { type: "text", body: "ok" }] }],
    })
    expect((html.match(/exp-block exp-text/g) ?? []).length).toBe(1)
    expect(warnings).toHaveLength(1)
  })

  it("flattens stacks deeper than MAX_STACK_DEPTH with a warning", () => {
    const { html, warnings } = renderExplanation({
      version: 1,
      blocks: [
        {
          type: "stack",
          blocks: [{ type: "stack", blocks: [{ type: "stack", blocks: [{ type: "text", body: "deep" }] }] }],
        },
      ],
    })
    expect(html).toContain("deep")
    expect(warnings.filter(w => w.includes("stack-too-deep"))).toHaveLength(2)
  })
})
