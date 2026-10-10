import { describe, expect, it } from "vitest"
import {
  clearBandsY,
  clearCorridorsX,
  edgeLabelRect,
  estimateEdgeTextWidth,
  layoutFlow,
  routeSerpentine,
  segmentClearsBoxes,
} from "../../src/figures/layoutFlow"
import * as demoExamples from "../../demo/examples"
import type { ArrowEl, NodeBoxEl, Scene } from "../../src/figures/scene"

function mustNode(scene: Scene, id: string): NodeBoxEl {
  const el = scene.elements.find((e): e is NodeBoxEl => e.kind === "node-box" && e.id === id)
  if (!el) throw new Error(`node "${id}" not found in scene`)
  return el
}

interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** The EXACT node geometry of the run-3 "Cytotoxic T Cells: The Assassins"
 *  diagram (merged dist a45db9c) — the live instance of the skip-rank defect. */
const RUN3_BOXES: Box[] = [
  { x: 16, y: 16, w: 144, h: 44 }, // cytotoxic_t_cell (rank 0)
  { x: 224, y: 16, w: 92, h: 44 }, // granzymes (rank 1, top)
  { x: 224, y: 88, w: 90, h: 44 }, // perforin (rank 1, bottom)
  { x: 456, y: 16, w: 122, h: 44 }, // target_cell (rank 2)
]

