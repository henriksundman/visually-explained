import { describe, expect, it } from "vitest"
import { z } from "zod"
import { parseWithIssues, repairUserPrompt } from "../src/compiler/repair"

const schema = z.object({ a: z.number() })

describe("parseWithIssues", () => {
  it("parses valid output", () => {
    expect(parseWithIssues(schema, '{"a":1}')).toEqual({ ok: true, value: { a: 1 } })
  })

  it("reports compact path-shaped issues on schema violation", () => {
    const r = parseWithIssues(schema, '{"a":"nope"}')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.issues).toHaveLength(1)
      expect(r.issues[0]).toMatch(/a.*number/i)
      expect(r.snippet).toContain('"a"')
    }
  })

  it("counts extraction failure as a validation failure", () => {
    const r = parseWithIssues(schema, "sorry, no json")
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues[0]).toMatch(/no JSON/i)
  })
})

describe("repairUserPrompt", () => {
  it("carries the offending fragment, issues, and rules", () => {
    const p = repairUserPrompt({
      previous: '{"a":"nope"}',
      issues: ["a: expected number"],
      rules: "- a must be a number",
    })
    expect(p).toContain('{"a":"nope"}')
    expect(p).toContain("a: expected number")
    expect(p).toContain("- a must be a number")
  })
})
