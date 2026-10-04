import { describe, expect, it } from "vitest"
import { layoutFlow } from "../../src/figures/layoutFlow"
import * as demoExamples from "../../demo/examples"
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

// ---------------------------------------------------------------------------
// Cycles, back-edge return paths, and the endpoint-alignment invariant.
//
// These cover the 2026-10-04 flow-cycle fix: a diagram containing a feedback
// loop used to explode its layer count, which widened the scene until the
// emit layer scaled it to half size, gave one edge a NEGATIVE gutter (so its
// label wrapped to two characters per line), and — because that shredded
// label hung above the origin — triggered a scene clamp that moved node boxes
// without moving the already-serialized edge paths, leaving every arrow
// floating above its node's centre.
// ---------------------------------------------------------------------------

/** First coordinate pair of an arrow's path. */
function pathStart(d: string): { x: number; y: number } {
  const n = d.match(/-?[\d.]+/g)!.map(Number)
  return { x: n[0], y: n[1] }
}


/** Sample a path made of M/L/C segments and return every point it passes
 *  through. Used to check where a curve ACTUALLY reaches — a control point
 *  sits outside the drawn curve (see the 3/4 rule in layoutFlow), so raw
 *  control coordinates are not a valid bound. */
function samplePath(d: string, steps = 64): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = []
  const tokens = d.match(/[MLC][^MLC]*/g) ?? []
  let cur = { x: 0, y: 0 }
  for (const tok of tokens) {
    const n = (tok.slice(1).match(/-?[\d.]+/g) ?? []).map(Number)
    const cmd = tok[0]
    if (cmd === "M" || cmd === "L") {
      for (let i = 0; i + 1 < n.length; i += 2) {
        cur = { x: n[i], y: n[i + 1] }
        pts.push(cur)
      }
    } else {
      const [x1, y1, x2, y2, x3, y3] = n
      for (let i = 0; i <= steps; i++) {
        const t = i / steps
        const mt = 1 - t
        pts.push({
          x: mt * mt * mt * cur.x + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t * x3,
          y: mt * mt * mt * cur.y + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t * y3,
        })
      }
      cur = { x: x3, y: y3 }
    }
  }
  return pts
}

/** Last coordinate pair of an arrow's path. */
function pathEnd(d: string): { x: number; y: number } {
  const n = d.match(/-?[\d.]+/g)!.map(Number)
  return { x: n[n.length - 2], y: n[n.length - 1] }
}

interface FlowSpecLike {
  direction?: "lr" | "tb"
  nodes: { id: string; label: string; shape?: "box" | "round" | "pill" | "note" }[]
  edges: { from: string; to: string; label?: string; kind?: "causes" | "leads" | "part-of" | "conflict" }[]
}

/** True when this arrow is a return path (it leaves via a node's far edge). */
function isReturnPath(
  start: { x: number; y: number },
  a: NodeBoxEl,
  direction: "lr" | "tb",
): boolean {
  return direction === "lr"
    ? Math.abs(start.x - (a.x + a.w / 2)) < 0.01 && Math.abs(start.y - (a.y + a.h)) < 0.01
    : Math.abs(start.x - (a.x + a.w)) < 0.01
}

/** Every `diagram` block in the demo fixtures, so these assertions cover the
 *  IR a real model emits rather than only hand-built specs. */
function demoDiagrams(): { name: string; spec: FlowSpecLike }[] {
  const found: { name: string; spec: FlowSpecLike }[] = []
  const walk = (x: unknown, name: string): void => {
    if (Array.isArray(x)) {
      x.forEach(v => walk(v, name))
    } else if (x && typeof x === "object") {
      const o = x as Record<string, unknown>
      if (o.type === "diagram") found.push({ name, spec: o as unknown as FlowSpecLike })
      Object.values(o).forEach(v => walk(v, name))
    }
  }
  Object.entries(demoExamples).forEach(([name, v]) => walk(v, name))
  return found
}

/** THE INVARIANT. A forward edge must leave its source node at that node's
 *  own midpoint on the flow axis, and arrive at the target's. This is the
 *  property the clamp violated, and it is why every arrow appeared to point
 *  at the top of its box. */
