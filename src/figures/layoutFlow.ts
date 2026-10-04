import type { EdgeKind, NodeShape, Scene } from "./scene"

export interface FlowNodeSpec {
  id: string
  label: string
  shape?: NodeShape
  tip?: string
}

export interface FlowEdgeSpec {
  from: string
  to: string
  label?: string
  kind?: EdgeKind
}

export interface FlowSpec {
  nodes: FlowNodeSpec[]
  edges: FlowEdgeSpec[]
  direction?: "lr" | "tb"
}

export interface FlowLayoutResult {
  scene: Scene
  warnings: string[]
}

const NODE_W_MIN = 90
const NODE_W_MAX = 260
const LINE_H = 44 // height of a single-line node
const LINE_PITCH = 16 // extra vertical room per additional text line
const GAP_MAIN = 64 // minimum gap between columns (lr) or rows (tb)
const MAX_LABEL_GUTTER = 140 // cap on a label-driven gutter, so one long
                               // label cannot blow up the figure's width
const LABEL_PAD = 16 // breathing room either side of a single-line label
const GAP_CROSS = 28 // gap between rows (lr) or columns (tb)
const PAD = 16
const CHAR_W = 7.5 // width estimate per character at 13px
const EDGE_CHAR_W = 6.0 // per-char estimate at the 11px .exp-edge-label size
export const EDGE_LABEL_PITCH = 15 // line pitch at that size

/** Wrap an EDGE label to the gutter it is routed through. Unlike `wrapLabel`
 *  there is no node padding to reserve, and any single word wider than the
 *  gutter is hard-split — an edge label is never dropped, so it must never
 *  overflow either (figure label-overflow spec §3.1). */
export function wrapEdgeLabel(label: string, avail: number): string[] {
  const maxChars = Math.max(4, Math.floor(avail / EDGE_CHAR_W))
  const words = label.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ""
  for (const word of words) {
    if (word.length > maxChars) {
      if (current) {
        lines.push(current)
        current = ""
      }
      for (let i = 0; i < word.length; i += maxChars) lines.push(word.slice(i, i + maxChars))
      continue
    }
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length > maxChars) {
      lines.push(current)
      current = word
    } else {
      current = candidate
    }
  }
  if (current) lines.push(current)
  return lines.length > 0 ? lines : [label]
}

/** Deterministic width estimate for a single-line label, clamped. */
export function nodeWidth(label: string): number {
  return Math.min(NODE_W_MAX, Math.max(NODE_W_MIN, Math.round(label.length * CHAR_W) + 24))
}

/** Word-wrap a label into lines that fit `w` (same 7.5px/char estimate).
 *  Hard-splits any single word wider than the line so nothing overflows. */
function wrapLabel(label: string, w: number): string[] {
  const maxChars = Math.max(8, Math.floor((w - 24) / CHAR_W))
  const words = label.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ""
  for (const word of words) {
    if (word.length > maxChars) {
      if (current) {
        lines.push(current)
        current = ""
      }
      for (let i = 0; i < word.length; i += maxChars) lines.push(word.slice(i, i + maxChars))
      continue
    }
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length > maxChars) {
      lines.push(current)
      current = word
    } else {
      current = candidate
    }
  }
  if (current) lines.push(current)
  return lines.length > 0 ? lines : [label]
}

/** Stable key for an edge, shared by the back-edge set and the arrow `id`. */
function edgeKey(e: FlowEdgeSpec): string {
  return `${e.from}->${e.to}`
}

/** Edges that point back at a node currently on the DFS stack. Any cycle in
 *  the graph contains at least one, so removing them leaves a DAG — which is
 *  what makes step 3's relaxation terminate.
 *
 *  Iterative rather than recursive: this walks a model-authored graph, and a
 *  deep chain must not overflow the stack. Adjacency is visited in SPEC order
 *  so the classification (and therefore the layout) is deterministic. */
