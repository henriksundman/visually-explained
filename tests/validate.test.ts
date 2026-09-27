import { describe, expect, it } from "vitest"
import "../src/primitives/text"
import { validateExplanation } from "../src/core/validate"

describe("validateExplanation", () => {
  it("reports ok for a fully valid explanation", () => {
    const r = validateExplanation({ version: 1, blocks: [{ type: "text", body: "x" }] })
    expect(r.ok).toBe(true)
    expect(r.diagnostics).toEqual([])
  })

  it("collects diagnostics for invalid input", () => {
    const r = validateExplanation({ version: 2, blocks: [{ type: "text" }] })
    expect(r.ok).toBe(false)
    expect(r.diagnostics).toHaveLength(2)
  })
})
