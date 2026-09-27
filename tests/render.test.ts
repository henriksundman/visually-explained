import { describe, expect, it } from "vitest"
import { renderExplanation } from "../src/core/render"
import "../src/core/registerAll"

describe("renderExplanation", () => {
  it("wraps explanation with root, title, and summary", () => {
    const { html, warnings } = renderExplanation({
      version: 1,
      title: "How it works",
      summary: "Short",
      blocks: [{ type: "text", body: "Body" }],
    })
    expect(html).toBe(
      `<div class="exp"><h3 class="exp-title">How it works</h3><p class="exp-summary">Short</p>` +
        `<div class="exp-block exp-text"><p>Body</p></div></div>`,
    )
    expect(warnings).toEqual([])
  })

  it("renders unknown types as a styled fallback with a warning", () => {
    const { html, warnings } = renderExplanation({ version: 1, blocks: [{ type: "chart", title: "Sales" }] })
    expect(html).toContain("exp-fallback")
    expect(html).toContain("chart")
    expect(html).toContain("Sales")
    expect(warnings.some(w => w.includes("unknown type"))).toBe(true)
  })

  it("skips invalid blocks and reports them", () => {
    const { html, warnings } = renderExplanation({
      version: 1,
      blocks: [{ type: "text" }, { type: "text", body: "ok" }],
    })
    expect((html.match(/exp-block exp-text/g) ?? []).length).toBe(1)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("skipped")
  })

  it("escapes html coming from the IR", () => {
    const { html } = renderExplanation({
      version: 1,
      blocks: [{ type: "text", body: "<img src=x onerror=alert(1)>" }],
    })
    expect(html).not.toContain("<img")
    expect(html).toContain("&lt;img")
  })

  it("strict mode throws on invalid input", () => {
    expect(() => renderExplanation({ version: 2, blocks: [] }, { strict: true })).toThrow(/version/)
  })

  it("theme option adds a theme class", () => {
    const { html } = renderExplanation({ version: 1, blocks: [] }, { theme: "dark" })
    expect(html).toBe(`<div class="exp exp-theme-dark"></div>`)
  })
})
