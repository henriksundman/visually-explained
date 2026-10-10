import type { Scene } from "./scene"
import { estimateEdgeTextWidth } from "./layoutFlow"

export interface ChartPoint {
  label: string
  value: number
  tip?: string
}

export interface ChartSpec {
  kind: "bar" | "line"
  points: ChartPoint[]
  unit?: string
  caption?: string
}

export interface ChartLayoutResult {
  scene: Scene
  warnings: string[]
}

const W = 460
const H = 220
const PAD_L = 34
const PAD_R = 12
const PAD_T = 40 // room for the unit row plus the tallest mark's value label
const PAD_B = 28
const UNIT_LABEL_Y = 12
const BAND_TOLERANCE = 4

/** Chart labels share the 11px label CSS the flow layout's edge labels render
 *  at, so width estimating reuses its MEASURED per-character table rather than
 *  a flat per-char guess. The flat guesses (6.6/5.7) under-measured by ~21% —
 *  the run-5 clamp judged "2020" 23px wide when it renders 31.8px, which is
 *  why the clamped "31000000" and "2020" still hung 6px past the right edge
 *  (housing-v2 probe, 2026-10-10). Duplicated width arithmetic is how the tb
 *  nudge went blind; one table everywhere is the same lesson applied to
 *  charts. */
const labelWidth = estimateEdgeTextWidth

/** A centered label's anchor may not sit closer than half its own measured
 *  width to the scene edge: clamping keeps the GLYPHS inside the canvas (the
 *  housing "Population Growth" chart printed "31000…" and "2020" half-past the
 *  right edge). */
function clampedCenterX(x: number, text: string, gap: number): number {
  const half = labelWidth(text) / 2
  return Math.min(Math.max(x, half + gap), W - half - gap)
}

/** Bare value text. The unit is emitted ONCE as its own label above the plot
 *  (spec §2.3) — appending it to every value overflowed the band, ran labels
 *  together, and clipped the last one at the scene edge. */
function fmtValue(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100)
}

/** Whether label i may print given its NEIGHBOURS: two adjacent centered
 *  value labels must not overlap (the housing run-5 12-quarter chart let
 *  every label through its own-slot check and stacked 11 overlapping pairs of
 *  ~53px labels in a 460px plot). Both halves together must fit the spacing
 *  between the two marks; symmetric so the chain degrades evenly — a too-wide
 *  pair omits BOTH, rather than printing one that necessarily collides with
 *  whichever neighbour prints. */
function pairFits(values: string[], i: number, slot: number): boolean {
  const tol = BAND_TOLERANCE / 2
  const half = (j: number) => labelWidth(values[j]!) / 2
  const prevOk = i === 0 || half(i - 1) + half(i) <= slot - tol
  const nextOk = i === values.length - 1 || half(i) + half(i + 1) <= slot - tol
  return prevOk && nextOk
}

/** Which points get a tick label. Greedy left-to-right keeps a sparse,
 *  ever-thinning subset — 2020 Q1, 2020 Q3, 2021 Q1 — whose rhythm the reader
 *  cannot Morse-decode from the axis alone. The x-axis convention is a stride
 *  grid: evenly spaced ticks. So: pick the SMALLEST stride (1, 2, 3, …) whose
 *  grid fits pairwise at measured widths, always ≥2 ticks; if no stride fits
 *  at all, fall back to the two bookends alone. Bookends are PINNED: the first
 *  and last point define the axis, so their labels always print — if the last
 *  bookend crowds its stride neighbour, the NEIGHBOUR drops (the neighbour is
 *  interior; the bookend is the anchor). */
function planTickRow(labels: string[], centers: number[]): boolean[] {
  const n = labels.length
  if (n <= 2) return labels.map(() => true)
  const fitsPair = (a: number, b: number) => {
    const tol = BAND_TOLERANCE / 2
    return centers[b]! - centers[a]! >= labelWidth(labels[a]!) / 2 + labelWidth(labels[b]!) / 2 + tol
  }
  for (let stride = 1; stride < n; stride++) {
    // Guard: any interior pair of consecutive KEPT indices must fit. With the
    // bookends pinned, the last stride-grid tick is the one that must yield.
    const keep = new Array<boolean>(n).fill(false)
    for (let i = 0; i < n; i += stride) keep[i] = true
    keep[n - 1] = true
    let ok = true
    let prev = -1
    for (let i = 0; i < n; i++) {
      if (!keep[i]) continue
      if (prev >= 0 && !fitsPair(prev, i)) {
        // The crowded label is whichever is INTERIOR: index n-1 is pinned, so
        // drop the earlier one only when it is not index 0 — and if it IS
        // index 0, the pair cannot be fixed by dropping (bookends pinned), so
        // the stride fails.
        if (prev === 0 && i === n - 1) {
          ok = false
        } else if (i === n - 1) {
          keep[prev] = false // interior stride tick yields to the bookend
          const before = prev - stride
          if (before >= 0 && !fitsPair(before, i)) ok = false
          else prev = i
        } else {
          ok = false
        }
      } else {
        if (prev >= 0) {
          // normal advance
        }
        prev = i
      }
    }
    if (ok) return keep
  }
  return labels.map((_, i) => i === 0 || i === n - 1)
}

