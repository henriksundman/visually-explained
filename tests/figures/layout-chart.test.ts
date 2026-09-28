import { describe, expect, it } from "vitest"
import { layoutChart, layoutSparkline } from "../../src/figures/layoutChart"

describe("layoutChart", () => {
  it("bars: tallest value gets the full plot height; labels carry the unit", () => {
    const { scene, warnings } = layoutChart({
      kind: "bar",
      points: [
        { label: "Mon", value: 120 },
        { label: "Tue", value: 240 },
      ],
      unit: "ms",
    })
    expect(warnings).toEqual([])
    const bars = scene.elements.filter(e => e.kind === "bar")
    expect(bars).toHaveLength(2)
    const a = bars[0] as { y: number; h: number }
    const b = bars[1] as { y: number; h: number }
    expect(b.h).toBeGreaterThan(a.h)
    expect(b.y).toBeLessThan(a.y)
    const texts = scene.elements.filter(e => e.kind === "label").map(e => (e as { text: string }).text)
    expect(texts).toContain("240ms")
    expect(texts).toContain("Tue")
  })

  it("line: one path through all points, dots at each point", () => {
    const { scene } = layoutChart({
      kind: "line",
      points: [
        { label: "a", value: 1 },
        { label: "b", value: 3 },
        { label: "c", value: 2 },
      ],
    })
    const line = scene.elements.find(e => e.kind === "line-path")!
    expect((line as { d: string }).d.startsWith("M ")).toBe(true)
    expect((line as { d: string }).d.split(" L ").length).toBe(3)
    expect(scene.elements.filter(e => e.kind === "dot")).toHaveLength(3)
  })

  it("clamps negative values to 0 with a warning", () => {
    const { scene, warnings } = layoutChart({
      kind: "bar",
      points: [{ label: "a", value: -5 }, { label: "b", value: 10 }],
    })
    expect(warnings.some(w => w.includes("figure-chart-value"))).toBe(true)
    const bars = scene.elements.filter(e => e.kind === "bar")
    expect((bars[0] as { h: number }).h).toBe(0)
  })

  it("is deterministic", () => {
    const spec = { kind: "bar" as const, points: [{ label: "a", value: 1 }] }
    expect(JSON.stringify(layoutChart(spec).scene)).toBe(JSON.stringify(layoutChart(spec).scene))
  })
})

describe("layoutSparkline", () => {
  it("classifies trend from first vs last", () => {
    expect(layoutSparkline([1, 2, 3]).trend).toBe("up")
    expect(layoutSparkline([3, 2, 1]).trend).toBe("down")
    expect(layoutSparkline([2, 2, 2]).trend).toBe("flat")
  })

  it("fits the series into the given box", () => {
    const { d } = layoutSparkline([0, 100], 84, 28)
    expect(d).toMatch(/^M [\d.]+ [\d.]+ L [\d.]+ [\d.]+$/)
  })
})
