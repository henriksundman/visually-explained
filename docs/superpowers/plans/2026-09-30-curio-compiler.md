# Curio Compiler / Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `compileDocument(topic, opts)` — the provider-agnostic orchestrator that drives an injected LLM client through an outline call and per-section calls (bounded repair, lenient salvage) to produce a render-ready `DocumentIR`, plus a stub-client demo page — per spec `docs/superpowers/specs/2026-09-30-curio-compiler-design.md`.

**Architecture:** Five small modules under `src/compiler/`: client boundary types, JSON extraction, repair helper, prompts (interpolating the shared `BLOCK_TYPE_DOCS`), and the compile orchestration. The compiler consumes the finished document/explanation contracts unchanged — it introduces no new LLM-facing schema for the document itself, only an internal outline schema. All LLM interaction is behind a single minimal function type; every test runs offline against scripted fake clients.

**Tech Stack:** TypeScript, zod (existing), vitest, React 18 for the demo page (existing pattern). **Zero new dependencies.**

## Global Constraints

- **Dependency-free:** no new packages, runtime or dev (spec §1; ROADMAP "Decisions That Bind Future Work").
- **Provider-agnostic:** the only LLM surface is `type LlmClient = (req: { system: string; user: string }) => Promise<string>` (spec §2.2). No provider packages, no fetch, no streaming in the library.
- **Bounded repair:** at most `maxRepairs` (default 2) re-asks per stage; extraction failure counts as a validation failure and consumes an attempt (spec §2.3, §6).
- **Lenient salvage:** a section that still fails after repairs is dropped with a warning; only an irrecoverable outline throws (spec §6).
- **Canonical titles:** rendered section titles come from the outline, never the section call (spec §4).
- **No network in tests:** every test uses scripted fake clients (spec §7).
- **Re-export discipline:** compiler exports flow through `src/index.ts`; core never imports the compiler.
- **Commits:** conventional prefixes, lowercase scoped subjects.

## File Structure

- Create `src/compiler/client.ts` — `LlmClient`, `CompileOptions`, `CompileResult`, `CompileEvent` types.
- Create `src/compiler/extract.ts` — `extractJson(text): { ok: true; value: unknown } | { ok: false; snippet: string }` plus `outlineSchema` (internal contract).
- Create `src/compiler/repair.ts` — `parseWithIssues(schema, text)` → `{ ok: true; value } | { ok: false; issues, snippet }`, and `repairUserPrompt(...)` builder.
- Create `src/compiler/prompts.ts` — `outlineSystemPrompt`, `sectionSystemPrompt`, `outlineUserPrompt`, `sectionUserPrompt`.
- Create `src/compiler/compile.ts` — `compileDocument` orchestration.
- Modify `src/index.ts` — add `export * from "./compiler/...` lines (client, extract, repair, prompts, compile).
- Modify `demo/server.mjs` — add `/compile` route.
- Create `demo/compileClient.js` — stub `LlmClient` with canned outline/sections and one scripted repair.
- Modify `docs/ROADMAP.md` — mark step 3 shipped.
- Tests: `tests/compiler-extract.test.ts`, `tests/compiler-repair.test.ts`, `tests/compiler-prompts.test.ts`, `tests/compiler-compile.test.ts`.

---

### Task 1: Client boundary, JSON extraction, outline schema

**Files:**
- Create: `src/compiler/client.ts`, `src/compiler/extract.ts`
- Test: `tests/compiler-extract.test.ts`

**Interfaces:**
- Consumes: `z` from zod. Nothing from core yet.
- Produces:
  - `export type LlmClient = (req: { system: string; user: string }) => Promise<string>`
  - `export interface CompileOptions { client: LlmClient; maxRepairs?: number; guidance?: string; maxSections?: number }`
  - `export interface CompileEvent { kind: "outline-start" | "outline-done" | "section-start" | "section-done" | "section-failed" | "repair-attempt"; [key: string]: unknown }` (extra fields per spec §5 table)
  - `export interface CompileResult { document: unknown; events: CompileEvent[]; warnings: string[] }`
  - `export const outlineSchema` — zod object `{ version: 1, title: min(1), summary?: min(1), sections: array({ title: min(1), goal: min(1), visual?: enum("figure","diagram","chart") }).min(1) }` + `export type Outline`
  - `export function extractJson(text: string): { ok: true; value: unknown } | { ok: false; snippet: string }`

