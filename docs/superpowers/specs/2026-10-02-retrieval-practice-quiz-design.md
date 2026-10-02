# Retrieval Practice — Quiz Block Design

**Date:** 2026-10-02
**Status:** Approved (brainstorm 2026-10-02 — decisions locked in session)
**Backlog origin:** ROADMAP "Retrieval practice — an assessment primitive in
the block library (quiz / reveal-the-answer), the missing complement to the
exposition-side blocks; retrieval beats re-reading for learning that sticks."

## 1. Problem & Goal

Every existing block is exposition-side: `text`, `concept`, `derivation`,
`worked-example`, `comparison`, `timeline`, figures — they all *tell*; none
*ask*. Retrieval practice (the testing effect: attempting recall, then
checking) is among the most replicated results in learning research and is
exactly what an explanation library never requests of its reader. Goal: a
`quiz` block — multiple-choice question, options, marked answer, per-option
rationale — rendered statically (script-free reveal, on the SSR contract) and
interactively (React click-to-grade), with the LLM authoring contract taught.

## 2. Decisions (locked in brainstorm, 2026-10-02)

1. **MC quiz first.** `reveal-the-answer` and other formats (fill-in-the-blank,
   matching) stay deferred backlog; one format, done well.
2. **Per-option `why` feedback.** Checking marks the correct option and reveals
   each option's optional rationale — the distractor teaching moment.
3. **Static reveal + React clicks, one class vocabulary.** Static HTML is the
   contract (`<details>` reveal); the React client component reuses the same
   classes and adds grading. The figure-events rhythm: static first, React
   enhances.
4. **Block library only this cycle.** Compiler quiz placement (grounded checks
   per section) is a natural follow-up, same rhythm as sources → grounding.
5. **`answer` is a 0-based index** into `options`, not copied text — one source
   of truth; a copied string invites drift.
6. **Leniency degrades the whole block.** No per-option salvage: filtering
   options would shift the `answer` index. Bad shape → fallback + warning.
7. **React grading rides the existing `interactive` prop** on `<Explanation>` —
   "route interactive-capable blocks to client runtimes" extends from `figure`
   to `quiz`; no new prop; default-off keeps the component RSC-safe.
8. **Direct `quiz` block type** — no `assessment` wrapper abstraction (YAGNI);
   a second format later adds its own type.

## 3. Public Surface

```ts
export const quizOptionSchema = z.object({
  text: z.string().min(1).max(300),
  why: z.string().min(1).max(400).optional(),
})

export const quizBlockSchema = z.object({
  id: idSchema,
  type: z.literal("quiz"),
  question: z.string().min(1).max(500),
  options: z.array(quizOptionSchema).min(2).max(6),
  answer: z.number().int().min(0),
  explanation: z.string().min(1).max(500).optional(),
})
export type QuizBlock = z.infer<typeof quizBlockSchema>
```

- `answer` range vs `options.length` is enforced at **lenient render** (block
  degrade + warning), not at schema level — matching the house split where
  schema checks shape and render checks cross-field coherence.
- Exports: `quizBlockSchema` / `QuizBlock` from `src/core/schema.ts` (flow to
  the package root via `export *`); `renderQuiz` registered in
  `src/primitives/quiz.ts` + `registerAll` import; `BLOCK_TYPE_DOCS` gains the
  quiz line **atomically with registration** (the `llm.test.ts` pin requires
  every registered type in the snippet — sources-cycle lesson).
- React: `Quiz` client component exported from `src/react/index.ts`;
  `<Explanation interactive>` routing extended: `interactive && type === "quiz"`
  → `<Quiz block={…} />` alongside the existing `figure` → `InteractiveFigure`.
- The exported explanation JSON schema gains the quiz branch through the block
  union (verified by the existing JSON-schema tests).
- No compiler changes; no new dependencies.

## 4. Static rendering (`renderQuiz`)

```html
<div class="exp-block exp-quiz">
  <p class="exp-quiz-question">{question — renderInline}</p>
  <ol class="exp-quiz-options">
    <li class="exp-quiz-option"><span class="exp-quiz-option-text">{text}</span></li>
    …
  </ol>
  <details class="exp-quiz-check">
    <summary>Check your answer</summary>
    <div class="exp-quiz-result">
      <p class="exp-quiz-answer">✔ {correct text}{ — its why}</p>
      <p class="exp-quiz-miss">✘ {distractor text}{ — its why}</p>  <!-- per option -->
      <p class="exp-quiz-explanation">{explanation}</p>             <!-- optional -->
    </div>
  </details>
</div>
```

