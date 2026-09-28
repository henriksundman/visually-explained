import { describe, expect, it } from "vitest"
import { explanationSchema } from "../src/core/schema"
import { educationIr, dataIr, capabilitiesIr, figuresIr, howToIr } from "../demo/examples.js"

function collectTypes(ir: { blocks: unknown[] }): Set<string> {
  const types = new Set<string>()
  for (const raw of ir.blocks) {
    const b = raw as { type?: string; blocks?: unknown[] }
    if (typeof b.type !== "string") continue
    if (b.type === "stack" && Array.isArray(b.blocks)) {
      types.add("stack")
      for (const child of b.blocks) {
        const c = child as { type?: string }
        if (typeof c.type === "string") types.add(c.type)
      }
    } else {
      types.add(b.type)
    }
  }
  return types
}

describe("demo examples", () => {
  it("education fixture is schema-valid", () => {
    expect(explanationSchema.safeParse(educationIr).success).toBe(true)
  })

  it("data fixture is schema-valid", () => {
    expect(explanationSchema.safeParse(dataIr).success).toBe(true)
  })

  it("education fixture covers concept, worked-example, derivation, callout, stack, step-list, text", () => {
    const types = collectTypes(educationIr)
    for (const t of ["concept", "worked-example", "derivation", "callout", "stack", "step-list", "text"]) {
      expect(types.has(t)).toBe(true)
    }
  })

  it("data fixture covers data-callout, comparison, cause-effect, timeline, callout", () => {
    const types = collectTypes(dataIr)
    for (const t of ["data-callout", "comparison", "cause-effect", "timeline", "callout"]) {
      expect(types.has(t)).toBe(true)
    }
  })

  it("capabilities fixture intentionally contains an unknown and an invalid block", () => {
    const types = collectTypes(capabilitiesIr)
    expect(types.has("gauge")).toBe(true) // unknown → fallback
    expect(capabilitiesIr.blocks.some(b => (b as { type?: string }).type === "text" && !(b as { body?: string }).body)).toBe(true) // invalid → skipped
  })

  it("figures fixture is schema-valid", () => {
    expect(explanationSchema.safeParse(figuresIr).success).toBe(true)
  })

  it("figures fixture covers diagram, chart, cause-effect, callout", () => {
    const types = collectTypes(figuresIr)
    for (const t of ["diagram", "chart", "figure", "cause-effect", "callout"]) {
      expect(types.has(t)).toBe(true)
    }
  })

  it("how-to fixture is schema-valid", () => {
    expect(explanationSchema.safeParse(howToIr).success).toBe(true)
  })

  it("how-to fixture covers step-list, code, diagram, chart, data-callout, callout", () => {
    const types = collectTypes(howToIr)
    for (const t of ["step-list", "code", "diagram", "chart", "data-callout", "callout"]) {
      expect(types.has(t)).toBe(true)
    }
  })
})
