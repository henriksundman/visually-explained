import type { EdgeKind, NodeShape, Scene } from "./scene"

export interface FlowNodeSpec {
  id: string
  label: string
  shape?: NodeShape
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
const GAP_MAIN = 64 // gap between columns (lr) or rows (tb)
const GAP_CROSS = 28 // gap between rows (lr) or columns (tb)
const PAD = 16
const CHAR_W = 7.5 // width estimate per character at 13px

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

interface Placed {
  id: string
  label: string
  lines?: string[]
  shape: NodeShape
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

  // 3. Longest-path layering via capped relaxation (deterministic even with
  //    cycles: capped at nodes.length passes, so cyclic layers stabilize).
  const layer = new Map<string, number>(nodes.map(n => [n.id, 0]))
  for (let pass = 0; pass < nodes.length; pass++) {
    let changed = false
    for (const e of edges) {
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
  ranks.forEach(rankIds => {
    let cross = PAD
    rankIds.forEach(id => {
      const n = byId.get(id)!
      const { w, lines, h } = wrapFor(n)
      placed.set(id, {
        id,
        label: n.label,
        lines: lines.length > 1 ? lines : undefined,
        shape: n.shape ?? "box",
        w,
        h,
        x: direction === "lr" ? mainOffset : cross,
        y: direction === "lr" ? cross : mainOffset,
      })
      cross += h + GAP_CROSS
    })
    crossExtent = Math.max(crossExtent, cross - GAP_CROSS)
    mainOffset += Math.max(0, ...rankIds.map(id => placed.get(id)!.w)) + GAP_MAIN
  })
  const width = direction === "lr" ? mainOffset - GAP_MAIN + PAD : crossExtent + PAD
  const height = direction === "lr" ? crossExtent + PAD : mainOffset - GAP_MAIN + PAD

  // 6. Edges FIRST (so opaque node fills cover any crossing line), with
  //    skip-rank edges routed orthogonally through the column gutter.
  const elements: Scene["elements"] = []
  for (const e of edges) {
    const a = placed.get(e.from)!
    const b = placed.get(e.to)!
    let d: string
    let head: string
    let labelX: number
    let labelY: number
    const adjacent = Math.abs(layer.get(e.to)! - layer.get(e.from)!) === 1
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
    elements.push({ kind: "arrow", d, head, edgeKind: e.kind ?? "leads", label: e.label, labelX, labelY })
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
    })
  }

  return { scene: { width: Math.max(width, 240), height: Math.max(height, 76), elements }, warnings }
}
