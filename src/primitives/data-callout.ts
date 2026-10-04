import { registerPrimitive, type RenderContext } from "../core/registry"
import { dataCalloutBlockSchema, type DataCalloutBlock } from "../core/schema"
import { resolveDataset, applyDatasetFields, dataCalloutDatasetSchema } from "../core/datasets"
import { escapeHtml, renderInline } from "../core/inline"
import { layoutSparkline } from "../figures/layoutChart"
import { sceneToSvg } from "../figures/svg"
import { hashSeed } from "../figures/seed"
import type { Scene } from "../figures/scene"

export function renderDataCallout(block: DataCalloutBlock, ctx: RenderContext): string {
  let b: DataCalloutBlock = block
  if (block.dataset) {
    const r = resolveDataset(ctx, "data-callout", block.id, block.dataset, dataCalloutDatasetSchema)
    if (r.ok) b = applyDatasetFields(block, r.data)
  }
  const spark = resolveSparkline(b)
  const sparkSvg = spark
    ? sceneToSvg(spark.scene, { ariaLabel: spark.aria, sketch: ctx.sketch, seed: spark.seed })
    : ""
  const delta = b.delta
    ? `<span class="exp-delta${b.trend ? ` exp-delta-${b.trend}` : ""}">${escapeHtml(b.delta)}</span>`
    : ""
  const context = b.context ? `<p class="exp-context">${renderInline(b.context, ctx)}</p>` : ""
  return (
    `<div class="exp-block exp-data-callout">` +
    `<span class="exp-metric">${escapeHtml(b.metric)}</span>` +
    `<span class="exp-metric-label">${renderInline(b.label, ctx)}</span>` +
    delta +
    (sparkSvg ? `<div class="exp-spark-box">${sparkSvg}</div>` : "") +
    context +
    `</div>`
  )
}

/** Figure form = the callout markup plus a trend sparkline. No usable series
 *  (or presentation "text") → null → text markup (spec §1 leniency). */
function resolveSparkline(block: DataCalloutBlock): { scene: Scene; aria: string; seed: string } | null {
  const wantsFigure = block.presentation !== "text"
  if (!wantsFigure) return null
  if (!block.series || block.series.length < 2) return null
  const { d, trend } = layoutSparkline(block.series)
  const scene: Scene = { width: 84, height: 28, elements: [{ kind: "sparkline", d, trend }] }
  const aria = `${block.metric} ${block.label} trend ${block.trend ?? "flat"}`
  return { scene, aria, seed: block.id ?? hashSeed(aria) }
}

registerPrimitive("data-callout", { schema: dataCalloutBlockSchema, render: renderDataCallout })
