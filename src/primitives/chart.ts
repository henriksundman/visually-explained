import { registerPrimitive, type RenderContext } from "../core/registry"
import { chartBlockSchema, type ChartBlock } from "../core/schema"
import { resolveDataset, applyDatasetFields, chartDatasetSchema } from "../core/datasets"
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
    let tip: string | undefined
    if (rec?.tip !== undefined) {
      if (typeof rec.tip === "string" && rec.tip.trim() !== "" && rec.tip.length <= 200) {
        tip = rec.tip
      } else {
        warnings.push(`figure-tip-too-long: chart point ${i} tip dropped — must be 1-200 characters`)
      }
    }
    points.push({ label, value, tip })
  })
  return points
}

export function renderChart(block: ChartBlock, ctx: RenderContext): string {
  const warnings: string[] = []
  let b: ChartBlock = block
  if (block.dataset) {
    const r = resolveDataset(ctx, "chart", block.id, block.dataset, chartDatasetSchema)
    if (r.ok) b = applyDatasetFields(block, r.data)
  }
  const points = parsePoints(b.points, warnings)
  for (const w of warnings) ctx.addWarning(w)
  if (points.length === 0) {
    return `<div class="exp-block exp-chart"><p class="exp-fig-empty">Chart data could not be read.</p></div>`
  }
  const { scene } = layoutChart({ kind: b.kind, points, unit: b.unit, caption: b.caption })
  const aria = b.caption ?? `Chart: ${points.map(p => p.label).join(" → ")}`
  const svg = sceneToSvg(scene, { ariaLabel: aria, sketch: ctx.sketch, seed: b.id ?? hashSeed(aria) })
  const caption = b.caption ? `<p class="exp-fig-caption">${renderInline(b.caption)}</p>` : ""
  return `<div class="exp-block exp-chart">${svg}${caption}</div>`
}

registerPrimitive("chart", { schema: chartBlockSchema, render: renderChart })
