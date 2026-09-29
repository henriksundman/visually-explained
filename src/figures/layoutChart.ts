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
const PAD_T = 16
const PAD_B = 28

function fmtValue(v: number, unit?: string): string {
  const num = Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100)
  return unit ? `${num}${unit}` : num
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

  if (spec.kind === "bar") {
    const band = plotW / points.length
    const bw = band * 0.6
    points.forEach((p, i) => {
      const h = yAt(0) - yAt(p.value)
      const x = PAD_L + i * band + (band - bw) / 2
      const y = baseline - h
      elements.push({ kind: "bar", x, y, w: bw, h, valueLabel: fmtValue(p.value, spec.unit), id: `bar:${p.label}`, tip: p.tip })
      elements.push({ kind: "label", x: x + bw / 2, y: y - 6, text: fmtValue(p.value, spec.unit), anchor: "middle", emphasis: true })
      elements.push({ kind: "label", x: x + bw / 2, y: baseline + 16, text: p.label, anchor: "middle" })
    })
  } else {
    const n = points.length
    points.forEach((p, i) => {
      const x = xAt(i, n)
      const y = yAt(p.value)
      elements.push({ kind: "dot", x, y, id: `dot:${p.label}`, tip: p.tip })
      elements.push({ kind: "label", x, y: y - 8, text: fmtValue(p.value, spec.unit), anchor: "middle", emphasis: true })
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