const intersects = (a: Box, b: Box): boolean =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

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

  it("widens the gutter for a STEEP fan, so its curves and labels can breathe", () => {
    // The 2026-10-08 Twinkle feedback: six sources fan into three targets
    // across one 64px gutter. The label-aware rule only widens for LABEL text
    // — but the VISUAL jumble is line traffic: a source 288px below its
    // target draws a near-vertical curve in that 64px channel, and the fan's
    // labels ride the same channel 15px apart, unreadable. The gutter must
    // also scale with the steepest adjacent edge crossing it (vertical drop
    // per unit of width), so the curves shallow out and the labels separate.
    const gutterOf = (edges: { from: string; to: string; label?: string }[]) => {
      const { scene } = layoutFlow({
        nodes: [
          { id: "a1", label: "A1" }, { id: "a2", label: "A2" },
          { id: "b1", label: "B1" }, { id: "b2", label: "B2" },
          { id: "b3", label: "B3" }, { id: "b4", label: "B4" },
          { id: "b5", label: "B5" }, { id: "b6", label: "B6" },
        ],
        edges,
        direction: "lr" as const,
      })
      const ns = scene.elements.filter(e => e.kind === "node-box") as { id: string; x: number; w: number }[]
      const a1 = ns.find(n => n.id === "a1")!
      const b1 = ns.find(n => n.id === "b1")!
      return b1.x - (a1.x + a1.w)
    }
    // Every b is a target of a1 so rank 1 holds the full stack; the a1→b6
    // edge then drops five rows (~360px) across the single gutter.
    const steep = gutterOf([
      { from: "a1", to: "b1", label: "fits" },
      { from: "a1", to: "b2" }, { from: "a1", to: "b3" },
      { from: "a1", to: "b4" }, { from: "a1", to: "b5" },
      { from: "a1", to: "b6", label: "fits" },
    ])
    expect(steep).toBeGreaterThan(88)
    expect(steep).toBeLessThanOrEqual(140) // the same cap a label-driven gutter obeys
    // A shallow fan (same labels, no vertical drop) stays at the compact 88px
    // default — the slope term must not tax ordinary diagrams.
    const shallow = gutterOf([
      { from: "a1", to: "b1", label: "fits" },
      { from: "a2", to: "b2", label: "fits" },
    ])
    expect(shallow).toBe(88)
  })

  it("slides a label off a foreign curve that crosses its anchor", () => {
    // The 2026-10-08 Twinkle follow-up: two same-rank curves into one target
    // cross EXACTLY at the gutter's mid-x — which is also where each label
    // anchors (the span midpoint). Label meets foreign line at a crossing:
    // the jumble. The label must slide ALONG ITS OWN CURVE to a point no
    // foreign curve passes through, staying within its own gutter and on its
    // own curve's path.
    const { scene } = layoutFlow({
      nodes: [
        { id: "a1", label: "A1" }, { id: "a2", label: "A2" },
        { id: "b1", label: "B1" }, { id: "b2", label: "B2" },
        { id: "b3", label: "B3" }, { id: "b4", label: "B4" },
      ],
      edges: [
        { from: "a1", to: "b1", label: "fits" },
        { from: "a2", to: "b1", label: "fits" }, // both curves converge on b1
        { from: "a1", to: "b2" }, { from: "a1", to: "b3" }, { from: "a1", to: "b4" },
      ],
      direction: "lr" as const,
    })
    const a1 = mustNode(scene, "a1")
    const b1 = mustNode(scene, "b1")
    const sx = a1.x + a1.w
    const ex = b1.x // target's left edge; the gutter span
    const arrows = scene.elements.filter(
      (e): e is Extract<Scene["elements"][number], { kind: "arrow" }> => e.kind === "arrow",
    )
    const fit = arrows.filter(e => e.label === "fits")
    expect(fit.length).toBe(2)
    // foreign curves = the other four a1→bk edges (same source, different
    // targets) plus the sibling a2→b1 curve. A label's anchor must not sit
    // within the label rect of any foreign curve's CROSSING of the band it
    // lives in — approximated here by: the anchor's own-curve point must be
    // at least EDGE-RECT-clear of every foreign curve's mid-gutter y-band.
    // Simplest measurable invariant: the two labels' anchors differ by more
    // than a label height (they can no longer both sit at the same crossing
    // y-band), and each anchor stays inside its own gutter x-span.
    const ys = fit.map(e => e.labelY!).sort((p, q) => p - q)
    expect(ys[1] - ys[0]).toBeGreaterThan(16) // EDGE_LABEL_H: one label block
    for (const e of fit) {
      expect(e.labelX!).toBeGreaterThan(sx)
      expect(e.labelX!).toBeLessThan(ex)
    }
    // The real invariant: no foreign curve passes through either label RECT.
    // (A point-clear anchor still shipped rect-clipping curves in the first
    // cut — the label is a 19x16 box, not a point.)
    const cubic = (p0: [number, number], p1: [number, number], p2: [number, number], p3: [number, number], t: number): [number, number] => {
      const mt = 1 - t
      return [
        mt * mt * mt * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t * t * t * p3[0],
        mt * mt * mt * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t * t * t * p3[1],
      ]
    }
    const sample = (d: string): [number, number][] => {
      const m = /M ([\d.]+) ([\d.]+) C ([\d.]+) ([\d.]+), ([\d.]+) ([\d.]+), ([\d.]+) ([\d.]+)/.exec(d)!
      const p0: [number, number] = [+m[1], +m[2]]
      const p1: [number, number] = [+m[3], +m[4]]
      const p2: [number, number] = [+m[5], +m[6]]
      const p3: [number, number] = [+m[7], +m[8]]
      return Array.from({ length: 49 }, (_, i) => cubic(p0, p1, p2, p3, i / 48))
    }
    const foreign = arrows.filter(e => e.label === undefined).map(e => sample(e.d))
    expect(foreign.length).toBeGreaterThan(0)
    for (const lbl of fit) {
      const r = edgeLabelRect(lbl)
      for (const poly of foreign) {
        for (let i = 0; i + 1 < poly.length; i++) {
          const [x1, y1] = poly[i]
          const [x2, y2] = poly[i + 1]
          // segment vs rect: either endpoint inside, or edge-crossing
          const inside = (x: number, y: number): boolean => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h
          if (inside(x1, y1) || inside(x2, y2)) {
            throw new Error(`foreign curve passes through label "${lbl.label}" rect at (${r.x.toFixed(1)}, ${r.y.toFixed(1)})`)
          }
        }
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
    // Unchanged default: a short label leaves the gutter at its 88px minimum
    // (raised from 64 — 2026-10-09 breathing room).
    expect(shortGutter()).toBe(88)

    const { scene } = layoutFlow(overflowIr)
    const ns = scene.elements.filter(e => e.kind === "node-box") as { x: number; w: number }[]
    const gutter = ns[1].x - (ns[0].x + ns[0].w)
    expect(gutter).toBeGreaterThan(88)
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
    // The head's TIP lands 2px inside the target's edge, and its base plane
    // — where the shaft must terminate (the base-plane invariant,
    // 2026-10-10 findings 5/6) — sits 9px further back along the flow axis.
    const wantEndX = direction === "lr" ? b.x - 2 - 9 : b.x + b.w / 2
    const wantEndY = direction === "lr" ? b.y + b.h / 2 : b.y - 2 - 9
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
    // Leaves the source's bottom edge; the shaft terminates at the head's
    // base plane (HEAD_BASE below the target's bottom edge), not at the tip.
    expect(start.y).toBeCloseTo(a.y + a.h, 5)
    expect(end.y).toBeCloseTo(b.y + b.h + 9, 5)
    // Head base sits below the tip, i.e. the arrow points UP into the target.
    const headNums = back.head.match(/-?[\d.]+/g)!.map(Number)
    expect(headNums[1]).toBeCloseTo(b.y + b.h, 5)
    expect(headNums[3]).toBeCloseTo(b.y + b.h + 9, 5)
    // The stem must terminate at the midpoint of the head's base leg (the
    // leg parallel to the box), so the shaft reads as entering the hollow
    // head through the middle of its base. The 2026-10-08 reharm modes-cycle
    // page showed the old cubic's flattened arrival crossing the base plane
    // ~3.7px off-centre — visually attached at the base leg's corner.
    // Tip x and base centre x coincide, so the base midpoint is (end.x, baseY).
    const baseY = headNums[3]!
    const nearBase = samplePath(back.d).filter(p => Math.abs(p.y - baseY) < 1)
    expect(nearBase.length).toBeGreaterThan(0)
    const nearest = nearBase.reduce((best, p) =>
      Math.abs(p.x - end.x) < Math.abs(best.x - end.x) ? p : best,
    )
    expect(Math.abs(nearest.x - end.x)).toBeLessThan(1)
    // The dip must clear every node and stay inside the scene. Measured on the
    // DRAWN curve: with equal endpoints it reaches only 3/4 of the control line.
    const lowest = Math.max(...samplePath(back.d).map(p => p.y))
    for (const n of scene.elements) {
      if (n.kind !== "node-box") continue
      expect(lowest).toBeGreaterThan(n.y + n.h)
    }
    expect(scene.height).toBeGreaterThan(lowest)
  })

  it("rides a labelled tb back-edge label ON its curve's right flank, broken between words", () => {
    // 2026-10-09 review: the below-the-graph anchor (2026-10-08) fixed the
    // five-line shredding but orphaned the block ~150px from its curve — the
    // user: "it's unclear as to what it refers to... keep the text along the
    // line but put line breaks (if needed) between words and not in the
    // middle of them." The return curve bulges RIGHT and runs near-vertical
    // around its extremum, so a word-wrapped block hugging that flank reads
    // as text along the line.
    const { scene } = layoutFlow({
      direction: "tb",
      nodes: [
        { id: "apc", label: "Antigen-Presenting Cell" },
        { id: "killer", label: "Killer T Cell" },
        { id: "ab", label: "Antibody" },
      ],
      edges: [
        { from: "apc", to: "killer", label: "presents antigen" },
        { from: "killer", to: "ab", label: "triggers production" },
        { from: "ab", to: "apc", label: "neutralizes pathogen (via APC)" }, // the cycle
      ],
    })
    const back = mustArrow(scene, "ab->apc")
    expect(back.label).toBe("neutralizes pathogen (via APC)")
    const lines = back.lines ?? [back.label!]
    expect(lines.length).toBeLessThanOrEqual(3)
    // Breaks land BETWEEN words: joining the lines back with single spaces
    // reproduces the label exactly. wrapEdgeLabel hard-splits a word only
    // when that word alone is wider than the wrap width, so a mid-word
    // break would change this join ("neutral" + "izes" joins to
    // "neutral izes"). Pinning the join pins the word-completeness.
    expect(lines.join(" ")).toBe("neutralizes pathogen (via APC)")
    const r = edgeLabelRect(back)
    // The block hugs the curve: its left edge sits just right of the curve's
    // rightmost point (the extremum, sampled from the DRAWN path).
    const pts = samplePath(back.d, 256)
    const extremum = Math.max(...pts.map(p => p.x))
    expect(r.x).toBeGreaterThanOrEqual(extremum - 0.5)
    expect(r.x).toBeLessThanOrEqual(extremum + 12)
    // ...it rides ALONG the curve's span, not below the graph...
    const ys = pts.map(p => p.y)
    expect(r.y).toBeGreaterThanOrEqual(Math.min(...ys) - 0.5)
    expect(r.y + r.h).toBeLessThanOrEqual(Math.max(...ys) + 0.5)
    const nodes = scene.elements.filter((e): e is NodeBoxEl => e.kind === "node-box")
    const lowestNode = Math.max(...nodes.map(n => n.y + n.h))
    expect(r.y).toBeLessThan(lowestNode)
    // ...clears every node box...
    for (const n of nodes) expect(intersects(r as unknown as Box, n)).toBe(false)
    // ...and the scene grew wide enough to hold the block.
    expect(r.x + r.w).toBeLessThanOrEqual(scene.width + 0.5)
  })

  it("gives a figure room to breathe: wider gutters, taller rows, more padding", () => {
    // 2026-10-09 review: even after the slope gutter and the crossing slide,
    // dense figures still read cramped — "there is plenty of space to make
    // the figures more spaced out in all directions". The layout minimums
    // were tuned tight: GAP_MAIN 64→88, GAP_CROSS 28→44, PAD 16→24. Two
    // parallel chains keep the slope-gutter term at zero (every edge's drop
    // is 0), so the raw minimums are visible exactly.
    const { scene } = layoutFlow({
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
        { id: "c", label: "C" },
        { id: "d", label: "D" },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "c", to: "d" },
      ],
    })
    const a = mustNode(scene, "a")
    const b = mustNode(scene, "b")
    const c = mustNode(scene, "c")
    const d = mustNode(scene, "d")
    expect(a.x).toBe(24) // PAD: breathing room at the scene's left edge
    expect(b.x - (a.x + a.w)).toBe(88) // GAP_MAIN: room between the columns
    expect(d.x - (c.x + c.w)).toBe(88)
    expect(c.y - (a.y + a.h)).toBe(44) // GAP_CROSS: room between the rows
    expect(scene.width).toBe(d.x + d.w + 24) // right padding
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
    // tb mirror of the base-plane invariant: the shaft terminates at the
    // head's base leg (x = a.x + 9), entering through the leg's midpoint.
    const endTb = pathEnd(back.d)
    expect(endTb.x).toBeCloseTo(a.x + 9, 5)
    const baseXTb = headNums[2]!
    const nearBaseTb = samplePath(back.d).filter(p => Math.abs(p.x - baseXTb) < 1)
    expect(nearBaseTb.length).toBeGreaterThan(0)
    const nearestTb = nearBaseTb.reduce((best, p) =>
      Math.abs(p.y - endTb.y) < Math.abs(best.y - endTb.y) ? p : best,
    )
    expect(Math.abs(nearestTb.y - endTb.y)).toBeLessThan(1)
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
    // Nothing about a DAG changes when a cycle is present: only cycle
    // handling differs. The absolute geometry below was captured from commit
    // 0945bfd and re-captured after the 2026-10-09 spacing raise (GAP_MAIN
    // 64→88, PAD 16→24) moved every layout; the INVARIANT pinned is that the
    // cyclic and acyclic renders agree byte-for-byte, not these numbers.
    const { scene } = layoutFlow(overflowIr)
    expect(scene.width).toBe(607)
    expect(scene.height).toBe(92)
    // Captured after the 2026-10-10 arrowhead base-plane change: the shaft
    // ends 9px before the target edge (at the head's base plane), so both
    // curves end at 252-9=243 and 491-9=482. The INVARIANT pinned is that
    // the cyclic and acyclic renders agree byte-for-byte, not these numbers.
    expect(mustArrow(scene, "sun->air").d).toBe("M 114 46 C 178.5 46, 178.5 46, 243 46")
    expect(mustArrow(scene, "air->eye").d).toBe("M 353 46 C 417.5 46, 417.5 46, 482 46")
  })
})

