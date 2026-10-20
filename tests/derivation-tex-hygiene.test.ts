import { describe, expect, it } from "vitest"
import { renderMath } from "../src/core/math"
import { editorialDocIr } from "../demo/editorialIr.js"
import {
  educationIr,
  dataIr,
  capabilitiesIr,
  figuresIr,
  howToIr,
  demoDocIr,
} from "../demo/examples.js"

/**
 * `derivation.expression` is a TeX field. Prose placed in it is **valid TeX**
 * -- a run of letters is a run of variables -- so it renders as one <mi> per
 * letter with every space collapsed, and emits no warning at all. The `not
 * TeX` degradation path cannot catch it, because there is no parse error to
 * catch.
 *
 * That shipped twice: the editorial demo held a full sentence in a conclusion
 * ("Violetscattersmorethanblue", overflowing line, clean warnings), and a
 * host LLM did the same thing through `conclusion` (2026-10-10 capture). The
 * second incident is now FIXES at render time — `conclusion` is documented
 * prose with inline math, gated by the fingerprint below — so this sweep
 * covers `expression` only: bare words + single-letter identifiers are right
 * there, not a contract violation.
 */
const FIXTURES: Record<string, unknown> = {
  editorialDocIr,
  educationIr,
  dataIr,
  capabilitiesIr,
  figuresIr,
  howToIr,
  demoDocIr,
}

function* blocksOf(ir: unknown): Generator<Record<string, unknown>> {
  const rec = ir as { blocks?: unknown[]; sections?: { blocks?: unknown[] }[] }
  for (const b of rec?.blocks ?? []) {
    const block = b as Record<string, unknown>
    yield block
    if (block?.type === "stack" && Array.isArray(block.blocks)) {
      for (const child of block.blocks) yield child as Record<string, unknown>
    }
  }
  for (const s of rec?.sections ?? []) {
    for (const b of s.blocks ?? []) yield b as Record<string, unknown>
  }
}

/** Fields of a derivation block that are TeX, per math spec §3. `note` is
 *  deliberately excluded: it stays prose. So is `conclusion` since follow-up
 *  4 (2026-10-20): it is documented prose with inline math, and prose there
 *  renders readable instead of shredding into <mi> runs. */
function texFields(block: Record<string, unknown>): [string, unknown][] {
  const steps = (block.steps ?? []) as Record<string, unknown>[]
  return steps.map((s, i) => [`steps[${i}].expression`, s?.expression] as [string, unknown])
}

/** The prose fingerprint: bare words AND shredded single-letter identifiers. */
function looksLikeProse(tex: string, rendered: string): boolean {
  const words = tex.split(/\s+/).filter(w => /[a-zA-Z]{3,}/.test(w))
  const singleLetterMi = (rendered.match(/<mi>[a-zA-Z]<\/mi>/g) ?? []).length
  return words.length >= 4 && singleLetterMi >= 8
}

describe("demo fixtures keep prose out of TeX fields", () => {
  it("finds the fixtures (guards a bad path silently passing)", () => {
    expect(Object.keys(FIXTURES).length).toBe(7)
  })

  const offenders: string[] = []

  for (const [name, ir] of Object.entries(FIXTURES)) {
    it(`${name} holds no prose in a derivation TeX field`, () => {
      const found: string[] = []
      for (const block of blocksOf(ir)) {
        if (block?.type !== "derivation") continue
        for (const [field, value] of texFields(block)) {
          if (typeof value !== "string" || value.length === 0) continue
          let rendered = ""
          try {
            rendered = renderMath(value)
          } catch {
            // A parse failure degrades loudly with a [math] warning, which is
            // the good path -- not this test's concern.
            continue
          }
          if (looksLikeProse(value, rendered)) {
            found.push(`${field}: ${JSON.stringify(value.slice(0, 80))}`)
          }
        }
      }
      offenders.push(...found.map(f => `${name} ${f}`))
      expect(
        found,
        `prose in a TeX field renders as one <mi> per letter with no warning.\n` +
          `Move prose to a \`note\` (or a text block) and keep formulas here.`,
      ).toEqual([])
    })
  }

  it("found at least one derivation to check across the fixtures", () => {
    let count = 0
    for (const ir of Object.values(FIXTURES)) {
      for (const b of blocksOf(ir)) if (b?.type === "derivation") count++
    }
    // If a future refactor removes every derivation, this sweep silently
    // guards nothing -- so assert it still has something to look at.
    expect(count).toBeGreaterThan(0)
  })
})