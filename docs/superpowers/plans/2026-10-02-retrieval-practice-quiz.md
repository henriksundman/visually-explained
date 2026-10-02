# Retrieval Practice — Quiz Block Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This repo executes plans **inline** — no CLI subagents (AGENTS.md).

**Goal:** A `quiz` block — question, 2–6 options with per-option `why`, 0-based `answer`, optional `explanation` — rendered statically (script-free `<details>` check reveal) and graded interactively (React, opt-in via `interactive`), with the LLM contract taught.

**Architecture:** One new registered primitive on the existing rails: zod schema in `core/schema.ts` → `blockUnionSchema`; static renderer in `primitives/quiz.ts` self-registering via `registerPrimitive`; `BLOCK_TYPE_DOCS` line ships atomically with registration (the `llm.test.ts` pin); theme styles in `tokens.css` using `--exp-up`/`--exp-down`; React `Quiz` client component routed by the existing `interactive` prop, with pure transition functions for node-env testing (the `nextSweepValue` precedent).

**Tech Stack:** TypeScript (ES2022, strict), zod, vitest (node env — no jsdom), React 19 (server-rendered via `renderToStaticMarkup` in tests), tsup.

**Spec:** `docs/superpowers/specs/2026-10-02-retrieval-practice-quiz-design.md` (approved 2026-10-02).

## Global Constraints

- **No new dependencies.** No new runtime machinery: static path is script-free; React path is a client component like `InteractiveFigure`.
- **All model text through `renderInline`** (escaped) — no new raw-HTML sinks; question, option text, whys, explanation all inline-rendered.
- **Whole-block lenient degrade, never a throw.** Schema violations → salvage skips the block with an `[invalid-block]` diagnostic (house path, automatic). Cross-field violation (`answer` not a valid index) → renderer keeps question + options, hides the reveal, `ctx.addWarning("quiz-answer-invalid: …")` (the chart empty-state precedent).
- **Atomic registration + contract:** `primitives/quiz.ts` registration, `registerAll` import, and the `BLOCK_TYPE_DOCS` line land in the same commit — `tests/llm.test.ts` pins that every registered type appears in the snippet and JSON schema.
- **RSC-safe default:** without `interactive`, `<Explanation>` never mounts `Quiz`; the static path is unchanged.
- **Interaction logic is pure functions** (`quizPick`, `quizCheck`) — vitest runs node-env, no DOM events (the `nextSweepValue`/`valueColumnCh` precedent).
- **Merge gate (AGENTS.md 2026-10-02):** execute on `feature/retrieval-practice-quiz`, stop at ready-to-merge, present the demo for review — do **not** merge to main without explicit go-ahead.
- **Verification commands:** `npm run typecheck`, `npm test`, `npm run build`. Baseline at branch start: **346 tests / 41 files, all green** (main @ `9683d37`). Expected final: **358/358** (346 + 3 + 6 + 3).
- **Execution:** inline only; per-task commit; append a ledger line to `.superpowers/sdd/progress.md` after each task.

---

### Task 1: `quiz` schema + union integration

**Files:**
- Modify: `src/core/schema.ts`
- Create: `tests/quiz.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (used by Tasks 2–4; exported from the package root via `export *`):
  - `quizOptionSchema` / `type QuizOption = { text: string; why?: string }`
  - `quizBlockSchema` / `type QuizBlock = { id?: string; type: "quiz"; question: string; options: QuizOption[]; answer: number; explanation?: string }`
  - `Block` union gains `| QuizBlock`; `blockUnionSchema` gains `quizBlockSchema`.

- [ ] **Step 1: Write the failing tests**

Create `tests/quiz.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { quizBlockSchema } from "../src/core/schema"

const valid = {
  type: "quiz" as const,
  id: "q1",
  question: "Which function maps a **discrete** sequence to its frequency view?",
  options: [
    { text: "Fourier transform", why: "Correct — it decomposes a signal into frequencies." },
    { text: "Histogram", why: "Bins samples; it doesn't preserve order or frequency phase." },
    { text: "Moving average", why: "Smooths in the time domain." },
  ],
  answer: 0,
  explanation: "The Fourier view is the frequency lens used throughout this doc.",
}