describe("arrowhead attachment (2026-10-10 review findings 5/6)", () => {
  /** The head's base-plane midpoint: the base leg is corners A/B — the head
   *  path is `M tip L baseA L baseB Z` in every emit branch, so the leg's
   *  midpoint averages points 2 and 3. */
  const headBaseMid = (head: string): { x: number; y: number } => {
    const n = head.match(/-?[\d.]+/g)!.map(Number)
    return { x: (n[2]! + n[4]!) / 2, y: (n[3]! + n[5]!) / 2 }
  }

  it("terminates every FORWARD shaft at the head's base plane, in every demo diagram", () => {
    // Finding 6 ("Mechanism of the Backdoor ii-V"): a forward shaft ran to
    // the head's TIP (2px inside the target edge), so its last ~9px crossed
    // the hollow head and visually ran to the arrowhead's centre — reading
    // as two lines, the second off-centre, at the grey/thin rendering scale.
    // The back-edge branches already obey the base-plane invariant; the four
    // forward branches must too. Checked on the DRAWN path: the sampled shaft
    // must reach the base plane and nothing may pass beyond it toward the
    // target's edge.
    const diagrams = demoDiagrams()
    expect(diagrams.length).toBeGreaterThan(0)
    let checked = 0
    for (const { name, spec } of diagrams) {
      const direction = spec.direction ?? "lr"
      const { scene } = layoutFlow(spec)
      for (const el of scene.elements.filter(
        (e): e is Extract<Scene["elements"][number], { kind: "arrow" }> =>
          e.kind === "arrow" && e.id !== undefined,
      )) {
        const [from, to] = el.id!.split("->")
        const a = mustNode(scene, from)
        const b = mustNode(scene, to)
        if (isReturnPath(pathStart(el.d), a, direction)) continue
        checked++
        const base = headBaseMid(el.head)
        const end = pathEnd(el.d)
        // The shaft endpoint IS the base-leg midpoint (the base-plane
        // invariant verified in coordinates)...).
        expect(`${name}: ${el.id} shaft ends at head base`).toBe(`${name}: ${el.id} shaft ends at head base`)
        expect(Math.abs(end.x - base.x)).toBeLessThan(0.01)
        expect(Math.abs(end.y - base.y)).toBeLessThan(0.01)
        // ...and on the DRAWN curve nothing penetrates the base plane toward
        // the target edge (which is what draws the line through the hollow
        // head). Project the shaft's last sampled point and the plane's own
        // axis coordinate: for lr the plane is a vertical line x = base.x,
        // for tb a horizontal line y = base.y.
        const pts = samplePath(el.d)
        if (direction === "lr") {
          const beyond = pts.filter(p => p.x > base.x + 0.5)
          expect(beyond).toEqual([])
        } else {
          const beyond = pts.filter(p => p.y > base.y + 0.5)
          expect(beyond).toEqual([])
        }
      }
    }
    expect(checked).toBeGreaterThan(0)
  })

  it("keeps every LR back-edge label off every node box, after the nudge", () => {
    // Finding 5 ("The iv Chord (Subdominant)"): the reharm fig-3 geometry —
    // seven nodes, C Major's rank over three rows, back edges V-I and
    // bVII-I returning around the graph. The plan-level lr back-edge label
    // anchor sits at the span midpoint (x, y), and when a mid-rank box
    // occupies that band the label printed ON the box: measured in the
    // run-5 HTML, "V-I" centred at (406, 220) inside Bb Major's rect
    // [270..407]×[200..244] — the reader sees the head + label vanish
    // behind the node. The 7c-pre slide excludes back edges (they are not
    // in polyOf), and the 7c nudge compares labels only against labels —
    // so nothing ever moved it. Pin: every edge-label rect, back edges
    // included, clears every node box, over the real fixture shape AND
    // every demo diagram.
    const reharmFig3 = {
      direction: "lr" as const,
      nodes: [
        { id: "cmaj", label: "C Major (I)" },
        { id: "amaj", label: "A minor (vi)" },
        { id: "fmaj", label: "F Major (IV)" },
        { id: "abmaj", label: "Ab Major (bVI)" },
        { id: "bbmaj", label: "Bb Major (bVII)" },
        { id: "fmin", label: "F minor (iv)" },
        { id: "gmaj", label: "G Major (V)" },
      ],
      edges: [
        { from: "cmaj", to: "fmaj", label: "I-IV" },
        { from: "fmaj", to: "gmaj", label: "IV-V" },
        { from: "gmaj", to: "cmaj", label: "V-I" }, // back: the reported label
        { from: "cmaj", to: "abmaj", label: "I-bVI" },
        { from: "abmaj", to: "gmaj", label: "bVI-V" },
        { from: "cmaj", to: "bbmaj", label: "I-bVII" },
        { from: "bbmaj", to: "cmaj", label: "bVII-I" }, // back, also labelled
        { from: "fmaj", to: "fmin", label: "IV-iv" },
        { from: "fmin", to: "gmaj", label: "iv-V" },
      ],
    }
    const checkedBack = { n: 0 }
    const checkLabels = (spec: FlowSpecLike): void => {
      const { scene } = layoutFlow(spec)
      const nodes = scene.elements.filter((e): e is NodeBoxEl => e.kind === "node-box")
      for (const el of scene.elements.filter(
        (e): e is Extract<Scene["elements"][number], { kind: "arrow" }> => e.kind === "arrow" && e.label !== undefined,
      )) {
        const r = edgeLabelRect(el) as unknown as Box
        // A return path exits through the source's far edge; the direction
        // signature (height dominated by stacked rows vs width by columns)
        // is not needed here — a back-edge id is detectable geometrically in
        // both directions as "exits at the node's own bottom/right edge".
        const [from] = el.id!.split("->")
        const a = mustNode(scene, from)
        const start = pathStart(el.d)
        if (Math.abs(start.x - (a.x + a.w)) < 0.01 || Math.abs(start.y - (a.y + a.h)) < 0.01) checkedBack.n++
        for (const n of nodes) {
          const ix = Math.min(r.x + r.w, n.x + n.w) - Math.max(r.x, n.x)
          const iy = Math.min(r.y + r.h, n.y + n.h) - Math.max(r.y, n.y)
          expect(
            `label "${el.label!}" vs node "${n.id}": ${ix > 2 && iy > 2 ? `OVERLAP ${Math.round(ix)}x${Math.round(iy)}` : "clear"}`,
          ).toBe(`label "${el.label!}" vs node "${n.id}": clear`)
        }
      }
    }
    checkLabels(reharmFig3)
    for (const { spec } of demoDiagrams()) checkLabels(spec)
    expect(checkedBack.n).toBeGreaterThan(0)
  })

  it("keeps an LR back-edge's drawn curve clear of OTHER nodes' boxes on its return", () => {
    // Finding 5 ("The iv Chord (Subdominant)"), the curve half: the reharm
    // fig-3 V-I return path pulls right→left across the RANKS between its
    // source (G Major, top right) and target (C Major, top left); the
    // ascent's mid-span swept behind Bb Major's box — the reader saw head +
    // shaft vanish behind the node. Unlike the label pass above, the CURVE
    // itself must also clear every box between the two: the drawn return
    // curve may pass under the graph, and into its TARGET's left edge by
    // way of a base-plane approach, but must not cross an unrelated box.
    const reharmFig3 = {
      direction: "lr" as const,
      nodes: [
        { id: "cmaj", label: "C Major (I)" },
        { id: "fmaj", label: "F Major (IV)" },
        { id: "bbmaj", label: "Bb Major (bVII)" },
        { id: "gmaj", label: "G Major (V)" },
        { id: "fmin", label: "F minor (iv)" },
      ],
      edges: [
        { from: "cmaj", to: "fmaj", label: "I-IV" },
        { from: "fmaj", to: "gmaj", label: "IV-V" },
        { from: "gmaj", to: "cmaj" }, // back: V-I
        { from: "cmaj", to: "bbmaj", label: "I-bVII" },
        { from: "bbmaj", to: "cmaj" }, // back: bVII-I
        { from: "fmaj", to: "fmin", label: "IV-iv" },
        { from: "fmin", to: "gmaj", label: "iv-V" },
      ],
    }
    const { scene } = layoutFlow(reharmFig3)
    const back = mustArrow(scene, "gmaj->cmaj")
    const pts = samplePath(back.d, 256)
    const nodes = scene.elements.filter((e): e is NodeBoxEl => e.kind === "node-box")
    // Interior test (1px inset matches the suite's > 2 label-overlap
    // convention): touching a box's edge is fine — the shaft legitimately
    // leaves the source's bottom edge and the head's tip touches the
    // target's bottom edge — but the CURVE must not pass through any box.
    const deepInside = (p: { x: number; y: number }, n: NodeBoxEl): boolean =>
      p.x > n.x + 1 && p.x < n.x + n.w - 1 && p.y > n.y + 1 && p.y < n.y + n.h - 1
    for (const p of pts) {
      for (const n of nodes) {
        expect(
          deepInside(p, n),
          `return curve enters node "${n.id}" at (${p.x.toFixed(1)},${p.y.toFixed(1)})`,
        ).toBe(false)
      }
    }
    // Guards the guard: the return path must actually wrap around the graph
    // (its drawn depth below every node), so this test cannot pass vacuously.
    expect(Math.max(...pts.map(p => p.y))).toBeGreaterThan(Math.max(...nodes.map(n => n.y + n.h)))
  })
})

