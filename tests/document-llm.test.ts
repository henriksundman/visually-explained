import { describe, expect, it } from "vitest"
import { documentJsonSchema, documentSystemPromptSnippet, BLOCK_TYPE_DOCS } from "../src/core/llm"
import { MATH_RULES } from "../src/core/blockTypes"
import { documentSchema } from "../src/core/documentSchema"
import { registry } from "../src/core/registry"
import "../src/core/registerAll"

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
    expect(documentSystemPromptSnippet()).toContain('"version"')
    expect(documentSystemPromptSnippet()).toContain("Section order is the document outline")
    expect(documentSystemPromptSnippet()).toContain("ONLY the JSON object")
    expect(documentSystemPromptSnippet()).toContain("no HTML")
  })

  it("carries the shared block-type text verbatim", () => {
    expect(documentSystemPromptSnippet()).toContain(BLOCK_TYPE_DOCS)
  })

  // Same family as the section-prompt pin (2026-10-04 inline-math cycle,
  // compiler-prompts.test.ts): the rule lives in one shared constant, so
  // asserting it here pins lockstep without duplicating the literal text.
  it("teaches the inline math delimiters and never forbids them", () => {
    expect(documentSystemPromptSnippet()).toContain(MATH_RULES)
    expect(documentSystemPromptSnippet()).toContain("\\(...\\)")
    expect(documentSystemPromptSnippet()).toContain("left as literal text")
    expect(documentSystemPromptSnippet()).toContain("needs no escaping")
    expect(documentSystemPromptSnippet()).not.toContain("no LaTeX delimiters")
  })

  // Same regression as the section prompt (2026-10-07): text and code were
  // appended only to systemPromptSnippet, so this document-facing contract
  // never mentioned them. Pin the doc line, not the bare type name — a
  // substring check passes on unrelated prose.
  it("mentions every registered block type as a doc line", () => {
    for (const type of Object.keys(registry)) {
      expect(documentSystemPromptSnippet()).toContain(`- ${type}:`)
    }
  })

  // Same contract as the explanation snippet (tests/llm.test.ts, host follow-up
  // 3): a document snippet pasted by a catalog-less host must forbid images,
  // not invite invented ones; a host with a catalog gets the key:subject menu.
  describe("image gating", () => {
    const imageRef = {
      src: "https://cdn.example.com/platform.png",
      alt: "A crowded train platform",
      width: 800,
      height: 600,
      subject: "a rush-hour platform",
    }

    it("with a catalog, shows the key:subject menu and nothing of src/alt", () => {
      const s = documentSystemPromptSnippet({ platform: imageRef })
      expect(s).toContain("Images available")
      expect(s).toContain("- platform: a rush-hour platform")
      expect(s).not.toContain("cdn.example.com")
      expect(s).not.toContain("A crowded train platform")
      expect(s).not.toContain("No image catalog")
    })

    it("without a catalog, forbids image blocks instead of inviting invented ones", () => {
      const s = documentSystemPromptSnippet()
      expect(s).toContain("No image catalog was provided")
      expect(s).toContain("never emit an image block")
      expect(s).not.toContain("Images available")
    })
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
