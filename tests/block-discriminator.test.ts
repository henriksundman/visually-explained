import { describe, expect, it } from "vitest"
import { systemPromptSnippet, documentSystemPromptSnippet, BLOCK_TYPE_DOCS } from "../src/core/llm"
import { sectionSystemPrompt } from "../src/compiler/prompts"

// Regression for the first real-LLM run of the compiler (2026-10-07,
// google/gemini-2.5-flash-lite via OpenRouter): NO prompt surface stated the
// block discriminator. The model was never told a block is { "type": ... }, so
// it guessed — three different envelopes inside ONE document:
//   { "kind": "heading", ... }        (16/60 and 54/88 blocks)
//   { "heading": { ... } }            (36/60 — payload nested under the name)
//   { "type": "heading", ... }        (8/60 and 0/88 — the only valid shape)
// documentSectionSchema.blocks is z.array(z.unknown()) by design, so section
// validation passed everything, the repair loop never fired (0 repairs, 0
// dropped — a "clean" run), and renderDocument dropped every block at render
// time: 52 and 88 [invalid-block] warnings, two near-empty pages.
//
// The rule lives in BLOCK_TYPE_DOCS because all three prompt surfaces embed it
// verbatim (pinned elsewhere), so one line here fixes all of them.
describe("block discriminator contract", () => {
  const surfaces: Record<string, string> = {
    "BLOCK_TYPE_DOCS": BLOCK_TYPE_DOCS,
    "systemPromptSnippet": systemPromptSnippet,
    "documentSystemPromptSnippet": documentSystemPromptSnippet,
    "sectionSystemPrompt": sectionSystemPrompt(),
  }

  for (const [name, prompt] of Object.entries(surfaces)) {
    it(`${name} shows a block as { "type": ... }`, () => {
      expect(prompt).toContain('{ "type":')
    })

    it(`${name} forbids nesting the payload under the type name`, () => {
      expect(prompt).toContain("never nested")
    })
  }
})
