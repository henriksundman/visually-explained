import { describe, expect, it } from "vitest"
import { documentSchema, sectionAnchor } from "../src/core/documentSchema"

describe("documentSchema", () => {
  it("parses a document whose sections carry unknown blocks (lenient by design)", () => {
    const doc = {
      version: 1,
      title: "A Page",
      summary: "S",
      sections: [
        { id: "intro", title: "Introduction", blocks: [{ type: "text", body: "hi" }] },
        { title: "No id here", blocks: [{ type: "garbage" }, 42] },
      ],
    }
    expect(documentSchema.safeParse(doc).success).toBe(true)
  })

  it("rejects a wrong version, empty title, and empty/missing sections", () => {
    expect(documentSchema.safeParse({ version: 2, title: "T", sections: [{ title: "S", blocks: [] }] }).success).toBe(false)
    expect(documentSchema.safeParse({ version: 1, title: "", sections: [{ title: "S", blocks: [] }] }).success).toBe(false)
    expect(documentSchema.safeParse({ version: 1, title: "T", sections: [] }).success).toBe(false)
    expect(documentSchema.safeParse({ version: 1, title: "T" }).success).toBe(false)
  })

  it("strips a nested sections key instead of rejecting (flat by design)", () => {
    const doc = {
      version: 1,
      title: "T",
      sections: [{ title: "S", blocks: [], sections: [{ title: "inner" }] }],
    }
    const parsed = documentSchema.safeParse(doc)
    expect(parsed.success).toBe(true)
    expect("sections" in (parsed as any).data!.sections[0]).toBe(false)
  })

  it("rejects an empty section title", () => {
    expect(documentSchema.safeParse({ version: 1, title: "T", sections: [{ title: "", blocks: [] }] }).success).toBe(false)
  })
})

describe("sectionAnchor", () => {
  it("slugifies a valid authored id", () => {
    expect(sectionAnchor({ id: "My Cool_ID" }, 0, new Set())).toBe("sec-my-cool_id")
  })

  it("derives the slug from the title when no id", () => {
    expect(sectionAnchor({ title: "How It Works!" }, 0, new Set())).toBe("sec-how-it-works")
  })

  it("caps the slug at 100 chars", () => {
    expect(sectionAnchor({ title: "a".repeat(300) }, 0, new Set()).length).toBeLessThanOrEqual(104) // "sec-" + 100
  })

  it("falls back to section-<index> for an empty slug", () => {
    expect(sectionAnchor({ title: "!!!" }, 0, new Set())).toBe("section-0")
    expect(sectionAnchor({ id: "///" }, 2, new Set())).toBe("section-2")
  })

  it("resolves collisions with -2, -3 suffixes (first wins)", () => {
    const taken = new Set(["sec-intro"])
    expect(sectionAnchor({ id: "intro" }, 1, taken)).toBe("sec-intro-2")
    expect(sectionAnchor({ id: "intro" }, 2, new Set(["sec-intro", "sec-intro-2"]))).toBe("sec-intro-3")
  })
})