function findBackEdges(nodes: FlowNodeSpec[], edges: FlowEdgeSpec[]): Set<string> {
  const outgoing = new Map<string, FlowEdgeSpec[]>()
  for (const n of nodes) outgoing.set(n.id, [])
  for (const e of edges) outgoing.get(e.from)!.push(e)

  const WHITE = 0 // unvisited
  const GREY = 1 // on the current stack
  const BLACK = 2 // finished
  const state = new Map<string, number>(nodes.map(n => [n.id, WHITE]))
  const back = new Set<string>()

  for (const root of nodes) {
    if (state.get(root.id) !== WHITE) continue
    // Explicit stack of [nodeId, next adjacency index].
    const stack: [string, number][] = [[root.id, 0]]
    state.set(root.id, GREY)
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]
      const adj = outgoing.get(frame[0])!
      if (frame[1] >= adj.length) {
        state.set(frame[0], BLACK)
        stack.pop()
        continue
      }
      const e = adj[frame[1]++]
      const s = state.get(e.to)
      if (s === GREY) {
        back.add(edgeKey(e)) // to an ancestor: a back edge
      } else if (s === WHITE) {
        state.set(e.to, GREY)
        stack.push([e.to, 0])
      }
    }
  }
  return back
}

const RETURN_DROP = 26 // how far below the last node a return path dips
const RETURN_LANE = 18 // extra depth per back edge, so two cycles don't overlap

/** The TRUE lowest point of a cubic whose two control points both sit at
 *  `ly`, given endpoints at `y0`/`y3`.
 *
 *  The control line is NOT the curve's extent. With equal endpoints the curve
 *  reaches only `y0 + 0.75*(ly - y0)` — three quarters of the way — so sizing
 *  a scene from `ly` would clip a return path by ~26px. Differentiating
 *  y(t) = mt³y0 + 3mt²t·ly + 3mt·t²·ly + t³y3 gives t* = u/(1+u) with
 *  u = √((ly-y0)/(ly-y3)); this evaluates y there.
 *
 *  Computed FORWARD (control depth → real depth): exact, and no inversion. */
function cubicDepth(y0: number, y3: number, ly: number): number {
  if (ly <= Math.max(y0, y3)) return Math.max(y0, y3)
  const u = Math.sqrt((ly - y0) / (ly - y3))
  const t = u / (1 + u)
  const mt = 1 - t
  return mt * mt * mt * y0 + 3 * mt * mt * t * ly + 3 * mt * t * t * ly + t * t * t * y3
}

interface Placed {
  id: string
  label: string
  lines?: string[]
  shape: NodeShape
  tip?: string
  x: number
  y: number
  w: number
  h: number
}

