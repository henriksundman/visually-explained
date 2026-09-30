import { describe, expect, it } from "vitest"
import { explanationJsonSchema, systemPromptSnippet, BLOCK_TYPE_DOCS } from "../src/core/llm"
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
    for (const type of Object.keys(registry)) {
      expect(systemPromptSnippet).toContain(type)
    }
  })

  it("forbids HTML and requires JSON-only output", () => {
    expect(systemPromptSnippet).toContain("no HTML")
    expect(systemPromptSnippet).toContain("ONLY the JSON object")
  })

  it("still mentions the shared block-type text after the extraction", () => {
    expect(systemPromptSnippet).toContain(BLOCK_TYPE_DOCS)
  })
})
