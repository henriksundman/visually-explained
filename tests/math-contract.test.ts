import { describe, expect, it } from "vitest"
import { BLOCK_TYPE_DOCS, systemPromptSnippet } from "../src/core/llm"

/** The derivation line as the model sees it. An unstated rule is an unusable
 *  one: the model cannot infer that two fields sharing a rendering path mean
 *  different things. */
const line = BLOCK_TYPE_DOCS.split("\n").find((l) => l.startsWith("- derivation:"))

describe("derivation contract", () => {
  it("exists", () => {
    expect(line).toBeDefined()
  })

  it("states that expression and conclusion are TeX", () => {
    expect(line).toMatch(/expression/)
    expect(line).toMatch(/conclusion/)
    expect(line).toMatch(/TeX/)
  })

  it("states that note is prose", () => {
    expect(line).toMatch(/note/)
    expect(line).toMatch(/prose/i)
  })

  it("warns against $ delimiters, since the whole field is already TeX", () => {
    expect(line).toMatch(/delimiter/i)
  })

  it("reaches the section system prompt", () => {
    // toContain, not toBe: systemPromptSnippet (5439 chars) wraps the block-type
    // docs (4309 chars) with additional instruction text.
    expect(systemPromptSnippet()).toContain(BLOCK_TYPE_DOCS)
  })
})
