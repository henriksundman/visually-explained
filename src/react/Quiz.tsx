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
