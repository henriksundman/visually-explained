import { describe, expect, it } from "vitest"
import { compileDocumentStream, type StreamCompileEvent } from "../src/compiler/stream"
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

const happyClient = () =>
  scriptedClient([
    { match: outlineMatch, reply: JSON.stringify(cannedOutline) },
    { match: sectionMatch("What is a signal"), reply: JSON.stringify(goodSection("What is a signal")) },
    { match: sectionMatch("Reading data"), reply: JSON.stringify(goodSection("Reading data")) },
    { match: sectionMatch("Broken section"), reply: JSON.stringify(goodSection("Renamed by model")) },
  ])

describe("compileDocumentStream", () => {
  it("yields the v1 event order with compile-done last", async () => {
    const kinds: string[] = []
    let done: Extract<StreamCompileEvent, { kind: "compile-done" }> | undefined
    for await (const e of compileDocumentStream("signals", { client: happyClient() })) {
      if (e.kind === "compile-done") done = e
      else kinds.push(e.kind)
    }
    expect(kinds).toEqual([
      "outline-start",
      "outline-done",
      "section-start",
      "section-done",
      "section-start",
      "section-done",
      "section-start",
      "section-done",
    ])
    expect(done).toBeDefined()
    expect(documentSchema.safeParse(done!.document).success).toBe(true)
    expect(done!.warnings).toEqual([])
  })

  it("carries the shell on outline-done and block arrays on section-done", async () => {
    const events: StreamCompileEvent[] = []
    for await (const e of compileDocumentStream("signals", { client: happyClient() })) events.push(e)
    const outlineDone = events.find(e => e.kind === "outline-done")!
    expect(outlineDone).toMatchObject({
      kind: "outline-done",
      title: "Signals",
      summary: "How signals work.",
      sections: 3,
      visualHints: 1,
      sectionTitles: ["What is a signal", "Reading data", "Broken section"],
    })
    const sectionDone = events.filter(e => e.kind === "section-done")
    expect(sectionDone[0]).toMatchObject({
      kind: "section-done",
      index: 0,
      title: "What is a signal",
      blocks: [{ type: "text", body: "What is a signal body" }],
    })
  })

  it("yields repair-attempt events as they happen", async () => {
    let sectionCalls = 0
    const outline = { ...cannedOutline, sections: [cannedOutline.sections[0]] }
    const client: LlmClient = async req => {
      if (outlineMatch.test(req.user)) return JSON.stringify(outline)
      sectionCalls++
      if (sectionCalls === 1) return JSON.stringify({ title: "What is a signal", blocks: "not an array" })
      return JSON.stringify(goodSection("What is a signal"))
    }
    const events: StreamCompileEvent[] = []
    for await (const e of compileDocumentStream("signals", { client })) events.push(e)
    const repairs = events.filter(e => e.kind === "repair-attempt")
    expect(repairs).toEqual([
      { kind: "repair-attempt", stage: "section", index: 0, attempt: 1, issues: expect.any(Array) },
    ])
    expect(events.indexOf(repairs[0])).toBeLessThan(events.findIndex(e => e.kind === "section-done"))
  })

  it("throws when the outline is irrecoverable", async () => {
    const client: LlmClient = async () => "garbage, no json"
    const consume = async () => {
      for await (const _e of compileDocumentStream("signals", { client })) {
        // drain — outline-start and repair-attempts do arrive before the throw
      }
    }
    await expect(consume).rejects.toThrow(/outline/)
  })
})
