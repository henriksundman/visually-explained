import { describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { Explanation } from "../src/react/Explanation"
import { Document } from "../src/react/Document"
import { renderDocument } from "../src/core/renderDocument"

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

  it("does not throw when nothing degrades", () => {
    // The controls MUST be genuinely clean: a negative assertion passes
    // vacuously if the input degrades for an unrelated reason. An explanation
    // missing `version` degrades with [wrong-version]; a document missing a
    // title degrades too.
    expect(() =>
      renderToStaticMarkup(<Explanation ir={{ version: 1, title: "T", blocks: [clean] }} failOnWarning />),
    ).not.toThrow()
    expect(() => renderToStaticMarkup(<Document ir={doc(clean)} failOnWarning />)).not.toThrow()
  })

  it("reports the same warning set as the string renderer", () => {
    const fromReact: string[][] = []
    renderToStaticMarkup(<Document ir={doc(img, math)} onWarning={w => fromReact.push(w)} />)
    const fromHtml = renderDocument(doc(img, math)).warnings
    expect(fromReact[0]).toEqual(fromHtml)
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
})