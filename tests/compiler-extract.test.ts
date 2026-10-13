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

describe("extractJson: LaTeX escape salvage (host follow-up 2, 2026-10-13)", () => {
  // The model writes TeX BARE inside JSON strings, in two shapes. Illegal
  // escapes ("$\Delta x$" — \D is not a JSON escape) throw on parse. Legal
  // mangles (\frac, \ne, \times — \f \n \t ARE legal JSON escapes) parse
  // "successfully" but the TeX arrives as form feeds / tabs / newlines, which
  // no parse failure ever reports — so the doubling pass that fixes them must
  // run BEFORE the raw parse, unconditionally, and be a no-op on correctly
  // double-escaped replies. A full-doubling pass for escapes no TeX command
  // names (\(, \{) rides in only when parsing still fails.
  it("un-mangles TeX lead commands that JSON legal escapes ate", () => {
    const r = extractJson('{"type":"text","body":"so $\\frac{a}{b}$ and $x \\ne y$ then $a \\times b$"}')
    expect(r.ok).toBe(true)
    if (r.ok) {
      const v = r.value as { body: string }
      expect(v.body).toContain("\\frac{a}{b}")
      expect(v.body).toContain("\\ne y")
      expect(v.body).toContain("\\times b")
      expect(v.body).not.toMatch(/[\f\n\t]/)
    }
  })

  it("doubles illegal escapes whose lead is a TeX command letter", () => {
    const r = extractJson('{"body":"Displacement ($\\Delta x$) grows"}')
    expect(r.ok).toBe(true)
    if (r.ok) {
      const v = r.value as { body: string }
      expect(v.body).toContain("\\Delta x")
    }
  })

  it("rides the full-doubling pass for escapes no TeX command names, like \\(...\\)", () => {
    const r = extractJson('{"body":"math in prose \\(x + 1\\) here"}')
    expect(r.ok).toBe(true)
    if (r.ok) {
      const v = r.value as { body: string }
      expect(v.body).toContain("\\(x + 1\\)")
    }
  })

  it("is a no-op on a correctly double-escaped reply", () => {
    const r = extractJson('{"body":"$\\\\frac{a}{b}$ works"}')
    expect(r.ok).toBe(true)
    if (r.ok) {
      const v = r.value as { body: string }
      expect(v.body).toBe("$\\frac{a}{b}$ works")
    }
  })

  it("salvages through fences and commentary, end to end", () => {
    const r = extractJson('Commentary.\n```json\n{"body":"$\\Delta x$"}\n```')
    expect(r.ok).toBe(true)
    if (r.ok) {
      const v = r.value as { body: string }
      expect(v.body).toContain("\\Delta x")
    }
  })

  it("skips valid \\uXXXX escapes but doubles TeX commands starting with u", () => {
    const r = extractJson('{"body":"\\u0041 and \\undertilde{x}"}')
    expect(r.ok).toBe(true)
    if (r.ok) {
      const v = r.value as { body: string }
      expect(v.body).toContain("A and \\undertilde{x}")
    }
  })

  it("leaves a JSON newline escape alone when no TeX command shape follows", () => {
    const r = extractJson('{"body":"a\\n b and c\\t, done"}')
    expect(r.ok).toBe(true)
    if (r.ok) {
      const v = r.value as { body: string }
      // \n + space and \t + comma: no letter-run follows the escape char, so
      // no doubling — the real newline and tab survive intact.
      expect(v.body).toBe("a\n b and c\t, done")
    }
  })

  // THE RECORDED TRADE (open thread): "\ne" (TeX, must be un-mangled) and
  // "\nline2" (a JSON newline escape followed by a word) are the SAME raw
  // bytes — there is no syntax-level distinction, and the renderer-side
  // plausibility gates that decide inline math cannot run before parsing.
  // TeX wins: an in-string \n whose next chars are letters is doubled, so a
  // parsed value may carry a literal "\n"-letter sequence where the model
  // meant a newline. Reallos versions write JSON newlines between tokens
  // (outside strings) far more than inside string values, and math payloads
  // dominate this library's prompt surface, so the missing-newline cost is
  // the accepted side. If a real capture shows a corrupted multi-line value,
  // revisit: a per-string gate on TeX markers ($, \(, ^, _) is the sketch.
  it("doubles an in-string newline escape followed by letters (recorded trade)", () => {
    const r = extractJson('{"body":"a\\nb and c\\tend"}')
    expect(r.ok).toBe(true)
    if (r.ok) {
      const v = r.value as { body: string }
      expect(v.body).toBe("a\\nb and c\\tend")
    }
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
