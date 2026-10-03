import { describe, expect, it } from "vitest"
import { validateImages, MAX_IMAGES } from "../src/compiler/client"
import { outlineUserPrompt, sectionUserPrompt, sectionSystemPrompt } from "../src/compiler/prompts"
import { outlineSectionSchema } from "../src/compiler/extract"
import { BLOCK_TYPE_DOCS } from "../src/core/blockTypes"

const ref = {
  src: "https://cdn.example.com/a.png",
  alt: "A crowded train platform",
  width: 800,
  height: 600,
  subject: "a rush-hour platform",
}

describe("validateImages", () => {
  it("accepts a well-formed catalog and preserves key order", () => {
    const { catalog, warnings } = validateImages({ platform: ref, platformTwo: ref })
    expect(Object.keys(catalog)).toEqual(["platform", "platformTwo"])
    expect(catalog.platform).toEqual(ref)
    expect(warnings).toEqual([])
  })

  it("drops malformed entries with a stable warning naming the key", () => {
    const { catalog, warnings } = validateImages({
      nope: null,
      bad: { ...ref, alt: "" },
      ugly: { ...ref, width: -1 },
    })
    expect(Object.keys(catalog)).toEqual([])
    expect(warnings).toHaveLength(3)
    expect(warnings[0]).toBe('[images] image "nope" dropped — not an object')
    expect(warnings[1]).toContain("alt must be 1-300 chars")
    expect(warnings[2]).toContain("width must be a positive integer")
  })

  it("caps the set, reporting each overflow by key", () => {
    const many: Record<string, unknown> = {}
    for (let i = 0; i < MAX_IMAGES + 3; i++) many[`k${i}`] = { ...ref, subject: `subject ${i}` }
    const capped = validateImages(many)
    expect(Object.keys(capped.catalog)).toHaveLength(MAX_IMAGES)
    expect(capped.warnings).toHaveLength(3)
    expect(capped.warnings[0]).toBe(`[images] image "k${MAX_IMAGES}" dropped — at most ${MAX_IMAGES} images`)
  })

  it("truncates a long key so a warning cannot be bloated by host input", () => {
    const long = "k".repeat(200)
    const { warnings } = validateImages({ [long]: null })
    expect(warnings[0]).toBe(`[images] image "${"k".repeat(64)}" dropped — not an object`)
    expect(warnings[0].length).toBeLessThan(120)
  })

  it("never lets an inherited Object member become a catalog entry", () => {
    // A literal's own keys are entries; nothing inherited is. Both still have
    // to survive value validation, so a prototype member cannot ride along.
    const { catalog } = validateImages({ constructor: ref, toString: ref })
    expect(Object.keys(catalog)).toEqual(["constructor", "toString"])
    expect(catalog.constructor).toEqual(ref)
    // And a prototype-polluted prototype contributes nothing enumerable.
    expect(Object.keys(validateImages(Object.create({ injected: ref })).catalog)).toEqual([])
  })

  it("returns an empty catalog for undefined input", () => {
    expect(validateImages(undefined)).toEqual({ catalog: {}, warnings: [] })
  })
})

describe("image prompt menus", () => {
  it("lists the record key beside its subject, never src or alt", () => {
    const p = outlineUserPrompt("signals", undefined, undefined, undefined, { platform: ref })
    expect(p).toContain("- platform: a rush-hour platform")
    expect(p).toContain("Images available")
    expect(p).not.toContain("cdn.example.com")
    expect(p).not.toContain("A crowded train platform")
  })

  it("states the editorial placement rule in the section prompt", () => {
    const p = sectionUserPrompt({ index: 0, title: "Why", goal: "Explain.", images: { platform: ref } })
    expect(p).toContain("Images available")
    expect(p).toContain("anchor an analogy or set a scene")
    expect(p).toContain("Put no text in the image itself")
  })

  it("pins one image block when the outline declared a key", () => {
    const p = sectionUserPrompt({
      index: 0,
      title: "Why",
      goal: "Explain.",
      images: { platform: ref },
      image: "platform",
    })
    expect(p).toContain("Include exactly ONE image block")
    expect(p).toContain("platform")
  })

  it("stays byte-identical when no catalog is supplied", () => {
    // The absence-of-effect pin: these literal strings must not drift.
    expect(outlineUserPrompt("entropy")).toBe(
      "Topic: entropy\nDesign the outline. Reply with the JSON object ONLY.",
    )
    expect(sectionUserPrompt({ index: 0, title: "Why", goal: "Explain." })).toBe(
      'Write section 1 of the document: "Why"\nGoal: Explain.\n' +
        'Reply with the section JSON object ONLY: { "title": string, "blocks": Block[] }.',
    )
    // An empty record is the same as absent — no empty menu header.
    expect(outlineUserPrompt("entropy", undefined, undefined, undefined, {})).toBe(
      outlineUserPrompt("entropy"),
    )
  })

  it("teaches the block in the shared contract and the section system prompt", () => {
    expect(BLOCK_TYPE_DOCS).toContain("- image:")
    expect(sectionSystemPrompt()).toContain("- image:")
  })
})

describe("outline image declaration", () => {
  it("accepts an optional image key on a section", () => {
    expect(outlineSectionSchema.safeParse({ title: "S", goal: "G", image: "platform" }).success).toBe(true)
    expect(outlineSectionSchema.safeParse({ title: "S", goal: "G" }).success).toBe(true)
    expect(outlineSectionSchema.safeParse({ title: "S", goal: "G", image: "" }).success).toBe(false)
  })
})