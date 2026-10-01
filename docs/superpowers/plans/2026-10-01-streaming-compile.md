# Streaming Compile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the compiler's orchestration loop as `compileDocumentStream(topic, opts)` — an async generator yielding the existing event vocabulary live plus a terminal `compile-done` event — and reimplement `compileDocument` as a drain of that stream.

**Architecture:** The private `stage()` helper mixes mechanics (call → parse → re-ask) with policy (throw vs. drop); streaming needs the mechanics without the policy. `runStage<T>()` becomes an async generator that yields `repair-attempt` events live and *returns* an outcome (`yield*`-consumed); `compileDocumentStream` owns all policy. `compile.ts` shrinks to a drain. Demo `/compile` moves client-side so progression is visible.

**Tech Stack:** TypeScript, vanilla async generators (no deps), vitest, tsup, zero-dependency demo server.

**Spec:** `docs/superpowers/specs/2026-10-01-streaming-compile-design.md`

**Branch:** `feature/streaming-compile` (already created from `main` @ `1a10fc1`). Commit the plan file itself as the first commit.

## Global Constraints

- **No new runtime deps** — `zod` and `roughjs` stay the only ones (README "Principles").
- **`LlmClient` is unchanged** — `(req: { system: string; user: string }) => Promise<string>`. Token-level streaming and abort signals stay out of scope (spec §9).
- **v1 failure contract unchanged** — outline exhaustion **throws** through both APIs; a section still invalid after repairs is dropped with a `[compile] section N dropped — …` warning.
- **v1 public signatures unchanged** — `compileDocument(topic, opts) → Promise<{ document, events, warnings }>`.
- **Event order is exactly v1's** (`outline-start` → `outline-done` → per section: `section-start` → `repair-attempt*` → `section-done` | `section-failed`), then `compile-done` last (stream only).
- **Payload growth is additive and shared by both APIs** (one code path): `outline-done` gains `summary?` + `sectionTitles: string[]` (post-clamp); `section-done`'s `blocks` is now the block **array** (was a count).
- **`document` stays contract-locked to `documentSchema` in tests.**
- **Canonical titles:** the outline's title always wins over the section call's own.
- **`maxSections` clamp applies before `outline-done`** so the shell always matches the final document.
- **TDD:** every behavior-changing task starts with a failing run (RED) before implementation. Tests explicitly labeled "contract lock" may pass immediately — that is their purpose; label them in the plan, don't fake a RED.
- **Commits:** one per task, conventional-commit style, `🤖 Generated with Codebuff` + `Co-Authored-By: Codebuff <noreply@codebuff.com>` footer. No pushing.
- **Demo contract:** the demo server serves **built** `dist/` — verify against a fresh `npm run build`, and restart the long-lived launchd server after rebuilds.

---

### Task 1: `stream.ts` — types, `runStage`, orchestration, `compile-done`

**Files:**
- Create: `src/compiler/stream.ts`
- Modify: `src/index.ts` (add one export line at the end)
- Test: `tests/compiler-stream.test.ts` (new)

**Interfaces:**
- Consumes: `CompileOptions`, `CompileEvent` from `./client`; `outlineSchema`, `Outline` from `./extract`; `parseWithIssues`, `repairUserPrompt` from `./repair`; `outlineSystemPrompt`, `outlineUserPrompt`, `sectionSystemPrompt`, `sectionUserPrompt` from `./prompts`; `documentSectionSchema`, `DocumentSection` from `../core/documentSchema`. All exist today with exactly these names.
- Produces: `type StreamCompileEvent = CompileEvent | { kind: "compile-done"; document: unknown; warnings: string[] }` and `function compileDocumentStream(topic: string, opts: CompileOptions): AsyncGenerator<StreamCompileEvent>`. Task 2 imports `compileDocumentStream`; later tasks rely on nothing else from this file.

- [ ] **Step 1: Commit the plan file**

```bash
git add docs/superpowers/plans/2026-10-01-streaming-compile.md
git commit -m "$(cat <<'EOF'
Add implementation plan for streaming compile

🤖 Generated with Codebuff
Co-Authored-By: Codebuff <noreply@codebuff.com>
EOF
)"
```

- [ ] **Step 2: Write the failing tests**

Create `tests/compiler-stream.test.ts` with the full content below. The fixtures mirror `tests/compiler-compile.test.ts` (this file is deliberately self-contained — do not import fixtures across test files).

