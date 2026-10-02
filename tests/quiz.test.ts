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
