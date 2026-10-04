import { describe, expect, it } from "vitest"
import {
  outlineSystemPrompt,
  outlineUserPrompt,
  sectionSystemPrompt,
  sectionUserPrompt,
} from "../src/compiler/prompts"
import { BLOCK_TYPE_DOCS } from "../src/core/blockTypes"
import type { SourceExcerpt } from "../src/compiler/client"

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

  it("teaches the link inline form", () => {
    expect(sectionSystemPrompt()).toContain("[text](url)")
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

const sources: SourceExcerpt[] = [
  { id: "s1", title: "Signals 101", text: "A signal carries information.", url: "https://example.com/signals" },
  { id: "s2", title: "Deploy counts", text: "Deploys per weekday." },
]

describe("grounded prompts", () => {
  it("outline prompt lists ids/titles/urls but never excerpt text", () => {
    const p = outlineUserPrompt("entropy", undefined, sources)
    expect(p).toContain("Sources available (cite by id; sections must stay groundable in these):")
    expect(p).toContain("- s1: Signals 101 — https://example.com/signals")
    expect(p).toContain("- s2: Deploy counts")
    expect(p).not.toContain("A signal carries information.")
  })

  it("section prompt carries excerpt text, url lines, and the citation rules", () => {
    const p = sectionUserPrompt({ index: 0, title: "Why", goal: "Explain.", sources })
    expect(p).toContain("Sources for this document (ground claims in these):")
    expect(p).toContain("[s1] Signals 101: A signal carries information.")
    expect(p).toContain("[url: https://example.com/signals]")
    expect(p).toContain("[s2] Deploy counts: Deploys per weekday.")
    expect(p).toContain(
      "Citation rules: cite the source a claim comes from as [label](#source-<id>) (or [label](url) when the source has one).",
    )
    expect(p).toContain("leave it out rather than inventing facts or citations")
  })

  it("outline prompt is byte-identical without sources", () => {
    expect(outlineUserPrompt("entropy")).toBe(
      "Topic: entropy\nDesign the outline. Reply with the JSON object ONLY.",
    )
    expect(outlineUserPrompt("entropy", "for kids")).toBe(
      "Topic: entropy\nGuidance: for kids\nDesign the outline. Reply with the JSON object ONLY.",
    )
  })

  it("section prompt is byte-identical without sources", () => {
    const base = 'Write section 1 of the document: "Why"\nGoal: Explain.\n'
    const tail = 'Reply with the section JSON object ONLY: { "title": string, "blocks": Block[] }.'
    expect(sectionUserPrompt({ index: 0, title: "Why", goal: "Explain." })).toBe(`${base}${tail}`)
    expect(sectionUserPrompt({ index: 0, title: "Why", goal: "Explain.", visual: "figure", guidance: "terse" })).toBe(
      `${base}Visual: include one figure block in this section.\nGuidance: terse\n${tail}`,
    )
  })
})

describe("checks prompts", () => {
  it("outline prompt carries the checks fragment only when the flag is on", () => {
    expect(outlineUserPrompt("entropy", undefined, undefined, true)).toContain(
      'Checks: mark sections with "check": true where a short quiz would consolidate the learning — not every section; never the first; skip reference-style ones.',
    )
    // Flag off or absent: byte-identical to today, fragment absent.
    expect(outlineUserPrompt("entropy", undefined, undefined)).not.toContain("Checks:")
    expect(outlineUserPrompt("entropy", undefined, undefined, false)).not.toContain("Checks:")
    expect(outlineUserPrompt("entropy")).toBe("Topic: entropy\nDesign the outline. Reply with the JSON object ONLY.")
  })

  it("checks and grounding fragments compose in the documented order", () => {
    const p = outlineUserPrompt("entropy", "for kids", sources, true)
    const checksAt = p.indexOf("Checks: mark sections")
    const guidanceAt = p.indexOf("Guidance: for kids")
    const sourcesAt = p.indexOf("Sources available")
    expect(guidanceAt).toBeLessThan(checksAt)
    expect(checksAt).toBeLessThan(sourcesAt)
  })

  it("section prompt carries the quiz instruction only for check-declared entries", () => {
    const declared = sectionUserPrompt({ index: 1, title: "T", goal: "G", check: true })
    expect(declared).toContain(
      "End this section with exactly ONE quiz block (the retrieval check the outline planned): question answerable from this section alone, 2-4 options, plausible distractors whose why names the misconception, answer as the 0-based index.",
    )
    // Undeclared / flag-shaped absence: unchanged.
    expect(sectionUserPrompt({ index: 1, title: "T", goal: "G" })).not.toContain("quiz block")
    expect(sectionUserPrompt({ index: 1, title: "T", goal: "G", check: false })).not.toContain("quiz block")
    // Order: the check instruction sits after the visual line, before guidance.
    const ordered = sectionUserPrompt({ index: 1, title: "T", goal: "G", visual: "chart", guidance: "terse", check: true })
    expect(ordered.indexOf("ONE quiz block")).toBeGreaterThan(ordered.indexOf("Visual:"))
    expect(ordered.indexOf("ONE quiz block")).toBeLessThan(ordered.indexOf("Guidance: terse"))
  })

  it("check instruction composes with grounding in the documented order", () => {
    const p = sectionUserPrompt({ index: 0, title: "T", goal: "G", sources, check: true })
    expect(p).toContain("ONE quiz block")
    expect(p).toContain("Sources for this document")
    expect(p.indexOf("ONE quiz block")).toBeGreaterThan(-1)
    expect(p.indexOf("ONE quiz block")).toBeLessThan(p.indexOf("Sources for this document"))
  })

  // The prompt used to say "no LaTeX delimiters", which became wrong the
  // moment inline math shipped. Pin the replacement so it cannot silently rot
  // back into contradicting the renderer.
  it("teaches the inline math delimiters and never says not to use them", () => {
    const p = sectionSystemPrompt()
    expect(p).not.toContain("no LaTeX delimiters")
    expect(p).toContain("inline math")
    expect(p).toContain("\\(...\\)")
    expect(p).toContain("left as literal text")
  })

  it("tells the model a dollar amount needs no escaping", () => {
    // The gate is the reason: a prose dollar that is left literal is correct
    // behaviour, not a bug to route around.
    expect(sectionSystemPrompt()).toContain(
      "needs no escaping",
    )
  })
})

describe("mind-map contract", () => {
  it("teaches the mind-map as a containment tool, not a sequence tool", () => {
    // The distinction is the whole value claim. Left unstated, the model
    // reaches for mind-map whenever content has any shape at all, and a
    // timeline-shaped mind map is unreadable — order needs position, and a
    // dendrogram's positions are determined by ancestry instead.
    const p = sectionSystemPrompt()
    expect(p).toContain("mind-map")
    expect(p).toContain("what nests inside what")
    expect(p).toContain("never for a sequence")
  })
})
