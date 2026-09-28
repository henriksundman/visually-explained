import { registerPrimitive, type RenderContext } from "../core/registry"
import { chartBlockSchema, type ChartBlock } from "../core/schema"
import { renderInline } from "../core/inline"
import { layoutChart, type ChartPoint } from "../figures/layoutChart"
import { sceneToSvg } from "../figures/svg"
import { hashSeed } from "../figures/seed"

/** Lenient per-point parsing (spec §1): a malformed point is dropped with a
 *  warning, not fatal. Mirrors how stack children are salvaged. */
function parsePoints(raw: unknown[], warnings: string[]): ChartPoint[] {
  const points: ChartPoint[] = []
  raw.forEach((p, i) => {
    const rec = typeof p === "object" && p !== null ? (p as Record<string, unknown>) : null
    const label = typeof rec?.label === "string" && rec.label.trim() !== "" ? rec.label : null
    const rawValue = rec?.value
    const value =
      typeof rawValue === "number" && Number.isFinite(rawValue)
        ? rawValue
        : typeof rawValue === "string" && /^-?\d+(\.\d+)?$/.test(rawValue)
          ? Number(rawValue)
          : null
    if (!label || value === null) {
      warnings.push(`figure-point-invalid: chart point ${i} dropped — needs a label and a numeric value`)
      return
    }
    points.push({ label, value })
  })
  return points
}

export function renderChart(block: ChartBlock, ctx: RenderContext): string {
  const warnings: string[] = []
  const points = parsePoints(block.points, warnings)
  for (const w of warnings) ctx.addWarning(w)
  if (points.length === 0) {
    return `<div class="exp-block exp-chart"><p class="exp-fig-empty">Chart data could not be read.</p></div>`
  }
  const { scene } = layoutChart({ kind: block.kind, points, unit: block.unit, caption: block.caption })
  const aria = block.caption ?? `Chart: ${points.map(p => p.label).join(" → ")}`
  const svg = sceneToSvg(scene, { ariaLabel: aria, sketch: ctx.sketch, seed: block.id ?? hashSeed(aria) })
  const caption = block.caption ? `<p class="exp-fig-caption">${renderInline(block.caption)}</p>` : ""
  return `<div class="exp-block exp-chart">${svg}${caption}</div>`
}

registerPrimitive("chart", { schema: chartBlockSchema, render: renderChart })
