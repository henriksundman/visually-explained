import { describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { renderExplanation } from "../src/core/render"
import { renderDocument } from "../src/core/renderDocument"
import { Document } from "../src/react/Document"
import { Explanation } from "../src/react/Explanation"
import "../src/core/registerAll"

/** `$x^$` is not TeX — Temml throws a TypeError on the dangling superscript —
 *  and it also passes the `$...$` gate, so it reaches the boundary and
 *  degrades. The one string that means "this prose field was wired up". */
const BAD = "$x^$"
const mathWarnings = (warnings: string[]): string[] => warnings.filter(w => w.startsWith("[math]"))

function explanation(blocks: unknown[]) {
  return { version: 1, blocks }
}

describe("inline math degradations reach the warnings channel", () => {
  // One case per prose field that calls renderInline. A field missing from
  // this list is a field whose degradation would be swallowed silently, which
  // is the whole failure mode ctx plumbing exists to prevent.
  const FIELDS: ReadonlyArray<readonly [string, unknown]> = [
    ["text", { type: "text", body: BAD }],
    ["callout", { type: "callout", variant: "note", body: BAD }],
    ["concept.term", { type: "concept", term: BAD, definition: "d" }],
    ["concept.definition", { type: "concept", term: "t", definition: BAD }],
    ["concept.intuition", { type: "concept", term: "t", definition: "d", intuition: BAD }],
    ["concept.analogy", { type: "concept", term: "t", definition: "d", analogy: BAD }],
    ["worked-example.problem", { type: "worked-example", problem: BAD, steps: [{ title: "s" }], result: "r" }],
    ["worked-example.result", { type: "worked-example", problem: "p", steps: [{ title: "s" }], result: BAD }],
    ["step-list.title", { type: "step-list", steps: [{ title: BAD }] }],
    ["step-list.detail", { type: "step-list", steps: [{ title: "t", detail: BAD }] }],
    ["quiz.question", { type: "quiz", question: BAD, options: [{ text: "a" }, { text: "b" }], answer: 0 }],
    ["quiz.option", { type: "quiz", question: "q", options: [{ text: BAD }, { text: "b" }], answer: 1 }],
    ["quiz.explanation", { type: "quiz", question: "q", options: [{ text: "a" }, { text: "b" }], answer: 0, explanation: BAD }],
    ["quiz.why", { type: "quiz", question: "q", options: [{ text: "a", why: BAD }, { text: "b" }], answer: 0 }],
    // presentation: "text" is load-bearing -- auto would draw a figure and
    // never call renderInline on the event at all.
    ["timeline.when", { type: "timeline", events: [{ when: BAD, what: "w" }], presentation: "text" }],
    ["timeline.what", { type: "timeline", events: [{ when: "2020", what: BAD }], presentation: "text" }],
    ["comparison.cell", { type: "comparison", items: [{ name: "a" }, { name: "b" }], dimensions: [{ name: BAD, values: ["v", "w"] }] }],
    ["comparison.item", { type: "comparison", items: [{ name: BAD }, { name: "b" }], dimensions: [{ name: "d", values: ["v", "w"] }] }],
    ["cause-effect.because", { type: "cause-effect", chain: [{ because: BAD, therefore: "t" }], presentation: "text" }],
    ["cause-effect.therefore", { type: "cause-effect", chain: [{ because: "b", therefore: BAD }], presentation: "text" }],
    ["figure.title", { type: "figure", elements: [], title: BAD }],
    ["figure.caption", { type: "figure", elements: [], caption: BAD }],
    ["chart.caption", { type: "chart", kind: "bar", points: [{ label: "A", value: 1 }, { label: "B", value: 2 }], caption: BAD }],
    ["data-callout.context", { type: "data-callout", metric: "m", label: "l", context: BAD }],
    ["data-callout.label", { type: "data-callout", metric: "m", label: BAD }],
    ["sources.title", { type: "sources", items: [{ id: "s1", title: BAD, text: "t" }] }],
    ["sources.detail", { type: "sources", items: [{ id: "s1", title: "t", text: "x", detail: BAD }] }],
    ["derivation.note", { type: "derivation", steps: [{ expression: "x = 1", note: BAD }] }],
  ]

  it.each(FIELDS)("warns for %s", (_name, block) => {
    const { warnings } = renderExplanation(explanation([block]))
    // quiz.option renders its text twice — once in the option list and once in
    // the check-reveal line — so it warns twice. Every other field warns once.
    const expected = _name === "quiz.option" ? 2 : 1
    expect(mathWarnings(warnings)).toHaveLength(expected)
  })

  it("warns once per degradation, not once per render path", () => {
    const { warnings } = renderExplanation(explanation([{ type: "text", body: `${BAD} and ${BAD}` }]))
    expect(mathWarnings(warnings)).toHaveLength(2)
  })

  it("stays silent for prose that only looks like math", () => {
    const { warnings } = renderExplanation(explanation([{ type: "text", body: "It costs $5 and returns $10." }]))
    expect(warnings).toEqual([])
  })

  it("throws under failOnWarning, so a strict host still gates the output", () => {
    expect(() => renderExplanation(explanation([{ type: "text", body: BAD }]), { failOnWarning: true })).toThrow(
      /math/,
    )
  })

  it("throws for a derivation step too, through the same policy", () => {
    expect(() =>
      renderExplanation(explanation([{ type: "derivation", steps: [{ expression: "x^" }] }]), {
        failOnWarning: true,
      }),
    ).toThrow(/math/)
  })
})

describe("document chrome reports inline math degradations", () => {
  const doc = (title: string, summary: string, sectionTitle: string) => ({
    version: 1,
    title,
    summary,
    sections: [{ title: sectionTitle, blocks: [] }],
  })

  it("string renderer reports title, summary, section title and TOC", () => {
    const onWarning = vi.fn()
    renderDocument(doc(BAD, BAD, BAD), { onWarning })
    // Title + summary + one section title, once for the body and once for the TOC.
    expect(mathWarnings(onWarning.mock.calls[0][0]).length).toBeGreaterThanOrEqual(4)
  })

  it("React Document reports the same set — titles and TOC included", () => {
    // Regression guard for an ordering bug: React rendered the title, summary
    // and TOC AFTER the policy check, so a degradation raised there reached
    // onWarning too late to be in the array it reported.
    const onWarning = vi.fn()
    renderToStaticMarkup(<Document ir={doc(BAD, BAD, BAD)} onWarning={onWarning} />)
    expect(mathWarnings(onWarning.mock.calls[0][0]).length).toBeGreaterThanOrEqual(4)
  })

  it("React Document throws under failOnWarning for a bad title", () => {
    expect(() =>
      renderToStaticMarkup(<Document ir={doc(BAD, "fine", "fine")} failOnWarning />),
    ).toThrow(/math/)
  })

  it("React Explanation reports a bad title", () => {
    const onWarning = vi.fn()
    renderToStaticMarkup(
      <Explanation ir={{ version: 1, title: BAD, blocks: [] }} onWarning={onWarning} />,
    )
    expect(mathWarnings(onWarning.mock.calls[0][0])).toHaveLength(1)
  })

  it("React Explanation throws under failOnWarning for a bad title", () => {
    expect(() =>
      renderToStaticMarkup(<Explanation ir={{ version: 1, title: BAD, blocks: [] }} failOnWarning />),
    ).toThrow(/math/)
  })

  it("parity: string and React report the same number for the same IR", () => {
    const ir = doc(BAD, BAD, BAD)
    const a = vi.fn()
    renderDocument(ir, { onWarning: a })
    const b = vi.fn()
    renderToStaticMarkup(<Document ir={ir} onWarning={b} />)
    expect(mathWarnings(b.mock.calls[0][0])).toEqual(mathWarnings(a.mock.calls[0][0]))
  })
})
