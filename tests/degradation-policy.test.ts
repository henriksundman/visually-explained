import { describe, expect, it, vi } from "vitest"
import { renderDocument } from "../src/core/renderDocument"
import { renderExplanation, formatDegradationError } from "../src/core/render"

const img = { type: "image", image: "chart" }
const math = { type: "derivation", steps: [{ expression: "\\frac{1" }] }
const clean = { type: "text", body: "hi" }

const doc = (...blocks: unknown[]) => ({
  version: 1,
  title: "T",
  sections: [{ title: "S", blocks }],
})

describe("degradation policy — string renderers", () => {
  it("onWarning fires once with the full set, in document order", () => {
    const onWarning = vi.fn()
    renderDocument(doc(img, math), { onWarning })
    expect(onWarning).toHaveBeenCalledTimes(1)
    expect(onWarning.mock.calls[0][0]).toEqual([
      '[image] image chart: no image named "chart"',
      expect.stringContaining("[math] not TeX"),
    ])
  })

  it("onWarning fires with an empty array when nothing degrades", () => {
    const onWarning = vi.fn()
    renderDocument(doc(clean), { onWarning })
    expect(onWarning).toHaveBeenCalledTimes(1)
    expect(onWarning).toHaveBeenCalledWith([])
  })

  it("failOnWarning throws carrying EVERY warning, not just the first", () => {
    let err: unknown
    try {
      renderDocument(doc(img, math), { failOnWarning: true })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(Error)
    const msg = (err as Error).message
    expect(msg).toContain("Degradation policy: 2 warning(s)")
    expect(msg).toContain("[image]")
    expect(msg).toContain("[math]")
  })

  it("does not throw when nothing degrades", () => {
    // Same vacuous-assertion guard: prove the control is clean first.
    expect(renderDocument(doc(clean)).warnings).toEqual([])
    expect(() => renderDocument(doc(clean), { failOnWarning: true })).not.toThrow()
  })

  it("a broken top level throws under failOnWarning, before the empty-shell early return", () => {
    expect(() =>
      renderDocument({ version: 2, title: "", sections: [] }, { failOnWarning: true }),
    ).toThrow(/Degradation policy/)
    // Lenient mode still returns the silent empty shell — the regression this guards.
    const lenient = renderDocument({ version: 2, title: "", sections: [] })
    expect(lenient.html).toBe('<article class="exp exp-doc"></article>')
  })

  it("strict still throws the VALIDATION error when both options are set", () => {
    let err: unknown
    try {
      renderDocument(
        { version: 1, title: "T", sections: [{ title: "", blocks: [] }] },
        { strict: true, failOnWarning: true },
      )
    } catch (e) {
      err = e
    }
    expect((err as Error).message).toMatch(/^invalid document:/)
  })

  it("strict alone is unchanged: a validation failure throws the same message", () => {
    expect(() =>
      renderDocument({ version: 1, title: "T", sections: [{ title: "", blocks: [] }] }, { strict: true }),
    ).toThrow(/^invalid document:/)
  })

  it("counts lenient-validation diagnostics as degradations", () => {
    expect(() =>
      renderDocument({ version: 1, title: "T", sections: [{ title: "", blocks: [] }] }, { failOnWarning: true }),
    ).toThrow(/Degradation policy/)
  })

  it("truncates the message but not the array", () => {
    const long = { type: "image", image: "x".repeat(300) }
    const seen: string[][] = []
    renderDocument(doc(long), { onWarning: w => seen.push(w) })
    expect(seen[0][0].length).toBeGreaterThan(120)
    let msg = ""
    try {
      renderDocument(doc(long), { failOnWarning: true })
    } catch (e) {
      msg = (e as Error).message
    }
    expect(msg).not.toContain("x".repeat(200))
  })

  it("renders identical HTML with and without the options", () => {
    const a = renderDocument(doc(img, math)).html
    const b = renderDocument(doc(img, math), { onWarning: () => {}, failOnWarning: false }).html
    expect(a).toBe(b)
  })

  it("renderExplanation honors both options", () => {
    const ir = { version: 1, title: "T", summary: "s", blocks: [img] }
    const onWarning = vi.fn()
    renderExplanation(ir, { onWarning })
    expect(onWarning).toHaveBeenCalledTimes(1)
    expect(() => renderExplanation(ir, { failOnWarning: true })).toThrow(/Degradation policy/)
    // The control MUST be genuinely clean: a negative assertion passes
    // vacuously if the input degrades for some other reason (an explanation
    // missing `version` degrades with [wrong-version]), which would make this
    // test prove nothing.
    const control = { version: 1, title: "T", blocks: [clean] }
    expect(renderExplanation(control).warnings).toEqual([])
    expect(() => renderExplanation(control, { failOnWarning: true })).not.toThrow()
  })

  it("formatDegradationError bounds fragments at 120 chars and 10 fragments", () => {
    const msg = formatDegradationError(Array.from({ length: 12 }, (_, i) => `[x] ${"y".repeat(300)} #${i}`))
    expect(msg).toContain("12 warning(s)")
    expect(msg).toContain("and 2 more")
    expect(msg).not.toContain("y".repeat(200))
  })
})