```ts
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/compiler-stream.test.ts`
Expected: FAIL — module `../src/compiler/stream` does not exist (vitest "Failed to resolve import").

- [ ] **Step 4: Implement `src/compiler/stream.ts`**

```ts
import type { z } from "zod"
import type { CompileEvent, CompileOptions } from "./client"
import { outlineSchema, type Outline } from "./extract"
import { parseWithIssues, repairUserPrompt } from "./repair"
import {
  outlineSystemPrompt,
  outlineUserPrompt,
  sectionSystemPrompt,
  sectionUserPrompt,
} from "./prompts"
import { documentSectionSchema, type DocumentSection } from "../core/documentSchema"

export type StreamCompileEvent =
  | CompileEvent
  | { kind: "compile-done"; document: unknown; warnings: string[] }

type StageOutcome<T> = { ok: true; value: T } | { ok: false; issues: string[] }

interface StageArgs<T> {
  client: CompileOptions["client"]
  maxRepairs: number
  stage: "outline" | "section"
  system: string
  user: string
  rules: string
  schema: z.ZodType<T>
  index?: number
}

/** Mechanical LLM stage: call → parse → re-ask, at most maxRepairs times.
 *  Yields repair-attempt events the moment they happen and RETURNS the
 *  outcome (consume via yield*). Purely mechanical — the throw-for-outline /
 *  drop-for-section policy lives in the orchestrator. */
async function* runStage<T>(args: StageArgs<T>): AsyncGenerator<CompileEvent, StageOutcome<T>, undefined> {
  let user = args.user
  for (let attempt = 0; ; attempt++) {
    const raw = await args.client({ system: args.system, user })
    const parsed = parseWithIssues(args.schema, raw)
    if (parsed.ok) return { ok: true, value: parsed.value }
    if (attempt >= args.maxRepairs) return { ok: false, issues: parsed.issues }
    yield {
      kind: "repair-attempt",
      stage: args.stage,
      index: args.index,
      attempt: attempt + 1,
      issues: parsed.issues,
    }
    user = repairUserPrompt({ previous: parsed.snippet, issues: parsed.issues, rules: args.rules })
  }
}

/** Stream the compile: yields the v1 event vocabulary live (spec §5), then a
 *  terminal compile-done carrying { document, warnings }. Outline exhaustion
 *  throws (unchanged v1 contract); a failed section is warned + dropped. */
export async function* compileDocumentStream(
  topic: string,
  opts: CompileOptions,
): AsyncGenerator<StreamCompileEvent> {
  const warnings: string[] = []
  const maxSections = opts.maxSections ?? 12
  const maxRepairs = opts.maxRepairs ?? 2

  yield { kind: "outline-start", topic }
  const outlineOutcome = yield* runStage<Outline>({
    client: opts.client,
    maxRepairs,
    stage: "outline",
    system: outlineSystemPrompt(maxSections),
    user: outlineUserPrompt(topic, opts.guidance),
    rules: outlineSystemPrompt(maxSections),
    schema: outlineSchema,
  })
  if (!outlineOutcome.ok) {
    throw new Error(
      `compile: outline failed validation after ${maxRepairs + 1} calls: ${outlineOutcome.issues.join("; ")}`,
    )
  }
  const outline = outlineOutcome.value

  // Clamp BEFORE outline-done so the shell (title/summary/sectionTitles)
  // always matches the final document.
  const clamped: Outline = { ...outline, sections: outline.sections.slice(0, maxSections) }

  yield {
    kind: "outline-done",
    title: clamped.title,
    summary: clamped.summary,
    sections: clamped.sections.length,
    visualHints: clamped.sections.filter(s => s.visual).length,
    sectionTitles: clamped.sections.map(s => s.title),
  }

  const sections: DocumentSection[] = []
  for (let i = 0; i < clamped.sections.length; i++) {
    const entry = clamped.sections[i]
    yield { kind: "section-start", index: i, title: entry.title }
    const outcome = yield* runStage<z.infer<typeof documentSectionSchema>>({
      client: opts.client,
      maxRepairs,
      stage: "section",
      system: sectionSystemPrompt(),
      user: sectionUserPrompt({
        index: i,
        title: entry.title,
        goal: entry.goal,
        visual: entry.visual,
        guidance: opts.guidance,
      }),
      rules:
        'Shape: { "title": string, "blocks": Block[] }. A section has "title" and "blocks" only — never "sections", never "version".',
      schema: documentSectionSchema,
      index: i,
    })
    if (!outcome.ok) {
      warnings.push(`[compile] section ${i} dropped — ${outcome.issues.join("; ")}`)
      yield { kind: "section-failed", index: i, title: entry.title }
      continue
    }
    // Canonical title: the outline's title wins over the section call's own.
    sections.push({ title: entry.title, blocks: outcome.value.blocks })
    yield { kind: "section-done", index: i, title: entry.title, blocks: outcome.value.blocks }
  }

  yield {
    kind: "compile-done",
    document: { version: 1, title: clamped.title, summary: clamped.summary, sections },
    warnings,
  }
}
```

