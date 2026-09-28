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
const NODE_H = 44
const GAP_MAIN = 64 // gap between columns (lr) or rows (tb)
const GAP_CROSS = 28 // gap between rows (lr) or columns (tb)
const PAD = 16

/** Deterministic width estimate: ~7.5px/char at 13px, clamped. */
export function nodeWidth(label: string): number {
  return Math.min(NODE_W_MAX, Math.max(NODE_W_MIN, Math.round(label.length * 7.5) + 24))
}

interface Placed {
  id: string
  label: string
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

  // 5. Positions.
  const thickness = NODE_H + GAP_CROSS // cross-axis pitch
  const mainSizes = ranks.map(rankIds => Math.max(0, ...rankIds.map(id => nodeWidth(byId.get(id)!.label))))
  const placed = new Map<string, Placed>()
  let mainOffset = PAD
  ranks.forEach((rankIds, r) => {
    rankIds.forEach((id, i) => {
      const n = byId.get(id)!
      const w = nodeWidth(n.label)
      const cross = PAD + i * thickness
      placed.set(id, {
        id,
        label: n.label,
        shape: n.shape ?? "box",
        w,
        h: NODE_H,
        x: direction === "lr" ? mainOffset : cross,
        y: direction === "lr" ? cross : mainOffset,
      })
    })
    mainOffset += mainSizes[r] + GAP_MAIN
  })
  const crossCount = Math.max(1, ...ranks.map(r => r.length))
  const width = direction === "lr" ? mainOffset - GAP_MAIN + PAD : PAD * 2 + crossCount * thickness - GAP_CROSS
  const height = direction === "lr" ? PAD * 2 + crossCount * thickness - GAP_CROSS : mainOffset - GAP_MAIN + PAD

  // 6. Edges: cubic shaft + explicit arrowhead triangle (no <defs>/marker ids —
  //    multiple figures per page must not collide).
  const elements: Scene["elements"] = [...placed.values()].map(p => ({
    kind: "node-box" as const,
    ...p,
  }))
  for (const e of edges) {
    const a = placed.get(e.from)!
    const b = placed.get(e.to)!
    let d: string
    let head: string
    let labelX: number
    let labelY: number
    if (direction === "lr") {
      const sx = a.x + a.w
      const sy = a.y + a.h / 2
      const tx = b.x - 2
      const ty = b.y + b.h / 2
      const mx = (sx + tx) / 2
      d = `M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ty}, ${tx} ${ty}`
      head = `M ${tx} ${ty} L ${tx - 9} ${ty - 4.5} L ${tx - 9} ${ty + 4.5} Z`
      labelX = mx
      labelY = (sy + ty) / 2 - 6
    } else {
      const sx = a.x + a.w / 2
      const sy = a.y + a.h
      const tx = b.x + b.w / 2
      const ty = b.y - 2
      const my = (sy + ty) / 2
      d = `M ${sx} ${sy} C ${sx} ${my}, ${tx} ${my}, ${tx} ${ty}`
      head = `M ${tx} ${ty} L ${tx - 4.5} ${ty - 9} L ${tx + 4.5} ${ty - 9} Z`
      labelX = sx
      labelY = my - 6
    }
    elements.push({ kind: "arrow", d, head, edgeKind: e.kind ?? "leads", label: e.label, labelX, labelY })
  }

  return { scene: { width: Math.max(width, 240), height: Math.max(height, 76), elements }, warnings }
}
