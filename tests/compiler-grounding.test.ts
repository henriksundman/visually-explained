import { describe, expect, it } from "vitest"
import { compileDocumentStream, type StreamCompileEvent } from "../src/compiler/stream"
import { compileDocument } from "../src/compiler/compile"
import { documentSchema } from "../src/core/documentSchema"
import { validateSources, type LlmClient, type SourceExcerpt } from "../src/compiler/client"

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

const sources: SourceExcerpt[] = [
  { id: "s1", title: "Signals 101", text: "A signal carries information.", url: "https://example.com/signals" },
  { id: "s2", title: "Deploy counts", text: "Deploys per weekday." },
]

const groundedOutline = {
  version: 1,
  title: "Signals",
  summary: "How signals work.",
  sections: [
    { title: "What is a signal", goal: "Define it." },
    { title: "Reading data", goal: "Show values." },
  ],
}

/** Scripted fake that also records every user prompt it receives. */
function scriptedClient(
  replies: Array<{ match: RegExp; reply: string | (() => string) }>,
): { client: LlmClient; calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    client: async req => {
      calls.push(req.user)
      const hit = replies.find(r => r.match.test(req.user))
      if (!hit) throw new Error("unexpected call: " + req.user.slice(0, 80))
      return typeof hit.reply === "function" ? hit.reply() : hit.reply
    },
  }
}

function groundedClient(bodies: { concept?: string; reading?: string } = {}) {
  return scriptedClient([
    { match: /Design the outline/, reply: JSON.stringify(groundedOutline) },
    {
      match: /Write section .*"What is a signal"/,
      reply: JSON.stringify({
        title: "What is a signal",
        blocks: [{ type: "text", body: bodies.concept ?? "A signal carries information [Signals 101](#source-s1)." }],
      }),
    },
    {
      match: /Write section .*"Reading data"/,
      reply: JSON.stringify({
        title: "Reading data",
        blocks: [{ type: "text", body: bodies.reading ?? "Deploys per weekday [counts](#source-s2)." }],
      }),
    },
  ])
}

