import { z } from "zod"
import type { RenderContext } from "./registry"
import { chartBlockSchema, dataCalloutBlockSchema, timelineBlockSchema } from "./schema"

/** Dataset payloads are shaped like their block's DATA fields only (no id,
 *  type, or dataset). Field definitions are reused from the block schemas so
 *  constraints cannot drift (spec §3). */
export const chartDatasetSchema = z.object({
  kind: chartBlockSchema.shape.kind,
  points: chartBlockSchema.shape.points,
  unit: chartBlockSchema.shape.unit,
  caption: chartBlockSchema.shape.caption,
})

export const dataCalloutDatasetSchema = z.object({
  metric: dataCalloutBlockSchema.shape.metric,
  label: dataCalloutBlockSchema.shape.label,
  delta: dataCalloutBlockSchema.shape.delta,
  trend: dataCalloutBlockSchema.shape.trend,
  series: dataCalloutBlockSchema.shape.series,
  context: dataCalloutBlockSchema.shape.context,
})

export const timelineDatasetSchema = z.object({
  events: timelineBlockSchema.shape.events,
})

export type DatasetResolution<T> = { ok: true; data: T } | { ok: false }

/** Look up a block's dataset, validate it against the type's dataset schema,
 *  and emit a lenient warning on miss/invalid (never a throw — block-level
 *  salvage, even under strict). Own-property guard: a host record must not
 *  resolve "constructor"/"__proto__" to inherited values. */
export function resolveDataset<T>(
  ctx: RenderContext,
  type: string,
  id: string | undefined,
  key: string,
  schema: z.ZodType<T>,
): DatasetResolution<T> {
  const label = id ?? key
  const datasets = ctx.datasets
  if (!datasets || !Object.hasOwn(datasets, key)) {
    ctx.addWarning(`[dataset] ${type} ${label}: no dataset named "${key}"`)
    return { ok: false }
  }
  const parsed = schema.safeParse(datasets[key])
  if (!parsed.success) {
    const issues = parsed.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")
    ctx.addWarning(`[dataset] ${type} ${label}: invalid payload — ${issues}`)
    return { ok: false }
  }
  return { ok: true, data: parsed.data }
}

/** Field-by-field override: the dataset's DEFINED fields win; fields it
 *  omits keep the block's literal values (spec §2.4). */
export function applyDatasetFields<T extends object>(block: T, data: Record<string, unknown>): T {
  const defined = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined))
  return { ...block, ...defined } as T
}
