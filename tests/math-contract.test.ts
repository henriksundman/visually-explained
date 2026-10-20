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

  // Host follow-up 4 (2026-10-20): "conclusion" reads as "the concluding
  // sentence", so models naturally write prose there — prose that parsed as
  // valid TeX and mangled silently. The contract now documents what the field
  // actually is: expression stays whole-field TeX, conclusion is prose with
  // inline math.
  it("states that expression is TeX spanning the whole field", () => {
    expect(line).toMatch(/expression/)
    expect(line).toMatch(/TeX/)
  })

  it("states that conclusion is prose with inline math", () => {
    expect(line).toMatch(/conclusion is prose/)
    expect(line).toMatch(/\(…\)/)
    expect(line).toMatch(/inline math/)
  })

  it("sends the final equation to the last step's expression", () => {
    expect(line).toMatch(/last step/)
  })

  it("states that note is prose", () => {
    expect(line).toMatch(/note/)
    expect(line).toMatch(/prose/i)
  })

  it("warns against $ delimiters for the TeX field", () => {
    expect(line).toMatch(/delimiter/i)
  })

  it("reaches the section system prompt", () => {
    // toContain, not toBe: systemPromptSnippet (5439 chars) wraps the block-type
    // docs (4309 chars) with additional instruction text.
    expect(systemPromptSnippet()).toContain(BLOCK_TYPE_DOCS)
  })
})
