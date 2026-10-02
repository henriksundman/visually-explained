# Quiz Placement in the Compiler — Design (Retrieval Practice, Part 2)

**Date:** 2026-10-02
**Status:** Approved (brainstorm 2026-10-02 — decisions locked in session)
**Predecessor:** Quiz block (`2026-10-02-retrieval-practice-quiz-design.md`,
shipped `de20352`) and compiler grounding
(`2026-10-01-compiler-grounding-design.md`)
**Backlog origin:** ROADMAP "Quiz placement in the compiler — teach
outline/section prompts to place retrieval checks (part 2 of retrieval
practice; the quiz block shipped 2026-10-02)."

## 1. Problem & Goal

The `quiz` block exists, but the compiler never places one: hosts compiling a
document get exposition only. Goal: `compileDocument(topic, { client, checks:
true })` lets the outline declare where a retrieval check consolidates the
learning and instructs the section writer to close that section with exactly
one quiz — with a drift audit when a declared check produces no quiz, and the
grounding audit covering quiz content for free. Flag off → byte-identical to
today.

## 2. Decisions (locked in brainstorm, 2026-10-02)

1. **Opt-in flag** — `CompileOptions.checks?: boolean`, default `false`.
   Absent/off → byte-identical behavior (the inertness rule that made
   `sources` safe). Density knobs stay out until real output teaches the
   defaults (YAGNI).
2. **Outline declares, section writes.** The outline prompt (flag on) may
   mark sections `"check": true` — where a quiz would consolidate; the
   section prompt for a marked section is told to end with ONE quiz. Mirrors
   the existing `visual` hint (outline plans structure, section writes it);
   zero extra LLM calls; whole-document distribution; the plan rides the
   outline's existing repair loop.
3. **Constrain + audit-warn.** A declared check that produces no quiz warns
   `[checks] section N declared a check but placed no quiz`. Nothing is
   dropped or thrown. Quizzes in undeclared sections are fine (no warning) —
   the flag constrains the plan, it doesn't forbid bonus checks. No quota
   enforcement against the declared count.
4. **Grounding tie-in is free.** `collectCitationIds` already walks every
   string field of accepted blocks — quiz questions, option texts, whys
   included — so a quiz citing `#source-unknown` warns exactly like body
   text. Test-locked + README line; no new code.
5. **No compile-side quiz validation.** Bad quiz payloads degrade at render
   (`quiz-answer-invalid`, house leniency) — the schema/render split holds;
   the compiler adds no quiz-specific repair machinery.
6. **No new event kinds.** `outline-done` carries an extra `checks` field
   (flag on only); everything else rides the existing vocabulary.

## 3. Public Surface

```ts
export interface CompileOptions {
  client: LlmClient
  maxRepairs?: number
  guidance?: string
  maxSections?: number
  sources?: SourceExcerpt[]
  /** When true, the outline may declare retrieval checks and section
   *  prompts instruct one closing quiz per declared section. Default false. */
  checks?: boolean
}
```

- `outlineSectionSchema` (compiler-internal, `src/compiler/extract.ts`)
  gains `check: z.boolean().optional()` — model-output shape, not a host
  input; no JSON-schema export changes.
- `outline-done` payload gains `checks?: number` (count of declared sections)
  **only when `opts.checks` is on** — with the flag off the payload is
  untouched.
- New warning string: `[checks] section N declared a check but placed no quiz`.
- `SourceExcerpt`/grounding surface unchanged; no new deps.

## 4. Prompt Flow (`src/compiler/prompts.ts`)

- **Outline user prompt** — when `opts.checks` is on, add (position: after
  guidance, before the sources block when grounding is active):

  ```
  Checks: mark sections with "check": true where a short quiz would consolidate
  the learning — not every section; never the first; skip reference-style ones.
  ```

- **Section user prompt** — for an outline entry with `check: true`, add
  (position: after the visual line, before guidance):

  ```
  End this section with exactly ONE quiz block (the retrieval check the outline
  planned): question answerable from this section alone, 2-4 options, plausible
  distractors whose why names the misconception, answer as the 0-based index.
  ```

- No `check` on the entry → nothing added. Prompts stay deterministic; both
  fragments vanish entirely when the flag is off / the entry is unmarked.

## 5. Orchestrator wiring (`src/compiler/stream.ts`)

- Thread `opts.checks` into both prompt calls.
- After the outline resolves, count declared checks:
  `const declaredChecks = clamped.sections.filter(s => s.check === true).length`.
  Include `checks: declaredChecks` on `outline-done` only when `opts.checks`.
- After a check-declared section's blocks are accepted (post-repair), scan
  for a quiz: if no block (recursing into `stack` children — a quiz nested
  in a stack still satisfies the declaration) has `type === "quiz"`, push
  `[checks] section N declared a check but placed no quiz` onto `warnings`.
- A quiz in an undeclared section produces no warning. A `check: true` on a
  section that is later dropped (failed validation) produces no warning — the
  section-dropped warning already covers it.
- The grounding audit continues to run over quiz-bearing sections unchanged
  (quiz string fields are walked like any other block's fields).

## 6. Testing (scripted clients, no network)

- **Prompt fragments:** outline prompt carries the Checks fragment only when
  the flag is on (byte-identity off); section prompt carries the quiz
  instruction only for `check: true` entries; grounding fragment and checks
  fragment compose in the documented order.
- **Happy checks compile:** outline declares one check; that section's reply
  ends with a quiz → quiz lands in the section's blocks, `outline-done`
  carries `checks: 1`, zero warnings, document parses against
  `documentSchema`.
- **Drift:** declared section replies without a quiz →
  `[checks] section 1 declared a check but placed no quiz`.
- **Undeclared quiz:** quiz in an unmarked section, flag on → no warning.
- **Checks off, quiz-emitting stub:** byte-identical behavior, no warnings —
  the flag gates the prompt, not a filter.
- **Grounding × checks:** a quiz citing an unknown source warns via the
  existing `[grounding]` audit; a never-cited source still reports when the
  only citation attempt lives in a quiz.
- **Parity:** `compileDocument` and drained `compileDocumentStream` agree on
  events, document, and warnings with checks on (extends the drain-parity
  pattern).
- **Drop interplay:** a `check: true` section that fails validation yields
  the section-dropped warning and no checks warning.

## 7. Demo

`/compile` stub gains `checks: true`: the stub outline marks two sections as
checks, but only one section reply actually ends with a quiz — the audit log
shows `checks: 2` on `outline-done` and the `[checks] … no quiz` drift
warning live, and the placed quiz renders in the streamed document. Route
smoke to 200.

## 8. Out of Scope

- Density knobs (checks-per-section ratios, first/last constraints as
  options) — the prompt's prose encodes the heuristics; revisit on evidence.
- Dedicated quiz-writing LLM calls (better quiz quality, +1 call per check,
  third stage kind — rejected for now).
- Compile-side quiz payload validation or quiz-specific repair.
- Scoring, progress persistence, cross-document check state.
- Any new dependency.

## 9. Plan Sizing (input to writing-plans)

Estimated 3 tasks: (1) extract schema + prompt fragments + byte-identity
tests; (2) stream wiring (thread flag, outline-done field, drift audit,
grounding × checks) + parity tests; (3) demo stub, README compile-section
paragraph, ROADMAP ship + backlog reword, full verification.
