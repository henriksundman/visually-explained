import type { LinePathEl, NodeBoxEl, NodeShape, Scene } from "./scene"

/** One node of a containment tree. Deliberately the same shape the block's
 *  IR uses, so the layout has no translation layer to get out of sync. */
export interface TreeNodeSpec {
  label: string
  children?: TreeNodeSpec[]
  /** Hover/focus text (1-200 chars). NOT layout input: it never moves a box.
   *  Carried so `wrapIdentity` can emit `data-tip` + `tabindex`, which is what
   *  makes a node keyboard-reachable rather than pointer-only. */
  tip?: string
}

export const TREE_PAD = 16
export const TREE_H_GAP = 44
export const TREE_V_GAP = 18
export const TREE_NODE_W_MAX = 176
export const TREE_NODE_W_MIN = 64
export const TREE_NODE_H = 44
const CHAR_W = 7.5 // per-char estimate at 13px — same basis as layoutFlow's
const NODE_PAD = 24
const MULTI_LINE_STEP = 18
const MULTI_LINE_PAD = 20

/**
 * Widest scene the figure form may occupy (spec §4.4). Derived, not chosen: a
 * scene of width W scales to the column, so an 11px label renders at
 * 11 × (column / W); holding that at a readable 8px in a ~600px column puts
 * the ceiling at 825. Past it the figure is not a wide diagram, it is a
 * shrunken one. Same arithmetic, and the same number, as `layoutTimeline`.
 */
export const TREE_MAX_SCENE_W = 825

interface Measured {
  label: string
  tip?: string
  depth: number
  w: number
  h: number
  /** Total vertical band this node's whole subtree occupies. */
  subtreeH: number
  kids: Measured[]
  x: number
  y: number
}

function n(v: number): string {
  return String(Math.round(v * 100) / 100)
}

function wrap(label: string, avail: number): string[] {
  const maxChars = Math.max(8, Math.floor((avail - NODE_PAD) / CHAR_W))
  if (label.length <= maxChars) return [label]
  const lines: string[] = []
  let line = ""
  for (const word of label.split(/\s+/)) {
    if (word === "") continue
    const next = line ? `${line} ${word}` : word
    if (next.length > maxChars && line) { lines.push(line); line = word } else { line = next }
  }
  if (line) lines.push(line)
  // A single unbreakable token (a long identifier) has no whitespace to wrap
  // on, so it must be hard-cut or it would widen the column without bound.
  return lines.map(l => (l.length <= maxChars ? l : l.slice(0, maxChars)))
}

function nodeWidth(lines: string[]): number {
  const longest = Math.max(...lines.map(l => l.length))
  return Math.min(TREE_NODE_W_MAX, Math.max(TREE_NODE_W_MIN, Math.round(longest * CHAR_W) + NODE_PAD))
}

function nodeHeight(lines: string[]): number {
  return lines.length === 1 ? TREE_NODE_H : lines.length * MULTI_LINE_STEP + MULTI_LINE_PAD
}

/** Pass 1 — post-order. Subtree extents only; nothing is placed yet. */
function measure(spec: TreeNodeSpec, depth: number): Measured {
  const lines = wrap(spec.label, TREE_NODE_W_MAX)
  const kids = (spec.children ?? []).map(c => measure(c, depth + 1))
  return {
    label: spec.label,
    tip: spec.tip,
    depth,
    w: nodeWidth(lines),
    h: nodeHeight(lines),
    subtreeH: kids.length === 0
      ? nodeHeight(lines)
      : kids.reduce((s, k) => s + k.subtreeH, 0) + (kids.length - 1) * TREE_V_GAP,
    kids,
    x: 0,
    y: 0,
  }
}

/** Pre-order: a node, then its whole subtree. This is also the id order. */
function flatten(m: Measured): Measured[] {
  const out: Measured[] = []
  const walk = (x: Measured): void => {
    out.push(x)
    for (const k of x.kids) walk(k)
  }
  walk(m)
  return out
}

/**
 * A horizontal dendrogram.
 *
 * Pass 1 measures subtree extents bottom-up; pass 2 seats each child subtree
 * inside its parent's band with the PARENT CENTRED OVER IT. That centring is
 * the entire reason this is not `layoutFlow`, which ranks children and
 * left-aligns them — measured at ~162px off on the spec's own example tree.
 *
 * Columns hug their own widest label, so a tree of short names stays narrow
 * instead of inheriting the width of one long one.
 */