describe("quiz schema", () => {
  it("accepts a valid block with optional fields", () => {
    expect(quizBlockSchema.safeParse(valid).success).toBe(true)
    const minimal = {
      ...valid,
      id: undefined,
      explanation: undefined,
      options: valid.options.map(o => ({ text: o.text })),
    }
    expect(quizBlockSchema.safeParse(minimal).success).toBe(true)
  })

  it("rejects out-of-bounds shapes", () => {
    expect(quizBlockSchema.safeParse({ ...valid, question: "" }).success).toBe(false)
    expect(quizBlockSchema.safeParse({ ...valid, question: "x".repeat(501) }).success).toBe(false)
    expect(quizBlockSchema.safeParse({ ...valid, options: valid.options.slice(0, 1) }).success).toBe(false)
    expect(
      quizBlockSchema.safeParse({
        ...valid,
        options: [...valid.options, { text: "x" }, { text: "y" }, { text: "z" }, { text: "w" }],
      }).success,
    ).toBe(false)
    expect(quizBlockSchema.safeParse({ ...valid, options: [{ text: "" }, { text: "y" }] }).success).toBe(false)
    expect(
      quizBlockSchema.safeParse({ ...valid, options: [{ text: "x".repeat(301) }, { text: "y" }] }).success,
    ).toBe(false)
    expect(
      quizBlockSchema.safeParse({ ...valid, options: [{ text: "x", why: "w".repeat(401) }, { text: "y" }] }).success,
    ).toBe(false)
    expect(quizBlockSchema.safeParse({ ...valid, explanation: "e".repeat(501) }).success).toBe(false)
  })

  it("requires a non-negative integer answer", () => {
    expect(quizBlockSchema.safeParse({ ...valid, answer: -1 }).success).toBe(false)
    expect(quizBlockSchema.safeParse({ ...valid, answer: 1.5 }).success).toBe(false)
    expect(quizBlockSchema.safeParse({ ...valid, answer: "0" }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/quiz.test.ts`
Expected: FAIL — `quizBlockSchema` is not exported from `../src/core/schema`.

- [ ] **Step 3: Implement in `src/core/schema.ts`**

Add after `sourcesBlockSchema`/`SourcesBlock` (before `blockUnionSchema`):

```ts
export const quizOptionSchema = z.object({
  text: z.string().min(1).max(300),
  why: z.string().min(1).max(400).optional(),
})
export type QuizOption = z.infer<typeof quizOptionSchema>

export const quizBlockSchema = z.object({
  id: idSchema,
  type: z.literal("quiz"),
  question: z.string().min(1).max(500),
  // 2-6 options (spec §3); the answer is a 0-based index, range-checked at
  // render time (cross-field, so not expressible in the object schema).
  options: z.array(quizOptionSchema).min(2).max(6),
  answer: z.number().int().min(0),
  explanation: z.string().min(1).max(500).optional(),
})
export type QuizBlock = z.infer<typeof quizBlockSchema>
```

Add `| QuizBlock` to the `Block` union type, and `quizBlockSchema,` to the `blockUnionSchema` discriminated-union array (after `sourcesBlockSchema`).

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run tests/quiz.test.ts && npm run typecheck`
Expected: 3/3 pass; tsc clean.

- [ ] **Step 5: Full suite**

Run: `npm test`
Expected: 349/349 (346 + 3).

- [ ] **Step 6: Ledger + commit**

Append to `.superpowers/sdd/progress.md`:
`Quiz Task 1: complete (<sha>; 349/349, tsc clean)`

```bash
git add src/core/schema.ts tests/quiz.test.ts
git commit -m "feat(schema): quiz block — options with per-option why, 0-based answer, optional explanation"
```

---

### Task 2: Static renderer + `BLOCK_TYPE_DOCS` + theme CSS

**Files:**
- Create: `src/primitives/quiz.ts`
- Modify: `src/core/registerAll.ts`, `src/core/blockTypes.ts`, `src/themes/tokens.css`
- Modify: `tests/quiz.test.ts` (append render tests)

**Interfaces:**
- Consumes: `quizBlockSchema` / `QuizBlock` (Task 1); `RenderContext.addWarning` (existing).
- Produces: `renderQuiz(block: QuizBlock, ctx: RenderContext): string`, registered as `"quiz"`; the `BLOCK_TYPE_DOCS` quiz line (consumed by the LLM contract tests automatically); CSS class vocabulary shared with Task 3: `exp-quiz`, `exp-quiz-question`, `exp-quiz-options`, `exp-quiz-option`, `exp-quiz-option-text`, `exp-quiz-check`, `exp-quiz-result`, `exp-quiz-answer`, `exp-quiz-miss`, `exp-quiz-explanation`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/quiz.test.ts` (extend the imports first):

```ts
import { renderExplanation } from "../src/core/render"
import { BLOCK_TYPE_DOCS } from "../src/core/blockTypes"
import "../src/core/registerAll"
```

```ts
describe("quiz render", () => {
  it("renders question, options, and the check reveal", () => {
    const { html, warnings } = renderExplanation({ version: 1, blocks: [valid] })
    expect(html).toContain(`class="exp-block exp-quiz"`)
    expect(html).toContain(`<p class="exp-quiz-question">Which function maps a <strong>discrete</strong> sequence`)
    expect(html).toContain(`<li class="exp-quiz-option"><span class="exp-quiz-option-text">Histogram</span></li>`)
    expect(html).toContain(`<details class="exp-quiz-check"><summary>Check your answer</summary>`)
    expect(html).toContain(`class="exp-quiz-answer"`) // correct answer first in the reveal
    expect(html).toContain("decomposes a signal into frequencies") // correct why
    expect(html).toContain("Bins samples") // distractor why
    expect(html).toContain(`class="exp-quiz-explanation"`)
    expect(warnings).toEqual([])
  })

  it("omits why lines that are absent", () => {
    const { html } = renderExplanation({
      version: 1,
      blocks: [{ type: "quiz", question: "Q", options: [{ text: "A" }, { text: "B" }], answer: 1 }],
    })
    expect(html).toContain(`<p class="exp-quiz-miss">✘ A</p>`)
    expect(html).not.toContain(" — </p>") // no empty why separators
    expect(html).not.toContain(`class="exp-quiz-explanation"`)
  })

  it("hides the reveal and warns when the answer indexes nothing", () => {
    const { html, warnings } = renderExplanation({ version: 1, blocks: [{ ...valid, answer: 7 }] })
    expect(html).not.toContain("exp-quiz-check")
    expect(html).toContain("exp-quiz-options") // question + options survive
    expect(warnings.some(w => w.startsWith("quiz-answer-invalid"))).toBe(true)
  })

  it("skips schema-invalid quizzes with a warning, never throwing", () => {
    const { html, warnings } = renderExplanation({
      version: 1,
      blocks: [{ ...valid, options: [{ text: "only one" }], answer: 0 }],
    })
    expect(html).not.toContain("exp-quiz")
    expect(warnings.some(w => w.includes("invalid-block"))).toBe(true)
  })

  it("escapes model text everywhere", () => {
    const { html } = renderExplanation({
      version: 1,
      blocks: [
        {
          type: "quiz",
          question: "<script>alert(1)</script>",
          options: [{ text: "a & b", why: "<b>bold</b> claims" }, { text: "c" }],
          answer: 0,
        },
      ],
    })
    expect(html).not.toContain("<script>")
    expect(html).toContain("&lt;script&gt;")
    expect(html).toContain("a &amp; b")
    expect(html).not.toContain("<b>bold</b>")
  })

  it("is taught in the block-type contract", () => {
    expect(BLOCK_TYPE_DOCS).toContain("quiz:")
    expect(BLOCK_TYPE_DOCS).toContain("0-based index")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/quiz.test.ts`
Expected: the 6 new tests FAIL (no `quiz` primitive registered — unknown type → fallback); Task 1's 3 schema tests stay green.

- [ ] **Step 3: Implement `src/primitives/quiz.ts`**

```ts
import { registerPrimitive, type RenderContext } from "../core/registry"
import { quizBlockSchema, type QuizBlock } from "../core/schema"
import { renderInline } from "../core/inline"

/** "✔ text — why" / "✘ text" — the why separator only appears when a why exists. */
function whyLine(prefix: string, text: string, why: string | undefined): string {
  return `${prefix} ${renderInline(text)}${why ? ` — ${renderInline(why)}` : ""}`
}

export function renderQuiz(block: QuizBlock, ctx: RenderContext): string {
  const question = `<p class="exp-quiz-question">${renderInline(block.question)}</p>`
  const items = block.options
    .map(o => `<li class="exp-quiz-option"><span class="exp-quiz-option-text">${renderInline(o.text)}</span></li>`)
    .join("")
  const inRange = Number.isInteger(block.answer) && block.answer >= 0 && block.answer < block.options.length
  if (!inRange) {
    // Cross-field leniency (spec §4): the shape passed the schema but the
    // answer indexes nothing. Keep question + options, hide the check reveal.
    ctx.addWarning(
      `quiz-answer-invalid: quiz ${block.id ? `"${block.id}" ` : ""}answer index out of range — check reveal hidden`,
    )
    return `<div class="exp-block exp-quiz">${question}<ol class="exp-quiz-options">${items}</ol></div>`
  }
  const correct = block.options[block.answer]
  const result =
    `<p class="exp-quiz-answer">${whyLine("✔", correct.text, correct.why)}</p>` +
    block.options
      .map((o, i) => (i === block.answer ? "" : `<p class="exp-quiz-miss">${whyLine("✘", o.text, o.why)}</p>`))
      .join("") +
    (block.explanation ? `<p class="exp-quiz-explanation">${renderInline(block.explanation)}</p>` : "")
  return (
    `<div class="exp-block exp-quiz">${question}` +
    `<ol class="exp-quiz-options">${items}</ol>` +
    `<details class="exp-quiz-check"><summary>Check your answer</summary><div class="exp-quiz-result">${result}</div></details>` +
    `</div>`
  )
}

registerPrimitive("quiz", { schema: quizBlockSchema, render: renderQuiz })
```

- [ ] **Step 4: Registration + contract line**

`src/core/registerAll.ts` — add after the sources import:

```ts
import "../primitives/quiz"
```

`src/core/blockTypes.ts` — add after the `sources:` line, before the `stack:` line:

```
- quiz: { question, options: [{ text, why? }], answer, explanation? } — a multiple-choice check for the reader. 2-6 options; answer is the 0-based index of the one correct option. Write plausible distractors whose why names the misconception they encode, and give the correct option a why that completes the idea. Never reveal the answer inside the question; place the quiz after the material it checks.
```

- [ ] **Step 5: Theme CSS**

Append to the end of `src/themes/tokens.css`:

```css
/* Quiz — retrieval practice (retrieval-practice spec §4) */
.exp-quiz {
  display: grid;
  gap: 0.5rem;
  border: 1px solid var(--exp-border);
  border-radius: var(--exp-radius);
  background: var(--exp-surface);
  padding: 1rem;
}
.exp-quiz-question { margin: 0; font-weight: 600; }
.exp-quiz-options { margin: 0; padding-left: 1.5rem; display: grid; gap: 0.25rem; }
.exp-quiz-check { margin-top: 0.25rem; }
.exp-quiz-check summary { cursor: pointer; color: var(--exp-accent); font-weight: 600; }
.exp-quiz-check summary::marker,
.exp-quiz-check summary::-webkit-details-marker { color: var(--exp-accent); }
.exp-quiz-result { display: grid; gap: 0.25rem; padding-top: 0.5rem; }
.exp-quiz-result p { margin: 0; }
.exp-quiz-answer { color: var(--exp-up); }
.exp-quiz-miss { color: var(--exp-down); }
.exp-quiz-explanation { color: var(--exp-text-muted); }

/* Interactive grading (React) reuses the block classes above and adds: */
.exp-quiz-choice {
  all: unset;
  display: block;
  width: 100%;
  box-sizing: border-box;
  cursor: pointer;
  padding: 0.25rem 0.5rem;
  border-radius: calc(var(--exp-radius) / 2);
}
.exp-quiz-choice:hover { background: var(--exp-surface-muted); }
.exp-quiz-option-selected .exp-quiz-choice { background: var(--exp-accent-soft); }
.exp-quiz-option-correct .exp-quiz-choice { color: var(--exp-up); font-weight: 600; }
.exp-quiz-option-wrong .exp-quiz-choice { color: var(--exp-down); }
.exp-quiz-checked .exp-quiz-choice { cursor: default; }
.exp-quiz-checked .exp-quiz-option:not(.exp-quiz-option-correct):not(.exp-quiz-option-wrong) .exp-quiz-choice:hover { background: transparent; }
.exp-quiz-why { margin: 0.25rem 0 0; color: var(--exp-text-muted); }
.exp-quiz-check-button {
  all: unset;
  cursor: pointer;
  justify-self: start;
  padding: 0.25rem 0.75rem;
  border: 1px solid var(--exp-border);
  border-radius: var(--exp-radius);
  background: var(--exp-surface);
  font-weight: 600;
}
.exp-quiz-check-button:disabled { opacity: 0.5; cursor: default; }
.exp-quiz-check-button:not(:disabled):hover { background: var(--exp-accent-soft); }
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npx vitest run tests/quiz.test.ts tests/llm.test.ts && npm run typecheck`
Expected: 9/9 quiz + 5/5 llm pass (the registration pin: `quiz` now in registry → snippet must contain it — it does via BLOCK_TYPE_DOCS); tsc clean.

- [ ] **Step 7: Full suite**

Run: `npm test`
Expected: 355/355 (349 + 6).

- [ ] **Step 8: Ledger + commit**

Append to `.superpowers/sdd/progress.md`:
`Quiz Task 2: complete (<sha>; 355/355, tsc clean)`

```bash
git add src/primitives/quiz.ts src/core/registerAll.ts src/core/blockTypes.ts src/themes/tokens.css tests/quiz.test.ts
git commit -m "feat(quiz): script-free static renderer with details check reveal + contract line + theme"
```

---

### Task 3: React grading (`Quiz.tsx`) + `interactive` routing

**Files:**
- Create: `src/react/Quiz.tsx`
- Modify: `src/react/Explanation.tsx`, `src/react/index.ts`, `tests/react.test.tsx`

**Interfaces:**
- Consumes: `quizBlockSchema` (Task 1); `renderBlock` (existing core); the Task 2 class vocabulary + `exp-quiz-option-selected/-correct/-wrong`, `exp-quiz-checked`, `exp-quiz-choice`, `exp-quiz-check-button`, `exp-quiz-why`.
- Produces (exported from `src/react/index.ts` and the `explanations/react` entry):
  - `Quiz: FC<{ block: unknown }>`
  - `QuizState = { picked: number | null; checked: boolean }`, `initialQuizState`
  - `quizPick(state, index): QuizState` (no-op once checked), `quizCheck(state): QuizState` (no-op until picked / once checked)

- [ ] **Step 1: Write the failing tests**

Append to `tests/react.test.tsx` (add the import at the top with the others):

```tsx
import { Quiz, initialQuizState, quizPick, quizCheck } from "../src/react/Quiz"
```

```tsx
const quizIr = {
  version: 1,
  blocks: [
    {
      type: "quiz",
      question: "Which pass turns a **signal** into frequencies?",
      options: [
        { text: "Fourier transform", why: "It decomposes the signal into frequencies." },
        { text: "Moving average", why: "It smooths in the time domain." },
      ],
      answer: 0,
      explanation: "The frequency view is the Fourier view.",
    },
  ],
}

describe("Quiz (react)", () => {
  it("stays static unless interactive is set, and starts unchecked when it is", () => {
    const off = renderToStaticMarkup(<Explanation ir={quizIr} theme="none" />)
    expect(off).toContain("exp-quiz-check") // the static details reveal
    expect(off).not.toContain("exp-quiz-choice")

    const on = renderToStaticMarkup(<Explanation ir={quizIr} theme="none" interactive />)
    expect(on).toContain(`class="exp-quiz-choice"`)
    expect(on).toContain(`disabled`) // check button disabled before a pick
    expect(on).not.toContain("exp-quiz-why") // whys hidden before checking
    expect(on).not.toContain("exp-quiz-checked")
  })

  it("degrades to the static path for a bad answer index", () => {
    const html = renderToStaticMarkup(
      <Explanation ir={{ version: 1, blocks: [{ ...quizIr.blocks[0], answer: 9 }] }} theme="none" interactive />,
    )
    expect(html).toContain("exp-quiz-check") // static degraded markup
    expect(html).not.toContain("exp-quiz-choice")
  })

  it("transitions: pick before check, lock after check", () => {
    const picked = quizPick(initialQuizState, 1)
    expect(picked).toEqual({ picked: 1, checked: false })
    const checked = quizCheck(picked)
    expect(checked).toEqual({ picked: 1, checked: true })
    expect(quizCheck(initialQuizState)).toEqual(initialQuizState) // no pick → no check
    expect(quizPick(checked, 0)).toEqual(checked) // locked
    expect(quizCheck(checked)).toEqual(checked) // idempotent
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/react.test.tsx`
Expected: the 3 new tests FAIL — `../src/react/Quiz` does not exist (import error).

- [ ] **Step 3: Implement `src/react/Quiz.tsx`**

```tsx
"use client"
import { useState, type FC } from "react"
import { quizBlockSchema, type QuizBlock } from "../core/schema"
import { renderInline } from "../core/inline"
import { renderBlock } from "../core/render"

/** Grading state machine — pure so node-env vitest can pin it (the
 *  nextSweepValue precedent; there is no DOM-event harness). */
export interface QuizState {
  picked: number | null
  checked: boolean
}
export const initialQuizState: QuizState = { picked: null, checked: false }
/** Selecting is a no-op once the answer is checked (retrieval practice:
 *  commit, then correct — no retry-until-right). */
export function quizPick(state: QuizState, index: number): QuizState {
  return state.checked ? state : { ...state, picked: index }
}
/** Checking requires a pick and locks after the first check. */
export function quizCheck(state: QuizState): QuizState {
  return state.checked || state.picked === null ? state : { ...state, checked: true }
}

export const Quiz: FC<{ block: unknown }> = ({ block }) => {
  const [state, setState] = useState<QuizState>(initialQuizState)
  const parsed = quizBlockSchema.safeParse(block)
  const b = parsed.success ? (parsed.data as QuizBlock) : null
  const inRange = b !== null && Number.isInteger(b.answer) && b.answer >= 0 && b.answer < b.options.length
  if (b === null || !inRange) {
    // Degrade to the static path — identical markup to the HTML renderer.
    return <div dangerouslySetInnerHTML={{ __html: renderBlock("quiz", block, 1) }} />
  }
  const optionClass = (i: number) => {
    const cls = ["exp-quiz-option"]
    if (state.checked) {
      if (i === b.answer) cls.push("exp-quiz-option-correct")
      else if (i === state.picked) cls.push("exp-quiz-option-wrong")
    } else if (i === state.picked) {
      cls.push("exp-quiz-option-selected")
    }
    return cls.join(" ")
  }
  return (
    <div className={"exp-block exp-quiz" + (state.checked ? " exp-quiz-checked" : "")}>
      <p className="exp-quiz-question" dangerouslySetInnerHTML={{ __html: renderInline(b.question) }} />
      <ol className="exp-quiz-options">
        {b.options.map((o, i) => (
          <li key={i} className={optionClass(i)}>
            <button
              type="button"
              className="exp-quiz-choice"
              disabled={state.checked}
              onClick={() => setState(s => quizPick(s, i))}
            >
              <span className="exp-quiz-option-text" dangerouslySetInnerHTML={{ __html: renderInline(o.text) }} />
            </button>
            {state.checked && o.why && (
              <p className="exp-quiz-why" dangerouslySetInnerHTML={{ __html: renderInline(o.why) }} />
            )}
          </li>
        ))}
      </ol>
      {!state.checked && (
        <button
          type="button"
          className="exp-quiz-check-button"
          disabled={state.picked === null}
          onClick={() => setState(quizCheck)}
        >
          Check your answer
        </button>
      )}
      {state.checked && b.explanation && (
        <p className="exp-quiz-explanation" dangerouslySetInnerHTML={{ __html: renderInline(b.explanation) }} />
      )}
    </div>
  )
}
```

- [ ] **Step 4: Route it from `Explanation`**

`src/react/Explanation.tsx` — add the import:

```tsx
import { Quiz } from "./Quiz"
```

and the branch, directly after the existing `interactive && … figure` branch:

```tsx
        if (interactive && b.kind === "valid" && b.type === "quiz") {
          return <Quiz key={b.index} block={b.data} />
        }
```

`src/react/index.ts` — add:

```ts
export * from "./Quiz"
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run tests/react.test.tsx tests/quiz.test.ts && npm run typecheck`
Expected: 3/3 new react tests pass (all existing react tests stay green); tsc clean.

- [ ] **Step 6: Full suite**

Run: `npm test`
Expected: 358/358 (355 + 3).

- [ ] **Step 7: Ledger + commit**

Append to `.superpowers/sdd/progress.md`:
`Quiz Task 3: complete (<sha>; 358/358, tsc clean)`

```bash
git add src/react/Quiz.tsx src/react/Explanation.tsx src/react/index.ts tests/react.test.tsx
git commit -m "feat(quiz): React grading component on the interactive opt-in with pure transition tests"
```

---

### Task 4: Demo, README, ROADMAP, full verification

**Files:**
- Modify: `demo/examples.js`, `demo/interactive.html`, `README.md`, `docs/ROADMAP.md`

**Interfaces:**
- Consumes: the registered `quiz` type (Tasks 1–3).
- Produces: `quizBlock` (module-local) + `quizIr` export in `demo/examples.js`; a "Retrieval practice" section in `demoDocIr`; a second React root on `/interactive`.

- [ ] **Step 1: Demo IR — `demo/examples.js`**

Add above `export const educationIr`:

```js
// Retrieval-practice demo (quiz spec §8): one authored quiz with
// misconception-targeting whys; rendered statically on /document and graded
// interactively on /interactive.
const quizBlock = {
  type: "quiz",
  id: "quiz-frequency",
  question: "A signal repeats 50 times per second. Which view shows that **directly**?",
  options: [
    { text: "A time-series plot", why: "The waveform wiggles 50 times a second, but counting those wiggles is work." },
    { text: "A **Fourier** view", why: "Correct — energy per frequency, and 50 Hz stands out as a single peak." },
    { text: "A histogram of sample values", why: "Bins amplitudes; the 50-per-second rhythm disappears." },
    { text: "A moving average", why: "Smooths the time series; it can't reveal frequency." },
  ],
  answer: 1,
  explanation: "The Fourier view is the frequency lens this document keeps reaching for.",
}

export const quizIr = {
  version: 1,
  title: "Retrieval practice",
  blocks: [quizBlock],
}
```

In `demoDocIr.sections`, append after the `fig-real-data` entry:

```js
    { id: "fig-quiz", title: "Retrieval practice", blocks: [quizBlock] },
```

- [ ] **Step 2: `/interactive` second root — `demo/interactive.html`**

Add the import and heading/root:

```html
<p>The same <code>figuresIr</code> as the main demo, rendered by the React runtime: drag the sliders, press play to sweep <code>t</code>.</p>
<div id="root"></div>
<h2>Retrieval practice</h2>
<p>A <code>quiz</code> block through the same runtime: pick an option, check it, and the per-option whys explain themselves.</p>
<div id="quiz-root"></div>
```

and in the module script:

```js
  import { figuresIr, quizIr } from "/examples.js"
  createRoot(document.getElementById("root")).render(createElement(Explanation, { ir: figuresIr, interactive: true }))
  createRoot(document.getElementById("quiz-root")).render(
    createElement(Explanation, { ir: quizIr, interactive: true }),
  )
```

- [ ] **Step 3: README**

- Add `quiz` to the block-type enumeration (line ~102: the `cause-effect`, `callout`, `data-callout`, `sources` list) — keep alphabetical/grouped style consistent with the list.
- Grep for any primitive count wording (`grep -n "primitive" README.md`) and bump it if the count is stated.

- [ ] **Step 4: ROADMAP**

Add to `## Shipped` (after the Compiler grounding entry):

```markdown
- **Retrieval practice — quiz block** (2026-10-02) — the first assessment
  primitive: `quiz` (question, 2–6 options, 0-based `answer`, per-option
  `why` rationale, optional `explanation`); static HTML renders options with
  a script-free `<details>` check reveal, the React runtime grades clicks
  (`<Explanation interactive>`) and locks after check; `BLOCK_TYPE_DOCS`
  teaches authoring. Spec:
  `docs/superpowers/specs/2026-10-02-retrieval-practice-quiz-design.md`.
```

In `## Backlog`, reword the `**Retrieval practice**` bullet to its remaining part:

```markdown
- **Quiz placement in the compiler** — teach outline/section prompts to place
  retrieval checks (part 2 of retrieval practice; the quiz block shipped
  2026-10-02).
```

- [ ] **Step 5: Full verification**

```bash
npm run typecheck   # expect: clean
npm test            # expect: 358/358
npm run build       # expect: tsup + css copy succeed
```

Restart the demo so it serves the new dist (stale servers keep old dist — AGENTS.md):

```bash
launchctl remove explanations-demo 2>/dev/null || true
launchctl submit -l explanations-demo -- "$(command -v node)" "$PWD/demo/server.mjs"
```

Then verify from a SEPARATE tool call:

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:4173/document     # 200
curl -s -o /dev/null -w "%{http_code}" http://localhost:4173/interactive  # 200
curl -s -o /dev/null -w "%{http_code}" http://localhost:4173/             # 200
curl -s http://localhost:4173/examples.js | grep -c quiz-frequency        # ≥1
curl -s http://localhost:4173/document | grep -c "exp-quiz"               # ≥1 (static reveal served)
curl -s http://localhost:4173/interactive | grep -c quiz-root             # 1
```

- [ ] **Step 6: Ledger + commit**

Append to `.superpowers/sdd/progress.md`:
`Quiz Task 4: complete (<sha>; 358/358, tsc, build, /document + /interactive + / smoke 200, quiz served in both surfaces; roadmap shipped + backlog reworded)`

```bash
git add demo/examples.js demo/interactive.html README.md docs/ROADMAP.md
git commit -m "feat(quiz): static + interactive demo, README block list, roadmap ship"
```

---

## Branch finish (after all tasks) — MERGE GATE

1. **Fresh-eyes review pass** against the spec (`2026-10-02-retrieval-practice-quiz-design.md`): walk §3 (surface), §4 (static + leniency + escaping), §5 (React flow + RSC default), §6 (contract line), §7 (test list — each bullet maps to a test), §8 (demo), §9 (out of scope respected). Run `rafter secrets .` (known FP: `.vexp/manifest.json`); `rafter run` scans the remote and will fail until pushed — record that as environment-unavailable.
2. **Ledger:** append `Quiz final review: …` with findings; append the `Branch finished` line (merge state = **not merged — awaiting user review**, tests on branch tip, push state, branch kept).
3. **STOP — present for review (AGENTS.md merge gate):** demo URLs (`/document` section "Retrieval practice", `/interactive` quiz card), what to look at (static reveal vs click grading, per-option whys, lock-after-check), diff stat. Do **not** merge to main or delete the branch until the user's explicit go-ahead.
4. After approval: fast-forward main, run `npm test` + `tsc` on the merged result, delete the branch, ask about pushing.
5. If any debugging lesson surfaced, append a dated entry to `docs/DEBUGGING.md` before finishing.
