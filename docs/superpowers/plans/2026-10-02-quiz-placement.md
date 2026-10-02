# Quiz Placement in the Compiler — Implementation Plan (Retrieval Practice, Part 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This repo executes plans **inline** — no CLI subagents (AGENTS.md).

**Goal:** `compileDocument(topic, { client, checks: true })` lets the outline declare retrieval-check sections and instructs those section writers to close with exactly one quiz — with a `[checks]` drift audit, free grounding coverage of quiz content, and byte-identical behavior when the flag is off.

**Architecture:** One new `CompileOptions.checks` boolean threaded through the existing two-stage orchestrator. `outlineSectionSchema` gains optional `check` (model-output shape). `prompts.ts` gains two conditional fragments (outline planning line; section instruction line). `stream.ts` threads the flag, adds `checks: N` to `outline-done` (flag on only), and audits accepted check-declared sections for a quiz (recursing into `stack` children), warning through the existing `warnings` channel. No new events, no repair machinery, no deps.

**Tech Stack:** TypeScript (ES2022, strict), zod, vitest (node env), tsup.

**Spec:** `docs/superpowers/specs/2026-10-02-quiz-placement-design.md` (approved 2026-10-02).

## Global Constraints

- **Byte-identity when off:** absent/false `checks` → outline prompt, section prompts, events, document, warnings byte-identical to today (the `sources` inertness rule). Both prompt builders compose via `.filter(Boolean)`, so absent fragments vanish.
- **Constrain + audit-warn only:** drift produces `[checks] section N declared a check but placed no quiz`; nothing is dropped, thrown, or filtered. Quizzes in undeclared sections are fine; no quota enforcement.
- **No compile-side quiz validation:** bad quiz payloads degrade at render (`quiz-answer-invalid` etc.) — the schema/render split holds.
- **No new event kinds:** only the optional `checks` field on `outline-done`, flag-on only.
- **Deterministic prompts:** fragment order per spec §4 (outline: topic → guidance → **checks** → sources → instruction; section: title → goal → visual → **check instruction** → guidance → sources → instruction).
- **Verification commands:** `npm run typecheck`, `npm test`, `npm run build`. Baseline at branch start: **359 tests / 44 files, all green** (main @ `a035b1c`). Expected final: **371/371** (359 + 4 + 8).
- **Merge gate (AGENTS.md 2026-10-02):** execute on `feature/quiz-placement`, stop at ready-to-merge, present the demo for review — do **not** merge to main without explicit go-ahead.
- **Execution:** inline only; per-task commit; append a ledger line to `.superpowers/sdd/progress.md` after each task.

---

### Task 1: `check` on the outline schema + prompt fragments

**Files:**
- Modify: `src/compiler/extract.ts` (one line), `src/compiler/prompts.ts`
- Modify: `tests/compiler-prompts.test.ts` (append)

**Interfaces:**
- Consumes: `SourceExcerpt` (existing), existing prompt-builder signatures.
- Produces (used by Task 2):
  - `outlineSectionSchema` entries may carry `check?: boolean` (flows into `Outline` type automatically).
  - `outlineUserPrompt(topic: string, guidance?: string, sources?: SourceExcerpt[], checks?: boolean): string`
  - `sectionUserPrompt(args: { …existing; check?: boolean }): string`
  - Fragment texts (exact, test-pinned):
    - outline: `Checks: mark sections with "check": true where a short quiz would consolidate the learning — not every section; never the first; skip reference-style ones.`
    - section: `End this section with exactly ONE quiz block (the retrieval check the outline planned): question answerable from this section alone, 2-4 options, plausible distractors whose why names the misconception, answer as the 0-based index.`

- [ ] **Step 1: Write the failing tests**

