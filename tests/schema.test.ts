import { describe, expect, it } from "vitest"
import { explanationSchema } from "../src/core/schema"

describe("explanationSchema", () => {
  it("parses an explanation containing every block type", () => {
    const ir = {
      version: 1,
      title: "T",
      summary: "S",
      blocks: [
        { type: "text", body: "hello" },
        { type: "step-list", steps: [{ title: "a" }, { title: "b", detail: "d" }] },
        { type: "worked-example", problem: "p", steps: [{ title: "s" }], result: "r" },
        { type: "derivation", steps: [{ expression: "x = 1", note: "n" }], conclusion: "c" },
        { type: "concept", term: "t", definition: "d", intuition: "i", analogy: "a" },
        {
          type: "comparison",
          items: [{ name: "A" }, { name: "B" }],
          dimensions: [{ name: "D", values: ["1", "2"] }],
        },
        { type: "cause-effect", chain: [{ because: "b", therefore: "t" }] },
        { type: "data-callout", metric: "42%", label: "L", delta: "+1", trend: "up", context: "c" },
        { type: "timeline", events: [{ when: "1990", what: "w" }] },
        { type: "callout", variant: "tip", body: "b" },
        { type: "stack", blocks: [{ type: "text", body: "nested" }] },
      ],
    }
    expect(explanationSchema.safeParse(ir).success).toBe(true)
  })

  it("rejects a wrong version", () => {
    expect(explanationSchema.safeParse({ version: 2, blocks: [] }).success).toBe(false)
  })

  it("rejects unknown block types", () => {
    expect(explanationSchema.safeParse({ version: 1, blocks: [{ type: "nope" }] }).success).toBe(false)
  })

  it("accepts stack-in-stack (depth is a render-time concern, not schema)", () => {
    const deep = {
      type: "stack",
      blocks: [{ type: "stack", blocks: [{ type: "stack", blocks: [{ type: "text", body: "x" }] }] }],
    }
    expect(explanationSchema.safeParse({ version: 1, blocks: [deep] }).success).toBe(true)
  })

  it("rejects blocks missing required content", () => {
    expect(explanationSchema.safeParse({ version: 1, blocks: [{ type: "text" }] }).success).toBe(false)
  })
})
