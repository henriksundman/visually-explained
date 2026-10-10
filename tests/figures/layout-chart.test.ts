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

  // The housing run-5 "Population Growth" chart: the LAST tick and value
  // printed centered on the last point but half their width past the scene's
  // right edge — "31000..." and "2020" visually cut mid-glyph. A centered
  // label's box is x ± w/2, and the plot's right margin (PAD_R 12) is smaller
  // than half a wide label, so the last point needs explicit containment.
  it("keeps the last point's value and x-label inside the scene bounds", () => {
    const housing = {
      kind: "line" as const,
      points: [
        { label: "2000", value: 25000000 },
        { label: "2005", value: 26500000 },
        { label: "2010", value: 28000000 },
        { label: "2015", value: 29500000 },
        { label: "2020", value: 31000000 },
      ],
      unit: "People",
    }
    const { scene } = layoutChart(housing)
    // Every emitted element (value label + tick) must fit the canvas.
    const widthOf = (s: string) => valueTextW(s)
    for (const l of scene.elements.filter(e => e.kind === "label") as { text: string; x: number; anchor: string }[]) {
      const half = widthOf(l.text) / 2
      expect(l.x - half, `label "${l.text}" left edge`).toBeGreaterThanOrEqual(0)
      expect(l.x + half, `label "${l.text}" right edge`).toBeLessThanOrEqual(scene.width)
    }
    // ...the last tick specifically (the reported clip)...
    const lastTick = scene.elements.find(
      e => e.kind === "label" && (e as { text: string }).text === "2020",
    ) as { x: number }
    expect(lastTick, "2020 tick exists").toBeDefined()
    expect(lastTick.x + widthOf("2020") / 2).toBeLessThanOrEqual(scene.width)
    // ...and the last value label too.
    const lastValue = emphasis(scene).at(-1) as { x: number; text: string }
    expect(lastValue.text).toBe("31000000")
    expect(lastValue.x + valueTextW(lastValue.text) / 2).toBeLessThanOrEqual(scene.width)
  })

  // The housing-v2 probe (2026-10-10): the run-5 clamp fixed the ANCHOR but
  // not the GLYPHS, because TICK_CHAR_W (5.7) under-measured the 11px label
  // CSS — "2020" renders 31.8px (7.95/char), so the clamped "31000000" still
  // ended 6px past the 460 edge. The estimate must sit at the measured
  // per-char width or every downstream clamp inherits the same error.
  it("keeps the last value's GLYPHS inside the edge at the measured char width", () => {
    const housing = {
      kind: "line" as const,
      points: [
        { label: "2000", value: 25000000 },
        { label: "2005", value: 26500000 },
        { label: "2010", value: 28000000 },
        { label: "2015", value: 29500000 },
        { label: "2020", value: 31000000 },
      ],
      unit: "People",
    }
    const { scene } = layoutChart(housing)
    // Measured probe boxes: value 8.4/char (67.2/8), tick 7.95/char (31.8/4).
    // Assert with the LOOSER of the two so a small estimate drift can't
    // silently re-open the clip the probe caught.
    for (const l of scene.elements.filter(e => e.kind === "label") as { text: string; x: number }[]) {
      const half = (l.text.length * 8.4) / 2
      expect(l.x + half, `label "${l.text}" right glyph edge at 8.4px/char`).toBeLessThanOrEqual(
        scene.width + 1,
      )
    }
  })

  // The housing run-5 12-quarter chart: 12 one-line value labels in 460px of
  // plot, each ~53px wide in a 36px band — 11 label-label overlaps measured.
  // valueLabelFits only compared a label to its OWN slot, so the NEIGHBOR'S
  // overhang into that slot went unseen. The rule must be: label i's box may
  // not overlap label i+1's box.
  it("never lets adjacent value labels overlap (the 12-quarter chart)", () => {
    const quarters = Array.from({ length: 12 }, (_, q) => ({
      label: `202${Math.floor(q / 4)} Q${(q % 4) + 1}`,
      value: [400, 550, 700, 800, 950, 1100, 1000, 850, 750, 700, 650, 600][q],
    }))
    const { scene } = layoutChart({ kind: "line", points: quarters, caption: "lumber" })
    const values = emphasis(scene) as { x: number; text: string }[]
    expect(values.length).toBeGreaterThan(0)
    for (let i = 0; i < values.length - 1; i++) {
      const a = values[i]
      const b = values[i + 1]
      const overlap = valueTextW(a.text) / 2 + valueTextW(b.text) / 2 - Math.abs(b.x - a.x)
      expect(overlap, `adjacent value labels ${a.text} and ${b.text} overlap by ${overlap}px`).toBeLessThanOrEqual(0)
    }
  })

  // The housing-v2 probe caught the SAME defect on the x-tick row: the 12
  // "2020 Q1"…"2022 Q4" ticks carried no fit check at all (the clamp only
  // repositions), so 11 tick-tick pairs overlapped at a ~36px pitch. The fix
  // is greedy thinning — the first tick always prints, a later tick prints
  // only when it clears the last printed one — so the row degrades to a
  // sparse subset instead of a solid block of overlapping text.
  it("thins overlapping x-tick labels instead of letting them overlap (the 12-quarter chart)", () => {
    const quarters = Array.from({ length: 12 }, (_, q) => ({
      label: `202${Math.floor(q / 4)} Q${(q % 4) + 1}`,
      value: [400, 550, 700, 800, 950, 1100, 1000, 850, 750, 700, 650, 600][q],
    }))
    for (const kind of ["bar", "line"] as const) {
      const { scene } = layoutChart({ kind, points: quarters })
      const ticks = (scene.elements.filter(e => e.kind === "label") as { x: number; text: string }[]).filter(
        t => /^\d{4} Q\d$/.test(t.text),
      )
      expect(ticks, "first tick always prints").toContainEqual(expect.objectContaining({ text: "2020 Q1" }))
      expect(ticks.length, "thin but don't gut the row").toBeGreaterThanOrEqual(3)
      const sorted = [...ticks].sort((a, b) => a.x - b.x)
      for (let i = 0; i < sorted.length - 1; i++) {
        const overlap =
          (sorted[i]!.text.length * 7.9) / 2 + (sorted[i + 1]!.text.length * 7.9) / 2 - (sorted[i + 1]!.x - sorted[i]!.x)
        expect(
          overlap,
          `adjacent tick labels ${sorted[i]!.text} and ${sorted[i + 1]!.text} overlap by ${overlap}px`,
        ).toBeLessThanOrEqual(0)
      }
    }
  })
})