describe("skip-rank routing helpers", () => {
  const columns: [number, number][] = [
    [16, 160], // rank 0 band
    [224, 316], // rank 1 band
    [456, 578], // rank 2 band
  ]

  it("finds the corridor midpoints clear of every box (run-3 geometry)", () => {
    const corridors = clearCorridorsX(columns, RUN3_BOXES)
    // gutter0 mid = (160+224)/2 = 192; gutter1 mid = (316+456)/2 = 386
    expect(corridors).toEqual([192, 386])
  })

  it("excludes a corridor a box bleeds into", () => {
    // a box spanning across the first gutter kills it
    const boxes: Box[] = [...RUN3_BOXES, { x: 140, y: 200, w: 120, h: 40 }]
    expect(clearCorridorsX(columns, boxes)).toEqual([386])
  })

  it("computes the clear bypass band between stacked boxes (run-3)", () => {
    // crossed boxes are granzymes (y 16..60) and perforin (y 88..132);
    // the 28px gap between them, with 6px clearance each side, is [66, 82]
    // (mid 74 — what the route actually uses). MIN_BAND is 12, BAND_PAD 6.
    // Interior-only call: tight range spanning exactly the crossed boxes.
    const bands = clearBandsY([RUN3_BOXES[1], RUN3_BOXES[2]], 16, 132)
    expect(bands).toEqual([[66, 82]])
  })

  it("offers above-all and below-all bands when the gap is missing", () => {
    const tiled: Box[] = [
      { x: 224, y: 0, w: 92, h: 74 },
      { x: 224, y: 74, w: 92, h: 74 },
    ]
    const bands = clearBandsY(tiled, 0, 148)
    expect(bands.length).toBe(0) // no interior gap ≥ MIN_BAND
  })

  it("rejects a segment crossing a box and accepts a clear one", () => {
    expect(segmentClearsBoxes([160, 38], [454, 38], RUN3_BOXES)).toBe(false)
    expect(segmentClearsBoxes([160, 38], [192, 38], RUN3_BOXES)).toBe(true)
    expect(segmentClearsBoxes([192, 38], [192, 74], RUN3_BOXES)).toBe(true)
  })

  it("routes the run-3 skip edge through clear corridors only", () => {
    const route = routeSerpentine(
      { x: 16, y: 16, w: 144, h: 44 },
      { x: 456, y: 16, w: 122, h: 44 },
      columns,
      [RUN3_BOXES[1], RUN3_BOXES[2]],
      0,
      148,
      10, // label block that fits the 16px usable band (28px gap − 2×BAND_PAD)
    )
    // every polyline segment clears every box
    for (let i = 0; i < route.points.length - 1; i++) {
      expect(segmentClearsBoxes(route.points[i], route.points[i + 1], RUN3_BOXES)).toBe(true)
    }
    // first leg must end in the corridor adjacent to the source (192),
    // not somewhere past the first crossed column
    expect(route.points[1][0]).toBe(192)
    // the line runs inside the [66,82] band, below the label block
    expect(route.bypassY).toBe(66 + 10 + 3)
    expect(route.labelY).toBe(66 + 5)
    expect(route.dipped).toBe(false)
  })

  it("nudges a colliding label off an earlier one, first keeps its anchor", () => {
    // two same-source skip edges would share a label row without steering;
    // but the nudge itself is exercised on the simplest collision: two nodes
    // whose adjacent edges carry the same label at the same y.
    const { scene } = layoutFlow({
      nodes: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
        { id: "c", label: "C" },
        { id: "d", label: "D" },
      ],
      edges: [
        { from: "a", to: "b", label: "same text" },
        { from: "a", to: "c", label: "same text" },
      ],
      direction: "lr",
    })
    const arrows = scene.elements.filter(e => e.kind === "arrow") as { label?: string; labelY?: number; labelX?: number }[]
    const labelled = arrows.filter(e => e.label === "same text")
    expect(labelled.length).toBe(2)
    // no two labelled arrows share BOTH anchor coordinates (the collision class)
    const [l1, l2] = labelled
    expect(l1.labelY === l2.labelY && l1.labelX === l2.labelX).toBe(false)
  })

  it("falls back to a dip lane when no clear band exists", () => {
    const tiled: Box[] = [
      { x: 224, y: 0, w: 92, h: 74 },
      { x: 224, y: 74, w: 92, h: 74 },
    ]
    const route = routeSerpentine(
      { x: 16, y: 16, w: 144, h: 44 },
      { x: 456, y: 16, w: 122, h: 44 },
      columns,
      tiled,
      0,
      148,
      14,
    )
    expect(route.dipped).toBe(true)
    for (let i = 0; i < route.points.length - 1; i++) {
      expect(segmentClearsBoxes(route.points[i], route.points[i + 1], [...RUN3_BOXES, ...tiled])).toBe(true)
    }
  })

  it("steers a second skip edge off the band the first one took", () => {
    const a = { x: 16, y: 16, w: 144, h: 44 }
    const b = { x: 456, y: 16, w: 122, h: 44 }
    const crossed = [RUN3_BOXES[1], RUN3_BOXES[2]]
    // a taller crossed column leaves room for two stacked one-line bands:
    // the interior gap [66,100] fits band 1; band 2 excludes that anchor and
    // lands in the below-all band.
    const crossed2: Box[] = [
      { x: 224, y: 16, w: 92, h: 44 },
      { x: 224, y: 106, w: 90, h: 44 },
    ]
    const first = routeSerpentine(a, b, columns, crossed2, 0, 200, 10)
    // convention: callers exclude the earlier skip's LINE y (bypassY)
    const second = routeSerpentine(a, b, columns, crossed2, 1, 200, 10, [first.bypassY])
    expect(first.dipped).toBe(false)
    expect(second.dipped).toBe(false) // enough room for another band
    expect(second.bypassY).not.toBe(first.bypassY)
    // and their bypass lines never share a y
    expect(Math.abs(second.bypassY - first.bypassY)).toBeGreaterThanOrEqual(10)
  })
})