- [ ] **Step 1: Write the failing tests**

Create `tests/compiler-extract.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { extractJson, outlineSchema } from "../src/compiler/extract"

describe("extractJson", () => {
  it("parses a bare JSON object", () => {
    expect(extractJson('{"a":1}')).toEqual({ ok: true, value: { a: 1 } })
  })

  it("parses fenced JSON", () => {
    const text = 'Here you go:\n```json\n{"a": {"b": 2}}\n```\nDone.'
    expect(extractJson(text)).toEqual({ ok: true, value: { a: { b: 2 } } })
  })

  it("parses JSON with leading commentary before the brace", () => {
    expect(extractJson('Sure! The outline is {"a":1} as requested.')).toEqual({ ok: true, value: { a: 1 } })
  })

  it("handles braces inside strings when balancing", () => {
    expect(extractJson('{"s":"a } b","t":"{ c"}')).toEqual({ ok: true, value: { s: "a } b", t: "{ c" } })
  })

  it("fails with a short snippet on garbage", () => {
    const r = extractJson("no json at all")
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.snippet.length).toBeLessThanOrEqual(200)
  })

  it("fails on JSON arrays (object required)", () => {
    expect(extractJson("[1,2,3]").ok).toBe(false)
  })
})

describe("outlineSchema", () => {
  it("parses a valid outline with visual hints", () => {
    const outline = {
      version: 1,
      title: "T",
      summary: "S",
      sections: [
        { title: "A", goal: "Do a." },
        { title: "B", goal: "Do b.", visual: "figure" },
      ],
    }
    expect(outlineSchema.safeParse(outline).success).toBe(true)
  })

  it("rejects empty sections, empty goal, bad visual", () => {
    expect(outlineSchema.safeParse({ version: 1, title: "T", sections: [] }).success).toBe(false)
    expect(outlineSchema.safeParse({ version: 1, title: "T", sections: [{ title: "A", goal: "" }] }).success).toBe(false)
    expect(
      outlineSchema.safeParse({ version: 1, title: "T", sections: [{ title: "A", goal: "g", visual: "video" }] }).success,
    ).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/compiler-extract.test.ts`
Expected: FAIL — "Cannot find module '../src/compiler/extract'"

- [ ] **Step 3: Write the implementation**

Create `src/compiler/client.ts`:

```ts
/** The one LLM surface the library knows: host-injected, text-in/text-out.
 *  Works with any provider — with or without JSON mode — because the
 *  compiler owns extraction, validation, and repair. */
export type LlmClient = (req: { system: string; user: string }) => Promise<string>

export interface CompileOptions {
  client: LlmClient
  /** Repair re-asks per stage before salvage. Default 2. */
  maxRepairs?: number
  /** Host steering (audience, tone, constraints) interpolated into both user prompts. */
  guidance?: string
  /** Cap on outline sections. Default 12. */
  maxSections?: number
}

/** Extra fields per kind are specified in the compiler spec §5 table. */
export interface CompileEvent {
  kind: "outline-start" | "outline-done" | "section-start" | "section-done" | "section-failed" | "repair-attempt"
  [key: string]: unknown
}

export interface CompileResult {
  /** Assembled document IR — parses against documentSchema (contract-locked in tests). */
  document: unknown
  events: CompileEvent[]
  warnings: string[]
}
```

Create `src/compiler/extract.ts`:

