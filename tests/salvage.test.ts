import { describe, expect, it } from "vitest"
import "../src/primitives/text" // registers the "text" primitive
import { salvageBlock, salvageExplanation, type Diagnostic } from "../src/core/salvage"

describe("salvageBlock", () => {
  it("marks a valid block", () => {
    const diagnostics: Diagnostic[] = []
    const b = salvageBlock({ type: "text", body: "hi" }, 0, diagnostics)
    expect(b.kind).toBe("valid")
    expect(b.type).toBe("text")
    expect(diagnostics).toEqual([])
  })

  it("marks unknown types for fallback rendering", () => {
    const diagnostics: Diagnostic[] = []
    const b = salvageBlock({ type: "chart", title: "Sales" }, 1, diagnostics)
    expect(b.kind).toBe("unknown")
    expect(b.data).toEqual({ type: "chart", title: "Sales" })
    expect(diagnostics[0]?.code).toBe("unknown-type")
  })

  it("marks blocks missing required content as invalid", () => {
    const diagnostics: Diagnostic[] = []
    const b = salvageBlock({ type: "text" }, 2, diagnostics)
    expect(b.kind).toBe("invalid")
    expect(b.data).toBeNull()
    expect(diagnostics[0]?.code).toBe("invalid-block")
    expect(diagnostics[0]?.message).toContain("skipped")
  })

  it("marks non-objects and missing type as invalid", () => {
    const diagnostics: Diagnostic[] = []
    expect(salvageBlock("nope", 0, diagnostics).kind).toBe("invalid")
    expect(salvageBlock({ body: "no type" }, 1, diagnostics).kind).toBe("invalid")
  })
})

describe("salvageExplanation", () => {
  it("salvages title, summary, and valid blocks", () => {
    const s = salvageExplanation({
      version: 1,
      title: "T",
      summary: "S",
      blocks: [{ type: "text", body: "x" }],
    })
    expect(s.title).toBe("T")
    expect(s.summary).toBe("S")
    expect(s.blocks).toHaveLength(1)
    expect(s.diagnostics).toEqual([])
  })

  it("warns on wrong version and tolerates missing optionals", () => {
    const s = salvageExplanation({ version: 2, blocks: [] })
    expect(s.version).toBe(2)
    expect(s.title).toBeNull()
    expect(s.diagnostics[0]?.code).toBe("wrong-version")
    expect(s.warnings[0]).toContain("expected version 1")
  })

  it("treats non-object input as an empty explanation with a diagnostic", () => {
    const s = salvageExplanation("junk")
    expect(s.blocks).toEqual([])
    expect(s.diagnostics[0]?.code).toBe("invalid-explanation")
  })

  it("treats non-array blocks as empty with a diagnostic", () => {
    const s = salvageExplanation({ version: 1, blocks: "nope" })
    expect(s.blocks).toEqual([])
    expect(s.diagnostics[0]?.message).toContain("blocks must be an array")
  })
})