describe("edge label rect superset invariant (tb edge-label cycle)", () => {
  // Real rendered widths measured in Chrome at the 11px .exp-edge-label size
  // on the run-4 reharmonization page (.superpowers/shots/reharm-report.json).
  // The layout's estimate must be a SUPERSET of reality: est ≥ real for every
  // string, or the collision nudge is blind exactly as it was in fig 1 —
  // estimated rects 4–6px apart while real rects overlapped 90–286px².
  const REAL_WIDTHS: Array<[string, number]> = [
    ["Common Progression", 129.9],
    ["Diatonic Supertonic", 119.1],
    ["Borrowed Submediant", 134.2],
    ["Subdominant", 80.3], // widest line of the wrapped 2-line blocks
    ["Borrowed Supertonic", 127.6],
  ]

  it.each(REAL_WIDTHS)("estimates ≥ real width for %s", (text, real) => {
    expect(estimateEdgeTextWidth(text)).toBeGreaterThanOrEqual(real)
  })

  it("estimates ≥ real for space-heavy and digit strings", () => {
    // spaces are narrow but NOT free, and digits are tabular-width
    expect(estimateEdgeTextWidth("step 1 of 4")).toBeGreaterThanOrEqual(60)
    expect(estimateEdgeTextWidth("a b c d e f g h")).toBeGreaterThanOrEqual(80)
  })

  it("block rect height covers real rendered line boxes", () => {
    // real: 1-line 16.0, 2-line 31.0 (reharm-report.json) — current 14/29
    const one = edgeLabelRect({ label: "Strong Pull", labelX: 100, labelY: 100 })
    expect(one.h).toBeGreaterThanOrEqual(16)
    const two = edgeLabelRect({ label: "Diatonic Subdominant", lines: ["Diatonic", "Subdominant"], labelX: 100, labelY: 100 })
    expect(two.h).toBeGreaterThanOrEqual(31)
    expect(two.w).toBeGreaterThanOrEqual(81) // widest real line, not the string
  })
})

