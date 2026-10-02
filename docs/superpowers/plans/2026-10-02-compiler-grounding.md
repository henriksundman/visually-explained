# Compiler Grounding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This repo executes plans **inline** — no CLI subagents (AGENTS.md convention).

**Goal:** Wire host-supplied `SourceExcerpt`s through `compileDocument`/`compileDocumentStream`: excerpt interpolation into outline/section prompts, taught citation contract, auto-appended `sources` block, and `[grounding]` audit warnings.

**Architecture:** One additive `CompileOptions.sources` option. `validateSources` (in `client.ts`, the options/types home) leniently validates host input — drop + warn, first duplicate wins. `prompts.ts` gains grounded fragments (byte-identical output when sources are absent). `stream.ts` validates once before prompting, threads excerpts into both prompt calls, scans each accepted section's blocks for `#source-<id>` citations, appends the sources block to the last surviving section's blocks, and emits warnings through the existing `warnings` channel. `compileDocument` needs zero changes (it is a drain of the stream).

**Tech Stack:** TypeScript (ES2022, strict), zod (already a dep; NOT used here — hand-rolled checks for stable warning strings), vitest, tsup.

**Spec:** `docs/superpowers/specs/2026-10-01-compiler-grounding-design.md` (approved 2026-10-01).

## Global Constraints

