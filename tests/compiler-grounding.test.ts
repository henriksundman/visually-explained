import { describe, expect, it } from "vitest"
import { validateSources, type SourceExcerpt } from "../src/compiler/client"

const valid = (over: Partial<SourceExcerpt> = {}): SourceExcerpt => ({
  id: "s1",
  title: "Signals 101",
  text: "A signal carries information.",
  ...over,
})

describe("validateSources", () => {
  it("passes valid excerpts through in host order, keeping optional urls", () => {
    const { excerpts, warnings } = validateSources([
      valid({ url: "https://example.com/signals" }),
      valid({ id: "s2", title: "Deploy counts", text: "Deploys per weekday." }),
    ])
    expect(warnings).toEqual([])
    expect(excerpts).toEqual([
      { id: "s1", title: "Signals 101", text: "A signal carries information.", url: "https://example.com/signals" },
      { id: "s2", title: "Deploy counts", text: "Deploys per weekday." },
    ])
  })

  it("drops out-of-shape excerpts, naming the issues", () => {
    const { excerpts, warnings } = validateSources([
      valid({ id: "" }),
      valid({ id: "s2", text: "" }),
      valid({ id: "s3", url: "javascript:alert(1)" }),
    ])
    expect(excerpts).toEqual([])
    expect(warnings).toEqual([
      "[grounding] source 0 dropped — id must be 1-64 chars",
      "[grounding] source 1 dropped — text must be 1-2000 chars",
      "[grounding] source 2 dropped — url must be http(s)",
    ])
  })

  it("keeps the first of duplicated ids", () => {
    const { excerpts, warnings } = validateSources([
      valid({ title: "First" }),
      valid({ title: "Second" }),
    ])
    expect(warnings).toEqual(['[grounding] duplicate source id "s1" dropped'])
    expect(excerpts).toHaveLength(1)
    expect(excerpts[0].title).toBe("First")
  })

  it("caps the set at 24 sources", () => {
    const many = Array.from({ length: 25 }, (_, i) => valid({ id: `s${i}` }))
    const { excerpts, warnings } = validateSources(many)
    expect(excerpts).toHaveLength(24)
    expect(warnings).toEqual(["[grounding] source 24 dropped — at most 24 sources"])
  })

  it("treats absent input as no excerpts and no warnings", () => {
    expect(validateSources(undefined)).toEqual({ excerpts: [], warnings: [] })
  })
})
