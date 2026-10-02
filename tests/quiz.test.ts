import { describe, expect, it } from "vitest"
import { renderExplanation } from "../src/core/render"
import { BLOCK_TYPE_DOCS } from "../src/core/blockTypes"
import { quizBlockSchema } from "../src/core/schema"
import "../src/core/registerAll"

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
