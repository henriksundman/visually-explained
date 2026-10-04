import { describe, expect, it } from "vitest"
import { mindMapBlockSchema, MIND_MAP_SCHEMA_DEPTH, MIND_MAP_MAX_CHILDREN } from "../src/core/schema"
import { renderExplanation } from "../src/core/render"

/** A tree of exactly `depth` nodes in a chain: L0 -> L1 -> ... -> L{depth-1}. */
function nest(depth: number): { label: string; children?: unknown[] } {
  let node: { label: string; children?: unknown[] } = { label: `L${depth - 1}` }
  for (let i = depth - 2; i >= 0; i--) node = { label: `L${i}`, children: [node] }
  return node
}

function block(root: unknown): Record<string, unknown> {
  return { type: "mind-map", root }
}

describe("mind-map schema — valid shapes", () => {
  it("accepts a leaf", () => {
    expect(mindMapBlockSchema.safeParse(block({ label: "Alone" })).success).toBe(true)
  })

  it("accepts a nested tree", () => {
    const r = mindMapBlockSchema.safeParse(
      block({
        label: "Cache",
        children: [
          { label: "Browser cache" },
          { label: "Shared cache", children: [{ label: "In-memory" }, { label: "On-disk" }] },
        ],
      }),
    )
    expect(r.success).toBe(true)
  })

  it("accepts presentation and id", () => {
    for (const presentation of ["auto", "text", "figure"] as const) {
      expect(mindMapBlockSchema.safeParse({ ...block({ label: "a" }), id: "m1", presentation }).success).toBe(true)
    }
  })

  it("accepts a tree exactly at the guard depth", () => {
    // The boundary is stated as a node count, not a level count, so it does
    // not depend on whether the root is called level 0 or level 1.
    expect(mindMapBlockSchema.safeParse(block(nest(MIND_MAP_SCHEMA_DEPTH))).success).toBe(true)
  })

  it("accepts the maximum sibling count", () => {
    const kids = Array.from({ length: MIND_MAP_MAX_CHILDREN }, (_, i) => ({ label: `c${i}` }))
    expect(mindMapBlockSchema.safeParse(block({ label: "r", children: kids })).success).toBe(true)
  })
})

describe("mind-map schema — invalid shapes", () => {
  it("rejects an empty children array rather than treating it as a leaf", () => {
    expect(mindMapBlockSchema.safeParse(block({ label: "a", children: [] })).success).toBe(false)
  })

  it("rejects an empty label", () => {
    expect(mindMapBlockSchema.safeParse(block({ label: "" })).success).toBe(false)
  })

  it("rejects a non-string label", () => {
    expect(mindMapBlockSchema.safeParse(block({ label: 42 })).success).toBe(false)
  })

  it("rejects a missing root", () => {
    expect(mindMapBlockSchema.safeParse({ type: "mind-map" }).success).toBe(false)
  })

  it("rejects more than MIND_MAP_MAX_CHILDREN siblings", () => {
    const kids = Array.from({ length: MIND_MAP_MAX_CHILDREN + 1 }, (_, i) => ({ label: `c${i}` }))
    expect(mindMapBlockSchema.safeParse(block({ label: "r", children: kids })).success).toBe(false)
  })

  it("rejects a tree one level past the guard", () => {
    expect(mindMapBlockSchema.safeParse(block(nest(MIND_MAP_SCHEMA_DEPTH + 1))).success).toBe(false)
  })

  it("rejects a tree well past the guard", () => {
    expect(mindMapBlockSchema.safeParse(block(nest(MIND_MAP_SCHEMA_DEPTH + 5))).success).toBe(false)
  })
})

describe("mind-map schema — the crash guard", () => {
  // The regression test for spec §4.3. A recursive z.lazy() schema throws
  // RangeError on a deep tree and safeParse does NOT catch it, so the
  // exception escapes salvage.ts (which calls safeParse with no try/catch)
  // and takes the whole render pass with it. Same failure shape as the Temml
  // TypeError fixed on 2026-10-04: a degrade-only boundary whose error
  // assumption was narrower than reality.
  it("returns a validation result for a 20,000-deep tree instead of throwing", () => {
    let result: { success: boolean } | null = null
    expect(() => {
      result = mindMapBlockSchema.safeParse(block(nest(20000)))
    }).not.toThrow()
    expect(result!.success).toBe(false)
  })

  it("returns a validation result, not a throw, at several absurd depths", () => {
    for (const depth of [500, 5000, 50000]) {
      let result: { success: boolean } | null = null
      expect(() => {
        result = mindMapBlockSchema.safeParse(block(nest(depth)))
      }, `depth ${depth} threw`).not.toThrow()
      expect(result!.success, `depth ${depth} parsed`).toBe(false)
    }
  })

  it("rejects the deep tree through the real salvage path, not just the schema", () => {
    // The schema is not the only door: the block goes through salvage first,
    // and a throw there would escape renderExplanation entirely.
    // render.ts imports ./registerAll itself, so importing render is enough
    // to have the mind-map primitive registered by the time this runs.
    const html = renderExplanation({
      version: 1,
      blocks: [{ type: "mind-map", root: nest(20000) }],
    } as never)
    expect(typeof html.html).toBe("string")
  })
})
