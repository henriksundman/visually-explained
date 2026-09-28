import { describe, expect, it } from "vitest"
import { layoutFlow } from "../../src/figures/layoutFlow"
import type { NodeBoxEl, Scene } from "../../src/figures/scene"

function mustNode(scene: Scene, id: string): NodeBoxEl {
  const el = scene.elements.find((e): e is NodeBoxEl => e.kind === "node-box" && e.id === id)
  if (!el) throw new Error(`node "${id}" not found in scene`)
  return el
}

describe("layoutFlow", () => {
  it("layers lr: sources in column 0, targets in column 1", () => {
    const { scene, warnings } = layoutFlow({
      nodes: [
        { id: "a", label: "Start" },
        { id: "b", label: "Finish" },
      ],
      edges: [{ from: "a", to: "b", kind: "causes" }],
      direction: "lr",
    })
    expect(warnings).toEqual([])
    const a = mustNode(scene, "a")
    const b = mustNode(scene, "b")
    expect(a.x).toBeLessThan(b.x)
    expect(a.y).toBe(b.y)
    expect(scene.elements.some(e => e.kind === "arrow")).toBe(true)
  })

  it("flows top-to-bottom for tb direction (height exceeds width)", () => {
    const { scene } = layoutFlow({
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
        { id: "c", label: "C" },
      ],
      edges: [{ from: "a", to: "c" }, { from: "b", to: "c" }],
      direction: "tb",
    })
    const a = mustNode(scene, "a")
    const c = mustNode(scene, "c")
    expect(c.y).toBeGreaterThan(a.y)
    expect(scene.height).toBeGreaterThan(scene.width)
  })

  it("drops dangling edges with a warning and still renders nodes", () => {
    const { scene, warnings } = layoutFlow({
      nodes: [{ id: "a", label: "A" }],
      edges: [{ from: "a", to: "ghost" }],
    })
    expect(scene.elements.some(e => e.kind === "node-box")).toBe(true)
    expect(scene.elements.some(e => e.kind === "arrow")).toBe(false)
    expect(warnings.some(w => w.includes("figure-edge-dangling"))).toBe(true)
  })

  it("keeps the first duplicate node and warns", () => {
    const { scene, warnings } = layoutFlow({
      nodes: [
        { id: "a", label: "First" },
        { id: "a", label: "Second" },
      ],
      edges: [],
    })
    expect(scene.elements.filter(e => e.kind === "node-box")).toHaveLength(1)
    expect(warnings.some(w => w.includes("figure-node-duplicate"))).toBe(true)
  })

  it("drops self-edges with a warning", () => {
    const { warnings } = layoutFlow({
      nodes: [{ id: "a", label: "A" }],
      edges: [{ from: "a", to: "a" }],
    })
    expect(warnings.some(w => w.includes("figure-edge-self"))).toBe(true)
  })

  it("sizes boxes from label length (clamped)", () => {
    const { scene } = layoutFlow({
      nodes: [{ id: "tiny", label: "ab" }, { id: "huge", label: "x".repeat(80) }],
      edges: [],
    })
    const tiny = mustNode(scene, "tiny")
    const huge = mustNode(scene, "huge")
    expect(tiny.w).toBe(90) // min width
    // Wrapped: box fits its widest line, still clamped to [90, 260].
    expect(huge.lines!.length).toBeGreaterThan(1)
    const maxLine = Math.max(...huge.lines!.map(l => l.length))
    expect(huge.w).toBe(Math.min(260, Math.max(90, Math.round(maxLine * 7.5) + 24)))
    expect(huge.w).toBeLessThanOrEqual(260)
  })

  it("wraps long labels into lines that fit the box and grows the height", () => {
    const { scene } = layoutFlow({
      nodes: [{ id: "long", label: "More signups reach the aha moment before dropping off" }],
      edges: [],
    })
    const n = mustNode(scene, "long")
    expect(n.lines!.length).toBeGreaterThan(1)
    expect(n.h).toBeGreaterThan(44)
    const maxChars = Math.floor((n.w - 24) / 7.5)
    for (const line of n.lines!) {
      expect(line.length).toBeLessThanOrEqual(maxChars)
    }
  })

  it("paints arrows before nodes so boxes cover crossing lines", () => {
    const { scene } = layoutFlow({
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
        { id: "c", label: "C" },
      ],
      edges: [{ from: "a", to: "c" }],
      direction: "lr",
    })
    const kinds = scene.elements.map(e => e.kind)
    expect(kinds.indexOf("arrow")).toBeLessThan(kinds.indexOf("node-box"))
  })

  it("routes skip-rank edges orthogonally through the column gutter", () => {
    const { scene } = layoutFlow({
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
        { id: "c", label: "C" },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" }, // chain puts c in rank 2...
        { from: "a", to: "c" }, // ...so this edge skips rank 1 → orthogonal
      ],
      direction: "lr",
    })
    const arrows = scene.elements.filter(e => e.kind === "arrow") as { d: string }[]
    const cubic = arrows.find(e => e.d.includes(" C "))
    const orthogonal = arrows.find(e => e.d.includes(" L ") && !e.d.includes(" C "))
    expect(cubic).toBeDefined()
    expect(orthogonal).toBeDefined()
  })
})