Append to `tests/compiler-prompts.test.ts` (extend the existing `SourceExcerpt` import only if needed — it's already imported there from the grounding cycle):

```ts
describe("checks prompts", () => {
  const sources: SourceExcerpt[] = [{ id: "s1", title: "Notes", text: "Some excerpt text." }]

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
    // Order: the check instruction sits after the visual line, before guidance.
    const ordered = sectionUserPrompt({ index: 1, title: "T", goal: "G", visual: "chart", guidance: "terse", check: true })
    expect(ordered.indexOf("ONE quiz block")).toBeGreaterThan(ordered.indexOf("Visual:"))
    expect(ordered.indexOf("ONE quiz block")).toBeLessThan(ordered.indexOf("Guidance: terse"))
  })

  it("check instruction composes with grounding in the documented order", () => {
    const p = sectionUserPrompt({ index: 0, title: "T", goal: "G", sources, check: true })
    expect(p.indexOf("ONE quiz block")).toBeLessThan(p.indexOf("Sources for this document"))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/compiler-prompts.test.ts`
Expected: the 4 new tests FAIL (no fragments, unknown `check` arg — TS may error first); existing prompt tests stay green.

- [ ] **Step 3: Implement**

`src/compiler/extract.ts` — extend `outlineSectionSchema`:

```ts
export const outlineSectionSchema = z.object({
  title: z.string().min(1),
  goal: z.string().min(1),
  visual: outlineVisualSchema.optional(),
  // Retrieval-check declaration (quiz-placement spec §3): the outline may
  // mark sections where a quiz consolidates the learning. Flag-gated: the
  // prompt only invites it when opts.checks is on, but the schema accepts it
  // unconditionally (zod leniency; undeclared quizzes are also allowed).
  check: z.boolean().optional(),
})
```

`src/compiler/prompts.ts` — extend both builders (fragments per Interfaces block; positions per Global Constraints):

```ts
export function outlineUserPrompt(
  topic: string,
  guidance?: string,
  sources?: SourceExcerpt[],
  checks?: boolean,
): string {
  return [
    `Topic: ${topic}`,
    guidance ? `Guidance: ${guidance}` : "",
    checks
      ? 'Checks: mark sections with "check": true where a short quiz would consolidate the learning — not every section; never the first; skip reference-style ones.'
      : "",
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
  check?: boolean
}): string {
  return [
    `Write section ${args.index + 1} of the document: "${args.title}"`,
    `Goal: ${args.goal}`,
    args.visual ? `Visual: include one ${args.visual} block in this section.` : "",
    args.check
      ? "End this section with exactly ONE quiz block (the retrieval check the outline planned): question answerable from this section alone, 2-4 options, plausible distractors whose why names the misconception, answer as the 0-based index."
      : "",
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
Expected: 4/4 new pass; grounding tests still green (signature extension is additive); tsc clean.

- [ ] **Step 5: Full suite**

Run: `npm test`
Expected: 363/363 (359 + 4).

- [ ] **Step 6: Ledger + commit**

Append to `.superpowers/sdd/progress.md`:
`Quiz-placement Task 1: complete (<sha>; 363/363, tsc clean)`

```bash
git add src/compiler/extract.ts src/compiler/prompts.ts tests/compiler-prompts.test.ts
git commit -m "feat(compiler): checks flag prompt fragments + check field on outline sections"
```

---

### Task 2: Orchestrator wiring + drift audit + grounding × checks

**Files:**
- Modify: `src/compiler/stream.ts`
- Modify: `tests/compiler-grounding.test.ts` — rename-worthy but keep: this file now owns all compile-integration tests; append a `checks` describe block
- Create: nothing (keep the suite consolidated)

**Interfaces:**
- Consumes: Task 1 signatures; `compileDocumentStream(topic, opts)`; existing `validateSources`, `collectCitationIds`.
- Produces (behavior, test-locked):
  - `outline-done` gains `checks?: number` when `opts.checks` is true (absent otherwise).
  - Warning `[checks] section N declared a check but placed no quiz` when an accepted section declared via the outline contains no quiz in its blocks (recursing into `stack` children).
  - Grounding audit unchanged and applicable to quiz content (quiz option/why citations count; unknown ids warn).

- [ ] **Step 1: Write the failing tests**

Append to `tests/compiler-grounding.test.ts` (imports already include `compileDocument`, `compileDocumentStream`, `documentSchema`, `LlmClient` — add nothing):

```ts
const checksOutline = {
  version: 1,
  title: "Signals",
  summary: "How signals work.",
  sections: [
    { title: "What is a signal", goal: "Define it.", check: true },
    { title: "Reading data", goal: "Show values." },
  ],
}

/** Section reply whose blocks end with a quiz (any blocks before it). */
const quizTail = (body: string) => ({
  title: "What is a signal",
  blocks: [
    { type: "text", body },
    {
      type: "quiz",
      question: "Which view shows frequency **directly**?",
      options: [
        { text: "Fourier view", why: "Energy per frequency." },
        { text: "Histogram", why: "Bins amplitudes." },
      ],
      answer: 0,
    },
  ],
})

describe("checks compile", () => {
  it("plans, writes, and audits a declared check silently when it lands", async () => {
    const { client, calls } = scriptedClient([
      { match: /Design the outline/, reply: JSON.stringify(checksOutline) },
      { match: /Write section .*"What is a signal"/, reply: JSON.stringify(quizTail("Body about signals.")) },
      { match: /Write section .*"Reading data"/, reply: JSON.stringify(goodSection("Reading data")) },
    ])
    const { document, warnings, events } = await compileDocument("signals", { client, checks: true })
    expect(warnings).toEqual([])
    expect(documentSchema.safeParse(document).success).toBe(true)
    const doc = document as { sections: { blocks: { type: string }[] }[] }
    expect(doc.sections[0].blocks.some(b => b.type === "quiz")).toBe(true)
    const outlineDone = events.find(e => e.kind === "outline-done") as { checks?: number }
    expect(outlineDone.checks).toBe(1)
    // The section prompt carried the quiz instruction; the outline prompt carried the fragment.
    expect(calls[0]).toContain("Checks: mark sections")
    expect(calls[1]).toContain("ONE quiz block")
  })

  it("warns when a declared check places no quiz", async () => {
    const { client } = scriptedClient([
      { match: /Design the outline/, reply: JSON.stringify(checksOutline) },
      { match: /Write section .*"What is a signal"/, reply: JSON.stringify(goodSection("What is a signal")) },
      { match: /Write section .*"Reading data"/, reply: JSON.stringify(goodSection("Reading data")) },
    ])
    const { warnings } = await compileDocument("signals", { client, checks: true })
    expect(warnings).toEqual(["[checks] section 0 declared a check but placed no quiz"])
  })

  it("counts a stack-nested quiz as satisfying the declaration", async () => {
    const stacked = {
      title: "What is a signal",
      blocks: [
        { type: "stack", blocks: [quizTail("Nested.")["blocks"][1]] },
      ],
    }
    const { client } = scriptedClient([
      { match: /Design the outline/, reply: JSON.stringify(checksOutline) },
      { match: /Write section .*"What is a signal"/, reply: JSON.stringify(stacked) },
      { match: /Write section .*"Reading data"/, reply: JSON.stringify(goodSection("Reading data")) },
    ])
    const { warnings } = await compileDocument("signals", { client, checks: true })
    expect(warnings).toEqual([])
  })

  it("leaves undeclared sections and bonus quizzes alone", async () => {
    // Section 1 is NOT declared but its reply contains a quiz anyway.
    const undeclared = {
      version: 1,
      title: "Signals",
      sections: [
        { title: "What is a signal", goal: "Define it.", check: true },
        { title: "Reading data", goal: "Show values." },
      ],
    }
    const quizReading = {
      title: "Reading data",
      blocks: [
        { type: "text", body: "Reading." },
        {
          type: "quiz",
          question: "Bonus?",
          options: [{ text: "a" }, { text: "b" }],
          answer: 0,
        },
      ],
    }
    const { client } = scriptedClient([
      { match: /Design the outline/, reply: JSON.stringify(undeclared) },
      { match: /Write section .*"What is a signal"/, reply: JSON.stringify(quizTail("Declared one.")) },
      { match: /Write section .*"Reading data"/, reply: JSON.stringify(quizReading) },
    ])
    const { warnings } = await compileDocument("signals", { client, checks: true })
    expect(warnings).toEqual([]) // declared landed + bonus quiz tolerated
  })

  it("omits the outline-done checks field when the flag is off (byte-identity)", async () => {
    const { client, calls } = scriptedClient([
      { match: /Design the outline/, reply: JSON.stringify(checksOutline) },
      { match: /Write section .*"What is a signal"/, reply: JSON.stringify(goodSection("What is a signal")) },
      { match: /Write section .*"Reading data"/, reply: JSON.stringify(goodSection("Reading data")) },
    ])
    const { warnings, events } = await compileDocument("signals", { client })
    expect(warnings).toEqual([]) // no drift audit when off
    expect(calls[0]).not.toContain("Checks:")
    expect(calls[1]).not.toContain("ONE quiz block")
    expect("checks" in (events.find(e => e.kind === "outline-done") as object)).toBe(false)
  })

  it("audits citations inside quiz content (grounding × checks)", async () => {
    const citing = quizTail("Body [Signals 101](#source-s1).")
    ;(citing.blocks[1] as { options: { text: string; why: string }[] }).options[0].why =
      "See [paper](#source-nope)."
    const { client } = scriptedClient([
      { match: /Design the outline/, reply: JSON.stringify(checksOutline) },
      { match: /Write section .*"What is a signal"/, reply: JSON.stringify(citing) },
      { match: /Write section .*"Reading data"/, reply: JSON.stringify(goodSection("Reading data")) },
    ])
    const { warnings } = await compileDocument("signals", { client, checks: true, sources })
    expect(warnings).toEqual(['[grounding] section 0 cites unknown source "nope"'])
  })

  it("yields the section-dropped warning, not a checks warning, for a failed declared check", async () => {
    const { client } = scriptedClient([
      { match: /Design the outline/, reply: JSON.stringify(checksOutline) },
      { match: /Write section .*"What is a signal"/, reply: JSON.stringify({ title: "x", blocks: "not an array" }) },
      { match: /failed validation/, reply: JSON.stringify({ title: "x", blocks: "not an array" }) },
      { match: /Write section .*"Reading data"/, reply: JSON.stringify(goodSection("Reading data")) },
    ])
    const { warnings } = await compileDocument("signals", { client, checks: true })
    expect(warnings).toEqual([
      "[compile] section 0 dropped — blocks: Invalid input: expected array, received string",
    ])
  })

  it("compileDocument and the drained stream agree with checks on", async () => {
    const a = await compileDocument("signals", {
      client: scriptedClient([
        { match: /Design the outline/, reply: JSON.stringify(checksOutline) },
        { match: /Write section .*"What is a signal"/, reply: JSON.stringify(quizTail("Body.")) },
        { match: /Write section .*"Reading data"/, reply: JSON.stringify(goodSection("Reading data")) },
      ]).client,
      checks: true,
    })
    const events: StreamCompileEvent[] = []
    let document: unknown
    let warnings: string[] = []
    for await (const e of compileDocumentStream("signals", {
      client: scriptedClient([
        { match: /Design the outline/, reply: JSON.stringify(checksOutline) },
        { match: /Write section .*"What is a signal"/, reply: JSON.stringify(quizTail("Body.")) },
        { match: /Write section .*"Reading data"/, reply: JSON.stringify(goodSection("Reading data")) },
      ]).client,
      checks: true,
    })) {
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

Note: the existing `scriptedClient`, `sources`, `goodSection`, `StreamCompileEvent`, and `LlmClient` identifiers already exist in this file from the grounding cycle — reuse, don't redeclare. (`sources` is the module-level `[{ id: "s1", … }, { id: "s2", … }]` fixture.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/compiler-grounding.test.ts`
Expected: the 8 new tests FAIL (no threading, no `checks` field, no drift warning); grounding tests stay green.

- [ ] **Step 3: Implement in `src/compiler/stream.ts`**

After `const grounded = …` block (the grounding init), add:

```ts
  const checksOn = opts.checks === true
```

Outline call: pass the flag through:

```ts
    user: outlineUserPrompt(topic, opts.guidance, grounded, checksOn),
```

`outline-done` yield — add the field conditionally:

```ts
  yield {
    kind: "outline-done",
    title: clamped.title,
    summary: clamped.summary,
    sections: clamped.sections.length,
    visualHints: clamped.sections.filter(s => s.visual).length,
    sectionTitles: clamped.sections.map(s => s.title),
    ...(checksOn ? { checks: clamped.sections.filter(s => s.check === true).length } : {}),
  }
```

Section call: pass the declaration:

```ts
      user: sectionUserPrompt({
        index: i,
        title: entry.title,
        goal: entry.goal,
        visual: entry.visual,
        guidance: opts.guidance,
        sources: grounded,
        check: checksOn && entry.check === true,
      }),
```

After the section is accepted (same site as the grounding audit, after `sections.push(…)`), add the drift scan:

```ts
    // Checks audit (quiz-placement spec §5): a declared check must place a
    // quiz — recurse into stack children; constrain-and-warn only.
    if (checksOn && entry.check === true) {
      const hasQuiz = (blocks: unknown[]): boolean =>
        blocks.some(b => {
          if (typeof b !== "object" || b === null) return false
          const rec = b as { type?: unknown; blocks?: unknown[] }
          if (rec.type === "quiz") return true
          if (rec.type === "stack" && Array.isArray(rec.blocks)) return hasQuiz(rec.blocks)
          return false
        })
      if (!hasQuiz(outcome.value.blocks)) {
        warnings.push(`[checks] section ${i} declared a check but placed no quiz`)
      }
    }
```

(Place after the grounding-audit `for (const id of …)` loop, before the `section-done` yield.)

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run tests/compiler-grounding.test.ts && npm run typecheck`
Expected: 8/8 new pass, grounding green; tsc clean.

- [ ] **Step 5: Full suite**

Run: `npm test`
Expected: **371/371** (363 + 8).

- [ ] **Step 6: Ledger + commit**

Append to `.superpowers/sdd/progress.md`:
`Quiz-placement Task 2: complete (<sha>; 371/371, tsc clean)`

```bash
git add src/compiler/stream.ts tests/compiler-grounding.test.ts
git commit -m "feat(compiler): thread checks flag, outline-done count, drift audit for declared checks"
```

Note: the drift audit only runs for ACCEPTED sections (it sits after the salvage `sections.push`), so a declared check that fails validation never reaches it — the `[compile] section N dropped` warning is the only signal, which the drop-interplay test pins.

---

### Task 3: Demo, README, ROADMAP, full verification

**Files:**
- Modify: `demo/compileClient.js`, `demo/compile.html`, `README.md`, `docs/ROADMAP.md`

**Interfaces:**
- Consumes: `CompileOptions.checks` (Tasks 1–2).
- Produces: `/compile` demo with `checks: true`, one landed quiz + one declared-but-missing check (both the `checks: 2` plan and the drift warning visible in the audit log).

- [ ] **Step 1: `demo/compileClient.js`**

- The stub's outline reply: add `"check": true` to the `"The concept"` and `"Drawing it"` section entries.
- `"The concept"` reply: append a quiz block to its `blocks` (after the existing text + diagram):

```js
          {
            type: "quiz",
            question: "Which part of the pipeline adds **noise**?",
            options: [
              { text: "The source", why: "It originates the signal — no noise yet." },
              { text: "The channel", why: "Correct — noise creeps in during transmission." },
              { text: "The receiver", why: "It decodes; by then the noise already happened." },
            ],
            answer: 1,
            explanation: "The demo diagram in this section shows exactly that.",
          },
```

- `"Drawing it"` reply: leave WITHOUT a quiz (the declared-but-missing case — the drift warning shows in the audit log).
- The quiz reply must NOT include any `#source-…` citation (keeps grounding warnings clean — the demo already shows grounding warnings from the hallucinated anchor + unused source).

- [ ] **Step 2: `demo/compile.html`**

Change the stream call to pass the flag:

```js
  for await (const e of compileDocumentStream("How signals become pictures", {
    client: stubClient(true, demoSources),
    sources: demoSources,
    checks: true,
  })) {
```

- [ ] **Step 3: README**

In the compile section (Pipeline 2), extend the options example and add a paragraph:

```markdown
With `checks: true`, the outline may mark sections where a retrieval check
consolidates the learning, and those section prompts are told to close with
exactly one `quiz`. The plan surfaces as `checks: <count>` on `outline-done`;
a declared section whose reply places no quiz warns
`[checks] section N declared a check but placed no quiz`. Off by default —
absent the flag, compiles are byte-identical to ungrounded ones. Quiz
citations participate in the grounding audit like any other block.
```

(Add `checks: true, // retrieval checks` as a commented line in the existing options snippet.)

- [ ] **Step 4: ROADMAP**

In `## Shipped` (after the Retrieval practice — quiz block entry):

```markdown
- **Quiz placement in the compiler** (2026-10-02) — retrieval practice part
  2: `compileDocument(topic, { client, checks: true })` invites the outline
  to declare retrieval-check sections (`check: true`, planned count on
  `outline-done`), instructs those section writers to close with exactly one
  quiz, and warns when a declared check places none; quiz content joins the
  grounding audit for free. Spec:
  `docs/superpowers/specs/2026-10-02-quiz-placement-design.md`.
```

In `## Backlog`, delete the `**Quiz placement in the compiler**` bullet.

- [ ] **Step 5: Full verification**

```bash
npm run typecheck   # expect: clean
npm test            # expect: 371/371
npm run build       # expect: tsup + css copy succeed
```

Restart the demo so it serves the new dist (AGENTS.md):

```bash
launchctl remove explanations-demo 2>/dev/null || true
launchctl submit -l explanations-demo -- "$(command -v node)" "$PWD/demo/server.mjs"
```

Then verify from a SEPARATE tool call:

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:4173/compile   # 200
curl -s http://localhost:4173/compile.html | grep -c "checks: true"    # ≥1 (html passes the flag)
curl -s http://localhost:4173/compileClient.js | grep -c '"check": true'  # ≥2 (two declared sections)
```

Browser eyes: the audit log should show `"checks":2` on outline-done, the `[checks] section 2 declared a check but placed no quiz` warning (index 2 = "Drawing it"), and the quiz rendering in "The concept" section — alongside the two existing `[grounding]` warnings.

- [ ] **Step 6: Ledger + commit**

Append to `.superpowers/sdd/progress.md`:
`Quiz-placement Task 3: complete (<sha>; 371/371, tsc, build, /compile smoke 200, plan+drift+quiz visible in served demo; roadmap flipped)`

```bash
git add demo/compileClient.js demo/compile.html README.md docs/ROADMAP.md
git commit -m "feat(compiler): checks demo on /compile + README grounding-adjacent docs + roadmap flip"
```

---

## Branch finish (after all tasks) — MERGE GATE

1. **Fresh-eyes review pass** against the spec (`2026-10-02-quiz-placement-design.md`): walk §3 (surface + inertness), §4 (fragment texts + positions), §5 (threading, count, drift recursion, drop interplay, grounding tie-in), §6 (test list — each bullet maps to a test), §7 (demo), §8 (out of scope respected). Run `rafter secrets .` (known FP: `.vexp/manifest.json`); remote SAST unavailable until push (environment note).
2. **Ledger:** append `Quiz-placement final review: …` + the `Branch finished (MERGE GATE)` line — **not merged**, branch kept, awaiting review.
3. **STOP — present for review:** demo URL, what to look at (audit log plan + drift warning, quiz render), diff stat.
4. After approval: fast-forward main, verify on merged result, delete branch, push on go-ahead.
5. Any reusable debugging lesson → dated entry in `docs/DEBUGGING.md`.
