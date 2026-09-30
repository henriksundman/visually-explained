import { describe, expect, it } from "vitest"
import { documentJsonSchema, documentSystemPromptSnippet, BLOCK_TYPE_DOCS } from "../src/core/llm"
import { documentSchema } from "../src/core/documentSchema"

describe("documentJsonSchema", () => {
  it("pins version to 1 and keeps optionals optional", () => {
    const schema = documentJsonSchema as Record<string, any>
    expect(schema.properties.version.const).toBe(1)
    const sectionProps = schema.properties.sections.items.properties
    expect(sectionProps.id.required).toBeUndefined() // io: "input" — optional stays optional
  })
})

describe("documentSystemPromptSnippet", () => {
  it("describes the document shape and section ordering rule", () => {
    expect(documentSystemPromptSnippet).toContain('"version"')
    expect(documentSystemPromptSnippet).toContain("Section order is the document outline")
    expect(documentSystemPromptSnippet).toContain("ONLY the JSON object")
    expect(documentSystemPromptSnippet).toContain("no HTML")
  })

  it("carries the shared block-type text verbatim", () => {
    expect(documentSystemPromptSnippet).toContain(BLOCK_TYPE_DOCS)
  })
})

describe("documentSchema (LLM path)", () => {
  it("round-trips through the exported JSON schema", () => {
    expect(
      documentSchema.safeParse({
        version: 1,
        title: "T",
        sections: [{ title: "S", blocks: [{ type: "text", body: "x" }] }],
      }).success,
    ).toBe(true)
  })
})