export function layoutTree(root: TreeNodeSpec): { scene: Scene } {
  const m = measure(root, 0)

  const colW: number[] = []
  for (const node of flatten(m)) colW[node.depth] = Math.max(colW[node.depth] ?? 0, node.w)

  const colX: number[] = []
  let acc = TREE_PAD
  for (const w of colW) { colX.push(acc); acc += w + TREE_H_GAP }

  // Pass 2 — pre-order placement. A node is centred within its own subtree
  // band, and the kids fill that band exactly (pass 1 summed them with the
  // same gaps), so the parent's centre and its children's span centre are the
  // same number by construction rather than by correction.
  const place = (node: Measured, top: number): void => {
    node.x = colX[node.depth]!
    node.y = top + (node.subtreeH - node.h) / 2
    let cursor = top
    for (const k of node.kids) {
      place(k, cursor)
      cursor += k.subtreeH + TREE_V_GAP
    }
  }
  place(m, TREE_PAD)

  const all = flatten(m)
  const width = TREE_PAD * 2 + colW.reduce((s, w) => s + w, 0) + TREE_H_GAP * (colW.length - 1)
  const height = TREE_PAD * 2 + m.subtreeH

  const ids = new Map<Measured, string>()
  all.forEach((node, i) => ids.set(node, `n${i}`))

  // Shape carries depth, so hierarchy reads without the connectors. This is
  // the same vocabulary `diagram` already uses, not a new one.
  const shapeFor = (depth: number): NodeShape => depth === 0 ? "pill" : depth === 1 ? "box" : "note"

  const elements: Scene["elements"] = []
  for (const node of all) {
    const lines = wrap(node.label, node.w)
    const box: NodeBoxEl = {
      kind: "node-box",
      id: ids.get(node)!,
      x: node.x,
      y: node.y,
      w: node.w,
      h: node.h,
      shape: shapeFor(node.depth),
      label: node.label,
    }
    // Only when present: `wrapIdentity` tests tip truthiness, so an empty
    // string would emit a focusable element that says nothing.
    if (node.tip) box.tip = node.tip
    if (lines.length > 1) box.lines = lines
    elements.push(box)
  }

  // Connectors: ONE trunk per parent. An elbow from the parent's centre to
  // each child's centre would stack every vertical segment on a single x and
  // overlap — the standard hand-rolled-tree mistake. One vertical trunk in the
  // children's column, reached by one horizontal stub from the parent, cannot
  // self-overlap because the children are contiguous in y by construction.
  // No arrowhead: containment is not directed.
  for (const node of all) {
    if (node.kids.length === 0) continue
    const exitX = node.x + node.w
    const trunkX = node.kids[0]!.x
    const pcy = node.y + node.h / 2
    const first = node.kids[0]!.y + node.kids[0]!.h / 2
    const last = node.kids[node.kids.length - 1]!
    const lastCy = last.y + last.h / 2
    const trunk: LinePathEl = {
      kind: "line-path",
      d: node.kids.length === 1
        ? `M ${n(exitX)} ${n(pcy)} L ${n(trunkX)} ${n(first)}`
        : `M ${n(exitX)} ${n(pcy)} L ${n(trunkX)} ${n(pcy)} L ${n(trunkX)} ${n(first)} L ${n(trunkX)} ${n(lastCy)}`,
    }
    elements.push(trunk)
  }

  return { scene: { width, height, elements } }
}

export function mindMapTreeStats(root: TreeNodeSpec): { nodes: number; depth: number } {
  let deepest = 0
  for (const node of flatten(measure(root, 0))) deepest = Math.max(deepest, node.depth)
  return { nodes: flatten(measure(root, 0)).length, depth: deepest + 1 }
}

export function mindMapFigureWidth(root: TreeNodeSpec): number {
  return layoutTree(root).scene.width
}

export function mindMapFigureFits(root: TreeNodeSpec): boolean {
  return mindMapFigureWidth(root) <= TREE_MAX_SCENE_W
}