/** Emit the tick row from a plan: the clamp runs first (early clamps pull
 *  LEFT, into the accepted gap — the housing-v2 probe showed the raw-center
 *  decision accepting a gap the emitted geometry then violated). */
function emitTickRow(
  plan: boolean[],
  labels: string[],
  centers: number[],
  baseline: number,
  into: Scene["elements"],
): void {
  let lastRight = -Infinity
  for (let i = 0; i < labels.length; i++) {
    if (!plan[i]) continue
    const center = clampedCenterX(centers[i]!, labels[i]!, 2)
    const half = labelWidth(labels[i]!) / 2
    if (lastRight > -Infinity && center - half < lastRight + BAND_TOLERANCE / 2) continue
    lastRight = center + half
    into.push({
      kind: "label",
      x: center,
      y: baseline + 16,
      text: labels[i]!,
      anchor: "middle",
    })
  }
}

export function layoutChart(spec: ChartSpec): ChartLayoutResult {
  const warnings: string[] = []
  const points = spec.points.map(p => {
    if (p.value < 0) {
      warnings.push(`figure-chart-value: negative value for "${p.label}" clamped to 0`)
      return { label: p.label, value: 0 }
    }
    return p
  })

  const plotW = W - PAD_L - PAD_R
  const plotH = H - PAD_T - PAD_B
  const baseline = PAD_T + plotH
  const max = Math.max(1, ...points.map(p => p.value))

  const elements: Scene["elements"] = [{ kind: "axis", x1: PAD_L, y1: baseline, x2: W - PAD_R, y2: baseline }]
  const xAt = (i: number, n: number) => (n === 1 ? PAD_L + plotW / 2 : PAD_L + (i * plotW) / (n - 1))
  const yAt = (v: number) => baseline - (v / max) * plotH

  // The unit, once, on a row of its own above the plot. Its own row is what
  // keeps it clear of the tallest mark's value label whatever the data does.
  if (spec.unit) {
    elements.push({ kind: "label", x: PAD_L, y: UNIT_LABEL_Y, text: spec.unit, anchor: "start" })
  }

  const labels = points.map(p => p.label)

  if (spec.kind === "bar") {
    const band = plotW / points.length
    const bw = band * 0.6
    // Bar ticks center on the BAR (band centers), not on xAt's point pitch —
    // plotW/n ≠ plotW/(n−1).
    const centers = points.map((_, i) => PAD_L + i * band + band / 2)
    const values = points.map(p => fmtValue(p.value))
    points.forEach((p, i) => {
      const h = yAt(0) - yAt(p.value)
      const x = PAD_L + i * band + (band - bw) / 2
      const y = baseline - h
      const value = values[i]!
      elements.push({ kind: "bar", x, y, w: bw, h, valueLabel: value, id: `bar:${p.label}`, tip: p.tip })
      // A label prints only when it fits its OWN band and cannot collide with
      // the label beside it (pairFits): the 12-quarter class.
      if (labelWidth(value) <= band - BAND_TOLERANCE && pairFits(values, i, band)) {
        elements.push({
          kind: "label",
          x: clampedCenterX(x + bw / 2, value, 2),
          y: y - 6,
          text: value,
          anchor: "middle",
          emphasis: true,
        })
      }
    })
    emitTickRow(planTickRow(labels, centers), labels, centers, baseline, elements)
  } else {
    const n = points.length
    const seg = n === 1 ? plotW : plotW / (n - 1)
    const centers = points.map((_, i) => xAt(i, n))
    const values = points.map(p => fmtValue(p.value))
    points.forEach((p, i) => {
      const x = xAt(i, n)
      const y = yAt(p.value)
      const value = values[i]!
      elements.push({ kind: "dot", x, y, id: `dot:${p.label}`, tip: p.tip })
      if (labelWidth(value) <= seg - BAND_TOLERANCE && pairFits(values, i, seg)) {
        elements.push({
          kind: "label",
          x: clampedCenterX(x, value, 2),
          y: y - 8,
          text: value,
          anchor: "middle",
          emphasis: true,
        })
      }
    })
    const coords = points.map((p, i) => `${xAt(i, n)} ${yAt(p.value)}`)
    elements.push({ kind: "line-path", d: `M ${coords.join(" L ")}` })
    emitTickRow(planTickRow(labels, centers), labels, centers, baseline, elements)
  }

  return { scene: { width: W, height: H, elements }, warnings }
}

export function layoutSparkline(
  series: number[],
  w = 84,
  h = 28,
): { d: string; trend: "up" | "down" | "flat" } {
  const pad = 2
  const min = Math.min(...series)
  const max = Math.max(...series)
  const span = max - min || 1
  const step = series.length > 1 ? (w - pad * 2) / (series.length - 1) : 0
  const coords = series.map((v, i) => {
    const x = pad + i * step
    const y = pad + (1 - (v - min) / span) * (h - pad * 2)
    return `${Math.round(x * 100) / 100} ${Math.round(y * 100) / 100}`
  })
  const delta = series[series.length - 1] - series[0]
  const trend = delta > 1e-9 ? "up" : delta < -1e-9 ? "down" : "flat"

  return { d: `M ${coords.join(" L ")}`, trend }
}
