import { describe, expect, it } from "vitest"
import {
  resolveDataset,
  applyDatasetFields,
  chartDatasetSchema,
  dataCalloutDatasetSchema,
  timelineDatasetSchema,
} from "../src/core/datasets"
import type { RenderContext } from "../src/core/registry"

let warnings: string[] = []
const ctx = (datasets?: Record<string, unknown>): RenderContext => ({
  depth: 1,
  sketch: false,
  datasets,
  addWarning: m => warnings.push(m),
  renderChildren: () => "",
})
const fresh = () => {
  warnings = []
  return warnings
}

describe("dataset schemas", () => {
  it("accept payloads shaped like the block's data fields", () => {
    expect(
      chartDatasetSchema.safeParse({ kind: "bar", points: [{ label: "Mon", value: 4 }] }).success,
    ).toBe(true)
    expect(
      dataCalloutDatasetSchema.safeParse({ metric: "12", label: "deploys", series: [1, 2, 3] }).success,
    ).toBe(true)
    expect(timelineDatasetSchema.safeParse({ events: [{ when: "2024", what: "launch" }] }).success).toBe(true)
  })
})

describe("resolveDataset", () => {
  it("returns validated data on a key hit", () => {
    const w = fresh()
    const r = resolveDataset(ctx({ k: { kind: "line", points: [{ label: "a", value: 1 }] } }), "chart", "c1", "k", chartDatasetSchema)
    expect(r).toEqual({ ok: true, data: { kind: "line", points: [{ label: "a", value: 1 }] } })
    expect(w).toEqual([])
  })

  it("warns with the block id on a key miss and on an invalid payload", () => {
    const w = fresh()
    expect(resolveDataset(ctx({}), "chart", "c1", "nope", chartDatasetSchema).ok).toBe(false)
    expect(w).toEqual([`[dataset] chart c1: no dataset named "nope"`])
    const w2 = fresh()
    expect(resolveDataset(ctx({ k: { kind: "pie" } }), "chart", "c1", "k", chartDatasetSchema).ok).toBe(false)
    expect(w2[0]).toMatch(/^\[dataset\] chart c1: invalid payload — /)
  })

  it("says the type when the block has no id", () => {
    const w = fresh()
    resolveDataset(ctx({}), "timeline", undefined, "nope", timelineDatasetSchema)
    expect(w).toEqual([`[dataset] timeline nope: no dataset named "nope"`])
  })
})

describe("applyDatasetFields", () => {
  it("overrides defined fields and keeps literals for omitted ones", () => {
    const block = { kind: "bar", unit: "ms", caption: "old", points: [{ label: "a", value: 1 }] }
    const merged = applyDatasetFields(block, { kind: "line", points: [{ label: "b", value: 2 }], unit: undefined })
    expect(merged).toEqual({ kind: "line", unit: "ms", caption: "old", points: [{ label: "b", value: 2 }] })
  })
})