describe("grounded compile", () => {
  it("interpolates excerpts into prompts, appends the sources block, stays silent when grounded", async () => {
    const { client, calls } = groundedClient()
    const { document, warnings } = await compileDocument("signals", { client, sources })
    expect(warnings).toEqual([])
    expect(documentSchema.safeParse(document).success).toBe(true)
    const doc = document as { sections: { title: string; blocks: unknown[] }[] }
    expect(doc.sections[0].blocks[0]).toEqual({
      type: "text",
      body: "A signal carries information [Signals 101](#source-s1).",
    })
    expect(doc.sections[1].blocks.at(-1)).toEqual({
      type: "sources",
      id: "compile-sources",
      title: "Sources",
      items: [
        { id: "s1", title: "Signals 101", url: "https://example.com/signals", detail: "A signal carries information." },
        { id: "s2", title: "Deploy counts", detail: "Deploys per weekday." },
      ],
    })
    expect(calls[0]).toContain("- s1: Signals 101 — https://example.com/signals")
    expect(calls[0]).not.toContain("A signal carries information.")
    expect(calls[1]).toContain("[s1] Signals 101: A signal carries information.")
    expect(calls[1]).toContain("Citation rules:")
  })

  it("warns on citations to ids outside the validated excerpt set", async () => {
    const { client } = groundedClient({ concept: "Stuff [paper](#source-nope)." })
    const { warnings } = await compileDocument("signals", { client, sources })
    expect(warnings).toEqual([
      '[grounding] section 0 cites unknown source "nope"',
      '[grounding] source "s1" never cited',
    ])
  })

  it("warns for validated excerpts the model never cited", async () => {
    const { client } = groundedClient({ concept: "No citations here.", reading: "Still none." })
    const { warnings } = await compileDocument("signals", { client, sources })
    expect(warnings).toEqual(['[grounding] source "s1" never cited', '[grounding] source "s2" never cited'])
  })

  it("drops invalid and duplicate excerpts before any prompting", async () => {
    // No citations in bodies: s2 was dropped, so citing it would add noise;
    // this isolates the validation warnings. s1 surviving but uncited still
    // warns at compile-done.
    const { client, calls } = groundedClient({ concept: "No cites.", reading: "None either." })
    const { warnings } = await compileDocument("signals", {
      client,
      sources: [
        { id: "", title: "Bad id", text: "x" },
        { id: "s1", title: "One", text: "alpha" },
        { id: "s1", title: "Dup", text: "beta" },
        { id: "s3", title: "Three", text: "gamma", url: "javascript:alert(1)" },
      ],
    })
    expect(warnings).toEqual([
      "[grounding] source 0 dropped — id must be 1-64 chars",
      '[grounding] duplicate source id "s1" dropped',
      "[grounding] source 3 dropped — url must be http(s)",
      '[grounding] source "s1" never cited',
    ])
    expect(calls[0]).toContain("- s1: One")
    expect(calls[0]).not.toContain("Dup")
    expect(calls[0]).not.toContain("Three")
    expect(calls[1]).toContain("[s1] One: alpha")
  })

  it("skips the sources-block append (with a warning) when no section survives", async () => {
    const { client } = scriptedClient([
      { match: /Design the outline/, reply: JSON.stringify(groundedOutline) },
      { match: /Write section/, reply: JSON.stringify({ title: "x", blocks: "not an array" }) },
      { match: /failed validation/, reply: JSON.stringify({ title: "x", blocks: "not an array" }) },
    ])
    const { document, warnings } = await compileDocument("signals", { client, sources })
    expect((document as { sections: unknown[] }).sections).toHaveLength(0)
    // Both sections dropped: the existing [compile] channel warns, then the
    // grounding channel reports the skipped append and the never-cited set.
    expect(warnings).toEqual([
      "[compile] section 0 dropped — blocks: Invalid input: expected array, received string",
      "[compile] section 1 dropped — blocks: Invalid input: expected array, received string",
      "[grounding] sources block not appended — no surviving section",
      '[grounding] source "s1" never cited',
      '[grounding] source "s2" never cited',
    ])
  })

  it("does not audit citations when sources are absent (byte-identical behavior)", async () => {
    const { client } = groundedClient()
    const { warnings } = await compileDocument("signals", { client })
    expect(warnings).toEqual([])
  })

  it("truncates model-cited ids in the unknown-source warning", async () => {
    const { client } = groundedClient({ concept: `[paper](#source-${"x".repeat(80)})` })
    const { warnings } = await compileDocument("signals", { client, sources })
    expect(warnings[0]).toBe(`[grounding] section 0 cites unknown source "${"x".repeat(64)}"`)
  })

  it("excludes model-authored sources blocks from citation accounting", async () => {
    const { client } = scriptedClient([
      {
        match: /Design the outline/,
        reply: JSON.stringify({ ...groundedOutline, sections: [groundedOutline.sections[0]] }),
      },
      {
        match: /Write section/,
        reply: JSON.stringify({
          title: "What is a signal",
          blocks: [
            { type: "sources", items: [{ id: "fake", title: "t", detail: "see #source-nope" }] },
            { type: "text", body: "Grounded [x](#source-s1)." },
          ],
        }),
      },
    ])
    const { warnings } = await compileDocument("signals", { client, sources })
    expect(warnings).toEqual(['[grounding] source "s2" never cited'])
  })

  it("compileDocument and the drained stream agree on grounding output", async () => {
    const a = await compileDocument("signals", { client: groundedClient().client, sources })
    const events: StreamCompileEvent[] = []
    let document: unknown
    let warnings: string[] = []
    for await (const e of compileDocumentStream("signals", { client: groundedClient().client, sources })) {
      if (e.kind === "compile-done") {
        document = e.document
        warnings = e.warnings
      } else {
        events.push(e)
      }
    }
    expect(events).toEqual(a.events)
    expect(document).toEqual(a.document)
    expect(warnings).toEqual(a.warnings)
  })
})
