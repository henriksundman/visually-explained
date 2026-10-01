import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { Explanation } from "../src/react/Explanation"
import { InteractiveFigure, nextSweepValue, valueColumnCh } from "../src/react/InteractiveFigure"
import { hitElement, placePopover, resolveTip } from "../src/react/figureEvents"
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

describe("resolveTip", () => {
  it("keeps non-empty tips within the cap", () => {
    expect(resolveTip("hello")).toBe("hello")
    expect(resolveTip("  spaced  ")).toBe("spaced")
    expect(resolveTip("x".repeat(200))).toBe("x".repeat(200))
  })
  it("nulls empty and over-long tips", () => {
    expect(resolveTip(null)).toBe(null)
    expect(resolveTip("")).toBe(null)
    expect(resolveTip("   ")).toBe(null)
    expect(resolveTip("x".repeat(201))).toBe(null)
  })
})

describe("hitElement", () => {
  const makeEl = (attrs: Record<string, string>): Element =>
    ({
      getAttribute: (k: string) => attrs[k] ?? null,
      closest: (sel: string) => (sel === ".exp-el" ? makeElEl : null),
    }) as unknown as Element
  const makeElEl: Element = makeEl({ "data-el-id": "pen", "data-tip": "The pen" })

  it("reads elId and tip off the hit element", () => {
    expect(hitElement(makeElEl)).toEqual({ elId: "pen", tip: "The pen", node: makeElEl })
  })

  it("returns null for chrome without identity", () => {
    const anon = ({
      getAttribute: () => null,
      closest: () => null,
    }) as unknown as Element
    expect(hitElement(anon)).toBe(null)
    expect(hitElement(null)).toBe(null)
  })
})

describe("placePopover", () => {
  const stage = { left: 0, top: 0, right: 400 }
  it("prefers above with a gap when there is headroom", () => {
    const anchor = { left: 100, top: 80, width: 20, height: 20, right: 120, bottom: 100 }
    const p = placePopover(anchor, stage)
    expect(p.placement).toBe("above")
    expect(p.top).toBe(72) // anchor.top - GAP(8)
  })
  it("flips below when clipped at the top", () => {
    const anchor = { left: 100, top: 10, width: 20, height: 20, right: 120, bottom: 30 }
    const p = placePopover(anchor, stage)
    expect(p.placement).toBe("below")
    expect(p.top).toBe(38) // anchor.bottom + GAP(8)
  })
  it("nudges horizontally to stay inside the stage", () => {
    const anchor = { left: 380, top: 80, width: 20, height: 20, right: 400, bottom: 100 }
    const p = placePopover(anchor, stage)
    expect(p.left).toBe(136) // stage.right - MAX_W(260) - 4
  })
  it("pins the left edge on stages narrower than the popover", () => {
    const anchor = { left: 50, top: 80, width: 20, height: 20, right: 70, bottom: 100 }
    const p = placePopover(anchor, { left: 0, top: 0, right: 200 })
    expect(p.left).toBe(4) // stage.left + 4 — never negative
  })
})

const tippedFigure = {
  type: "figure",
  title: "Orbit",
  elements: [
    { kind: "dot", cx: 100, cy: 80, r: 6, id: "pen", tip: "The pen dot" },
    { kind: "dot", cx: 10, cy: 10, r: 3 },
  ],
}

describe("element popover wiring (SSR)", () => {
  it("renders tip-bearing elements focusable and the popover closed", () => {
    const html = renderToStaticMarkup(<InteractiveFigure block={tippedFigure} />)
    expect(html).toContain(`tabindex="0"`)
    expect(html).toContain(`data-tip="The pen dot"`)
    expect(html).not.toContain(`exp-popover`) // closed initially — SSR-safe
  })

  it("static path wraps figure blocks in the delegated container when onElementEvent is set", () => {
    const withHandler = renderToStaticMarkup(
      <Explanation ir={{ version: 1, blocks: [tippedFigure] }} theme="none" onElementEvent={() => {}} />,
    )
    expect(withHandler).toContain(`exp-fig-events`)
    expect(withHandler).toContain(`data-el-id="pen"`)
    const without = renderToStaticMarkup(
      <Explanation ir={{ version: 1, blocks: [tippedFigure] }} theme="none" />,
    )
    expect(without).not.toContain(`exp-fig-events`) // RSC-safe default
  })

  it("static wrapper also covers diagram blocks", () => {
    const html = renderToStaticMarkup(
      <Explanation
        ir={{
          version: 1,
          blocks: [
            {
              type: "diagram",
              nodes: [{ id: "a", label: "A", tip: "Node A" }],
              edges: [],
            },
          ],
        }}
        theme="none"
        onElementEvent={() => {}}
      />,
    )
    expect(html).toContain(`exp-fig-events`)
    expect(html).toContain(`data-tip="Node A"`)
  })
})

describe("link smoke (react)", () => {
  it("renders links through the shared inline parser", () => {
    const html = renderToStaticMarkup(
      <Explanation ir={{ version: 1, blocks: [{ type: "text", body: "[x](https://e.com)" }] }} />,
    )
    expect(html).toContain(`<a href="https://e.com">x</a>`)
  })
})