function distToSeg(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1
  const dy = y2 - y1
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

/** Distance from a label anchor to its own edge's path — polyline segments
 *  directly, cubics by sampling (adjacent tb edges route as cubics). */
function ownDistance(arrow: ArrowEl): number {
  const parts = arrow.d.replace(/^M /, "").split(/ (?=[LC])/)
  const start = parts[0].replace(/,/g, "").trim().split(/\s+/).map(Number)
  let min = Infinity
  let prev: [number, number] = [start[0], start[1]]
  const seg = (p1: [number, number], p2: [number, number]) => {
    min = Math.min(min, distToSeg(arrow.labelX!, arrow.labelY!, p1[0], p1[1], p2[0], p2[1]))
  }
  for (const part of parts) {
    const isCubic = part.startsWith("C")
    const nums = part
      .replace(/^[LC]\s*/, "")
      .replace(/,/g, "")
      .trim()
      .split(/\s+/)
      .map(Number)
    if (isCubic) {
      const [x1, y1, x2, y2, x, y] = nums
      let cp: [number, number] = prev
      for (let k = 1; k <= 16; k++) {
        const t = k / 16
        const mt = 1 - t
        const px = mt * mt * mt * prev[0] + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t * x
        const py = mt * mt * mt * prev[1] + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t * y
        seg(cp, [px, py])
        cp = [px, py]
      }
      prev = [x, y]
    } else {
      const p: [number, number] = [nums[0], nums[1]]
      seg(prev, p)
      prev = p
    }
  }
  return min
}

const arrowsOf = (scene: Scene): ArrowEl[] =>
  scene.elements.filter((e): e is ArrowEl => e.kind === "arrow" && e.label !== undefined)

const pairOverlapArea = (A: { x: number; y: number; w: number; h: number }, B: { x: number; y: number; w: number; h: number }): number => {
  const ix = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x)
  const iy = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y)
  return Math.max(0, ix) * Math.max(0, iy)
}

