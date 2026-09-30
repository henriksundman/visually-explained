import { describe, expect, it } from "vitest"
import {
  outlineSystemPrompt,
  outlineUserPrompt,
  sectionSystemPrompt,
  sectionUserPrompt,
} from "../src/compiler/prompts"
import { BLOCK_TYPE_DOCS } from "../src/core/blockTypes"

describe("outline prompts", () => {
  it("system prompt pins the outline shape, version, and section cap", () => {
    const p = outlineSystemPrompt(12)
    expect(p).toContain("outline")
    expect(p).toContain('"version": 1')
    expect(p).toContain("at most 12")
    expect(p).toContain('"goal"')
    expect(p).toContain('"visual"')
    expect(p).toContain("figure")
    expect(p).toContain("ONLY the JSON object")
  })

  it("user prompt carries topic and optional guidance", () => {
    expect(outlineUserPrompt("entropy")).toContain("entropy")
    expect(outlineUserPrompt("entropy", "for kids")).toContain("for kids")
  })
})

describe("section prompts", () => {
  it("system prompt shares the block-type text verbatim", () => {
    expect(sectionSystemPrompt()).toContain(BLOCK_TYPE_DOCS)
    expect(sectionSystemPrompt()).toContain("no HTML")
  })

  it("forbids sections and version keys in section output", () => {
    const p = sectionSystemPrompt()
    expect(p).toContain('never emit a "sections" key')
    expect(p).toContain('never emit a "version" key')
  })

  it("user prompt carries title, goal, visual hint, and guidance", () => {
    const p = sectionUserPrompt({
      index: 2,
      title: "Why it matters",
      goal: "Ground the idea in two examples.",
      visual: "figure",
      guidance: "terse",
    })
    expect(p).toContain("Why it matters")
    expect(p).toContain("Ground the idea in two examples.")
    expect(p).toContain("figure")
    expect(p).toContain("terse")
  })
})
