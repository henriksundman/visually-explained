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
      expect(systemPromptSnippet).toContain(`- ${type}:`)
    }
  })

  it("forbids HTML and requires JSON-only output", () => {
    expect(systemPromptSnippet).toContain("no HTML")
    expect(systemPromptSnippet).toContain("ONLY the JSON object")
  })

  it("still mentions the shared block-type text after the extraction", () => {
    expect(systemPromptSnippet).toContain(BLOCK_TYPE_DOCS)
  })

  // Host report 2026-10-13 (BUG-REPORT-sweep-focus-storm.md, follow-up): this
  // snippet still carried the pre-inline-math rule "no LaTeX delimiters", so a
  // host pasting it taught the model to avoid exactly the \(...\) spans the
  // renderer honours — while the compiler's sectionSystemPrompt already taught
  // them. The rules now share one constant (MATH_RULES), so asserting the
  // constant pins lockstep across every prompt surface in one place.
  it("teaches the inline math delimiters and never forbids them", () => {
    expect(systemPromptSnippet).toContain(MATH_RULES)
    expect(systemPromptSnippet).toContain("\\(...\\)")
    expect(systemPromptSnippet).toContain("left as literal text")
    expect(systemPromptSnippet).toContain("needs no escaping")
    expect(systemPromptSnippet).not.toContain("no LaTeX delimiters")
  })
})