- **Script-free commitment**: the `<details>` tap is the check; identical
  information to the React path (correct answer, per-option whys, wrap-up),
  minus click-grading.
- **All model text through `renderInline`** (bold/italic/code/links, escaped) —
  the same untrusted-model-text path as every block; no new raw-HTML sinks.
  Security posture unchanged from the existing primitive set (no new
  network/auth/eval surface; text is escaped at the same choke point).
- **Lenient render triggers** (whole-block degrade → fallback + warning):
  `answer` out of range for `options.length`, `options.length < 2` or > 6
  (schema catches this; render re-checks defensively for raw-IR hosts),
  empty `question`/option `text`. Missing optional `why`s simply omit their
  line.
- **Theme**: `.exp-quiz*` component styles in `tokens.css` from the token
  vocabulary — accent for the correct mark, muted destructive tone for wrong,
  one small `summary` marker normalization (browser default markers vary).
  Light/dark inherit through tokens like every block.

## 5. React grading (`src/react/Quiz.tsx`)

- Same CSS classes, same IR. Flow: click an option to **select**
  (`exp-quiz-selected`) → "Check your answer" button → correct option gets
  `exp-quiz-correct`, a wrong selection gets `exp-quiz-wrong`, per-option
  `why`s reveal inline, `explanation` shows, controls lock.
- **No retry**: retrieval practice commits the reader to an answer before
  correction; retry-until-right is explicitly out of scope.
- Options are `<button>`s (natively focusable/keyboard-operable); the check
  button disables until a selection exists.
- Only mounted under `interactive` — the default `<Explanation>` remains a
  server component rendering the static path, RSC-safe.

## 6. LLM contract (BLOCK_TYPE_DOCS line)

One line in `BLOCK_TYPE_DOCS` (draft; final wording at implementation):

> `- quiz: { question, options: [{ text, why? }], answer, explanation? } — a
> multiple-choice check for the reader. 2-6 options; answer is the 0-based
> index of the one correct option. Write plausible distractors whose why names
> the misconception they encode; give the correct option a why that completes
> the idea. Never reveal the answer inside the question. Place after the
> material it checks.`

## 7. Testing

- **Schema**: bounds (question 500, option text 300, why 400, explanation 500,
  options 2–6), integer `answer`, optional fields.
- **Static render**: happy path (options listed, reveal contains correct-first
  mark, distractor whys, optional explanation); `why` omission; degrade cases —
  out-of-range `answer`, < 2 options (raw IR), empty question — each → fallback
  block + warning, never a throw; block id escapes.
- **React**: select → check → correct/wrong classes → locked; check disabled
  before selection; parity — without `interactive`, quiz blocks render the
  static markup identically to the HTML renderer.
- **Prompt contract**: quiz line present in `BLOCK_TYPE_DOCS` (the existing
  registration pin covers schema/contract atomicity).
- **Demo**: served static quiz verified via curl on `/document`.

## 8. Demo

- `/document`: a "Retrieval practice" section with one authored quiz — question
  with inline `code`, 4 options whose `why`s target real misconceptions, one
  `explanation` — exercising the static reveal (SSR path).
- `/interactive`: the same quiz through the React runtime (`interactive`) —
  click-to-grade visible in the browser (client path).

## 9. Out of Scope

- Compiler quiz placement (grounded checks per section) — follow-up cycle.
- Other assessment formats: `reveal-the-answer`, fill-in-the-blank, matching.
- Scoring, progress persistence, retry-until-correct, adaptive difficulty.
- Any new dependency.

## 10. Plan Sizing (input to writing-plans)

Estimated 4 tasks: (1) schema + `blockUnionSchema` + `registerAll` +
`BLOCK_TYPE_DOCS` line, atomic, with schema + registration-pin tests;
(2) `renderQuiz` + theme CSS + static tests; (3) React `Quiz` +
`Explanation` routing + component tests; (4) demo quizzes on `/document` +
`/interactive`, README block-table row, ROADMAP ship + backlog reword, full
verification.
