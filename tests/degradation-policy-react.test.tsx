import { describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { Explanation } from "../src/react/Explanation"
import { PopoverDiv } from "../src/react/ElementPopover"
import { Document } from "../src/react/Document"
import { renderDocument } from "../src/core/renderDocument"
import { renderExplanation } from "../src/core/render"

const img = { type: "image", image: "chart" }
const math = { type: "derivation", steps: [{ expression: "\\frac{1" }] }
const clean = { type: "text", body: "hi" }
const doc = (...blocks: unknown[]) => ({ version: 1, title: "T", sections: [{ title: "S", blocks }] })

describe("degradation policy — React", () => {
  it("Explanation surfaces warnings that were previously discarded", () => {
    const onWarning = vi.fn()
    renderToStaticMarkup(<Explanation ir={{ version: 1, title: "T", blocks: [img] }} onWarning={onWarning} />)
    expect(onWarning).toHaveBeenCalledTimes(1)
    expect(onWarning).toHaveBeenCalledWith(['[image] image chart: no image named "chart"'])
  })

  it("Document surfaces warnings that were previously discarded", () => {
    const onWarning = vi.fn()
    renderToStaticMarkup(<Document ir={doc(img, math)} onWarning={onWarning} />)
    expect(onWarning).toHaveBeenCalledTimes(1)
    expect(onWarning.mock.calls[0][0]).toHaveLength(2)
  })

  it("failOnWarning throws from both components", () => {
    expect(() =>
      renderToStaticMarkup(<Explanation ir={{ version: 1, title: "T", blocks: [img] }} failOnWarning />),
    ).toThrow(/Degradation policy/)
    expect(() => renderToStaticMarkup(<Document ir={doc(img)} failOnWarning />)).toThrow(/Degradation policy/)
  })

  it("failOnWarning fires for a document-level breakage with no blocks", () => {
    expect(() => renderToStaticMarkup(<Document ir={null} failOnWarning />)).toThrow(/Degradation policy/)
  })

  it("does not throw when nothing degrades", () => {
    // The controls MUST be genuinely clean: a negative assertion passes
    // vacuously if the input degrades for an unrelated reason. An explanation
    // missing `version` degrades with [wrong-version]; a document missing a
    // title degrades too. Assert the emptiness before asserting no throw.
    const expIr = { version: 1, title: "T", blocks: [clean] }
    const docIr = doc(clean)
    expect(renderExplanation(expIr).warnings).toEqual([])
    expect(renderDocument(docIr).warnings).toEqual([])
    expect(() => renderToStaticMarkup(<Explanation ir={expIr} failOnWarning />)).not.toThrow()
    expect(() => renderToStaticMarkup(<Document ir={docIr} failOnWarning />)).not.toThrow()
  })

  it("reports the same warning set as the string renderer", () => {
    const fromReact: string[][] = []
    renderToStaticMarkup(<Document ir={doc(img, math)} onWarning={w => fromReact.push(w)} />)
    const fromHtml = renderDocument(doc(img, math)).warnings
    expect(fromReact[0]).toEqual(fromHtml)
  })

  // Regression: Document once reimplemented renderDocument's diagnostics
  // inline, and the copy reported NO warnings for a non-object IR where
  // renderDocument reports three, and none for a dropped section. Both are
  // now shared helpers; these pin the agreement so it cannot drift again.
  it.each([
    ["a non-object IR", null],
    ["a missing version", { title: "T", sections: [{ title: "S", blocks: [] }] }],
    ["an empty title", { version: 1, title: "", sections: [{ title: "S", blocks: [] }] }],
    ["no sections", { version: 1, title: "T", sections: [] }],
    ["a dropped section", { version: 1, title: "T", sections: [{ title: "", blocks: [] }, { title: "ok", blocks: [] }] }],
    ["document and block diagnostics together", { version: 1, title: "T", sections: [{ title: "", blocks: [] }, { title: "ok", blocks: [img, math] }] }],
  ])("matches the string renderer on %s", (_name, ir) => {
    let reactSeen: string[] | null = null
    renderToStaticMarkup(<Document ir={ir} onWarning={w => { reactSeen = w }} />)
    expect(reactSeen).toEqual(renderDocument(ir).warnings)
  })

  // Deliberate asymmetry, not drift: a broken top level makes renderDocument
  // return early WITHOUT rendering blocks, so it cannot report their warnings.
  // <Document> has no early return and renders the sections it can, so it
  // reports MORE. Documented here so a future reader does not "fix" it by
  // suppressing React's warnings -- that would hide real degradations.
  it("reports block warnings the string renderer misses when the top level is broken", () => {
    const ir = { version: 2, title: "", sections: [{ title: "ok", blocks: [img] }] }
    let reactSeen: string[] = []
    renderToStaticMarkup(<Document ir={ir} onWarning={w => { reactSeen = w }} />)
    const fromHtml = renderDocument(ir).warnings
    expect(fromHtml.some(w => w.startsWith("[image]"))).toBe(false)
    expect(reactSeen.some(w => w.startsWith("[image]"))).toBe(true)
  })

  it("Explanation and Document agree with each other", () => {
    const a: string[][] = []
    const b: string[][] = []
    renderToStaticMarkup(
      <Explanation ir={{ version: 1, title: "T", blocks: [img, math] }} onWarning={w => a.push(w)} />,
    )
    renderToStaticMarkup(<Document ir={doc(img, math)} onWarning={w => b.push(w)} />)
    expect(a[0]).toEqual(b[0])
  })

  it("renders identical HTML with and without the options", () => {
    const plain = renderToStaticMarkup(<Document ir={doc(img, math)} />)
    const withOpts = renderToStaticMarkup(
      <Document ir={doc(img, math)} onWarning={() => {}} failOnWarning={false} />,
    )
    expect(withOpts).toBe(plain)
  })

  it("nested stack children warnings still reach the host", () => {
    // stackBlockSchema's child key is `blocks`, not `children` -- using
    // `children` makes the whole stack an [invalid-block], so the nested image
    // never renders and there is no warning to find. That is the fixture trap
    // this test would otherwise pass for the wrong reason.
    const onWarning = vi.fn<(w: string[]) => void>()
    renderToStaticMarkup(<Document ir={doc({ type: "stack", blocks: [img] })} onWarning={onWarning} />)
    expect(onWarning.mock.calls[0][0].some((w: string) => w.startsWith("[image]"))).toBe(true)
  })

  it("passes a copy, so a host mutating the array cannot corrupt the render", () => {
    let received: string[] = []
    renderToStaticMarkup(<Document ir={doc(img, math)} onWarning={w => { received = w; w.length = 0 }} />)
    expect(received).toEqual([])
    expect(renderDocument(doc(img, math)).warnings).toHaveLength(2)
  })
  // --- open thread 13: Quiz, InteractiveFigure and ElementPopover reported no
  // degradations at all, so the no-degradation policy was silently defeated
  // there. An unparseable formula in quiz prose produced BYTE-IDENTICAL html
  // with and without a sink, so the degradation was invisible in the DOM, to
  // diffing, and to onWarning — and a failOnWarning host did not throw.
  //
  // The fix is a synchronous PRE-PASS in Explanation's own body, not a prop
  // threaded into the child: a child component's side effects land after the
  // parent's body has run (measured), so the parent would read an empty array.
  // `interactive` is REQUIRED throughout, because without it Explanation never
  // routes to <Quiz>/<InteractiveFigure> at all and the plain renderBlock path
  // reports correctly — a green test that never touches the broken component.
  //
  // A dangling superscript throws inside Temml and degrades with [math].
  const BAD = "\\(x^\\)"

  it("reports a quiz's block warnings, which were discarded wholesale", () => {
    const badAnswer = {
      type: "quiz",
      id: "q1",
      question: "Q?",
      answer: 7, // out of range for 2 options — schema-valid, cross-field check
      options: [{ text: "a", why: "x" }, { text: "b", why: "y" }],
    }
    // Anchored to the string renderer, not to whatever React does.
    expect(renderExplanation({ version: 1, title: "T", blocks: [badAnswer] }).warnings).toEqual([
      'quiz-answer-invalid: quiz "q1" answer index out of range — check reveal hidden',
    ])

    const onWarning = vi.fn()
    renderToStaticMarkup(
      <Explanation ir={{ version: 1, title: "T", blocks: [badAnswer] }} interactive onWarning={onWarning} />,
    )
    expect(onWarning).toHaveBeenCalledTimes(1)
    expect(onWarning.mock.calls[0][0]).toEqual([
      'quiz-answer-invalid: quiz "q1" answer index out of range — check reveal hidden',
    ])
  })

  it("reports prose degradations inside a quiz", () => {
    const ir = {
      version: 1,
      title: "T",
      blocks: [
        {
          type: "quiz",
          id: "q1",
          question: `Bad ${BAD} here`,
          answer: 0,
          options: [{ text: `a ${BAD}`, why: `w ${BAD}` }, { text: "b", why: "n" }],
          explanation: `e ${BAD}`,
        },
      ],
    }
    const fromString = renderExplanation(ir).warnings
    // Measured, not guessed: the static quiz render sinks the question, both
    // option texts, the whys, the check-reveal lines and the explanation, so
    // the same formula in five places yields five warnings. An earlier draft of
    // this test asserted 4 and failed with "expected 5 to be 4" — the fixture
    // was miscounted, not the product. Anchoring to the string renderer's own
    // count is what makes the parity assertion robust to that.
    expect(fromString.length).toBe(5)

    const onWarning = vi.fn()
    renderToStaticMarkup(<Explanation ir={ir} interactive onWarning={onWarning} />)
    // The set must MATCH, not merely be non-empty: a count-only assertion
    // passed here before, when React reported 1 where the string renderer
    // reported 4 (the 2026-10-04 math cycle).
    expect(onWarning.mock.calls[0][0]).toHaveLength(fromString.length)
  })

  it("failOnWarning throws for a quiz, which it previously did not", () => {
    // The policy is worthless if it silently passes, so this asserts the
    // THROW rather than inferring it from the warning count. A component that
    // reported in an effect would satisfy a count assertion and still not throw.
    const ir = {
      version: 1,
      title: "T",
      blocks: [
        { type: "quiz", id: "q1", question: `Bad ${BAD}`, answer: 0, options: [{ text: "a", why: "x" }, { text: "b", why: "n" }] },
      ],
    }
    expect(() => renderToStaticMarkup(<Explanation ir={ir} interactive failOnWarning />)).toThrow(
      /Degradation policy/,
    )
  })

  it("reports a figure's title and caption degradations", () => {
    const ir = {
      version: 1,
      title: "T",
      blocks: [
        {
          type: "figure",
          title: `Cap ${BAD}`,
          caption: `Also ${BAD}`,
          params: [],
          elements: [{ kind: "label", x: 10, y: 10, text: "hi" }],
        },
      ],
    }
    expect(renderExplanation(ir).warnings).toHaveLength(2)

    const onWarning = vi.fn()
    renderToStaticMarkup(<Explanation ir={ir} interactive onWarning={onWarning} />)
    expect(onWarning.mock.calls[0][0]).toHaveLength(2)
  })

  it("does not double-report when the block is NOT delegated", () => {
    // The pre-pass must fire only for the delegated types. Without `interactive`
    // a quiz goes through the ordinary renderBlock path, which already reports;
    // a pre-pass there would report everything twice.
    const ir = {
      version: 1,
      title: "T",
      blocks: [
        { type: "quiz", id: "q1", question: `Bad ${BAD}`, answer: 0, options: [{ text: "a", why: "x" }, { text: "b", why: "n" }] },
      ],
    }
    const onWarning = vi.fn()
    renderToStaticMarkup(<Explanation ir={ir} onWarning={onWarning} />)
    expect(onWarning.mock.calls[0][0]).toHaveLength(1)
  })
  it("reports a degraded popover tip when the popover opens", () => {
    // A tip has NO static render pass: it appears at hover time, long after any
    // parent rendered, so the pre-pass cannot collect it (spec §3b). This is a
    // different lifecycle and is reported as one — onWarning fires at the moment
    // the popover renders, with no parent reading the array afterwards.
    //
    // The closer must be ESCAPED: "\\(x^)" with no closing \\) never enters
    // extractMath at all and yields zero warnings, which reads as "the sink is
    // broken" rather than "the fixture never contained math". Measured both.
    //
    // There is deliberately NO failOnWarning here: the popover mounts from a
    // hover or a focus, so throwing during its render would tear down a figure
    // the reader is currently looking at. That is recorded, not silently
    // omitted.
    const onWarning = vi.fn()
    renderToStaticMarkup(
      <PopoverDiv
        pop={{ elId: "n1", tip: "Costs \\(x^\\) here", top: 0, left: 0, placement: "below" }}
        onWarning={onWarning}
      />,
    )
    expect(onWarning).toHaveBeenCalledTimes(1)
    expect(onWarning.mock.calls[0][0].length).toBe(1)
    expect(onWarning.mock.calls[0][0][0]).toContain("[math]")
  })

  it("does not report for a clean tip", () => {
    // The negative case must be genuinely clean, or it passes vacuously: a
    // component that reported unconditionally would satisfy the test above too.
    const onWarning = vi.fn()
    renderToStaticMarkup(
      <PopoverDiv pop={{ elId: "n1", tip: "Just **bold** text", top: 0, left: 0, placement: "below" }} onWarning={onWarning} />,
    )
    expect(onWarning).toHaveBeenCalledWith([])
  })
  it("Explanation reports the SAME set as the string renderer across every block type", () => {
    // The single assertion that would have caught all of thread 13. One IR
    // touching a delegated quiz, a delegated figure, a plain text block and a
    // document-level title/summary — so the pre-pass path, the ordinary
    // renderBlock path and Explanation's own renderInline calls all contribute.
    //
    // Compares the SORTED SETS, not the counts and not the order. A count-only
    // comparison passed in the 2026-10-04 math cycle while React reported 1
    // where the string renderer reported 4; a set comparison cannot pass that
    // way, because a missing member is a missing member however it is counted.
    const ir = {
      version: 1,
      title: `Title ${BAD}`,
      summary: `Summary ${BAD}`,
      blocks: [
        { type: "text", body: `plain ${BAD}` },
        {
          type: "quiz",
          id: "q1",
          question: `q ${BAD}`,
          answer: 0,
          options: [{ text: `a ${BAD}`, why: `w ${BAD}` }, { text: "b", why: "n" }],
        },
        {
          type: "figure",
          title: `Cap ${BAD}`,
          caption: `Also ${BAD}`,
          params: [],
          elements: [{ kind: "label", x: 10, y: 10, text: "hi" }],
        },
      ],
    }

    const fromString = renderExplanation(ir).warnings
    expect(fromString.length).toBeGreaterThan(0)

    const onWarning = vi.fn()
    renderToStaticMarkup(<Explanation ir={ir} interactive onWarning={onWarning} />)
    const fromReact = onWarning.mock.calls[0][0]

    expect([...fromReact].sort()).toEqual([...fromString].sort())
  })
})