- **No new dependencies.** Hand-rolled utilities only (project rule).
- **Absent `sources` → byte-identical behavior** (prompts, warnings, document) — spec §2.3. Both APIs via one code path.
- **Constrain + audit-warn, never enforce** — grounding problems produce `[grounding] …` warnings; nothing is dropped, thrown, or rewritten for grounding (spec §2.4). Warnings ride the existing `warnings` array; strict/lenient escalation does not exist at the compiler level (same rule as `[dataset]`).
- **Exact caps** (spec §3, §4): excerpt `id` 1–64, `title` 1–200, `text` 1–2000, `url` 1–500 and http(s)-only; excerpt count ≤ 24 (matches the sources-block schema's `items.max(24)`); appended `detail` = excerpt text truncated to 400 chars (`slice(0, 400)`, no ellipsis); model-cited ids embedded in warnings truncated to 64 chars.
- **Deterministic:** excerpt order is host order, no sorting; warning order is fixed (validation → per-section unknown-source → append-warning → never-cited).
- **Block id of the appended block:** `id: "compile-sources"`, `title: "Sources"` (passes `idSchema = z.string().min(1).optional()` — verified).
- **Security walk (rafter-secure-design `ingestion.md`, 2026-10-02 — recorded per skill):**
  - Trust boundary: host → library. Excerpt text is interpolated verbatim into prompts — same trust posture as `guidance` (host material); model output remains untrusted regardless (zod extraction + repair + escaped `renderInline` render path).
  - Every field has a schema + size limit (caps above); the 24-source cap keeps the appended block schema-valid and bounds prompt size.
  - Excerpt URLs: compile-time `safeHref` + `/^https?:/i` check (drop excerpt); render-time `safeHref` gate remains defense-in-depth. No fetcher exists — URLs are never requested at render (SSRF n/a).
  - No new parser or deserialization. The audit regex `/#source-([^)\s]+)/g` is linear (single negated class — no ReDoS shape).
  - Model-cited ids land in warning strings — truncated to 64 chars (log-hygiene, unbounded model output).
  - Rendered output reuses the part-1-audited `renderSources` primitive (`escapeHtml` on ids, `renderInline` on titles/details, `safeHref` on urls). No new HTML surface.
- **Verification commands:** `npm run typecheck` (tsc --noEmit), `npm test` (vitest run), `npm run build`. Baseline at branch start: **328 tests / 41 files, all green**. Expected final: **346/346** (328 + 5 + 4 + 9).
- **Execution:** inline only; per-task commit; after each task append a ledger line to `.superpowers/sdd/progress.md`; keep verification output in the ledger notes.

---

### Task 1: `SourceExcerpt`, `CompileOptions.sources`, and `validateSources`

**Files:**
- Modify: `src/compiler/client.ts`
- Create: `tests/compiler-grounding.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (all exported from the package root via the existing `export * from "./compiler/client"`):
  - `interface SourceExcerpt { id: string; title: string; text: string; url?: string }` — consumed by Tasks 2–3
  - `CompileOptions.sources?: SourceExcerpt[]` — consumed by Task 4
  - `function validateSources(raw?: SourceExcerpt[]): { excerpts: SourceExcerpt[]; warnings: string[] }` — consumed by Task 3
  - `const MAX_SOURCES = 24` — internal to this task's validator (exported for hosts; no later task consumes it)

- [ ] **Step 1: Write the failing tests**

Create `tests/compiler-grounding.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/compiler-grounding.test.ts`
Expected: FAIL — `validateSources` is not exported from `../src/compiler/client` (import error).

- [ ] **Step 3: Implement in `src/compiler/client.ts`**

Add after the `LlmClient` type (before `CompileOptions`), and extend `CompileOptions`:

```ts
/** Host-supplied grounding material (compiler spec §3). Chunking/sizing is
 *  host-side; the compiler interpolates what it is given. */
export interface SourceExcerpt {
  /** Citation target — anchors as source-<id>. 1-64 chars. */
  id: string
  /** 1-200 chars. */
  title: string
  /** Host-pre-chunked excerpt, interpolated into section prompts. 1-2000 chars. */
  text: string
  /** Cited directly when present. http(s) only, 1-500 chars. */
  url?: string
}

export interface CompileOptions {
  client: LlmClient
  /** Repair re-asks per stage before salvage. Default 2. */
  maxRepairs?: number
  /** Host steering (audience, tone, constraints) interpolated into both user prompts. */
  guidance?: string
  /** Cap on outline sections. Default 12. */
  maxSections?: number
  /** Grounding material interpolated into the prompts; validated leniently. */
  sources?: SourceExcerpt[]
}

/** Largest excerpt set the compiler accepts — matches the sources block
 *  schema's items cap, so the auto-appended block is always schema-valid. */
export const MAX_SOURCES = 24

/** Lenient validation of host excerpts (spec §3): out-of-shape excerpts drop
 *  with a `[grounding]` warning before any prompting (bad ids would poison
 *  anchors); duplicate ids keep the first; the set is capped at MAX_SOURCES.
 *  Hand-rolled checks — not zod — so warning strings are stable across zod
 *  versions. URL scheme reuses the render-time gate (core/inline). */
export function validateSources(
  raw?: SourceExcerpt[],
): { excerpts: SourceExcerpt[]; warnings: string[] } {
  const warnings: string[] = []
  const excerpts: SourceExcerpt[] = []
  const seen = new Set<string>()
  for (let i = 0; i < (raw?.length ?? 0); i++) {
    const s = raw![i] as Partial<SourceExcerpt> | null
    if (typeof s !== "object" || s === null) {
      warnings.push(`[grounding] source ${i} dropped — not an object`)
      continue
    }
    const issues: string[] = []
    if (typeof s.id !== "string" || s.id.length < 1 || s.id.length > 64) issues.push("id must be 1-64 chars")
    if (typeof s.title !== "string" || s.title.length < 1 || s.title.length > 200)
      issues.push("title must be 1-200 chars")
    if (typeof s.text !== "string" || s.text.length < 1 || s.text.length > 2000)
      issues.push("text must be 1-2000 chars")
    if (s.url !== undefined) {
      if (typeof s.url !== "string" || s.url.length < 1 || s.url.length > 500) {
        issues.push("url must be 1-500 chars")
      } else {
        const href = safeHref(s.url)
        if (href === null || !/^https?:/i.test(href)) issues.push("url must be http(s)")
      }
    }
    if (issues.length > 0) {
      warnings.push(`[grounding] source ${i} dropped — ${issues.join("; ")}`)
      continue
    }
    const id = s.id as string
    if (seen.has(id)) {
      warnings.push(`[grounding] duplicate source id "${id}" dropped`)
      continue
    }
    if (excerpts.length >= MAX_SOURCES) {
      warnings.push(`[grounding] source ${i} dropped — at most ${MAX_SOURCES} sources`)
      continue
    }
    seen.add(id)
    excerpts.push({
      id,
      title: s.title as string,
      text: s.text as string,
      ...(s.url !== undefined ? { url: s.url as string } : {}),
    })
  }
  return { excerpts, warnings }
}
```

And add the import at the top of the file:

```ts
import { safeHref } from "../core/inline"
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run tests/compiler-grounding.test.ts && npm run typecheck`
Expected: 5/5 pass; tsc clean.

- [ ] **Step 5: Run the full suite (byte-identity of the no-sources path)**

Run: `npm test`
Expected: 333/333 (328 baseline + 5) — all pre-existing tests unchanged proves the additive option changed nothing.

- [ ] **Step 6: Ledger + commit**

Append to `.superpowers/sdd/progress.md`:
`Compiler-grounding Task 1: complete (<sha>; 333/333, tsc clean)`

```bash
git add src/compiler/client.ts tests/compiler-grounding.test.ts .superpowers/sdd/progress.md
git commit -m "feat(compiler): SourceExcerpt input + lenient validateSources in CompileOptions"
```

---

### Task 2: Grounded prompt fragments (outline + section)

**Files:**
- Modify: `src/compiler/prompts.ts`
- Modify: `tests/compiler-prompts.test.ts`

**Interfaces:**
- Consumes: `SourceExcerpt` from `./client` (Task 1).
- Produces (used by Task 3):
  - `outlineUserPrompt(topic: string, guidance?: string, sources?: SourceExcerpt[]): string`
  - `sectionUserPrompt(args: { index: number; title: string; goal: string; visual?: string; guidance?: string; sources?: SourceExcerpt[] }): string`
  - No sources passed (or empty array) → byte-identical output to today (both prompts use `.filter(Boolean)`, so the added slot vanishes).

- [ ] **Step 1: Write the failing tests**

Append to `tests/compiler-prompts.test.ts` (extend the existing imports:

```ts
import {
  outlineSystemPrompt,
  outlineUserPrompt,
  sectionSystemPrompt,
  sectionUserPrompt,
} from "../src/compiler/prompts"
import { BLOCK_TYPE_DOCS } from "../src/core/blockTypes"
import type { SourceExcerpt } from "../src/compiler/client"
```

— then append the new describes):

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/compiler-prompts.test.ts`
Expected: the two "with sources" tests FAIL (no sources block in output); the two byte-identity tests PASS already (current signatures accept the calls). 4 new tests total, 2 red.

- [ ] **Step 3: Implement in `src/compiler/prompts.ts`**

Replace the import line and the two user-prompt functions; add the two fragment builders:

```ts
import { BLOCK_TYPE_DOCS } from "../core/blockTypes"
import type { SourceExcerpt } from "./client"
```

```ts
/** Outline-visible grounding list (spec §4): ids + titles (+ urls) only — the
 *  outline plans structure, it does not read excerpts. */
function outlineSourcesBlock(sources: SourceExcerpt[]): string {
  return [
    "Sources available (cite by id; sections must stay groundable in these):",
    ...sources.map(s => `- ${s.id}: ${s.title}${s.url ? ` — ${s.url}` : ""}`),
  ].join("\n")
}

/** Writer-visible grounding list (spec §4): full excerpt text + the citation
 *  contract. Excerpt order is host order — no sorting. */
function sectionSourcesBlock(sources: SourceExcerpt[]): string {
  return [
    "Sources for this document (ground claims in these):",
    ...sources.flatMap(s => [`[${s.id}] ${s.title}: ${s.text}`, ...(s.url ? [`[url: ${s.url}]`] : [])]),
    "",
    "Citation rules: cite the source a claim comes from as [label](#source-<id>) (or [label](url) when the source has one). Ground claims in these sources; if the sources don't cover something, leave it out rather than inventing facts or citations.",
  ].join("\n")
}

export function outlineUserPrompt(topic: string, guidance?: string, sources?: SourceExcerpt[]): string {
  return [
    `Topic: ${topic}`,
    guidance ? `Guidance: ${guidance}` : "",
    sources && sources.length > 0 ? outlineSourcesBlock(sources) : "",
    "",
    "Design the outline. Reply with the JSON object ONLY.",
  ]
    .filter(Boolean)
    .join("\n")
}

export function sectionUserPrompt(args: {
  index: number
  title: string
  goal: string
  visual?: string
  guidance?: string
  sources?: SourceExcerpt[]
}): string {
  return [
    `Write section ${args.index + 1} of the document: "${args.title}"`,
    `Goal: ${args.goal}`,
    args.visual ? `Visual: include one ${args.visual} block in this section.` : "",
    args.guidance ? `Guidance: ${args.guidance}` : "",
    args.sources && args.sources.length > 0 ? sectionSourcesBlock(args.sources) : "",
    "",
    'Reply with the section JSON object ONLY: { "title": string, "blocks": Block[] }.',
  ]
    .filter(Boolean)
    .join("\n")
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run tests/compiler-prompts.test.ts tests/compiler-grounding.test.ts && npm run typecheck`
Expected: 4/4 new prompt tests pass, 5/5 grounding tests still pass; tsc clean.

- [ ] **Step 5: Full suite**

Run: `npm test`
Expected: 337/337 (333 + 4).

- [ ] **Step 6: Ledger + commit**

Append to `.superpowers/sdd/progress.md`:
`Compiler-grounding Task 2: complete (<sha>; 337/337, tsc clean)`

```bash
git add src/compiler/prompts.ts tests/compiler-prompts.test.ts .superpowers/sdd/progress.md
git commit -m "feat(compiler): interpolate validated excerpts into outline/section prompts"
```

---

### Task 3: Sources-block append + citation audit in the orchestrator

**Files:**
- Modify: `src/compiler/stream.ts`
- Modify: `tests/compiler-grounding.test.ts`

**Interfaces:**
- Consumes: `validateSources` / `SourceExcerpt` (Task 1); `outlineUserPrompt(…, sources)` / `sectionUserPrompt({…, sources})` (Task 2).
- Produces: no new exports. Behavior (locked by tests): with validated excerpts present, every accepted section's blocks are scanned for `#source-<id>` anchors; a `sources` block (`id: "compile-sources"`) is appended to the last surviving section; warnings appear in this order — validation drops, per-section `cites unknown source`, append-warning, `never cited`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/compiler-grounding.test.ts` (add imports at the top of the file, merging with Task 1's):