```ts
import { z } from "zod"

export const outlineVisualSchema = z.enum(["figure", "diagram", "chart"])
export const outlineSectionSchema = z.object({
  title: z.string().min(1),
  goal: z.string().min(1),
  visual: outlineVisualSchema.optional(),
})
export const outlineSchema = z.object({
  version: z.literal(1),
  title: z.string().min(1),
  summary: z.string().min(1).optional(),
  sections: z.array(outlineSectionSchema).min(1),
})
export type Outline = z.infer<typeof outlineSchema>

export type Extracted =
  | { ok: true; value: unknown }
  | { ok: false; snippet: string }

/** Pull the first balanced JSON object out of model text. Tolerates code
 *  fences and leading commentary; tracks string state so braces inside
 *  strings never confuse the balance count. */
export function extractJson(text: string): Extracted {
  const start = text.indexOf("{")
  if (start === -1) return { ok: false, snippet: text.slice(0, 200) }
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === "\\") escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === "{") depth++
    else if (ch === "}") {
      depth--
      if (depth === 0) {
        try {
          return { ok: true, value: JSON.parse(text.slice(start, i + 1)) }
        } catch {
          return { ok: false, snippet: text.slice(start, Math.min(text.length, start + 200)) }
        }
      }
    }
  }
  return { ok: false, snippet: text.slice(start, Math.min(text.length, start + 200)) }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/compiler-extract.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/compiler/client.ts src/compiler/extract.ts tests/compiler-extract.test.ts
git commit -m "feat(compiler): llm client boundary, json extraction, outline schema"
```

---

### Task 2: Repair helper (parse-with-issues + repair prompt)

**Files:**
- Create: `src/compiler/repair.ts`
- Test: `tests/compiler-repair.test.ts`

**Interfaces:**
- Consumes: `extractJson` (Task 1); zod `z.ZodType`.
- Produces:
  - `export function parseWithIssues<T>(schema: z.ZodType<T>, text: string): { ok: true; value: T } | { ok: false; issues: string[]; snippet: string }` — extraction failure → issues `["output contained no JSON object"]`; safeParse failure → compact `"path: message"` lines
  - `export function repairUserPrompt(args: { previous: string; issues: string[]; rules: string }): string` — contains the offending fragment and the numbered issues

- [ ] **Step 1: Write the failing tests**

Create `tests/compiler-repair.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { z } from "zod"
import { parseWithIssues, repairUserPrompt } from "../src/compiler/repair"

const schema = z.object({ a: z.number() })

describe("parseWithIssues", () => {
  it("parses valid output", () => {
    expect(parseWithIssues(schema, '{"a":1}')).toEqual({ ok: true, value: { a: 1 } })
  })

  it("reports compact path-shaped issues on schema violation", () => {
    const r = parseWithIssues(schema, '{"a":"nope"}')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.issues).toHaveLength(1)
      expect(r.issues[0]).toMatch(/a.*number/i)
      expect(r.snippet).toContain('"a"')
    }
  })

  it("counts extraction failure as a validation failure", () => {
    const r = parseWithIssues(schema, "sorry, no json")
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues[0]).toMatch(/no JSON/i)
  })
})

describe("repairUserPrompt", () => {
  it("carries the offending fragment, issues, and rules", () => {
    const p = repairUserPrompt({
      previous: '{"a":"nope"}',
      issues: ["a: expected number"],
      rules: "- a must be a number",
    })
    expect(p).toContain('{"a":"nope"}')
    expect(p).toContain("a: expected number")
    expect(p).toContain("- a must be a number")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/compiler-repair.test.ts`
Expected: FAIL — "Cannot find module '../src/compiler/repair'"

- [ ] **Step 3: Write the implementation**

Create `src/compiler/repair.ts`:

