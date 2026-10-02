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
