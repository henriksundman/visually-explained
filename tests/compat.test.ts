/**
 * The backward-compatibility contract, as measured on 2026-10-05.
 *
 * This suite exists because "is the library stable enough to build other apps
 * on" was a question with no answer in the repo. Every assertion here came
 * from running a probe against the built package — not from reading the
 * schemas — because the interesting results were the ones reading the code
 * does not predict:
 *
 *   - an unknown FIELD on a known block is stripped silently and survives even
 *     `strict` and `failOnWarning`, so field additions are backward compatible;
 *   - an unknown TYPE degrades to a labelled fallback chip and warns, but that
 *     warning is fatal to any host running `failOnWarning`, so type additions
 *     are BREAKING;
 *   - an IR `version` bump warns `[wrong-version]` and is breaking the same way.
 *
 * The README states this policy in prose. If a change makes any of these stop
 * being true, the correct fix is to change the policy deliberately — and to
 * update the README in the same commit — rather than to relax these tests.
 * See docs/OPEN_THREADS.md thread 19.
 */
import { describe, expect, it } from "vitest"
import { renderDocument } from "../src/core/renderDocument"
import { renderExplanation } from "../src/core/render"

const doc = (blocks: unknown[]) => ({
  version: 1,
  title: "T",
  sections: [{ id: "s", title: "S", blocks }],
})

describe("compatibility: a future version adds a FIELD to a known block", () => {
  const ir = doc([{ type: "heading", text: "H", someFutureField: true }])

  it("is backward compatible — renders, no warning", () => {
    const { warnings } = renderDocument(ir)
    expect(warnings).toEqual([])
  })

  it("survives failOnWarning", () => {
    // The load-bearing assertion. A stripped unknown key is not a
    // degradation, so the strictest host posture is unaffected by it.
    expect(() => renderDocument(ir, { failOnWarning: true })).not.toThrow()
  })

  it("survives strict", () => {
    expect(() => renderDocument(ir, { strict: true })).not.toThrow()
  })

  it("still renders the fields that ARE known", () => {
    const { html } = renderDocument(ir)
    expect(html).toContain("H")
  })
})

describe("compatibility: a future version adds a BLOCK TYPE", () => {
  const ir = doc([{ type: "carousel", id: "c", slides: ["a", "b"] }])

  it("degrades rather than throwing", () => {
    expect(() => renderDocument(ir)).not.toThrow()
  })

  it("warns with an [unknown-type] code", () => {
    const { warnings } = renderDocument(ir)
    expect(warnings.some((w) => w.startsWith("[unknown-type]"))).toBe(true)
  })

  it("is BREAKING for a failOnWarning host", () => {
    expect(() => renderDocument(ir, { failOnWarning: true })).toThrow(/carousel/)
  })

  it("renders a labelled fallback chip", () => {
    const { html } = renderDocument(ir)
    expect(html).toContain("exp-fallback")
    expect(html).toContain("carousel")
  })

  it("does not echo the unknown block's payload into the page", () => {
    // Only the type name is shown. A fallback that dumped the raw block would
    // put model output in front of the reader as visible text.
    const { html } = renderDocument(doc([{ type: "carousel", slides: ["a"], secret: "TOPSECRET" }]))
    expect(html).not.toContain("TOPSECRET")
    expect(html).not.toContain("slides")
  })

  it("warns for an unknown type nested in a stack too", () => {
    const { warnings } = renderDocument(doc([{ type: "stack", blocks: [{ type: "carousel", id: "c" }] }]))
    expect(warnings.some((w) => w.startsWith("[unknown-type]"))).toBe(true)
  })
})

describe("compatibility: an IR version bump", () => {
  const ir = { ...doc([]), version: 2 }

  it("warns [wrong-version]", () => {
    const { warnings } = renderDocument(ir)
    expect(warnings.some((w) => w.startsWith("[wrong-version]"))).toBe(true)
  })

  it("is BREAKING for a failOnWarning host", () => {
    expect(() => renderDocument(ir, { failOnWarning: true })).toThrow(/wrong-version/)
  })
})

describe("compatibility: garbage entries never fail a render", () => {
  it("warns per bad entry and renders the rest", () => {
    const { html, warnings } = renderExplanation({
      version: 1,
      blocks: [null, 42, "nope", { type: "text", body: "kept" }],
    })
    expect(warnings.filter((w) => w.startsWith("[invalid-block]"))).toHaveLength(3)
    expect(html).toContain("kept")
  })
})

describe("compatibility: a future version adds a REQUIRED field", () => {
  // `heading.text` is required today, so omitting it is exactly the shape of
  // "IR written before this field existed". Measured 2026-10-05: the block is
  // DROPPED, not rendered with the field missing.
  const ir = doc([{ type: "heading" }])

  it("drops the block rather than rendering it partially", () => {
    const { html, warnings } = renderDocument(ir)
    expect(warnings.some((w) => w.startsWith("[invalid-block]"))).toBe(true)
    expect(html).not.toContain("exp-heading")
  })

  it("is BREAKING for a failOnWarning host", () => {
    expect(() => renderDocument(ir, { failOnWarning: true })).toThrow(/invalid-block/)
  })

  it("is a SILENT loss for a lenient host — the reader just sees it missing", () => {
    // The dangerous half of this row, and why it is called out separately in
    // the README table: no throw, no placeholder, just a hole in the page.
    const { html, warnings } = renderDocument(ir)
    expect(warnings.length).toBeGreaterThan(0)
    expect(html).toContain("<section") // the document still renders
    expect(html).not.toContain("exp-heading")
  })
})