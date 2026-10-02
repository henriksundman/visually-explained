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

// 11px .exp-edge-label class: ~6.0px per character.
const EDGE_CHAR_W = 6.0
const edgeTextW = (s: string) => Math.round(s.length * EDGE_CHAR_W)

const overflowIr = {
  direction: "lr" as const,
  nodes: [
    { id: "sun", label: "Sun", shape: "round" as const },
    { id: "air", label: "Atmosphere", shape: "box" as const },
    { id: "eye", label: "Your eye", shape: "pill" as const },
  ],
  edges: [
    { from: "sun", to: "air", label: "slant path — up to 38× the vertical", kind: "leads" as const },
    { from: "air", to: "eye", label: "back-scattered light, blue mostly gone", kind: "leads" as const },
  ],
}

function mustArrow(scene: Scene, id: string): Extract<Scene["elements"][number], { kind: "arrow" }> {
  const el = scene.elements.find(e => e.kind === "arrow" && e.id === id)
  if (!el || el.kind !== "arrow") throw new Error(`arrow "${id}" not found`)
  return el
}

describe("edge label overflow", () => {
  it("wraps every edge label line to the gutter between the nodes", () => {
    const { scene, warnings } = layoutFlow(overflowIr)
    expect(warnings).toEqual([])
    const nodes = overflowIr.nodes.map(n => mustNode(scene, n.id))
    const gutter = nodes[1].x - (nodes[0].x + nodes[0].w)

    const arrow = mustArrow(scene, "sun->air")
    const lines = arrow.lines ?? [arrow.label!]
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) {
      expect(edgeTextW(line)).toBeLessThanOrEqual(gutter)
    }
  })

  it("keeps a wrapped label clear of every node box", () => {
    const { scene } = layoutFlow(overflowIr)
    for (const id of ["sun->air", "air->eye"]) {
      const arrow = mustArrow(scene, id)
      const lines = arrow.lines ?? [arrow.label!]
      const half = Math.max(...lines.map(edgeTextW)) / 2
      const left = arrow.labelX! - half
      const right = arrow.labelX! + half
      for (const el of scene.elements) {
        if (el.kind !== "node-box") continue
        // The label lives BETWEEN two nodes — right of one, left of the other.
        // The invariant is that the two intervals never intersect.
        const overlaps = right > el.x && left < el.x + el.w
        expect(`${id} vs ${el.id}: ${overlaps ? "OVERLAPS" : "clear"}`).toBe(`${id} vs ${el.id}: clear`)
      }
    }
  })

  it("hard-splits a single word too wide even for a label-aware gutter", () => {
    // The gutter widens to fit a label, but is capped at MAX_LABEL_GUTTER, so
    // a word longer than the cap must still be split rather than overflow.
    const word = "extraordinarilylongwordindeed"
    const { scene } = layoutFlow({
      nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
      edges: [{ from: "a", to: "b", label: word }],
      direction: "lr",
    })
    const arrow = mustArrow(scene, "a->b")
    const lines = arrow.lines ?? [arrow.label!]
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.join("")).toBe(word)
    const gutter = mustNode(scene, "b").x - (mustNode(scene, "a").x + mustNode(scene, "a").w)
    for (const line of lines) expect(edgeTextW(line)).toBeLessThanOrEqual(gutter)
  })

  it("widens the gutter for a long label, capped, and keeps short labels compact", () => {
    const shortGutter = () => {
      const { scene } = layoutFlow({
        nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
        edges: [{ from: "a", to: "b", label: "hit" }],
        direction: "lr",
      })
      const ns = scene.elements.filter(e => e.kind === "node-box") as { x: number; w: number }[]
      return ns[1].x - (ns[0].x + ns[0].w)
    }
    // Unchanged default: a short label leaves the gutter at its 64px minimum.
    expect(shortGutter()).toBe(64)

    const { scene } = layoutFlow(overflowIr)
    const ns = scene.elements.filter(e => e.kind === "node-box") as { x: number; w: number }[]
    const gutter = ns[1].x - (ns[0].x + ns[0].w)
    expect(gutter).toBeGreaterThan(64)
    expect(gutter).toBeLessThanOrEqual(140) // the cap
  })

  it("wraps a tb label on word boundaries, not shredded fragments", () => {
    // A cross-axis span would chop this into three-character chunks; tb labels
    // are horizontal text, so their bound is the column width.
    const { scene } = layoutFlow({
      direction: "tb",
      nodes: [{ id: "a", label: "Deploy" }, { id: "b", label: "Latency" }],
      edges: [{ from: "a", to: "b", label: "the deploy causes the latency spike" }],
    })
    const arrow = mustArrow(scene, "a->b")
    const lines = arrow.lines ?? [arrow.label!]
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) {
      expect(line.length).toBeGreaterThan(3)
      expect("the deploy causes the latency spike").toContain(line)
    }
  })

  it("leaves a short label single-line, with no lines field (byte-identical emit)", () => {
    const { scene } = layoutFlow({
      nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
      edges: [{ from: "a", to: "b", label: "hit" }],
      direction: "lr",
    })
    const arrow = mustArrow(scene, "a->b")
    expect(arrow.lines).toBeUndefined()
    expect(arrow.label).toBe("hit")
  })

  it("grows the scene so a tall wrapped label is not clipped", () => {
    const { scene } = layoutFlow(overflowIr)
    let checked = 0
    for (const el of scene.elements) {
      if (el.kind !== "arrow") continue
      const lines = el.lines ?? (el.label ? [el.label] : [])
      if (lines.length < 2) continue
      checked++
      const blockH = ((lines.length - 1) * 15) / 2
      expect(el.labelY! + blockH).toBeLessThanOrEqual(scene.height)
      expect(el.labelY! - blockH).toBeGreaterThanOrEqual(0)
    }
    // Guards the guard: without this the loop can pass by never running.
    expect(checked).toBeGreaterThan(0)
  })
})
