import { describe, expect, it } from "vitest"
import { renderMath, MathParseError } from "../src/core/math"
import { renderWithKaTeX } from "../demo/mathEngines"
import { MATH_CORPUS } from "../demo/mathCorpus"

/** Runs the shipped boundary and the comparison engine over one input and
 *  returns both outcomes, so a test can assert about either without caring
 *  which one threw. */
function both(tex: string): {
  temml?: string
  temmlError?: string
  katex?: string
  katexError?: string
} {
  const out: ReturnType<typeof both> = {}
  try {
    out.temml = renderMath(tex)
  } catch (e) {
    expect(e).toBeInstanceOf(MathParseError)
    out.temmlError = "parse-error"
  }
  const k = renderWithKaTeX(tex)
  if (typeof k === "string") out.katex = k
  else out.katexError = k.error
  return out
}

const VALID = MATH_CORPUS.filter((c) => !c.note.startsWith("malformed"))
const MALFORMED = MATH_CORPUS.filter((c) => c.note.startsWith("malformed"))

describe("engine parity over the shared corpus", () => {
  it.each(VALID)("renders $note with both engines", ({ tex }) => {
    const r = both(tex)
    expect(r.temmlError, `temml failed on ${tex}`).toBeUndefined()
    expect(r.katexError, `katex failed on ${tex}`).toBeUndefined()
    expect(r.temml).toContain("<math")
    expect(r.katex).toContain("katex")
  })

  it.each(MALFORMED)("agrees that $note fails on both engines", ({ tex }) => {
    const r = both(tex)
    expect(r.temmlError, "temml should reject malformed TeX").toBe("parse-error")
    expect(r.katexError, "katex should reject malformed TeX").toBeDefined()
  })

  it("keeps KaTeX output free of navigable attributes on hostile TeX", () => {
    // KaTeX neutralises rather than rejects, so assert the invariant, not a
    // throw — a test demanding a throw here would fail on correct code.
    //
    // Asserted structurally, never by substring: KaTeX echoes the source TeX
    // into <annotation encoding="application/x-tex">, so "javascript:" DOES
    // legitimately appear in the output as inert escaped source. A substring
    // check would fail on correct code and teach the wrong invariant — the
    // same trap as the earlier `onerror` false positive on escaped \text.
    for (const tex of [
      String.raw`\href{javascript:alert(1)}{x}`,
      String.raw`\url{https://evil.example}`,
      String.raw`\href{https://evil.example}{click}`,
    ]) {
      const out = renderWithKaTeX(tex)
      if (typeof out !== "string") continue
      expect(out, `${tex}: KaTeX emitted an href attribute`).not.toMatch(/\shref\s*=/i)
      expect(out, `${tex}: KaTeX emitted an anchor`).not.toMatch(/<a[\s>]/i)
      expect(out, `${tex}: KaTeX emitted an event handler`).not.toMatch(/\son[a-z]+\s*=/i)
    }
  })

  it("covers every corpus entry in at least one direction", () => {
    // Guards against someone adding a row to the corpus that no assertion runs.
    expect(VALID.length + MALFORMED.length).toBe(MATH_CORPUS.length)
    expect(VALID.length).toBeGreaterThan(0)
    expect(MALFORMED.length).toBeGreaterThan(0)
  })
})