```ts
import type { z } from "zod"
import { extractJson } from "./extract"

export type Parsed<T> = { ok: true; value: T } | { ok: false; issues: string[]; snippet: string }

/** Extract + validate model text in one step, returning compact issues for
 *  the repair loop. Extraction failure IS a validation failure (spec §6). */
export function parseWithIssues<T>(schema: z.ZodType<T>, text: string): Parsed<T> {
  const extracted = extractJson(text)
  if (!extracted.ok) {
    return { ok: false, issues: ["output contained no JSON object"], snippet: extracted.snippet }
  }
  const parsed = schema.safeParse(extracted.value)
  if (parsed.success) return { ok: true, value: parsed.data }
  const issues = parsed.error.issues.map(iss => {
    const path = iss.path.join(".")
    return `${path || "(root)"}: ${iss.message}`
  })
  return { ok: false, issues, snippet: extracted.snippet }
}

/** Repair re-ask: the offending fragment, the numbered issues, the rules. */
export function repairUserPrompt(args: { previous: string; issues: string[]; rules: string }): string {
  return [
    "Your previous reply failed validation.",
    "",
    "Problems:",
    ...args.issues.map((iss, i) => `${i + 1}. ${iss}`),
    "",
    "Offending output (fragment):",
    args.previous.slice(0, 400),
    "",
    "Rules that were violated:",
    args.rules,
    "",
    "Reply with the corrected JSON object ONLY — no fences, no commentary.",
  ].join("\n")
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/compiler-repair.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit` — expected: no errors

```bash
git add src/compiler/repair.ts tests/compiler-repair.test.ts
git commit -m "feat(compiler): parse-with-issues helper and repair prompt builder"
```

---

### Task 3: Prompts (outline + section)

**Files:**
- Create: `src/compiler/prompts.ts`
- Test: `tests/compiler-prompts.test.ts`

**Interfaces:**
- Consumes: `BLOCK_TYPE_DOCS` from `../core/blockTypes` (existing); `Outline`-section shape only for typing hints (no import needed).
- Produces:
  - `export function outlineSystemPrompt(maxSections: number): string`
  - `export function outlineUserPrompt(topic: string, guidance?: string): string`
  - `export function sectionSystemPrompt(): string`
  - `export function sectionUserPrompt(args: { index: number; title: string; goal: string; visual?: string; guidance?: string }): string`

- [ ] **Step 1: Write the failing tests**

Create `tests/compiler-prompts.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  outlineSystemPrompt,
  outlineUserPrompt,
  sectionSystemPrompt,
  sectionUserPrompt,
} from "../src/compiler/prompts"
import { BLOCK_TYPE_DOCS } from "../src/core/blockTypes"

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

  it("forbids sections and version keys in section output", () => {
    const p = sectionSystemPrompt()
    expect(p).toContain("never emit a \"sections\" key")
    expect(p).toContain("never emit a \"version\" key")
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/compiler-prompts.test.ts`
Expected: FAIL — "Cannot find module '../src/compiler/prompts'"

- [ ] **Step 3: Write the implementation**

Create `src/compiler/prompts.ts`:

```ts
import { BLOCK_TYPE_DOCS } from "../core/blockTypes"

export function outlineSystemPrompt(maxSections: number): string {
  return `
You design outlines for multi-section explanation documents. Output ONLY the JSON object — no markdown fences, no commentary.

Shape: { "version": 1, "title": string, "summary"?: string, "sections": [{ "title": string, "goal": string, "visual"?: "figure" | "diagram" | "chart" }] }

Rules:
- "version" must be exactly 1.
- "title" is the PAGE title; do not preface it.
- Plan at most ${maxSections} sections. Each section covers one idea-arc, ordered as the reader should meet them.
- "goal" is one or two sentences on what the section must accomplish for the reader; later steps write the section's blocks from it.
- Add "visual" only where a visual genuinely earns its place: "figure" (bespoke drawn diagram), "diagram" (semantic nodes/edges), "chart" (data). Most sections need none.
- Put no HTML in any field.
`.trim()
}

export function outlineUserPrompt(topic: string, guidance?: string): string {
  return [
    `Topic: ${topic}`,
    guidance ? `Guidance: ${guidance}` : "",
    "",
    "Design the outline. Reply with the JSON object ONLY.",
  ]
    .filter(Boolean)
    .join("\n")
}

export function sectionSystemPrompt(): string {
  return `
