import { describe, expect, it } from "vitest"
import { layoutChart, layoutSparkline } from "../../src/figures/layoutChart"
import type { Scene } from "../../src/figures/scene"

describe("layoutChart", () => {
  it("bars: tallest value gets the full plot height; the unit is one plot-level label", () => {
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
    // The unit is printed once for the whole plot, never glued onto every
    // value (figure-label-overflow spec §2.3) — "240ms" overflowed the band.
    expect(texts).toContain("240")
    expect(texts).not.toContain("240ms")
    expect(texts.filter(t => t === "ms")).toHaveLength(1)
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

// 11px .exp-fig-label-emphasis class at weight 650: ~6.6px per character.
const VALUE_CHAR_W = 6.6
const valueTextW = (s: string) => Math.round(s.length * VALUE_CHAR_W)

const spectralIr = {
  kind: "bar" as const,
  unit: "relative intensity",
  points: [
    { label: "400nm", value: 1 },
    { label: "450nm", value: 0.62 },
    { label: "500nm", value: 0.41 },
    { label: "550nm", value: 0.28 },
    { label: "600nm", value: 0.2 },
    { label: "650nm", value: 0.14 },
    { label: "700nm", value: 0.11 },
  ],
}

describe("chart value label overflow", () => {
  const emphasis = (scene: Scene) =>
    scene.elements
      .filter(e => e.kind === "label" && e.emphasis)
      .map(e => e as { text: string; x: number; y: number })

  it("never glues the unit onto a value label", () => {
    const { scene } = layoutChart(spectralIr)
    for (const l of emphasis(scene)) expect(l.text).not.toContain("relative intensity")
  })

  it("prints the unit exactly once, on its own row above the plot", () => {
    const { scene } = layoutChart(spectralIr)
    const units = scene.elements.filter(
      e => e.kind === "label" && e.text === "relative intensity",
    ) as { y: number }[]
    expect(units).toHaveLength(1)
    // Clear of every value label's baseline, so a tall first bar cannot collide.
    for (const v of emphasis(scene)) expect(units[0].y).toBeLessThan(v.y - 6)
  })

  it("keeps every emitted value label inside its band", () => {
    const { scene } = layoutChart(spectralIr)
    const band = (scene.width - 34 - 12) / spectralIr.points.length
    for (const l of emphasis(scene)) {
      expect(valueTextW(l.text)).toBeLessThanOrEqual(band)
    }
  })

  it("keeps every value label inside the scene bounds", () => {
    const { scene } = layoutChart(spectralIr)
    for (const l of emphasis(scene)) {
      expect(l.x - valueTextW(l.text) / 2).toBeGreaterThanOrEqual(0)
      expect(l.x + valueTextW(l.text) / 2).toBeLessThanOrEqual(scene.width)
      expect(l.y).toBeGreaterThanOrEqual(0)
    }
  })

  it("omits a value label too wide for its band but keeps the bar", () => {
    const wide = Array.from({ length: 12 }, (_, i) => ({ label: `p${i}`, value: i === 0 ? 987654 : 1 }))
    const { scene } = layoutChart({ kind: "bar", points: wide })
    const texts = emphasis(scene).map(l => l.text)
    expect(texts).not.toContain("987654")
    expect(scene.elements.filter(e => e.kind === "bar")).toHaveLength(12)
  })
})