- [ ] **Step 5: Export from the package root**

In `src/index.ts`, append after the last compiler export line (`export * from "./compiler/compile"`):

```ts
export * from "./compiler/stream"
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/compiler-stream.test.ts`
Expected: PASS — 4/4.

- [ ] **Step 7: Run the full suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit && echo OK`
Expected: 287/287 tests (283 existing + 4 new), tsc clean. The existing compiler tests pass unchanged — order and old payload fields are untouched.

- [ ] **Step 8: Commit**

```bash
git add src/compiler/stream.ts src/index.ts tests/compiler-stream.test.ts
git commit -m "$(cat <<'EOF'
feat(compiler): streaming compileDocumentStream with terminal compile-done

🤖 Generated with Codebuff
Co-Authored-By: Codebuff <noreply@codebuff.com>
EOF
)"
```

---

### Task 2: `compile.ts` becomes a drain (one code path)

**Files:**
- Modify: `src/compiler/compile.ts` (full rewrite — old content below gets replaced)
- Test: `tests/compiler-stream.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `compileDocumentStream` from `./stream` (Task 1), `CompileEvent`/`CompileOptions`/`CompileResult` from `./client` (unchanged).
- Produces: `compileDocument(topic: string, opts: CompileOptions): Promise<CompileResult>` — same signature as today. The README and demo both already use this shape.

- [ ] **Step 1: Write the failing tests**

Append to `tests/compiler-stream.test.ts` (after the existing describe block; also add the static import at the top of the file, next to the other imports):

```ts
import { compileDocument } from "../src/compiler/compile"
```

