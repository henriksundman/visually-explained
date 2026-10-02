import type { Scene } from "./scene"

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
const VALUE_CHAR_W = 6.6 // per-char estimate at the 11px emphasis label size

/** Bare value text. The unit is emitted ONCE as its own label above the plot
 *  (spec §2.3) — appending it to every value overflowed the band, ran labels
 *  together, and clipped the last one at the scene edge. */
function fmtValue(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100)
}

/** Whether a value label fits the space its mark owns. Degrade rather than
 *  overlap: too wide ⇒ omit the label; the bar height, the unit row and the
 *  hover tip still carry the value. */
function valueLabelFits(text: string, slot: number): boolean {
  return text.length * VALUE_CHAR_W <= slot - BAND_TOLERANCE
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

  if (spec.kind === "bar") {
    const band = plotW / points.length
    const bw = band * 0.6
    points.forEach((p, i) => {
      const h = yAt(0) - yAt(p.value)
      const x = PAD_L + i * band + (band - bw) / 2
      const y = baseline - h
      const value = fmtValue(p.value)
      elements.push({ kind: "bar", x, y, w: bw, h, valueLabel: value, id: `bar:${p.label}`, tip: p.tip })
      if (valueLabelFits(value, band)) {
        elements.push({ kind: "label", x: x + bw / 2, y: y - 6, text: value, anchor: "middle", emphasis: true })
      }
      elements.push({ kind: "label", x: x + bw / 2, y: baseline + 16, text: p.label, anchor: "middle" })
    })
  } else {
    const n = points.length
    const seg = n === 1 ? plotW : plotW / (n - 1)
    points.forEach((p, i) => {
      const x = xAt(i, n)
      const y = yAt(p.value)
      const value = fmtValue(p.value)
      elements.push({ kind: "dot", x, y, id: `dot:${p.label}`, tip: p.tip })
      if (valueLabelFits(value, seg)) {
        elements.push({ kind: "label", x, y: y - 8, text: value, anchor: "middle", emphasis: true })
      }
      elements.push({ kind: "label", x, y: baseline + 16, text: p.label, anchor: "middle" })
    })
    const coords = points.map((p, i) => `${xAt(i, n)} ${yAt(p.value)}`)
    elements.push({ kind: "line-path", d: `M ${coords.join(" L ")}` })
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
