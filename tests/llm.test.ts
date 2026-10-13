import { describe, expect, it } from "vitest"
import { explanationJsonSchema, systemPromptSnippet, BLOCK_TYPE_DOCS } from "../src/core/llm"
import { MATH_RULES } from "../src/core/blockTypes"
import { registry } from "../src/core/registry"
import "../src/core/registerAll"

describe("explanationJsonSchema", () => {
  it("pins version to 1", () => {
    const schema = explanationJsonSchema as Record<string, any>
    expect(schema.properties.version.const).toBe(1)
  })

  it("mentions every registered block type", () => {
    const s = JSON.stringify(explanationJsonSchema)
    for (const type of Object.keys(registry)) {
      expect(s).toContain(`"${type}"`)
    }
  })
})

describe("systemPromptSnippet", () => {
  it("mentions every registered block type", () => {
    // The doc LINE, not the bare name: "text" and "code" occur as substrings
    // in unrelated prose, so a plain toContain passes without the entry.
    for (const type of Object.keys(registry)) {
      expect(systemPromptSnippet()).toContain(`- ${type}:`)
    }
  })

  it("forbids HTML and requires JSON-only output", () => {
    expect(systemPromptSnippet()).toContain("no HTML")
    expect(systemPromptSnippet()).toContain("ONLY the JSON object")
  })

  it("still mentions the shared block-type text after the extraction", () => {
    expect(systemPromptSnippet()).toContain(BLOCK_TYPE_DOCS)
  })

  // Host report 2026-10-13 (BUG-REPORT-sweep-focus-storm.md, follow-up): this
  // snippet still carried the pre-inline-math rule "no LaTeX delimiters", so a
  // host pasting it taught the model to avoid exactly the \(...\) spans the
  // renderer honours — while the compiler's sectionSystemPrompt already taught
  // them. The rules now share one constant (MATH_RULES), so asserting the
  // constant pins lockstep across every prompt surface in one place.
  it("teaches the inline math delimiters and never forbids them", () => {
    expect(systemPromptSnippet()).toContain(MATH_RULES)
    expect(systemPromptSnippet()).toContain("\\(...\\)")
    expect(systemPromptSnippet()).toContain("left as literal text")
    expect(systemPromptSnippet()).toContain("needs no escaping")
    expect(systemPromptSnippet()).not.toContain("no LaTeX delimiters")
  })
})

// Host report (BUG-REPORT-sweep-focus-storm.md, follow-up 3): BLOCK_TYPE_DOCS
// teaches the `image` block unconditionally, so a host with no catalog got
// models placing image blocks for invented subjects — validate-time passed,
// and the miss only warns at RENDER time ([image] no image named …), which
// salvages silently in prod and throws a render boundary under failOnWarning.
// The snippet is now the same contract as the document pipeline: a catalog
// prints the key:subject menu, no catalog forbids the block outright.
const imageRef = {
  src: "https://cdn.example.com/platform.png",
  alt: "A crowded train platform",
  width: 800,
  height: 600,
  subject: "a rush-hour platform",
}

describe("systemPromptSnippet image gating", () => {
  it("with a catalog, shows the key:subject menu and nothing of src/alt", () => {
    const s = systemPromptSnippet({ platform: imageRef })
    expect(s).toContain("Images available")
    expect(s).toContain("- platform: a rush-hour platform")
    expect(s).not.toContain("cdn.example.com")
    expect(s).not.toContain("A crowded train platform")
    expect(s).not.toContain("No image catalog")
  })

  it("carries the editorial placement rule with a catalog", () => {
    const s = systemPromptSnippet({ platform: imageRef })
    expect(s).toContain("Place an image only to anchor an analogy or set a scene")
    expect(s).toContain("Put no text in the image itself")
  })

  it("without a catalog, forbids image blocks instead of inviting invented ones", () => {
    const s = systemPromptSnippet()
    expect(s).toContain("No image catalog was provided")
    expect(s).toContain("never emit an image block")
    expect(s).not.toContain("Images available")
  })

  it("treats an empty catalog like no catalog (pipeline-gating parity)", () => {
    const s = systemPromptSnippet({})
    expect(s).toContain("never emit an image block")
    expect(s).not.toContain("Images available")
  })
})