function expectEndpointsAligned(scene: Scene, spec: FlowSpecLike, label: string): number {
  const direction = spec.direction ?? "lr"
  let checked = 0
  for (const el of scene.elements) {
    if (el.kind !== "arrow" || !el.id) continue
    const [from, to] = el.id.split("->")
    const a = mustNode(scene, from)
    const b = mustNode(scene, to)
    const start = pathStart(el.d)
    // Return paths deliberately exit the far edge; they are not centre-anchored.
    if (isReturnPath(start, a, direction)) continue
    checked++
    const wantStart = direction === "lr" ? a.y + a.h / 2 : a.y + a.h
    const wantEndX = direction === "lr" ? b.x - 2 : b.x + b.w / 2
    const wantEndY = direction === "lr" ? b.y + b.h / 2 : b.y - 2
    const end = pathEnd(el.d)
    const msg = `${label}: ${el.id}`
    expect(`${msg} start y ${start.y} === source mid ${wantStart}`).toBe(
      `${msg} start y ${start.y} === source mid ${wantStart}`,
    )
    expect(Math.abs(start.y - wantStart)).toBeLessThan(0.01)
    expect(Math.abs(end.x - wantEndX)).toBeLessThan(0.01)
    expect(Math.abs(end.y - wantEndY)).toBeLessThan(0.01)
  }
  return checked
}