```ts
import { describe, expect, it } from "vitest"
import { compileDocumentStream, type StreamCompileEvent } from "../src/compiler/stream"
import { compileDocument } from "../src/compiler/compile"
import { documentSchema } from "../src/core/documentSchema"
import { validateSources, type LlmClient, type SourceExcerpt } from "../src/compiler/client"
```

Then append:

```ts
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
    const { client, calls } = groundedClient()
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
    expect(warnings).toEqual([
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/compiler-grounding.test.ts`
Expected: the 9 new `grounded compile` tests FAIL — no sources block appended, no `[grounding]` warnings (Task 1's 5 `validateSources` tests stay green).

- [ ] **Step 3: Implement in `src/compiler/stream.ts`**

Change the client import line to bring in `validateSources` (value import) alongside the types:

```ts
import { validateSources, type CompileEvent, type CompileOptions } from "./client"
```

Add a `SourceExcerpt` type import to the same line group (it is used by the helper below):

```ts
import type { SourceExcerpt } from "./client"
```

(May be merged into one import: `import { validateSources, type CompileEvent, type CompileOptions, type SourceExcerpt } from "./client"`.)

Add two module-level helpers (above `compileDocumentStream`):

```ts
/** Anchor citation ids referenced anywhere in a block tree's string fields
 *  (spec §5: walk string fields — bodies, captions, every rendered surface's
 *  input — for `(#source-<id>)` anchor references). Model-authored `sources`
 *  blocks are skipped: they list sources, they do not cite them. Linear scan,
 *  no backtracking-prone patterns. */
function collectCitationIds(value: unknown, into = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    for (const m of value.matchAll(/#source-([^)\s]+)/g)) into.add(m[1])
  } else if (Array.isArray(value)) {
    for (const v of value) collectCitationIds(v, into)
  } else if (value !== null && typeof value === "object") {
    if ((value as { type?: unknown }).type === "sources") return into
    for (const v of Object.values(value)) collectCitationIds(v, into)
  }
  return into
}

/** The auto-appended provenance list (spec §4). `detail` is the excerpt text
 *  truncated to the sources-block schema's 400-char cap. */
function sourcesBlockFrom(excerpts: SourceExcerpt[]) {
  return {
    type: "sources",
    id: "compile-sources",
    title: "Sources",
    items: excerpts.map(s => ({
      id: s.id,
      title: s.title,
      ...(s.url ? { url: s.url } : {}),
      detail: s.text.slice(0, 400),
    })),
  }
}
```

Inside `compileDocumentStream`, right after `const maxRepairs = …`, validate once and thread the excerpts:

```ts
  const warnings: string[] = []
  const maxSections = opts.maxSections ?? 12
  const maxRepairs = opts.maxRepairs ?? 2

  // Grounding (spec §3/§4): validate once before any prompting; empty after
  // validation means the compile behaves exactly like an ungrounded one.
  const { excerpts, warnings: sourceWarnings } = validateSources(opts.sources)
  warnings.push(...sourceWarnings)
  const grounded = excerpts.length > 0 ? excerpts : undefined
  const knownSourceIds = new Set(excerpts.map(s => s.id))
  const citedIds = new Set<string>()
```

Pass excerpts into both prompt calls:

```ts
    user: outlineUserPrompt(topic, opts.guidance, grounded),
```

```ts
      user: sectionUserPrompt({
        index: i,
        title: entry.title,
        goal: entry.goal,
        visual: entry.visual,
        guidance: opts.guidance,
        sources: grounded,
      }),
```

After the section is accepted (right after `sections.push({ title: entry.title, blocks: outcome.value.blocks })`, before the `section-done` yield), audit the section:

```ts
    // Grounding audit (spec §5): post-repair accepted blocks only. A cited id
    // outside the validated set is a dead link — warn, never drop. Model ids
    // are truncated to 64 chars so unbounded output cannot bloat warnings.
    for (const id of collectCitationIds(outcome.value.blocks)) {
      citedIds.add(id)
      if (grounded && !knownSourceIds.has(id)) {
        warnings.push(`[grounding] section ${i} cites unknown source "${id.slice(0, 64)}"`)
      }
    }
```

After the section loop, before the `compile-done` yield, append the block and report never-cited:

```ts
  // Provenance (spec §4): append to the LAST SURVIVING section — no new
  // section, maxSections semantics intact. Then report never-cited excerpts
  // (spec §5) at compile-done time.
  if (grounded) {
    if (sections.length > 0) {
      sections[sections.length - 1].blocks.push(sourcesBlockFrom(grounded))
    } else {
      warnings.push("[grounding] sources block not appended — no surviving section")
    }
    for (const s of excerpts) {
      if (!citedIds.has(s.id)) warnings.push(`[grounding] source "${s.id}" never cited`)
    }
  }
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run tests/compiler-grounding.test.ts && npm run typecheck`
Expected: 14/14 pass (5 Task-1 + 9 new); tsc clean.

- [ ] **Step 5: Full suite (locks the no-sources byte-identity at every existing contract)**

Run: `npm test`
Expected: **346/346** (337 + 9). Every pre-existing test green — especially `compiler-stream.test.ts` / `compiler-compile.test.ts` (no grounding warnings when sources absent).

- [ ] **Step 6: Ledger + commit**

Append to `.superpowers/sdd/progress.md`:
`Compiler-grounding Task 3: complete (<sha>; 346/346, tsc clean)`

```bash
git add src/compiler/stream.ts tests/compiler-grounding.test.ts .superpowers/sdd/progress.md
git commit -m "feat(compiler): grounding audit + auto-appended sources block in the orchestrator"
```

---

### Task 4: Demo grounding, README, ROADMAP, full verification

**Files:**
- Modify: `demo/compileClient.js`
- Modify: `demo/compile.html`
- Modify: `README.md`
- Modify: `docs/ROADMAP.md`

**Interfaces:**
- Consumes: `CompileOptions.sources` (Task 1) — used from demo JS.
- Produces: `demoSources` export + `stubClient(paced = false, sources = [])` in `demo/compileClient.js`.

**Demo design note (spec §7 made concrete):** two canned excerpts — `signals-101` (has a URL) and `deploy-counts` (no URL). The stub cites `signals-101` in "The concept" and plants one deliberate hallucinated anchor in "Drawing it" (`#source-fourier-paper`), while `deploy-counts` is never cited — so the `/compile` audit log shows **both** audit warning kinds live (`cites unknown source` + `never cited`), and the appended `sources` block renders at the document tail.

- [ ] **Step 1: Update `demo/compileClient.js`**

Add after the initial comment block:

```js
// Grounding demo (compiler spec §7): two host excerpts — one gets cited, one
// is deliberately left uncited, and one section carries a hallucinated
// anchor — so the /compile audit log shows both [grounding] warning kinds.
export const demoSources = [
  {
    id: "signals-101",
    title: "Signals 101",
    text: "A signal is any quantity that carries information — voltage, sound pressure, pixels.",
    url: "https://example.com/signals-101",
  },
  {
    id: "deploy-counts",
    title: "Weekly deploy counts",
    text: "Deploys per weekday: Mon 4, Tue 9, Wed 18, Thu 11, Fri 7.",
  },
]
```

Change the stub signature and the two section replies:

```js
export function stubClient(paced = false, sources = []) {
```

In the `"The concept"` reply, append a citation when a source is supplied (replace the existing `blocks` text entry):

```js
          {
            type: "text",
            body:
              "A **signal** is any quantity that carries information — voltage, sound pressure, pixels." +
              (sources[0] ? ` Grounded in [Signals 101](#source-${sources[0].id}).` : ""),
          },
```

In the `"Drawing it"` reply, replace the existing text block with a hallucinated anchor when sources are supplied:

```js
          {
            type: "text",
            body:
              "One bespoke figure, generated from parameters — the arc's height follows the slider." +
              (sources.length ? " Background: [the original paper](#source-fourier-paper)." : ""),
          },
```

(`deploy-counts` is intentionally never cited — that drives the `never cited` warning.)

- [ ] **Step 2: Update `demo/compile.html`**

Change the import line and the stream call:

```js
  import { renderDocument, compileDocumentStream } from "explanations"
  import { stubClient, demoSources } from "/compileClient.js"
```

```js
  for await (const e of compileDocumentStream("How signals become pictures", {
    client: stubClient(true, demoSources),
    sources: demoSources,
  })) {
```

- [ ] **Step 3: README — "Grounded compiles" subsection**

Insert after the `### Streaming` section (before `## Authoring prompts yourself`):

```markdown
### Grounded compiles

Pass host-supplied source excerpts and the compiler grounds the document in
them: excerpt text is interpolated into the section prompts, the model is
taught the citation contract, and a `sources` block is appended to the last
surviving section automatically:

```ts
const { document, warnings } = await compileDocument("How Fourier series work", {
  client,
  sources: [
    { id: "fourier-notes", title: "Lecture notes", text: "A Fourier series…", url: "https://…" },
    { id: "worked-examples", title: "Worked examples", text: "Example 1: a square wave…" },
  ],
})
```

Chunking is host-side (`text` is 1–2000 chars, interpolated verbatim — treat
excerpts with the same trust you give `guidance`; model output is
schema-validated and escaped either way). The outline prompt sees
ids/titles/urls only; section prompts see the excerpt text plus the citation
contract (`[label](#source-<id>)`, or `[label](url)` when the source has one).

Grounding is constrained, not enforced — the compiler audits and warns, it
never drops or rewrites content:

| Warning | Meaning |
| --- | --- |
| `[grounding] source N dropped — <issue>` | Excerpt failed validation (id/title/text/url bounds, non-http(s) url) or the 24-source cap |
| `[grounding] duplicate source id "x" dropped` | Duplicate ids — first wins |
| `[grounding] section N cites unknown source "x"` | Citation anchor matching no excerpt (dead link) |
| `[grounding] source "x" never cited` | Validated excerpt the model never used |
| `[grounding] sources block not appended — no surviving section` | Every section was dropped |

Absent `sources`, compiles are byte-identical to ungrounded ones.
```

Note: the fenced `ts` block inside the README snippet is nested in this plan — write it as a normal fenced block in the file.

- [ ] **Step 4: ROADMAP flip**

In `docs/ROADMAP.md`, add to `## Shipped` (after the Sources block entry):

```markdown
- **Compiler grounding** (2026-10-02) — grounded authoring part 2:
  `compileDocument(topic, { client, sources })` interpolates host
  `SourceExcerpt`s into the outline (ids/titles/urls) and section prompts
  (full text + citation rules), auto-appends the `sources` block to the last
  surviving section, and audits output with `[grounding]` warnings for
  hallucinated anchors and never-cited excerpts. Spec:
  `docs/superpowers/specs/2026-10-01-compiler-grounding-design.md`.
```

In `## Backlog`, delete the whole `**Grounded authoring**` bullet (part 1 + part 2 now shipped) and fix the missing newline so the list reads:

```markdown
The arc is complete; new work starts here. Candidate threads (recorded
2026-09-30, unplanned — each needs its own spec → plan → build cycle):
- **Retrieval practice** — …
```

- [ ] **Step 5: Full verification**

```bash
npm run typecheck   # expect: clean
npm test            # expect: 346/346
npm run build       # expect: tsup + css copy succeed
```

Restart the demo so it serves the new dist (stale servers keep old dist — AGENTS.md):

```bash
launchctl remove explanations-demo 2>/dev/null || true
launchctl submit -l explanations-demo -- "$(command -v node)" "$PWD/demo/server.mjs"
```

Then verify from a SEPARATE tool call:

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:4173/compile          # 200
curl -s -o /dev/null -w "%{http_code}" http://localhost:4173/                 # 200
curl -s http://localhost:4173/compile | grep -c demoSources                   # 1 (html passes sources)
curl -s http://localhost:4173/compileClient.js | grep -c demoSources          # ≥1 (stub + export)
```

- [ ] **Step 6: Ledger + commit**

Append to `.superpowers/sdd/progress.md`:
`Compiler-grounding Task 4: complete (<sha>; 346/346, tsc, build, /compile + / smoke 200, both grounding warnings verified in served demo assets; roadmap flipped)`

```bash
git add demo/compileClient.js demo/compile.html README.md docs/ROADMAP.md .superpowers/sdd/progress.md
git commit -m "feat(compiler): grounded /compile demo + README grounding docs + roadmap flip"
```

---

## Branch finish (after all tasks)

1. **Fresh-eyes review pass** against the spec (`2026-10-01-compiler-grounding-design.md`): walk §3 (surface + validation), §4 (prompt flow + append), §5 (audit + exclusion + warning channel), §6 (test list — each bullet must map to a test), §7 (demo), §8 (out of scope — confirm nothing extra crept in). Also run `rafter-code-review`/`rafter run` posture per repo convention if the diff touches the noted surfaces (it does — host input → prompts/render).
2. **Ledger:** append `Compiler-grounding final review: …` with findings.
3. **Branch finished line** (convention, 2026-10-01): append to `.superpowers/sdd/progress.md` — merge state, tests on merged result, push state, branch deletion. Commit the ledger line.
4. Merge to `main` (fast-forward), run `npm test` + `tsc` on merged result before reporting done. Ask the user about pushing (recent branches vary: pushed vs local).
5. If any debugging lesson surfaced, append a dated entry to `docs/DEBUGGING.md` (symptom → root cause → fix → rule) before finishing.
