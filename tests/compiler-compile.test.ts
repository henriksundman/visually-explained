import { describe, expect, it } from "vitest"
import { compileDocument } from "../src/compiler/compile"
import { documentSchema } from "../src/core/documentSchema"
import type { LlmClient } from "../src/compiler/client"

const cannedOutline = {
  version: 1,
  title: "Signals",
  summary: "How signals work.",
  sections: [
    { title: "What is a signal", goal: "Define it." },
    { title: "Reading data", goal: "Show values.", visual: "chart" },
    { title: "Broken section", goal: "This one always fails validation." },
  ],
}

const goodSection = (title: string) => ({
  title,
  blocks: [{ type: "text", body: `${title} body` }],
})

const badSection = () => ({ title: "Broken section", blocks: "not an array" })

/** Scripted fake: replies by matching the user prompt; throws on misses. */
function scriptedClient(replies: Array<{ match: RegExp; reply: string | (() => string) }>): LlmClient {
  return async req => {
    const hit = replies.find(r => r.match.test(req.user))
    if (!hit) throw new Error("unexpected call: " + req.user.slice(0, 80))
    return typeof hit.reply === "function" ? hit.reply() : hit.reply
  }
}

const outlineMatch = /Design the outline/
const sectionMatch = (title: string) => new RegExp(`Write section .*"${title}"`)

describe("compileDocument", () => {
  it("happy path: outline + 3 sections assemble into a valid document", async () => {
    const client = scriptedClient([
      { match: outlineMatch, reply: JSON.stringify(cannedOutline) },
      { match: sectionMatch("What is a signal"), reply: JSON.stringify(goodSection("What is a signal")) },
      { match: sectionMatch("Reading data"), reply: JSON.stringify(goodSection("Reading data")) },
      { match: sectionMatch("Broken section"), reply: JSON.stringify(goodSection("Renamed by model")) },
    ])
    const { document, events, warnings } = await compileDocument("signals", { client })
    expect(documentSchema.safeParse(document).success).toBe(true)
    const doc = document as { title: string; sections: { title: string; blocks: unknown[] }[] }
    expect(doc.title).toBe("Signals")
    expect(doc.sections).toHaveLength(3)
    // Canonical titles: the model renamed one section; the outline title wins.
    expect(doc.sections[2].title).toBe("Broken section")
    expect(warnings).toEqual([])
    expect(events.map(e => e.kind)).toEqual([
      "outline-start",
      "outline-done",
      "section-start",
      "section-done",
      "section-start",
      "section-done",
      "section-start",
      "section-done",
    ])
  })

  it("repairs once then succeeds", async () => {
    let sectionCalls = 0
    const outline = { ...cannedOutline, sections: [cannedOutline.sections[0]] }
    const client: LlmClient = async req => {
      if (outlineMatch.test(req.user)) return JSON.stringify(outline)
      sectionCalls++
      // First reply violates the schema (blocks not an array); repair fixes it.
      if (sectionCalls === 1) return JSON.stringify({ title: "What is a signal", blocks: "not an array" })
      return JSON.stringify(goodSection("What is a signal"))
    }
    const { document, events, warnings } = await compileDocument("signals", { client })
    expect(warnings).toEqual([])
    const doc = document as { sections: unknown[] }
    expect(doc.sections).toHaveLength(1)
    expect(events.filter(e => e.kind === "repair-attempt")).toHaveLength(1)
    expect(events.filter(e => e.kind === "section-done")).toHaveLength(1)
  })

  it("drops a section after exhausting repairs, with a warning", async () => {
    const client = scriptedClient([
      { match: outlineMatch, reply: JSON.stringify(cannedOutline) },
      { match: sectionMatch("What is a signal"), reply: JSON.stringify(goodSection("What is a signal")) },
      { match: sectionMatch("Reading data"), reply: JSON.stringify(goodSection("Reading data")) },
      { match: sectionMatch("Broken section"), reply: JSON.stringify(badSection()) },
      { match: /failed validation/, reply: JSON.stringify(badSection()) }, // repairs keep failing
    ])
    const { document, events, warnings } = await compileDocument("signals", { client })
    const doc = document as { sections: unknown[] }
    expect(doc.sections).toHaveLength(2)
    expect(warnings.some(w => w.includes("section 2"))).toBe(true)
    expect(events.filter(e => e.kind === "repair-attempt")).toHaveLength(2) // default maxRepairs
    expect(events.filter(e => e.kind === "section-failed")).toHaveLength(1)
  })

  it("throws when the outline is irrecoverable", async () => {
    const client: LlmClient = async () => "garbage, no json"
    await expect(compileDocument("signals", { client })).rejects.toThrow(/outline/)
  })

  it("clamps outline sections to maxSections", async () => {
    const many = {
      version: 1,
      title: "T",
      sections: Array.from({ length: 5 }, (_, i) => ({ title: `S${i}`, goal: `g${i}` })),
    }
    const client = scriptedClient([
      { match: outlineMatch, reply: JSON.stringify(many) },
      ...Array.from({ length: 5 }, (_, i) => ({
        match: sectionMatch(`S${i}`),
        reply: JSON.stringify(goodSection(`S${i}`)),
      })),
    ])
    const { document } = await compileDocument("signals", { client, maxSections: 2 })
    const doc = document as { sections: unknown[] }
    expect(doc.sections).toHaveLength(2)
  })
})