describe("tb edge-label routing (tb edge-label cycle T2)", () => {
  // The run-4 reharmonization fig 1 shape: one source fanning THREE labelled
  // adjacent edges into the next rank, two more out of a rank-1 node — every
  // defect measured there (same-anchor fan-out, orphaned labels, out-of-canvas
  // escapes) reproduces from this shape.
  const FIG1 = {
    nodes: [
      { id: "I", label: "C Major (I)" },
      { id: "iv", label: "F Minor (iv)" },
      { id: "ii7", label: "D Half-Diminished (iiø7)" },
      { id: "VI", label: "Ab Major (VI)" },
      { id: "IV", label: "F Major (IV)" },
      { id: "V", label: "G Major (V)" },
      { id: "ii", label: "D Minor (ii)" },
    ],
    edges: [
      { from: "I", to: "iv", label: "Borrowed Subdominant" },
      { from: "I", to: "ii7", label: "Borrowed Submediant" },
      { from: "I", to: "VI", label: "Borrowed Supertonic" },
      { from: "iv", to: "IV", label: "Diatonic Subdominant" },
      { from: "ii7", to: "ii", label: "Diatonic Supertonic" },
      { from: "VI", to: "V", label: "Common Progression" },
      { from: "VI", to: "ii", label: "Common Progression" },
    ],
    direction: "tb" as const,
  }

  it("separates a same-anchor fan-out without covering nodes", () => {
    const { scene } = layoutFlow(FIG1)
    const arrows = arrowsOf(scene)
    const rects = arrows.map(a => edgeLabelRect(a))
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const ix = Math.min(rects[i].x + rects[i].w, rects[j].x + rects[j].w) - Math.max(rects[i].x, rects[j].x)
        const iy = Math.min(rects[i].y + rects[i].h, rects[j].y + rects[j].h) - Math.max(rects[i].y, rects[j].y)
        expect(ix > 2 && iy > 2, `labels ${i} and ${j} overlap (${Math.round(ix * iy)}px2)`).toBe(false)
      }
    }
    // the fig-1 killer: a fan-out label sitting ON a node it does not belong to
    const nodes = scene.elements.filter(e => e.kind === "node-box") as Array<{ x: number; y: number; w: number; h: number; label?: string }>
    for (const r of rects) {
      for (const n of nodes) {
        const ix = Math.min(r.x + r.w, n.x + n.w) - Math.max(r.x, n.x)
        const iy = Math.min(r.y + r.h, n.y + n.h) - Math.max(r.y, n.y)
        expect(ix > 2 && iy > 2, `label overlaps node at ${n.x},${n.y}`).toBe(false)
      }
    }
  })

  it("keeps every label inside the canvas (T3: bounded escapes)", () => {
    const { scene } = layoutFlow(FIG1)
    for (const r of arrowsOf(scene).map(a => edgeLabelRect(a))) {
      expect(r.x, "label left edge inside canvas").toBeGreaterThanOrEqual(0)
      expect(r.x + r.w, "label right edge inside canvas").toBeLessThanOrEqual(scene.width)
    }
  })

  it("anchors an adjacent tb label near its own curve, not the source column", () => {
    const { scene } = layoutFlow(FIG1)
    const a = mustNode(scene, "I")
    const b = mustNode(scene, "VI")
    const arrow = arrowsOf(scene).find(x => x.id === "I->VI")
    if (!arrow) throw new Error("I->VI arrow not found")
    const spanMid = (a.x + a.w / 2 + b.x + b.w / 2) / 2
    // the curve's visual middle; the current source-column anchor is ~194px away
    expect(Math.abs(arrow.labelX! - spanMid), "label x vs span midpoint").toBeLessThanOrEqual(30)
    expect(ownDistance(arrow), "label to its own curve").toBeLessThanOrEqual(24)
  })

  it("routes a labelled tb skip through a clear bypass band, not the span midpoint", () => {
    const { scene } = layoutFlow({
      nodes: [
        { id: "apc", label: "Antigen-presenting cell" },
        { id: "ht", label: "Helper T cell" },
        { id: "kb", label: "Killer T cell" },
        { id: "ab", label: "B cell" },
      ],
      edges: [
        { from: "apc", to: "ht" },
        { from: "apc", to: "kb", label: "presents antigen" },
        { from: "ht", to: "kb" },
        { from: "kb", to: "ab" },
      ],
      direction: "tb",
    })
    // apc(rank0) -> kb(rank2) is the labelled skip; ht rides rank 1 beside it
    const skip = arrowsOf(scene).find(x => x.id === "apc->kb")
    if (!skip) throw new Error("apc->kb arrow not found")
    const pts = skip.d.replace(/^M /, "").split(" L ").length
    expect(pts, "serpentine route has 6 points (midpoint route has 4)").toBe(6)
    const crossed = [mustNode(scene, "ht")]
    const segs = skip.d.replace(/^M /, "").split(" L ").map(p => p.trim().split(/\s+/).map(Number) as [number, number])
    for (let i = 0; i < segs.length - 1; i++) {
      expect(segmentClearsBoxes(segs[i], segs[i + 1], crossed), `segment ${i} clears crossed boxes`).toBe(true)
    }
    // a tb label rides BESIDE its vertical bypass, so the distance scales with
    // the label's own width: centre-to-line = blockW/2 + 3. The bound catches
    // both the banded anchor (inside the band) and the dip anchor (outside).
    const blockW = Math.max(...(skip.lines ?? [skip.label!]).map(l => estimateEdgeTextWidth(l)))
    expect(ownDistance(skip), "label rides its bypass segment").toBeLessThanOrEqual(blockW / 2 + 10)
    // and no label anywhere on a node box (the fig-1 orphan killer)
    const nodes = scene.elements.filter(e => e.kind === "node-box") as Array<{ x: number; y: number; w: number; h: number }>
    const r = edgeLabelRect(skip)
    for (const n of nodes) {
      const ix = Math.min(r.x + r.w, n.x + n.w) - Math.max(r.x, n.x)
      const iy = Math.min(r.y + r.h, n.y + n.h) - Math.max(r.y, n.y)
      expect(ix > 2 && iy > 2, `skip label on node at ${n.x},${n.y}`).toBe(false)
    }
  })

  it("steers a second tb skip off the bypass band the first one took", () => {
    const { scene } = layoutFlow({
      nodes: [
        { id: "s", label: "Source" },
        { id: "m1", label: "Mid one" },
        { id: "m2", label: "Mid two" },
        { id: "t1", label: "Target one" },
        { id: "t2", label: "Target two" },
      ],
      edges: [
        { from: "s", to: "t1", label: "first skip" },
        { from: "s", to: "t2", label: "second skip" },
        { from: "s", to: "m1" },
        { from: "s", to: "m2" },
        { from: "m1", to: "t1" },
        { from: "m2", to: "t2" },
      ],
      direction: "tb",
    })
    const s1 = arrowsOf(scene).find(x => x.id === "s->t1")
    const s2 = arrowsOf(scene).find(x => x.id === "s->t2")
    if (!s1 || !s2) throw new Error("skip arrows not found")
    const x1 = s1.d.split(" L ")[2].trim().split(/\s+/).map(Number)[0]
    const x2 = s2.d.split(" L ")[2].trim().split(/\s+/).map(Number)[0]
    expect(Math.abs(x2 - x1), "bypass lines differ").toBeGreaterThanOrEqual(10)
  })
})