export function layoutFlow(spec: FlowSpec): FlowLayoutResult {
  const warnings: string[] = []
  const direction = spec.direction ?? "lr"

  // 1. Dedupe nodes by id (keep first).
  const nodes: FlowNodeSpec[] = []
  const seen = new Set<string>()
  for (const n of spec.nodes) {
    if (seen.has(n.id)) {
      warnings.push(`figure-node-duplicate: node id "${n.id}" appears more than once; keeping the first`)
      continue
    }
    seen.add(n.id)
    nodes.push(n)
  }
  const byId = new Map(nodes.map(n => [n.id, n]))

  // 2. Keep only edges whose endpoints exist; drop self-edges.
  const edges: FlowEdgeSpec[] = []
  for (const e of spec.edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) {
      warnings.push(`figure-edge-dangling: edge "${e.from}"→"${e.to}" references an unknown node; dropped`)
      continue
    }
    if (e.from === e.to) {
      warnings.push(`figure-edge-self: edge on node "${e.from}" dropped`)
      continue
    }
    edges.push(e)
  }

  // 3. Layering. A model-authored graph may contain a CYCLE (a feedback loop
  //    such as "revalidate -> cache" pointing back at an earlier node), and
  //    plain longest-path relaxation cannot terminate on one: every pass finds
  //    some edge it can still push, so layers grow without bound until the
  //    pass cap stops it. A 5-node cycle reached layer 16 and left 13 empty
  //    ranks, which tripled the figure's width and forced the emit layer to
  //    scale it down to half size.
  //
  //    So: classify back edges with a DFS, then relax over the acyclic
  //    remainder, which terminates by construction. Back edges keep their
  //    authored direction and are routed as return paths in step 6.
  const backEdges = findBackEdges(nodes, edges)
  const forward = edges.filter(e => !backEdges.has(edgeKey(e)))
  const layer = new Map<string, number>(nodes.map(n => [n.id, 0]))
  for (let pass = 0; pass < nodes.length; pass++) {
    let changed = false
    for (const e of forward) {
      const next = layer.get(e.from)! + 1
      if (next > layer.get(e.to)!) {
        layer.set(e.to, next)
        changed = true
      }
    }
    if (!changed) break
  }

  // 4. Column/row membership in spec order (stable).
  const maxLayer = Math.max(0, ...nodes.map(n => layer.get(n.id)!))
  const ranks: string[][] = Array.from({ length: maxLayer + 1 }, () => [])
  for (const n of nodes) ranks[layer.get(n.id)!].push(n.id)

  // 5. Positions with label wrapping: node width fits its widest line,
  //    height grows with line count; cross-axis accumulates real heights.
  const wrapFor = (n: FlowNodeSpec): { w: number; lines: string[]; h: number } => {
    const w = nodeWidth(n.label)
    const lines = wrapLabel(n.label, w)
    const maxLine = Math.max(...lines.map(l => l.length))
    const fittedW = Math.min(NODE_W_MAX, Math.max(NODE_W_MIN, Math.round(maxLine * CHAR_W) + 24))
    return { w: fittedW, lines, h: LINE_H + (lines.length - 1) * LINE_PITCH }
  }
  const placed = new Map<string, Placed>()
  let mainOffset = PAD
  let crossExtent = 0
  // Label-aware gutters (spec §2.7): the gap between rank r and r+1 widens to
  // fit the longest label crossing it, so an ordinary label sits on ONE line
  // instead of stacking into a narrow column. Capped, and still never narrower
  // than GAP_MAIN — short-label diagrams are exactly as compact as before.
  const gutters: number[] = ranks.map((_, r) => {
    let need = GAP_MAIN
    for (const e of edges) {
      const from = layer.get(e.from)!
      const to = layer.get(e.to)!
      if (Math.abs(from - to) !== 1 || Math.min(from, to) !== r) continue
      if (!e.label) continue
      need = Math.max(need, e.label.length * EDGE_CHAR_W + LABEL_PAD)
    }
    return Math.min(MAX_LABEL_GUTTER, need)
  })
  let lastGutter = GAP_MAIN
  ranks.forEach((rankIds, r) => {
    let cross = PAD
    rankIds.forEach(id => {
      const n = byId.get(id)!
      const { w, lines, h } = wrapFor(n)
      placed.set(id, {
        id,
        label: n.label,
        lines: lines.length > 1 ? lines : undefined,
        shape: n.shape ?? "box",
        tip: n.tip,
        w,
        h,
        x: direction === "lr" ? mainOffset : cross,
        y: direction === "lr" ? cross : mainOffset,
      })
      cross += h + GAP_CROSS
    })
    crossExtent = Math.max(crossExtent, cross - GAP_CROSS)
    lastGutter = gutters[r] ?? GAP_MAIN
    mainOffset += Math.max(0, ...rankIds.map(id => placed.get(id)!.w)) + lastGutter
  })
  let width = direction === "lr" ? mainOffset - lastGutter + PAD : crossExtent + PAD
  let height = direction === "lr" ? crossExtent + PAD : mainOffset - lastGutter + PAD

  // 6. Edges FIRST (so opaque node fills cover any crossing line), with
  //    skip-rank edges routed orthogonally through the column gutter, and
  //    back edges routed as return paths around the outside.
  const elements: Scene["elements"] = []
  // Lane index per back edge, so a diagram with two cycles draws them at
  // different depths instead of overprinting.
  let returnLane = 0
  for (const e of edges) {
    const a = placed.get(e.from)!
    const b = placed.get(e.to)!
    let d: string
    let head: string
    let labelX: number
    let labelY: number
    const adjacent = Math.abs(layer.get(e.to)! - layer.get(e.from)!) === 1

    if (backEdges.has(edgeKey(e))) {
      // A feedback loop. Route it out of the source and back into the target
      // from below (lr) or from the right (tb), so it reads as "…and this
      // feeds back" rather than fighting the left-to-right reading order.
      const lane = returnLane++
      if (direction === "lr") {
        const sx = a.x + a.w / 2
        const sy = a.y + a.h
        const tx = b.x + b.w / 2
        const ty = b.y + b.h
        const control = crossExtent + PAD + RETURN_DROP + lane * RETURN_LANE
        const real = cubicDepth(sy, ty, control)
        height = Math.max(height, real + PAD)
        d =
          Math.abs(sx - tx) < 1
            ? `M ${sx} ${sy} L ${sx} ${control} L ${tx} ${control} L ${tx} ${ty}`
            : `M ${sx} ${sy} C ${sx} ${control}, ${tx} ${control}, ${tx} ${ty}`
        // Head sits at the target's bottom edge pointing UP into it.
        head = `M ${tx} ${ty} L ${tx - 4.5} ${ty + 9} L ${tx + 4.5} ${ty + 9} Z`
        labelX = (sx + tx) / 2
        labelY = real - 6
      } else {
        const sx = a.x + a.w
        const sy = a.y + a.h / 2
        const tx = b.x
        const ty = b.y + b.h / 2
        const control = crossExtent + PAD + RETURN_DROP + lane * RETURN_LANE
        const real = cubicDepth(sx, tx, control)
        width = Math.max(width, real + PAD)
        d =
          Math.abs(sy - ty) < 1
            ? `M ${sx} ${sy} L ${control} ${sy} L ${control} ${ty} L ${tx} ${ty}`
            : `M ${sx} ${sy} C ${control} ${sy}, ${control} ${ty}, ${tx} ${ty}`
        // Head sits at the target's right edge pointing LEFT into it.
        head = `M ${tx} ${ty} L ${tx + 9} ${ty - 4.5} L ${tx + 9} ${ty + 4.5} Z`
        labelX = real + 6
        labelY = (sy + ty) / 2
      }

      const lines = e.label ? wrapEdgeLabel(e.label, Math.max(8, Math.abs(direction === "lr" ? a.x + a.w / 2 - (b.x + b.w / 2) : a.y + a.h / 2 - (b.y + b.h / 2)))) : []
      const shift = ((lines.length - 1) * EDGE_LABEL_PITCH) / 2
      elements.push({
        kind: "arrow",
        d,
        head,
        edgeKind: e.kind ?? "leads",
        label: e.label,
        ...(lines.length > 1 ? { lines } : {}),
        labelX,
        labelY: labelY - shift,
        id: edgeKey(e),
      })
      continue
    }

    if (direction === "lr") {
      const sx = a.x + a.w
      const sy = a.y + a.h / 2
      const tx = b.x - 2
      const ty = b.y + b.h / 2
      if (adjacent) {
        const mx = (sx + tx) / 2
        d = `M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ty}, ${tx} ${ty}`
        head = `M ${tx} ${ty} L ${tx - 9} ${ty - 4.5} L ${tx - 9} ${ty + 4.5} Z`
        labelX = mx
        labelY = (sy + ty) / 2 - 6
      } else {
        const gutterX = a.x + a.w + (b.x - (a.x + a.w)) / 2
        d = `M ${sx} ${sy} L ${gutterX} ${sy} L ${gutterX} ${ty} L ${tx} ${ty}`
        head = `M ${tx} ${ty} L ${tx - 9} ${ty - 4.5} L ${tx - 9} ${ty + 4.5} Z`
        labelX = gutterX
        labelY = Math.min(sy, ty) - 6
      }
    } else {
      const sx = a.x + a.w / 2
      const sy = a.y + a.h
      const tx = b.x + b.w / 2
      const ty = b.y - 2
      if (adjacent) {
        const my = (sy + ty) / 2
        d = `M ${sx} ${sy} C ${sx} ${my}, ${tx} ${my}, ${tx} ${ty}`
        head = `M ${tx} ${ty} L ${tx - 4.5} ${ty - 9} L ${tx + 4.5} ${ty - 9} Z`
        labelX = sx
        labelY = my - 6
      } else {
        const gutterY = a.y + a.h + (b.y - (a.y + a.h)) / 2
        d = `M ${sx} ${sy} L ${sx} ${gutterY} L ${tx} ${gutterY} L ${tx} ${ty}`
        head = `M ${tx} ${ty} L ${tx - 4.5} ${ty - 9} L ${tx + 4.5} ${ty - 9} Z`
        labelX = sx
        labelY = gutterY - 6
      }
    }
    // Available label width for this edge. For `lr` the label sits in the
    // horizontal gutter between two columns (for a skip-rank edge, the whole
    // span its orthogonal route crosses). For `tb` the label is horizontal
    // text centred on the source column, so its bound is that column's width —
    // a cross-axis span would shred it into three-character chunks.
    const gutterW =
      direction === "lr"
        ? Math.max(8, b.x - (a.x + a.w))
        : Math.min(MAX_LABEL_GUTTER, Math.max(a.w, b.w))
    const lines = e.label ? wrapEdgeLabel(e.label, gutterW) : []

    // labelY from the path maths is where the FIRST line sits; shift it up by
    // half the block so the block as a whole is centred on the edge.
    const shift = ((lines.length - 1) * EDGE_LABEL_PITCH) / 2

    elements.push({
      kind: "arrow",
      d,
      head,
      edgeKind: e.kind ?? "leads",
      label: e.label,
      ...(lines.length > 1 ? { lines } : {}),
      labelX,
      labelY: labelY - shift,
      id: `${e.from}->${e.to}`,
    })
  }

  // 7. Nodes AFTER edges: their opaque fill covers crossings.
  for (const p of placed.values()) {
    elements.push({
      kind: "node-box",
      id: p.id,
      x: p.x,
      y: p.y,
      w: p.w,
      h: p.h,
      shape: p.shape,
      label: p.label,
      lines: p.lines,
      tip: p.tip,
    })
  }

  // 8. Scene extent must CONTAIN every wrapped label block: a multi-line edge
  //    label can reach past the node bounds it was laid out against, and a
  //    viewBox clips whatever falls outside it.
  let minY = 0
  let maxY = height
  for (const el of elements) {
    if (el.kind !== "arrow" || el.labelY === undefined) continue
    const n = el.lines?.length ?? 1
    const half = ((n - 1) * EDGE_LABEL_PITCH) / 2 + n * 2
    minY = Math.min(minY, el.labelY - half)
    maxY = Math.max(maxY, el.labelY + half)
  }
  if (minY < 0 || maxY > height) {
    const grow = maxY - height
    // Shift everything down when a block hangs above the origin; grow the box
    // when it hangs below. Either way nothing is clipped.
    for (const el of elements) {
      if (el.kind === "node-box") el.y -= minY
      else if (el.kind === "arrow" && el.labelY !== undefined) el.labelY -= minY
    }
    height = Math.max(height - minY, height + grow)
  }

  return { scene: { width: Math.max(width, 240), height: Math.max(height, 76), elements }, warnings }
}