```ts
describe("compileDocument (drain)", () => {
  it("shares the stream's grown payloads", async () => {
    const { events } = await compileDocument("signals", { client: happyClient() })
    const outlineDone = events.find(e => e.kind === "outline-done") as { sectionTitles?: string[] }
    expect(outlineDone.sectionTitles).toEqual(["What is a signal", "Reading data", "Broken section"])
    const sectionDone = events.find(e => e.kind === "section-done") as { blocks?: unknown }
    expect(Array.isArray(sectionDone.blocks)).toBe(true)
  })

  it("drained stream deep-equals compileDocument", async () => {
    const a = await compileDocument("signals", { client: happyClient() })
    const events: StreamCompileEvent[] = []
    let document: unknown
    let warnings: string[] = []
    for await (const e of compileDocumentStream("signals", { client: happyClient() })) {
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

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/compiler-stream.test.ts`
Expected: FAIL — exactly the two new tests. `shares the stream's grown payloads` fails on `sectionTitles` (old impl doesn't emit it) and `Array.isArray(blocks)` (old impl emits the count `1`); `drained stream deep-equals compileDocument` fails on the same payload divergence.

- [ ] **Step 3: Rewrite `src/compiler/compile.ts` as the drain**

Replace the ENTIRE file content with:

```ts
import type { CompileEvent, CompileOptions, CompileResult } from "./client"
import { compileDocumentStream } from "./stream"

/** Accumulate-all convenience: drains the stream (one code path). The
 *  contract tests run both APIs against the same scripted clients, so the
 *  two surfaces cannot drift. */
export async function compileDocument(topic: string, opts: CompileOptions): Promise<CompileResult> {
  let document: unknown
  let warnings: string[] = []
  const events: CompileEvent[] = []
  for await (const e of compileDocumentStream(topic, opts)) {
    if (e.kind === "compile-done") {
      document = e.document
      warnings = e.warnings
    } else {
      events.push(e)
    }
  }
  return { document, events, warnings }
}
```

(The old `stage()` helper, `StageArgs`, prompt imports, and assembly loop all move to `stream.ts` — do not keep them here. There is no circular import: `stream.ts` never imports `compile.ts`.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/compiler-stream.test.ts tests/compiler-compile.test.ts`
Expected: PASS — 6/6 stream + 5/5 existing compile tests (the v1 tests now run against the drain and pass unchanged).

- [ ] **Step 5: Run the full suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit && echo OK`
Expected: 289/289 tests, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/compiler/compile.ts tests/compiler-stream.test.ts
git commit -m "$(cat <<'EOF'
refactor(compiler): compileDocument drains the streaming path

🤖 Generated with Codebuff
Co-Authored-By: Codebuff <noreply@codebuff.com>
EOF
)"
```

---

### Task 3: Incremental delivery + abandonment contract locks

**Files:**
- Test: `tests/compiler-stream.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `compileDocumentStream` (Task 1), `happyClient`/fixtures already in the file.
- Produces: nothing — these are contract locks (spec §7). They should PASS immediately against Task 1/2 code; their job is to fail loudly if a future change makes delivery batch or adds surface. Label: contract locks, no RED expected.

- [ ] **Step 1: Append the tests**

```ts
describe("stream semantics (contract locks)", () => {
  it("delivers section-done before the next section call starts", async () => {
    const outline = {
      version: 1,
      title: "T",
      sections: [
        { title: "First", goal: "g" },
        { title: "Second", goal: "g" },
      ],
    }
    const timeline: string[] = []
    const client: LlmClient = async req => {
      await new Promise(r => setTimeout(r, 20))
      if (outlineMatch.test(req.user)) {
        timeline.push("call:outline")
        return JSON.stringify(outline)
      }
      if (sectionMatch("First").test(req.user)) {
        timeline.push("call:first")
        return JSON.stringify(goodSection("First"))
      }
      timeline.push("call:second")
      return JSON.stringify(goodSection("Second"))
    }
    for await (const e of compileDocumentStream("signals", { client })) {
      if (e.kind === "section-done") timeline.push(`done:${e.index}`)
    }
    // The whole point: delivery of done:0 happens before call:second is made.
    expect(timeline).toEqual(["call:outline", "call:first", "done:0", "call:second", "done:1"])
  })

  it("stops issuing calls when the consumer breaks early", async () => {
    let calls = 0
    const client: LlmClient = async req => {
      calls++
      if (outlineMatch.test(req.user)) {
        return JSON.stringify({ ...cannedOutline, sections: cannedOutline.sections.slice(0, 1) })
      }
      return JSON.stringify(goodSection("What is a signal"))
    }
    for await (const e of compileDocumentStream("signals", { client })) {
      if (e.kind === "outline-done") break
    }
    expect(calls).toBe(1) // outline only — the section call never started
  })
})
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run tests/compiler-stream.test.ts`
Expected: PASS — 8/8 (contract locks; a FAIL here means the generator implementation regressed, not that these tests are new).

- [ ] **Step 3: Full suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit && echo OK`
Expected: 291/291 tests, tsc clean.

- [ ] **Step 4: Commit**

```bash
git add tests/compiler-stream.test.ts
git commit -m "$(cat <<'EOF'
test(compiler): lock incremental delivery and abandonment semantics

🤖 Generated with Codebuff
Co-Authored-By: Codebuff <noreply@codebuff.com>
EOF
)"
```

---

### Task 4: Demo `/compile` streams live in the browser

**Files:**
- Modify: `demo/compileClient.js` (add pacing opt-in)
- Create: `demo/compile.html` (static shell + client-side stream consumer)
- Modify: `demo/server.mjs` (route `/compile` to the static shell; add `/index.js` and `/compileClient.js` routes; drop the server-side compile import)

**Interfaces:**
- Consumes: `compileDocumentStream`, `renderDocument` from the built `dist/index.js` (served at `/index.js`); `stubClient` from `/compileClient.js`.
- Produces: a `/compile` route that returns 200 with the streaming shell. Browser behavior (progression) needs human eyes — curl only proves the shell and assets serve, same boundary as the interactive-runtime cycle.

- [ ] **Step 1: Add pacing to the stub client**

In `demo/compileClient.js`, replace:

```js
export function stubClient() {
  let readingCalls = 0
  return async ({ user }) => {
```

with:

```js
/** paced=true delays every reply ~300-600ms so the streamed progression is
 *  visible in the browser; default unpaced for fast SSR/audit consumers. */
export function stubClient(paced = false) {
  let readingCalls = 0
  const wait = (ms) => new Promise(r => setTimeout(r, ms))
  return async ({ user }) => {
    if (paced) await wait(300 + Math.random() * 300)
```

Everything else in the file stays exactly as-is.

- [ ] **Step 2: Create `demo/compile.html`**

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>explanations — compile demo</title>
<script type="importmap">
{
  "imports": {
    "zod": "https://esm.sh/zod@4",
    "roughjs": "https://esm.sh/roughjs@4.6.6",
    "explanations": "/index.js"
  }
}
</script>
<link rel="stylesheet" href="/themes/tokens.css">
<link rel="stylesheet" href="/themes/light.css">
<link rel="stylesheet" href="/themes/dark.css">
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 46rem; padding: 0 1rem; }
  #status { font-family: ui-monospace, monospace; font-size: 0.85em; color: #666; min-height: 1.2em; }
  #audit { font-size: 0.75em; background: #f4f3f0; border: 1px solid #e4e1d9; border-radius: 8px; padding: 12px; overflow-x: auto; white-space: pre-wrap; }
</style>
</head>
<body>
<p><a href="/">← all examples</a></p>
<h1>explanations — compile demo</h1>
<p>This page consumes <code>compileDocumentStream</code> live: the header and TOC appear when the outline resolves, sections append as they land, and the audit log fills with events as they are yielded. (Scroll-spy is demoed on <a href="/document">/document</a>.)</p>
<div id="status"></div>
<div id="doc-root"></div>
<h2>Compile audit</h2>
<pre id="audit">(waiting for events)</pre>
<script type="module">
  import { renderDocument, compileDocumentStream } from "explanations"
  import { stubClient } from "/compileClient.js"

  const root = document.getElementById("doc-root")
  const statusEl = document.getElementById("status")
  const auditEl = document.getElementById("audit")

  const events = []
  let warnings = []
  let outline = null
  const sections = []
  const dropped = []

  function renderDoc() {
    if (!outline) { root.innerHTML = ""; return }
    const { html } = renderDocument(
      { version: 1, title: outline.title, summary: outline.summary, sections: sections.slice() },
      { theme: "light" },
    )
    root.innerHTML = html
  }

  for await (const e of compileDocumentStream("How signals become pictures", { client: stubClient(true) })) {
    events.push(e)
    if (e.kind === "outline-done") {
      outline = e
      renderDoc()
      statusEl.textContent = `Outlined "${e.title}" — ${e.sections} sections to write`
    } else if (e.kind === "section-start") {
      statusEl.textContent = `Writing section ${e.index + 1}/${outline.sections} — "${e.title}"…`
    } else if (e.kind === "repair-attempt") {
      statusEl.textContent = `Repairing ${e.stage}${e.index !== undefined ? ` (section ${e.index})` : ""} — attempt ${e.attempt}…`
    } else if (e.kind === "section-done") {
      sections.push({ title: e.title, blocks: e.blocks })
      renderDoc()
    } else if (e.kind === "section-failed") {
      dropped.push(e.title)
    } else if (e.kind === "compile-done") {
      warnings = e.warnings
      statusEl.textContent =
        `Done — ${sections.length} section(s)${dropped.length ? `, dropped: ${dropped.join(", ")}` : ""}` +
        `${e.warnings.length ? `, ${e.warnings.length} warning(s)` : ""}`
    }
    auditEl.textContent =
      events.map(ev => JSON.stringify(ev)).join("\n") +
      `\nwarnings: ${warnings.join(" | ") || "(none)"}`
  }
</script>
</body>
</html>
```

(Note: `sections.push({ title: e.title, blocks: e.blocks })` works because of the §5 payload growth — `section-done` carries the block array. The zod and roughjs importmap entries follow the interactive-runtime lesson: unmapped bare specifiers in `dist/` break the browser module graph.)

- [ ] **Step 3: Rewire `demo/server.mjs`**

Three edits:

(a) Replace the dist import and delete the stub import — replace:

```js
import { renderExplanation, renderDocument, compileDocument } from "../dist/index.js"
import { educationIr, dataIr, capabilitiesIr, figuresIr, howToIr, demoDocIr } from "./examples.js"
import { stubClient } from "./compileClient.js"
```

with:

```js
import { renderExplanation, renderDocument } from "../dist/index.js"
import { educationIr, dataIr, capabilitiesIr, figuresIr, howToIr, demoDocIr } from "./examples.js"
```

(b) Replace the ENTIRE `/compile` route block — from `if (url.pathname === "/compile") {` down to the closing `}` immediately before `if (url.pathname === "/document") {` — with:

```js
  if (url.pathname === "/compile") {
    // Streaming demo: the shell is static; the compile runs client-side via
    // compileDocumentStream so the progression is visible in the browser.
    try {
      const html = await readFile(new URL("./compile.html", import.meta.url))
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
      res.end(html)
    } catch {
      res.writeHead(404, { "content-type": "text/plain" })
      res.end("not found")
    }
    return
  }
```

(c) Add asset routes right after the `/examples.js` route block:

```js
  if (url.pathname === "/compileClient.js") {
    const js = await readFile(new URL("./compileClient.js", import.meta.url))
    res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" })
    res.end(js)
    return
  }
  if (url.pathname === "/index.js") {
    const js = await readFile(new URL("../dist/index.js", import.meta.url))
    res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" })
    res.end(js)
    return
  }
```

(Without (c) the page 200s but its imports 404 — the two curls in Task 5 catch exactly that.)

- [ ] **Step 4: Build and verify the routes serve**

```bash
npm run build
launchctl remove explanations-demo 2>/dev/null; true
launchctl submit -l explanations-demo -- "$(command -v node)" "$PWD/demo/server.mjs"
sleep 1
curl -s -o /dev/null -w "compile:%{http_code}\n" http://localhost:4173/compile
curl -s -o /dev/null -w "index:%{http_code}\n" http://localhost:4173/index.js
curl -s -o /dev/null -w "stub:%{http_code}\n" http://localhost:4173/compileClient.js
curl -s -o /dev/null -w "doc:%{http_code}\n" http://localhost:4173/document
curl -s -o /dev/null -w "root:%{http_code}\n" http://localhost:4173/
```

Expected: all five report 200. (`index:200` confirms the new route; the page's module graph is exercised only in a browser — flag that for the user, don't claim it.)

- [ ] **Step 5: Full suite + typecheck (demo files are untested but must not break anything)**

Run: `npx vitest run && npx tsc --noEmit && echo OK`
Expected: 291/291, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add demo/compileClient.js demo/compile.html demo/server.mjs
git commit -m "$(cat <<'EOF'
demo(compile): stream the compile live in the browser

🤖 Generated with Codebuff
Co-Authored-By: Codebuff <noreply@codebuff.com>
EOF
)"
```

---

### Task 5: README, ROADMAP, ledger, final verification

**Files:**
- Modify: `README.md` (Pipeline 2 section)
- Modify: `docs/ROADMAP.md` (Shipped bullet + backlog removal)
- Modify: `.superpowers/sdd/progress.md` (git-ignored ledger — no commit)

**Interfaces:**
- Consumes: shipped Tasks 1–4. Produces: documentation only.

- [ ] **Step 1: README — update the event table**

In `README.md`, replace the two table rows:

```markdown
| `outline-done` | `{ title, sections, visualHints }` |
```
→
```markdown
| `outline-done` | `{ title, summary?, sections, visualHints, sectionTitles }` |
```

```markdown
| `section-done` | `{ index, title, blocks }` |
```
→
```markdown
| `section-done` | `{ index, title, blocks: Block[] }` |
```

and append a new row after the `repair-attempt` row:

```markdown
| `compile-done` | `{ document, warnings }` — terminal, stream API only |
```

- [ ] **Step 2: README — fix the stale "no streaming" sentence**

Replace:

```markdown
`index` is absent on outline-stage `repair-attempt` events. Events resolve
with the result (no streaming in v1). `CompileEvent` carries open extra
```

with:

```markdown
`index` is absent on outline-stage `repair-attempt` events. Events resolve
with the result — or stream live via `compileDocumentStream` (below).
`CompileEvent` carries open extra
```

- [ ] **Step 3: README — add the Streaming subsection**

Insert immediately before `## Authoring prompts yourself`:

```markdown
### Streaming

`compileDocumentStream` yields the same events live as an async generator,
plus a terminal `compile-done` carrying `{ document, warnings }`:

```ts
import { compileDocumentStream } from "explanations"

for await (const event of compileDocumentStream("How Fourier series work", { client })) {
  if (event.kind === "outline-done") renderShell(event.title, event.summary, event.sectionTitles)
  if (event.kind === "section-done") appendSection(event.title, event.blocks)
  if (event.kind === "compile-done") finish(event.document, event.warnings)
}
```

`outline-done` additionally carries `summary` and the clamped
`sectionTitles` — the shell always matches the final document — and
`section-done` carries the section's `blocks` array for live appending.
Both APIs emit from one code path; `compileDocument` is a drain of the
stream. Outline exhaustion still throws through `for await`.

Abandonment: `break` stops event delivery immediately and no further LLM
calls are started, but the in-flight call still completes in the background
and its result is discarded. For true cancellation, wrap your own
`LlmClient` with an abort signal.
```

- [ ] **Step 4: README — codebase map rows**

Replace:

```markdown
| `src/compiler/` | `compileDocument`: prompts, JSON extraction, repair, events |
```

with:

```markdown
| `src/compiler/` | `compileDocument` + `compileDocumentStream`: prompts, JSON extraction, repair, events |
```

and replace:

```markdown
| `demo/` | Static server over `dist/` — all examples, `/document`, `/interactive`, `/compile` (stub client) |
```

with:

```markdown
| `demo/` | Static server over `dist/` — all examples, `/document`, `/interactive`, `/compile` (stub client, streamed live) |
```

- [ ] **Step 5: ROADMAP — Shipped bullet + backlog removal**

In `docs/ROADMAP.md`, append to the **Shipped** list (after the Host README bullet):

```markdown
- **Streaming compile** (2026-10-01) — `compileDocumentStream(topic, { client })`:
  async generator yielding the v1 event vocabulary live plus a terminal
  `compile-done` event carrying `{ document, warnings }`; `compileDocument`
  is a drain of the stream (one code path, contract tests lock both APIs);
  `/compile` consumes the stream client-side with a paced stub. Spec:
  `docs/superpowers/specs/2026-10-01-streaming-compile-design.md`.
```

and delete the backlog bullet:

```markdown
- **Streaming compile** — async-generator API at the compiler's existing
  seams (compiler spec §9): header/TOC render immediately, sections append
  as they resolve. The highest-leverage host UX win left on the table.
```

- [ ] **Step 6: Final verification**

```bash
npx tsc --noEmit && npx vitest run 2>&1 | tail -4
npm run build
launchctl remove explanations-demo 2>/dev/null; true
launchctl submit -l explanations-demo -- "$(command -v node)" "$PWD/demo/server.mjs"
sleep 1
curl -s -o /dev/null -w "compile:%{http_code} " http://localhost:4173/compile
curl -s -o /dev/null -w "index:%{http_code} " http://localhost:4173/index.js
curl -s -o /dev/null -w "doc:%{http_code} " http://localhost:4173/document
curl -s -o /dev/null -w "root:%{http_code}\n" http://localhost:4173/
./scripts/vexp verify
```

Expected: tsc clean; 291/291 tests; build ok; all curls 200; `vexp verify` lists the touched tests as run (run any it flags).

- [ ] **Step 7: Commit docs**

```bash
git add README.md docs/ROADMAP.md
git commit -m "$(cat <<'EOF'
docs: document compileDocumentStream and flip the roadmap

🤖 Generated with Codebuff
Co-Authored-By: Codebuff <noreply@codebuff.com>
EOF
)"
```

- [ ] **Step 8: Update the progress ledger** (git-ignored — no commit)

Append to `.superpowers/sdd/progress.md`:

```text
Streaming Task 1: complete (stream.ts: runStage yield* + orchestrator + compile-done; 4 stream tests)
Streaming Task 2: complete (compileDocument = drain; parity + payload tests)
Streaming Task 3: complete (incremental delivery + abandonment contract locks)
Streaming Task 4: complete (/compile client-side streaming; /index.js + /compileClient.js routes; paced stub)
Streaming Task 5: complete (README streaming subsection + roadmap flip; full verification green)
```

- [ ] **Step 9: Fresh-eyes review pass against the spec**

Re-read `docs/superpowers/specs/2026-10-01-streaming-compile-design.md` §3–§9 and check each requirement against the shipped code: surface shape, event table, drain, abandonment wording, demo behavior, test matrix, out-of-scope list. Fix discrepancies in a follow-up commit before declaring the branch done.