describe("flow cycles and back-edge routing", () => {
  // The reported bug, asserted over the real fixtures rather than a spec built
  // to fail: a golden file would have been re-baselined along with the bug.
  it("anchors every forward edge to its node's midpoint in every demo diagram", () => {
    const diagrams = demoDiagrams()
    expect(diagrams.length).toBeGreaterThan(0)
    let total = 0
    for (const { name, spec } of diagrams) {
      const { scene } = layoutFlow(spec)
      total += expectEndpointsAligned(scene, spec, name)
    }
    // Guards the guard: the assertion must not pass by checking nothing.
    expect(total).toBeGreaterThan(0)
  })

  it("does not inflate the layer count of a cyclic diagram", () => {
    // howToIr's pipeline diagram closes a loop with reval -> cache.
    const spec = (demoExamples.howToIr as { blocks: { type: string }[] }).blocks.find(
      b => b.type === "diagram",
    ) as unknown as FlowSpecLike
    const { scene } = layoutFlow(spec)
    const nodes = spec.nodes.map(n => mustNode(scene, n.id))
    // Before the fix this was 1556px wide across 17 ranks, 13 of them empty.
    // The emit layer scales by viewBox, so that rendered the figure at 0.49x
    // and its 13px labels at 6.4px.
    expect(scene.width).toBeLessThan(900)
    // Four ranks, not seventeen: nodes sharing a rank share an x, which is
    // exactly what a correct layered layout does.
    const ranks = new Set(nodes.map(n => n.x))
    expect(ranks.size).toBe(4)
    const xs = [...ranks].sort((p, q) => p - q)
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1])
  })

  it("gives a cyclic diagram the same layout as the same graph minus its cycle", () => {
    const spec = (demoExamples.howToIr as { blocks: { type: string }[] }).blocks.find(
      b => b.type === "diagram",
    ) as unknown as FlowSpecLike
    const cyclic = layoutFlow(spec).scene
    const acyclic = layoutFlow({
      ...spec,
      edges: spec.edges.filter(e => !(e.from === "reval" && e.to === "cache")),
    }).scene
    const rank = (s: Scene): number =>
      new Set(s.elements.filter(e => e.kind === "node-box").map(e => (e as NodeBoxEl).x)).size
    expect(rank(cyclic)).toBe(rank(acyclic))
    expect(cyclic.width).toBe(acyclic.width)
  })

  it("keeps every rendered edge label free of negative gutters", () => {
    // A cycle used to push `cache` right of `origin`, giving their edge a
    // gutter of -538 that clamped to 8 and wrapped "miss / stale" into
    // ["miss", "/", "stal", "e"].
    for (const { name, spec } of demoDiagrams()) {
      const { scene } = layoutFlow(spec)
      for (const el of scene.elements) {
        if (el.kind !== "arrow" || !el.lines) continue
        const [from, to] = el.id!.split("->")
        const a = mustNode(scene, from)
        const b = mustNode(scene, to)
        if (isReturnPath(pathStart(el.d), a, spec.direction ?? "lr")) continue
        expect(`${name}: ${el.id} gutter non-negative`).toBe(
          `${name}: ${el.id} gutter non-negative`,
        )
        expect(b.x - (a.x + a.w)).toBeGreaterThanOrEqual(0)
        // No line may be shredded to a stub.
        for (const line of el.lines) expect(line.length).toBeGreaterThanOrEqual(4)
      }
    }
  })

  it("routes a back edge as a return path below the nodes, head pointing up", () => {
    const { scene } = layoutFlow({
      direction: "lr",
      nodes: [
        { id: "req", label: "Request" },
        { id: "cache", label: "Cache lookup" },
        { id: "reval", label: "Background revalidate" },
      ],
      edges: [
        { from: "req", to: "cache" },
        { from: "cache", to: "reval" },
        { from: "reval", to: "cache", kind: "part-of" }, // the cycle
      ],
    })
    const back = mustArrow(scene, "reval->cache")
    const a = mustNode(scene, "reval")
    const b = mustNode(scene, "cache")
    const start = pathStart(back.d)
    const end = pathEnd(back.d)
    // Leaves the source's bottom edge and enters the target's bottom edge.
    expect(start.y).toBeCloseTo(a.y + a.h, 5)
    expect(end.y).toBeCloseTo(b.y + b.h, 5)
    // Head base sits below the tip, i.e. the arrow points UP into the target.
    const headNums = back.head.match(/-?[\d.]+/g)!.map(Number)
    expect(headNums[1]).toBeCloseTo(b.y + b.h, 5)
    expect(headNums[3]).toBeCloseTo(b.y + b.h + 9, 5)
    // The dip must clear every node and stay inside the scene. Measured on the
    // DRAWN curve: with equal endpoints it reaches only 3/4 of the control line.
    const lowest = Math.max(...samplePath(back.d).map(p => p.y))
    for (const n of scene.elements) {
      if (n.kind !== "node-box") continue
      expect(lowest).toBeGreaterThan(n.y + n.h)
    }
    expect(scene.height).toBeGreaterThan(lowest)
  })

  it("gives each back edge its own lane so two cycles do not overprint", () => {
    const { scene } = layoutFlow({
      direction: "lr",
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
        { id: "c", label: "C" },
        { id: "d", label: "D" },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "c", to: "d" },
        { from: "d", to: "b" }, // one back edge
        { from: "c", to: "a" }, // another
      ],
    })
    const first = mustArrow(scene, "d->b")
    const second = mustArrow(scene, "c->a")
    const dipOf = (d: string): number => Math.max(...samplePath(d).map(p => p.y))
    expect(dipOf(first.d)).not.toBeCloseTo(dipOf(second.d), 1)
    // Both must pass BELOW every node, not through them — the second lane is
    // deeper than the first, and neither clips against a box.
    const lowestNode = Math.max(
      ...scene.elements
        .filter(e => e.kind === "node-box")
        .map(e => (e as NodeBoxEl).y + (e as NodeBoxEl).h),
    )
    expect(dipOf(first.d)).toBeGreaterThan(lowestNode)
    expect(dipOf(second.d)).toBeGreaterThan(dipOf(first.d))
    // Both still land inside the scene.
    expect(scene.height).toBeGreaterThan(dipOf(first.d))
    expect(scene.height).toBeGreaterThan(dipOf(second.d))
  })

  it("keeps arrows aligned when a label block hangs above the origin", () => {
    // The clamp regression: a tall wrapped label forced the whole scene down,
    // and the node boxes moved while the serialized edge paths did not.
    const spec: FlowSpecLike = {
      direction: "lr",
      nodes: [
        { id: "a", label: "Alpha" },
        { id: "b", label: "Beta" },
        { id: "c", label: "Gamma" },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c", label: "a very long explanatory edge label that has to wrap" },
      ],
    }
    const { scene } = layoutFlow(spec)
    // Force the condition: the label block must actually be multi-line,
    // otherwise this test would pass without exercising the clamp.
    const wrapped = scene.elements.filter(e => e.kind === "arrow" && (e.lines?.length ?? 0) > 1)
    expect(wrapped.length).toBeGreaterThan(0)
    expect(expectEndpointsAligned(scene, spec, "clamp case")).toBeGreaterThan(0)
  })

  it("lays out a tb cycle with the return path to the right", () => {
    const spec: FlowSpecLike = {
      direction: "tb",
      nodes: [
        { id: "a", label: "Alpha" },
        { id: "b", label: "Beta" },
        { id: "c", label: "Gamma" },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
        { from: "c", to: "a" },
      ],
    }
    const { scene } = layoutFlow(spec)
    expect(expectEndpointsAligned(scene, spec, "tb cycle")).toBeGreaterThan(0)
    const back = mustArrow(scene, "c->a")
    const a = mustNode(scene, "a")
    const c = mustNode(scene, "c")
    const start = pathStart(back.d)
    expect(start.x).toBeCloseTo(c.x + c.w, 5) // exits to the right
    // Head base is right of its tip, i.e. the arrow points LEFT into `a`.
    const headNums = back.head.match(/-?[\d.]+/g)!.map(Number)
    expect(headNums[0]).toBeCloseTo(a.x, 5)
    expect(headNums[2]).toBeCloseTo(a.x + 9, 5)
    // The lane must clear every node it passes, not cut back through them.
    // Measured on the DRAWN curve: the control point lies outside it.
    const rightmost = Math.max(...samplePath(back.d).map(p => p.x))
    for (const n of scene.elements) {
      if (n.kind !== "node-box") continue
      expect(rightmost).toBeGreaterThan(n.x + n.w)
    }
    expect(scene.width).toBeGreaterThan(rightmost)
  })

  it("keeps the return lane clear of the nodes after the clamp shifts them", () => {
    // Regression from the fresh-eyes pass: the lane was measured from the
    // PRE-clamp node extent. Once a clamp shift exceeded RETURN_DROP the lane
    // climbed above the boxes and the return path cut straight through the
    // nodes it exists to pass outside of. Ramp the label until the shift is
    // large enough to have triggered it.
    for (const len of [40, 90, 200, 400]) {
      const spec: FlowSpecLike = {
        direction: "lr",
        nodes: [
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta" },
          { id: "c", label: "Gamma" },
          { id: "d", label: "Delta" },
        ],
        edges: [
          { from: "a", to: "b" },
          { from: "b", to: "c", label: "x".repeat(len) },
          { from: "c", to: "d" },
          { from: "d", to: "a" }, // the cycle
        ],
      }
      const { scene } = layoutFlow(spec)
      const nodes = scene.elements.filter((e): e is NodeBoxEl => e.kind === "node-box")
      const lowestNode = Math.max(...nodes.map(n => n.y + n.h))
      const dip = Math.max(...samplePath(mustArrow(scene, "d->a").d).map(p => p.y))
      expect(`label ${len}: dip ${dip.toFixed(1)} > node bottom ${lowestNode}`).toBe(
        `label ${len}: dip ${dip.toFixed(1)} > node bottom ${lowestNode}`,
      )
      expect(dip).toBeGreaterThan(lowestNode)
      expect(scene.height).toBeGreaterThan(dip)
    }
  })

  it("spaces tb siblings by WIDTH, so same-rank boxes never overlap", () => {
    // `tb` puts the cross axis horizontal, so siblings advance by `w`. The
    // step used to advance by `h` for both directions, which put two ~130px
    // boxes 72px apart in a tb rank -- they overlapped.
    const { scene } = layoutFlow({
      direction: "tb",
      nodes: [
        { id: "api", label: "API server" },
        { id: "cache", label: "Response cache" },
        { id: "db", label: "Primary database" },
      ],
      edges: [{ from: "api", to: "cache" }, { from: "api", to: "db" }],
    })
    const boxes = scene.elements.filter((e): e is NodeBoxEl => e.kind === "node-box")
    expect(boxes).toHaveLength(3)
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]
        const b = boxes[j]
        const overlaps =
          a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
        expect(`${a.id} vs ${b.id}: ${overlaps ? "OVERLAP" : "clear"}`).toBe(
          `${a.id} vs ${b.id}: clear`,
        )
      }
    }
  })

  it("sizes a tb scene to its widest node, not to a sum of node heights", () => {
    // `crossExtent` accumulated node heights and then became tb's WIDTH, so a
    // 227px box in a 240-unit viewBox was clipped by 3px. lr got this right.
    const { scene } = layoutFlow({
      direction: "tb",
      nodes: [
        { id: "a", label: "A very wide node label that stretches the box out considerably" },
        { id: "b", label: "B" },
      ],
      edges: [{ from: "a", to: "b" }],
    })
    for (const n of scene.elements) {
      if (n.kind !== "node-box") continue
      expect(`${n.id} right edge ${n.x + n.w} <= width ${scene.width}`).toBe(
        `${n.id} right edge ${n.x + n.w} <= width ${scene.width}`,
      )
      expect(n.x + n.w).toBeLessThanOrEqual(scene.width)
      expect(n.x).toBeGreaterThanOrEqual(0)
    }
  })

  it("is deterministic across repeated calls", () => {
    const spec = (demoExamples.howToIr as { blocks: { type: string }[] }).blocks.find(
      b => b.type === "diagram",
    ) as unknown as FlowSpecLike
    const first = JSON.stringify(layoutFlow(spec).scene)
    for (let i = 0; i < 5; i++) {
      expect(JSON.stringify(layoutFlow(spec).scene)).toBe(first)
    }
  })

  it("leaves a cycle-free spec byte-identical to the pre-cycle layout", () => {
    // Nothing about a DAG should have changed: only cycle handling and the
    // clamp's application point moved. These values are the pre-fix output,
    // captured from commit 0945bfd — not derived from the new code.
    const { scene } = layoutFlow(overflowIr)
    expect(scene.width).toBe(591)
    expect(scene.height).toBe(76)
    expect(mustArrow(scene, "sun->air").d).toBe("M 106 38 C 175 38, 175 38, 244 38")
    expect(mustArrow(scene, "air->eye").d).toBe("M 345 38 C 414 38, 414 38, 483 38")
  })
})
