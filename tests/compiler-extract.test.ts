import { describe, expect, it } from "vitest"
import { extractJson, outlineSchema } from "../src/compiler/extract"

describe("extractJson", () => {
  it("parses a bare JSON object", () => {
    expect(extractJson('{"a":1}')).toEqual({ ok: true, value: { a: 1 } })
  })

  it("parses fenced JSON", () => {
    const text = 'Here you go:\n```json\n{"a": {"b": 2}}\n```\nDone.'
    expect(extractJson(text)).toEqual({ ok: true, value: { a: { b: 2 } } })
  })

  it("parses JSON with leading commentary before the brace", () => {
    expect(extractJson('Sure! The outline is {"a":1} as requested.')).toEqual({ ok: true, value: { a: 1 } })
  })

  it("handles braces inside strings when balancing", () => {
    expect(extractJson('{"s":"a } b","t":"{ c"}')).toEqual({ ok: true, value: { s: "a } b", t: "{ c" } })
  })

  it("fails with a short snippet on garbage", () => {
    const r = extractJson("no json at all")
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.snippet.length).toBeLessThanOrEqual(200)
  })

  it("fails on JSON arrays (object required)", () => {
    expect(extractJson("[1,2,3]").ok).toBe(false)
  })
})

describe("outlineSchema", () => {
  it("parses a valid outline with visual hints", () => {
    const outline = {
      version: 1,
      title: "T",
      summary: "S",
      sections: [
        { title: "A", goal: "Do a." },
        { title: "B", goal: "Do b.", visual: "figure" },
      ],
    }
    expect(outlineSchema.safeParse(outline).success).toBe(true)
  })

  it("rejects empty sections, empty goal, bad visual", () => {
    expect(outlineSchema.safeParse({ version: 1, title: "T", sections: [] }).success).toBe(false)
    expect(outlineSchema.safeParse({ version: 1, title: "T", sections: [{ title: "A", goal: "" }] }).success).toBe(false)
    expect(
      outlineSchema.safeParse({ version: 1, title: "T", sections: [{ title: "A", goal: "g", visual: "video" }] }).success,
    ).toBe(false)
  })
})