You write one section of a multi-section explanation document. Output ONLY the JSON object — no markdown fences, no commentary.

Shape: { "title": string, "blocks": Block[] } — you are writing ONE section: never emit a "sections" key, never emit a "version" key.

Rules:
- Each section's "blocks" follow exactly the same rules as a single explanation. Pick the most specific block type for each idea; do not repeat content in two places; group related blocks with "stack".
- Put no HTML in any field. Inline emphasis only: **bold**, *italic*, \`code\`.
- Math and expressions go in plain strings (e.g. derivation "expression"); no LaTeX delimiters.
- cause-effect/timeline/data-callout accept presentation?: "auto"|"text"|"figure". Default auto draws a figure when the data fits. Leave it as auto unless asked otherwise.

Block types:
${BLOCK_TYPE_DOCS}
`.trim()
}

export function sectionUserPrompt(args: { index: number; title: string; goal: string; visual?: string; guidance?: string }): string {
  return [
    `Write section ${args.index + 1} of the document: "${args.title}"`,
    `Goal: ${args.goal}`,
    args.visual ? `Visual: include one ${args.visual} block in this section.` : "",
    args.guidance ? `Guidance: ${args.guidance}` : "",
    "",
    'Reply with the section JSON object ONLY: { "title": string, "blocks": Block[] }.',
  ]
    .filter(Boolean)
    .join("\n")
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/compiler-prompts.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit` — expected: no errors

```bash
git add src/compiler/prompts.ts tests/compiler-prompts.test.ts
git commit -m "feat(compiler): outline and section prompts sharing block-type text"
```

---

### Task 4: `compileDocument` orchestration

**Files:**
- Create: `src/compiler/compile.ts`
- Test: `tests/compiler-compile.test.ts`

**Interfaces:**
- Consumes: `LlmClient`/`CompileOptions`/`CompileEvent`/`CompileResult` (Task 1); `outlineSchema` (Task 1); `parseWithIssues`/`repairUserPrompt` (Task 2); all four prompt builders (Task 3); `documentSectionSchema`, `documentSchema` from `../core/documentSchema` (existing).
- Produces: `export async function compileDocument(topic: string, opts: CompileOptions): Promise<CompileResult>` — per spec §5–§6.

- [ ] **Step 1: Write the failing tests**

Create `tests/compiler-compile.test.ts`:

```ts
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

/** Scripted fake: one system/user per call in order; reply by matching the user prompt. */
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

/** Test helper: swap the outline a client returns (kept for symmetry with other suites). */
```

Note for the executor: if the `withOutline` helper fights you, replace the second test with a plain `scriptedClient` that returns the one-section outline directly (as in the other tests) — the goal is testing repair-then-succeed, not the helper.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/compiler-compile.test.ts`
Expected: FAIL — "Cannot find module '../src/compiler/compile'"

- [ ] **Step 3: Write the implementation**

Create `src/compiler/compile.ts`:

```ts
import type { z } from "zod"
import type { CompileEvent, CompileOptions, CompileResult } from "./client"
import { outlineSchema, type Outline } from "./extract"
import { parseWithIssues, repairUserPrompt } from "./repair"
import {
  outlineSystemPrompt,
  outlineUserPrompt,
  sectionSystemPrompt,
  sectionUserPrompt,
} from "./prompts"
import { documentSectionSchema, type DocumentSection } from "../core/documentSchema"

interface StageArgs<T> {
  client: CompileOptions["client"]
  maxRepairs: number
  stage: "outline" | "section"
  system: string
  user: string
  rules: string
  schema: z.ZodType<T>
  events: CompileEvent[]
  warnings: string[]
  index?: number
}

/** One LLM stage with bounded repair. Throws only for the outline stage when
 *  repairs are exhausted (nothing to salvage); sections return null and the
 *  caller warns + drops (spec §6). */
async function stage<T>(args: StageArgs<T>): Promise<T | null> {
  let user = args.user
  for (let attempt = 0; ; attempt++) {
    const raw = await args.client({ system: args.system, user })
    const parsed = parseWithIssues(args.schema, raw)
    if (parsed.ok) return parsed.value
    if (attempt >= args.maxRepairs) {
      if (args.stage === "outline") {
        throw new Error(`compile: outline failed validation after ${args.maxRepairs + 1} calls: ${parsed.issues.join("; ")}`)
      }
      args.warnings.push(`[compile] section ${args.index} dropped — ${parsed.issues.join("; ")}`)
      return null
    }
    args.events.push({ kind: "repair-attempt", stage: args.stage, index: args.index, attempt: attempt + 1, issues: parsed.issues })
    user = repairUserPrompt({ previous: parsed.snippet, issues: parsed.issues, rules: args.rules })
  }
}

export async function compileDocument(topic: string, opts: CompileOptions): Promise<CompileResult> {
  const events: CompileEvent[] = []
  const warnings: string[] = []
  const maxSections = opts.maxSections ?? 12
  const maxRepairs = opts.maxRepairs ?? 2

  events.push({ kind: "outline-start", topic })
  const outline = await stage<Outline>({
    client: opts.client,
    maxRepairs,
    stage: "outline",
    system: outlineSystemPrompt(maxSections),
    user: outlineUserPrompt(topic, opts.guidance),
    rules: outlineSystemPrompt(maxSections),
    schema: outlineSchema,
    events,
    warnings,
  })
  if (!outline) throw new Error("compile: outline failed") // unreachable: outline stage throws instead

  // Cap outline sections at maxSections (defensive even though the schema
  // doesn't enforce the cap — the host asked for it, so honor it late too).
  const clamped: Outline = { ...outline, sections: outline.sections.slice(0, maxSections) }

  events.push({
    kind: "outline-done",
    title: clamped.title,
    sections: clamped.sections.length,
    visualHints: clamped.sections.filter(s => s.visual).length,
  })

  const sections: DocumentSection[] = []
  for (let i = 0; i < clamped.sections.length; i++) {
    const entry = clamped.sections[i]
    events.push({ kind: "section-start", index: i, title: entry.title })
    const raw = await stage<z.infer<typeof documentSectionSchema>>({
      client: opts.client,
      maxRepairs,
      stage: "section",
      system: sectionSystemPrompt(),
      user: sectionUserPrompt({ index: i, title: entry.title, goal: entry.goal, visual: entry.visual, guidance: opts.guidance }),
      rules: 'Shape: { "title": string, "blocks": Block[] }. A section has "title" and "blocks" only — never "sections", never "version".',
      schema: documentSectionSchema,
      events,
      warnings,
      index: i,
    })
    if (!raw) {
      events.push({ kind: "section-failed", index: i, title: entry.title })
      continue
    }
    // Canonical title: the outline's title wins over the section call's own.
    sections.push({ title: entry.title, blocks: raw.blocks })
    events.push({ kind: "section-done", index: i, title: entry.title, blocks: raw.blocks.length })
  }

  return {
    document: { version: 1, title: clamped.title, summary: clamped.summary, sections },
    events,
    warnings,
  }
}
```

Note: `stage` returning `null` only happens for sections; the outline path
always either returns parsed data or throws. The `if (!outline) throw` line
exists to satisfy TS's null check and is unreachable (comment says so).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/compiler-compile.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Full suite + typecheck**

Run: `npx tsc --noEmit && npx vitest run`
Expected: typecheck clean; all tests pass (255 + 23 new compiler tests)

- [ ] **Step 6: Commit**

```bash
git add src/compiler/compile.ts tests/compiler-compile.test.ts
git commit -m "feat(compiler): compileDocument orchestration with bounded repair"
```

---

### Task 5: Package exports

**Files:**
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: all four compiler modules (Tasks 1–4).
- Produces: public exports `compileDocument`, `LlmClient`, `CompileOptions`, `CompileResult`, `CompileEvent`, `outlineSchema`, `Outline`, `extractJson`, `parseWithIssues`, `repairUserPrompt`, the four prompt builders.

- [ ] **Step 1: Add the exports**

In `src/index.ts`, add after the existing core exports (before `export * from "./core/llm"` is fine; grouping is aesthetic):

```ts
export * from "./compiler/client"
export * from "./compiler/extract"
export * from "./compiler/repair"
export * from "./compiler/prompts"
export * from "./compiler/compile"
```

- [ ] **Step 2: Verify the public surface**

Run: `npx tsc --noEmit && npm run build >/dev/null 2>&1 && node -e "import('./dist/index.js').then(m => console.log(typeof m.compileDocument, typeof m.outlineSchema, typeof m.extractJson))"`
Expected: `function object function`

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat(compiler): export compiler from package root"
```

---

### Task 6: Demo `/compile` page (stub client) + ROADMAP

**Files:**
- Create: `demo/compileClient.js`
- Modify: `demo/server.mjs`
- Modify: `docs/ROADMAP.md`

**Interfaces:**
- Consumes: `compileDocument` + `LlmClient` from `dist/index.js` (Task 5's build); `renderDocument` from `dist/index.js`.
- Produces: `stubClient` in `demo/compileClient.js` (a canned `LlmClient` whose section reply for "Reading the data" fails validation once, then repairs); `GET /compile` route.

- [ ] **Step 1: Write the stub client**

Create `demo/compileClient.js`:

```js
// Stub LlmClient for the /compile demo: proves the orchestration end-to-end
// with zero API keys. The "Reading the data" section deliberately fails
// validation once so the repair loop is visible in the returned events.
export function stubClient() {
  let readingCalls = 0
  return async ({ user }) => {
    if (/Design the outline/.test(user)) {
      return JSON.stringify({
        version: 1,
        title: "How signals become pictures",
        summary: "Compiled live in your browser from a stub LLM.",
        sections: [
          { title: "The concept", goal: "Define signals and why pictures help.", visual: "diagram" },
          { title: "Reading the data", goal: "Show a small dataset as a chart.", visual: "chart" },
          { title: "Drawing it", goal: "Compose what we learned into one bespoke figure.", visual: "figure" },
        ],
      })
    }
    if (/Write section .*"The concept"/.test(user)) {
      return JSON.stringify({
        title: "The concept",
        blocks: [
          { type: "text", body: "A **signal** is any quantity that carries information — voltage, sound pressure, pixels." },
          {
            type: "diagram",
            nodes: [
              { id: "src", label: "Source", tip: "Where the signal originates" },
              { id: "ch", label: "Channel", tip: "Where noise creeps in" },
              { id: "sink", label: "Receiver", tip: "Where it is decoded" },
            ],
            edges: [
              { from: "src", to: "ch", kind: "leads" },
              { from: "ch", to: "sink", kind: "leads" },
            ],
          },
        ],
      })
    }
    if (/Write section .*"Reading the data"/.test(user)) {
      readingCalls++
      if (readingCalls === 1) {
        // Malformed on purpose: blocks is a string, not an array.
        return JSON.stringify({ title: "Reading the data", blocks: "oops" })
      }
      return JSON.stringify({
        title: "Reading the data",
        blocks: [
          { type: "text", body: "The same weekly numbers, drawn:" },
          { type: "chart", kind: "bar", points: [{ label: "Mon", value: 4 }, { label: "Tue", value: 9 }, { label: "Wed", value: 18 }, { label: "Thu", value: 11 }, { label: "Fri", value: 7 }], unit: "deploys", caption: "Deploys per weekday — deploy day towers." },
        ],
      })
    }
    if (/Write section .*"Drawing it"/.test(user)) {
      return JSON.stringify({
        title: "Drawing it",
        blocks: [
          { type: "text", body: "One bespoke figure, generated from parameters — the wave is the sum of its parts." },
          {
            type: "figure",
            title: "A sine from circles",
            caption: "Half a sine arc — height driven by the amp slider.",
            params: [{ name: "amp", min: 10, max: 60, step: 1, initial: 40 }],
            sweep: "amp",
            elements: [
              { kind: "curve", from: { x: 20, y: "120 - amp" }, cp1: { x: 60, y: "120 - amp * 2" }, cp2: { x: 100, y: "120 + amp * 2" }, to: { x: 140, y: "120" } },
              { kind: "dot", cx: 20, cy: "120 - amp", r: 4 },
            ],
          },
        ],
      })
    }
    return "unexpected prompt"
  }
}
```

- [ ] **Step 2: Add the `/compile` route**

In `demo/server.mjs`, extend the dist import:

```js
import { renderExplanation, renderDocument, compileDocument } from "../dist/index.js"
```

add to the examples import:

```js
import { stubClient } from "./compileClient.js"
```

and add the route (same pattern as `/document`):

```js
  if (url.pathname === "/compile") {
    // Proves the compiler end-to-end with a stub client — no API key. The
    // rendered page comes from the same renderDocument path as /document.
    const { document: docIr, events, warnings } = await compileDocument("signals", { client: stubClient() })
    const { html } = renderDocument(docIr, { theme: "none" })
    const audit = [
      `<pre style="font-size:0.75em;background:#f4f3f0;border:1px solid #e4e1d9;border-radius:8px;padding:12px;overflow-x:auto;">`,
      `events:\n${events.map(e => JSON.stringify(e)).join("\n")}`,
      `\nwarnings (${warnings.length}):\n${warnings.join("\n") || "(none)"}`,
      `</pre>`,
    ].join("\n")
    const compilePage = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>explanations — compile demo</title>
<link rel="stylesheet" href="/themes/tokens.css">
<link rel="stylesheet" href="/themes/light.css">
<link rel="stylesheet" href="/themes/dark.css">
<style>body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 46rem; padding: 0 1rem; }</style>
</head>
<body>
<p><a href="/">← all examples</a></p>
${html}
<h2>Compile audit</h2>
${audit}
</body>
</html>`
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end(compilePage)
    return
  }
```

Also add the index link next to the `/document` one:

```js
<a href="/compile">Compile demo →</a>
```

- [ ] **Step 3: Build + route smoke**

Run: `npm run build && PORT=4199 node demo/server.mjs & sleep 1.5; curl -s -o /tmp/compilepage.html -w "%{http_code}\n" http://localhost:4199/compile; grep -c "exp-doc-section\"" /tmp/compilepage.html; grep -c "repair-attempt" /tmp/compilepage.html; kill %1`
Expected: `200`, `3` (sections), `1` (the scripted repair), server killed cleanly.

- [ ] **Step 4: Update the ROADMAP**

In `docs/ROADMAP.md`, add to the end of the `## Shipped` list:

```markdown
- **Curio compiler / orchestrator** (2026-09-30) — `compileDocument(topic,
  { client })`: outline call → per-section calls with bounded repair (zod
  issues + offending fragment re-asks), lenient section salvage, canonical
  outline titles, structured events + warnings; provider-agnostic via a
  minimal host-injected text-in/text-out client; `/compile` demo on a stub
  client. Spec: `docs/superpowers/specs/2026-09-30-curio-compiler-design.md`.
```

And delete the `## Backlog` line about step 3 (the arc is complete):

```markdown
- Step 3 spec (Curio compiler / orchestrator) — write when its turn comes.
```

becomes (remove the line; if `## Backlog` is then empty, remove the heading too):

- [ ] **Step 5: Full verification**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: typecheck clean, all tests pass, build OK.

- [ ] **Step 6: Commit**

```bash
git add demo/compileClient.js demo/server.mjs docs/ROADMAP.md
git commit -m "demo: /compile page on a stub client; roadmap marks the arc complete"
```
