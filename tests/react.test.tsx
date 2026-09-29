import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { Explanation } from "../src/react/Explanation"
import { InteractiveFigure, nextSweepValue, valueColumnCh } from "../src/react/InteractiveFigure"
import type { TextBlock } from "../src/core/schema"

const ir = {
  version: 1,
  title: "T",
  summary: "S",
  blocks: [{ type: "text", body: "hello **world**" }],
}

describe("Explanation", () => {
  it("renders server-side with the default light theme", () => {
    const html = renderToStaticMarkup(<Explanation ir={ir} />)
    expect(html).toContain(`class="exp exp-theme-light"`)
    expect(html).toContain("exp-title")
    expect(html).toContain("<strong>world</strong>")
  })

  it("renders leniently by default and throws in strict mode", () => {
    const bad = { version: 2, blocks: [] }
    expect(renderToStaticMarkup(<Explanation ir={bad} />)).toContain(`class="exp exp-theme-light"`)
    expect(() => renderToStaticMarkup(<Explanation ir={bad} strict />)).toThrow()
  })

  it("lets consumers override a primitive with a custom component", () => {
    const MyText = ({ block }: { block: TextBlock }) => <em data-test="my-text">{block.body}</em>
    const html = renderToStaticMarkup(
      <Explanation ir={ir} theme="none" components={{ text: MyText }} />,
    )
    expect(html).toContain(`data-test="my-text"`)
    expect(html).not.toContain("exp-text")
  })

  it("renders unknown types through the core fallback", () => {
    const html = renderToStaticMarkup(
      <Explanation ir={{ version: 1, blocks: [{ type: "mindmap", title: "Sales" }] }} theme="none" />,
    )
    expect(html).toContain("exp-fallback")
  })

  it("routes figure blocks to the interactive runtime only when asked", () => {
    const ir = { version: 1, blocks: [figureBlock] }
    const on = renderToStaticMarkup(<Explanation ir={ir} theme="none" interactive />)
    expect(on).toContain(`type="range"`)
    const off = renderToStaticMarkup(<Explanation ir={ir} theme="none" />)
    expect(off).not.toContain(`type="range"`)
    expect(off).toContain(`class="exp-figure"`) // static path unchanged
  })

  it("lets a components override win over interactive routing", () => {
    const MyFigure = () => <em data-test="my-figure">mine</em>
    const ir = { version: 1, blocks: [figureBlock] }
    const html = renderToStaticMarkup(
      <Explanation ir={ir} theme="none" interactive components={{ figure: MyFigure }} />,
    )
    expect(html).toContain(`data-test="my-figure"`)
    expect(html).not.toContain(`type="range"`)
  })
})

const figureBlock = {
  type: "figure",
  title: "Orbit",
  caption: "A circle-ish thing.",
  params: [{ name: "r", min: 5, max: 50, step: 1, initial: 20 }],
  elements: [{ kind: "arc", cx: 100, cy: 80, rx: "r", ry: "r", start: 0, end: 270 }],
}

describe("InteractiveFigure", () => {
  it("renders static-identical initial SVG with markup parity", () => {
    const html = renderToStaticMarkup(<InteractiveFigure block={figureBlock} />)
    expect(html).toContain(`class="exp-block exp-figure"`)
    expect(html).toContain(`class="exp-fig-title"`)
    expect(html).toContain(`class="exp-fig-caption"`)
    expect(html).toContain(`class="exp-figure"`)
    expect(html).toContain("A 20 20 0 1 1") // same geometry as the static render
    expect(html).toContain(`type="range"`)
    expect(html).toContain(`aria-label="r"`)
    expect(html).toContain(`aria-label="Play r"`) // sweep falls back to params[0]
    // Value column is sized from the worst-case n2 format over the bounds
    // (sign + integer digits + "." + 2 decimals + slack) so fractional sweep
    // intermediates like 45.83 never widen it: 5..50 → 0+2+3+1 = 6ch.
    expect(html).toContain(`min-width:6ch`)
  })

  it("renders no controls for a zero-param figure", () => {
    const html = renderToStaticMarkup(
      <InteractiveFigure block={{ type: "figure", elements: [{ kind: "dot", cx: 5, cy: 5 }] }} />,
    )
    expect(html).toContain(`class="exp-fig-dot"`)
    expect(html).not.toContain(`type="range"`)
    expect(html).not.toContain(`exp-fig-play`)
  })

  it("honors a known sweep name and survives garbage blocks", () => {
    const html = renderToStaticMarkup(<InteractiveFigure block={{ ...figureBlock, sweep: "r" }} />)
    expect(html).toContain(`aria-label="Play r"`)
    const empty = renderToStaticMarkup(<InteractiveFigure block={{ type: "figure", elements: [{ kind: "wedge" }] }} />)
    expect(empty).toContain(`class="exp-fig-empty"`)
  })
})

describe("valueColumnCh", () => {
  it.each([
    [{ min: 20, max: 60 }, 6], // 2 digits + ".dd" + slack
    [{ min: 0, max: 360 }, 7], // 3 digits + ".dd" + slack
    [{ min: -10, max: 5 }, 7], // sign + 2 digits + ".dd" + slack
  ])("%j → %ich", (bounds, expected) => {
    expect(valueColumnCh(bounds as { min: number; max: number })).toBe(expected)
  })
})

describe("nextSweepValue", () => {
  const spec = { min: 20, max: 60, step: 5 }
  it.each([
    [40, 100, 45], // SWEEP_STEPS_PER_SEC = 10 → one step per 100ms
    [60, 100, 20], // wraps at max
    [40, 50, 42.5], // frame-rate scaled sub-step
    [40, 0, 40], // zero dt is a no-op
    [40, -5, 40], // negative dt is a no-op
  ])("value %i + dt %p ms → %p", (current, dt, expected) => {
    expect(nextSweepValue(current, spec, dt)).toBeCloseTo(expected as number)
  })
})
