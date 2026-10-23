import type { EdgeKind, NodeShape, Scene } from "./scene"
import { plainMathLabel } from "./labelMath"

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
const GAP_MAIN = 88 // minimum gap between columns (lr) or rows (tb) — raised
                     // from 64 (2026-10-09 review: dense figures still read
                     // cramped; the slope gutter and crossing slide shrank the
                     // problem, the minimums were still tuned tight)
const MAX_LABEL_GUTTER = 140 // cap on a label-driven gutter, so one long
                             // label cannot blow up the figure's width
const LABEL_PAD = 16 // breathing room either side of a single-line label
const GAP_CROSS = 44 // gap between rows (lr) or columns (tb) — raised from 28
                     // for the same reason as GAP_MAIN
const PAD = 24
const CHAR_W = 7.5 // width estimate per character at 13px (node labels)
const EDGE_LABEL_H = 16 // measured single-line label block height at 11px
export const EDGE_LABEL_PITCH = 15 // line pitch at that size

/** Estimated rendered width of one edge-label line. The collision nudge and
 *  the wrap logic MUST agree on this (one source of truth), and it must be a
 *  SUPERSET of the real rendered width — measured 6.3–7.3px/char in Chrome
 *  at 11px (proportional font), so a flat per-char estimate narrower than
 *  that blinds the nudge to real collisions (tb edge-label spec D1). */
const EDGE_CHAR_W_TABLE: Record<string, number> = {
  "0": 8.12, "1": 5.96, "2": 7.77, "3": 8.08,
  "4": 8.29, "5": 7.96, "6": 8.20, "7": 7.50,
  "8": 8.23, "9": 8.20, " ": 3.58, "!": 3.97,
  "\"": 6.13, "#": 8.12, "$": 8.12, "%": 11.95,
  "&": 9.18, "'": 3.79, "(": 4.89, ")": 4.89,
  "*": 6.06, "+": 8.12, ",": 3.79, "-": 6.06,
  ".": 3.79, "/": 3.91, ":": 3.79, ";": 3.79,
  "<": 8.12, "=": 8.12, ">": 8.12, "?": 6.59,
  "@": 11.86, "A": 8.69, "B": 8.47, "C": 9.23,
  "D": 9.37, "E": 7.67, "F": 7.37, "G": 9.63,
  "H": 9.57, "I": 3.41, "J": 6.92, "K": 8.49,
  "L": 7.31, "M": 11.29, "N": 9.57, "O": 9.95,
  "P": 8.18, "Q": 9.95, "R": 8.42, "S": 8.21,
  "T": 8.17, "U": 9.51, "V": 8.69, "W": 12.51,
  "X": 8.75, "Y": 8.44, "Z": 8.53, "[": 4.89,
  "\\": 3.91, "]": 4.89, "^": 8.12, "_": 7.20,
  "`": 6.43, "a": 7.10, "b": 7.91, "c": 7.20,
  "d": 7.91, "e": 7.35, "f": 4.63, "g": 7.85,
  "h": 7.57, "i": 3.14, "j": 3.18, "k": 6.98,
  "l": 3.21, "m": 11.24, "n": 7.51, "o": 7.61,
  "p": 7.86, "q": 7.85, "r": 4.96, "s": 6.65,
  "t": 4.65, "u": 7.51, "v": 6.97, "w": 9.99,
  "x": 6.75, "y": 6.98, "z": 6.93, "{": 4.89,
  "|": 3.29, "}": 4.89, "~": 8.12, "→": 11.70,
  "ø": 7.61, "é": 7.35, "ü": 7.51,
}
// Unmeasured characters: wider than most lowercase letters, narrower than CJK —
// biased HIGH because the estimate must stay a superset of reality.
const EDGE_CHAR_W_DEFAULT = 11
// Whole strings render within ±0.8px of the per-char sum (kerning); the pad
// absorbs it. This function is the ONE width estimate every edge-label rect,
// wrap decision and gutter sizing shares — duplicated arithmetic is how the
// nudge went blind (tb edge-label spec D1).
const EDGE_LABEL_KERN_PAD = 1.5

export function estimateEdgeTextWidth(text: string): number {
  // Measure the DISPLAYED text: math spans are stripped to plain text before
  // any width/wrap decision, so estimates and wrap points agree with what the
  // emit layer draws (a wrap that split a `\(…\)` span left half-spans that
  // survived as literal TeX — caught on the built package).
  text = plainMathLabel(text)
  let w = 0
  for (const ch of text) w += EDGE_CHAR_W_TABLE[ch] ?? EDGE_CHAR_W_DEFAULT
  return Math.ceil(w + EDGE_LABEL_KERN_PAD)
}

/** The label BLOCK rect the nudge compares: widest line wide, lines stacked
 *  at EDGE_LABEL_PITCH. Exported so tests pin the same arithmetic layout uses
 *  — the estimate-vs-real trap is exactly what duplicated arithmetic hides. */
export function edgeLabelRect(el: { label?: string; lines?: string[]; labelX?: number; labelY?: number }): {
  x: number
  y: number
  w: number
  h: number
} {
  const lines = el.lines && el.lines.length > 0 ? el.lines : [el.label ?? ""]
  const w = Math.max(...lines.map(l => estimateEdgeTextWidth(l)))
  const h = (lines.length - 1) * EDGE_LABEL_PITCH + EDGE_LABEL_H
  return { x: el.labelX! - w / 2, y: el.labelY! - h / 2, w, h }
}

/** Wrap an EDGE label to the gutter it is routed through. Unlike `wrapLabel`
 *  there is no node padding to reserve, and any single word wider than the
 *  gutter is hard-split — an edge label is never dropped, so it must never
 *  overflow either (figure label-overflow spec §3.1). */
export function wrapEdgeLabel(label: string, avail: number): string[] {
  // Strip math spans before wrapping — a hard-split word or line must never
  // cut a `\(…\)` span mid-way (the emit layer cannot strip a half-span).
  label = plainMathLabel(label)
  const words = label.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ""
  for (const word of words) {
    if (estimateEdgeTextWidth(word) > avail) {
      // hard-split an over-wide word AT THE WIDTH LIMIT, not a char count
      if (current) {
        lines.push(current)
        current = ""
      }
      let piece = ""
      for (const ch of word) {
        if (piece && estimateEdgeTextWidth(piece + ch) > avail) {
          lines.push(piece)
          piece = ch
        } else {
          piece += ch
        }
      }
      current = piece
      continue
    }
    const candidate = current ? `${current} ${word}` : word
    if (estimateEdgeTextWidth(candidate) > avail) {
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
  label = plainMathLabel(label)
  return Math.min(NODE_W_MAX, Math.max(NODE_W_MIN, Math.round(label.length * CHAR_W) + 24))
}

/** Word-wrap a label into lines that fit `w` (same 7.5px/char estimate).
 *  Hard-splits any single word wider than the line so nothing overflows. */
function wrapLabel(label: string, w: number): string[] {
  // See wrapEdgeLabel: spans are stripped before any wrap or hard-cut.
  label = plainMathLabel(label)
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

/** Skip-rank routing (skiprank spec §3.1): clear-corridor selection constants. */
export interface LaneBox {
  x: number
  y: number
  w: number
  h: number
}
const MIN_BAND = 12 // minimum clear band height a bypass may run through
const BAND_PAD = 6 // clearance the bypass keeps from box edges on either side
const NUDGE_STEP = GAP_CROSS / 2 // label collision nudge pitch (skiprank spec §3.2)
const MAX_NUDGE_STEPS = 4

/** Gaps, with BAND_PAD clearance each side, between the sorted y-intervals of
 *  `boxes`. [y0, y1] bounds the search: interior gaps come from the real box
 *  edges; anything before the first box's top (or after the last box's bottom)
 *  is treated as one gap opening at y0 (closing at y1) — pass a tight range to
 *  see interior gaps only, a full range to include above-all/below-all. */
export function clearBandsY(boxes: readonly LaneBox[], y0: number, y1: number): [number, number][] {
  const sorted = boxes.map(b => [b.y, b.y + b.h] as [number, number]).sort((a, b) => a[0] - b[0])
  const bands: [number, number][] = []
  let prev = y0
  for (const [by0, by1] of sorted) {
    if (by1 < y0 || by0 > y1) continue
    if (by0 - prev >= MIN_BAND) bands.push([prev + BAND_PAD, by0 - BAND_PAD])
    prev = Math.max(prev, by1)
  }
  if (y1 - prev >= MIN_BAND) bands.push([prev + BAND_PAD, y1 - BAND_PAD])
  return bands
}

/** Mid-x of every gutter between consecutive column bands that no box bleeds
 *  into. Gutters are node-free by construction of the layout, but a box from a
 *  NEIGHBOURING rank pair can straddle one (wrapped rows in the same column
 *  pair), so the candidate is verified, not assumed. */
export function clearCorridorsX(bands: readonly [number, number][], boxes: readonly LaneBox[]): number[] {
  const out: number[] = []
  for (let i = 0; i < bands.length - 1; i++) {
    const mid = (bands[i][1] + bands[i + 1][0]) / 2
    const straddles = boxes.some(b => mid > b.x && mid < b.x + b.w)
    if (!straddles) out.push(mid)
  }
  return out
}

/** Gaps, with BAND_PAD clearance each side, between the sorted x-intervals of
 *  `boxes` — the tb mirror of clearBandsY: a tb bypass runs VERTICALLY, so its
 *  clear band is an x-interval between the crossed boxes' extents. */
export function clearBandsX(boxes: readonly LaneBox[], x0: number, x1: number): [number, number][] {
  const sorted = boxes.map(b => [b.x, b.x + b.w] as [number, number]).sort((a, b) => a[0] - b[0])
  const bands: [number, number][] = []
  let prev = x0
  for (const [bx0, bx1] of sorted) {
    if (bx1 < x0 || bx0 > x1) continue
    if (bx0 - prev >= MIN_BAND) bands.push([prev + BAND_PAD, bx0 - BAND_PAD])
    prev = Math.max(prev, bx1)
  }
  if (x1 - prev >= MIN_BAND) bands.push([prev + BAND_PAD, x1 - BAND_PAD])
  return bands
}

/** Mid-y of every gutter between consecutive row bands that no box bleeds
 *  into — the tb mirror of clearCorridorsX: a tb bypass's horizontal runs
 *  ride the row gutters, so those gutters must be box-free. */
export function clearCorridorsY(bands: readonly [number, number][], boxes: readonly LaneBox[]): number[] {
  const out: number[] = []
  for (let i = 0; i < bands.length - 1; i++) {
    const mid = (bands[i][1] + bands[i + 1][0]) / 2
    const straddles = boxes.some(b => mid > b.y && mid < b.y + b.h)
    if (!straddles) out.push(mid)
  }
  return out
}

/** True when the straight segment p1→p2 clears every box (open-interval test:
 *  touching an edge is clear, matching how the renderer strokes paths). */
export function segmentClearsBoxes(p1: [number, number], p2: [number, number], boxes: readonly LaneBox[]): boolean {
  const minx = Math.min(p1[0], p2[0])
  const maxx = Math.max(p1[0], p2[0])
  const miny = Math.min(p1[1], p2[1])
  const maxy = Math.max(p1[1], p2[1])
  return !boxes.some(b => minx < b.x + b.w && maxx > b.x && miny < b.y + b.h && maxy > b.y)
}

export interface SerpentineRoute {
  /** Polyline points, first = source exit, last = target entry. */
  points: [number, number][]
  /** The bypass run's y (lr) — below the label block when banded. */
  bypassY: number
  /** Anchor for the label BLOCK's centre, only when the route is banded. */
  labelY?: number
  /** True when no clear band existed and the route dips below all boxes. */
  dipped: boolean
}

/** Orthogonal serpentine route for a skip-rank edge (lr): exit the source
 *  rightward into the FIRST corridor (running the horizontal at exit-y past
 *  the first crossed column is the defect being fixed), to a clear bypass
 *  band, across the span in that band, and back into the corridor adjacent
 *  to the target. Falls back to a dip lane below all crossed boxes when no
 *  band fits. The bypass LINE runs `blockH + 3` below the band top so the
 *  label block (height `blockH`) sits INSIDE the band, above its own line —
 *  layout widens cross gaps so this fits (label-aware gutters, same idea).
 *  `excludeY` steers later skip edges off bands already used by earlier ones
 *  from the same source. Deterministic throughout. */
export function routeSerpentine(
  a: LaneBox,
  b: LaneBox,
  bands: readonly [number, number][],
  crossed: readonly LaneBox[],
  laneIndex: number,
  extent: number,
  blockH: number,
  excludeY: readonly number[] = [],
): SerpentineRoute {
  const sx = a.x + a.w
  const sy = a.y + a.h / 2
  const tx = b.x - 2
  const ty = b.y + b.h / 2
  const corridors = clearCorridorsX(bands, crossed).filter(c => c > sx && c < tx)
  const first = corridors.length > 0 ? corridors[0] : sx + 8
  const last = corridors.length > 1 ? corridors[corridors.length - 1] : tx - 8
  const midY = (sy + ty) / 2
  // INTERIOR bands first (between crossed boxes) — hopping above or below the
  // whole figure is clear but reads as leaving the graph. The band must fit
  // the label block plus the line below it. Ties resolve to the later (lower)
  // band; bands already used by earlier skips of this source are excluded —
  // callers pass the earlier skip's LINE y (bypassY), the thing two skips
  // must not share, and comparison is against the candidate's line position
  // so a re-selection cannot land both lines on one band.
  const fits = (c: [number, number]): boolean =>
    c[1] - c[0] >= blockH + 6 && !excludeY.some(y => Math.abs(c[0] + blockH + 3 - y) < 8)
  const pick = (candidates: [number, number][]): [number, number] | undefined =>
    candidates
      .filter(fits)
      .map(c => ({ c, d: Math.abs((c[0] + c[1]) / 2 - midY) }))
      .sort((x, y) => (x.d === y.d ? y.c[0] - x.c[0] : x.d - y.d))[0]?.c
  let band: [number, number] | undefined
  if (crossed.length > 0) {
    const top = Math.min(...crossed.map(b => b.y))
    const bottom = Math.max(...crossed.map(b => b.y + b.h))
    band = pick(clearBandsY(crossed, top, bottom)) ?? pick(clearBandsY(crossed, 0, extent))
  }
  if (band === undefined) {
    const dipY = extent + BAND_PAD * 2 + laneIndex * 26
    return {
      points: [
        [sx, sy],
        [first, sy],
        [first, dipY],
        [last, dipY],
        [last, ty],
        [tx, ty],
      ],
      bypassY: dipY,
      labelY: dipY - 3 - blockH / 2,
      dipped: true,
    }
  }
  const bypassY = band[0] + blockH + 3
  return {
    points: [
      [sx, sy],
      [first, sy],
      [first, bypassY],
      [last, bypassY],
      [last, ty],
      [tx, ty],
    ],
    bypassY,
    labelY: band[0] + blockH / 2,
    dipped: false,
  }
}

export interface SerpentineRouteTb {
  /** Polyline points, first = source exit, last = target entry. */
  points: [number, number][]
  /** The bypass run's x (tb) — beside the label block when banded. */
  bypassX: number
  /** Anchor for the label BLOCK's centre, banded and dipped alike. */
  labelX?: number
  /** True when no clear x-band existed and the route dips right of all boxes. */
  dipped: boolean
}

/** Orthogonal serpentine route for a skip-rank edge (tb) — the exact transpose
 *  of `routeSerpentine`: exit the source downward into the FIRST row gutter,
 *  across to a clear x-band, DOWN the span inside that band, and back into
 *  the gutter adjacent to the target. Falls back to a dip lane RIGHT of all
 *  crossed boxes when no band fits the label block's width. The banded label
 *  sits INSIDE its band, left of its own line (the mirror of lr's label above
 *  its line); the dipped label sits RIGHT of the line — left of it would hang
 *  back over the boxes at the segment's mid-y, which is exactly the room the
 *  dip exists because there isn't.
 *  `excludeX` steers later skip edges off bands earlier ones took. */
export function routeSerpentineTb(
  a: LaneBox,
  b: LaneBox,
  bands: readonly [number, number][],
  crossed: readonly LaneBox[],
  laneIndex: number,
  extent: number,
  blockW: number,
  excludeX: readonly number[] = [],
): SerpentineRouteTb {
  const sx = a.x + a.w / 2
  const sy = a.y + a.h
  const tx = b.x + b.w / 2
  const ty = b.y - 2
  const corridors = clearCorridorsY(bands, crossed).filter(c => c > sy && c < ty)
  const first = corridors.length > 0 ? corridors[0] : sy + 8
  const last = corridors.length > 1 ? corridors[corridors.length - 1] : ty - 8
  const midX = (sx + tx) / 2
  // Interior x-bands first (between crossed boxes); the band must fit the
  // label block plus the line beside it. Ties resolve to the later (righter)
  // band; bands already used by earlier skips of this source are excluded —
  // callers pass the earlier skip's LINE x (bypassX), and comparison is
  // against the candidate's line position.
  const fits = (c: [number, number]): boolean =>
    c[1] - c[0] >= blockW + 6 && !excludeX.some(x => Math.abs(c[0] + blockW + 3 - x) < 8)
  const pick = (candidates: [number, number][]): [number, number] | undefined =>
    candidates
      .filter(fits)
      .map(c => ({ c, d: Math.abs((c[0] + c[1]) / 2 - midX) }))
      .sort((x, y) => (x.d === y.d ? y.c[0] - x.c[0] : x.d - y.d))[0]?.c
  let band: [number, number] | undefined
  if (crossed.length > 0) {
    const left = Math.min(...crossed.map(b => b.x))
    const right = Math.max(...crossed.map(b => b.x + b.w))
    band = pick(clearBandsX(crossed, left, right)) ?? pick(clearBandsX(crossed, 0, extent))
  }
  if (band === undefined) {
    const dipX = extent + BAND_PAD * 2 + laneIndex * 26
    return {
      points: [
        [sx, sy],
        [sx, first],
        [dipX, first],
        [dipX, last],
        [tx, last],
        [tx, ty],
      ],
      bypassX: dipX,
      labelX: dipX + 3 + blockW / 2,
      dipped: true,
    }
  }
  const bypassX = band[0] + blockW + 3
  return {
    points: [
      [sx, sy],
      [sx, first],
      [bypassX, first],
      [bypassX, last],
      [tx, last],
      [tx, ty],
    ],
    bypassX,
    labelX: band[0] + blockW / 2,
    dipped: false,
  }
}

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
/** Point of a symmetric control cubic (endpoints x0/x3, both control xs at
 *  `mx`, endpoint ys y0/y3) at horizontal fraction t — the shape every
 *  adjacent lr edge draws. Inverse of that curve's x(t) by bisection: x is
 *  monotone in t, so 24 iterations are exact to well under 0.01px. */
function cubicPointAtX(x0: number, x3: number, mx: number, y0: number, y3: number, x: number): { x: number; y: number } {
  const xAt = (t: number): number => {
    const mt = 1 - t
    return 3 * mt * mt * t * mx + 3 * mt * t * t * mx + t * t * t * x3
  }
  let lo = 0
  let hi = 1
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (xAt(mid) < x) lo = mid
    else hi = mid
  }
  const t = (lo + hi) / 2
  const mt = 1 - t
  return { x, y: mt * mt * mt * y0 + 3 * mt * mt * t * y0 + 3 * mt * t * t * y3 + t * t * t * y3 }
}

function cubicDepth(y0: number, y3: number, ly: number): number {
  if (ly <= Math.max(y0, y3)) return Math.max(y0, y3)
  const u = Math.sqrt((ly - y0) / (ly - y3))
  const t = u / (1 + u)
  const mt = 1 - t
  return mt * mt * mt * y0 + 3 * mt * mt * t * ly + 3 * mt * t * t * ly + t * t * t * y3
}

interface Pt {
  x: number
  y: number
}
interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Evaluate a cubic Bezier at parameter t. */
function cubicPoint(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const mt = 1 - t
  return {
    x: mt * mt * mt * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * p3.x,
    y: mt * mt * mt * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * p3.y,
  }
}

/** Sample every ADJACENT arrow curve (M a b C …, the shape forward lr/tb
 *  edges draw) into a 48-point polyline keyed by edge id. Skip-rank
 *  serpentines are polylines (no C) whose labels already ride segments the
 *  route proved clear, and back-edge labels have their own guards — both are
 *  excluded via `skipIds`. Shared by the 7c-pre crossing slide and the 7c
 *  nudge's on-curve escape (the slide anchors labels ON their curves; the
 *  nudge must not carry them off again). */
function sampleArrowPolylines(elements: Scene["elements"], skipIds: Set<string>): Map<string, Pt[]> {
  const bez = new Map<string, { p0: Pt; p1: Pt; p2: Pt; p3: Pt }>()
  for (const el of elements) {
    if (el.kind !== "arrow" || el.id === undefined || skipIds.has(el.id)) continue
    const m = /M ([-\d.]+) ([-\d.]+) C ([-\d.]+) ([-\d.]+), ([-\d.]+) ([-\d.]+), ([-\d.]+) ([-\d.]+)/.exec(el.d)
    if (!m) continue
    bez.set(el.id, {
      p0: { x: +m[1], y: +m[2] },
      p1: { x: +m[3], y: +m[4] },
      p2: { x: +m[5], y: +m[6] },
      p3: { x: +m[7], y: +m[8] },
    })
  }
  const SAMPLES = 48
  const polyOf = new Map<string, Pt[]>()
  for (const [id, b] of bez) {
    const poly: Pt[] = []
    for (let i = 0; i <= SAMPLES; i++) poly.push(cubicPoint(b.p0, b.p1, b.p2, b.p3, i / SAMPLES))
    polyOf.set(id, poly)
  }
  return polyOf
}

/** Does segment a→b touch rect r (an endpoint inside, or a proper edge
 *  crossing)? Proper test, not endpoint sampling: a first cut that only
 *  checked endpoints shipped labels whose rect clipped a curve passing
 *  through their middle. */
function segmentHitsRect(a: Pt, b: Pt, r: Rect): boolean {
  const inR = (p: Pt): boolean => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
  if (inR(a) || inR(b)) return true
  const edges = [
    [r.x, r.y, r.x + r.w, r.y],
    [r.x + r.w, r.y, r.x + r.w, r.y + r.h],
    [r.x, r.y + r.h, r.x + r.w, r.y + r.h],
    [r.x, r.y, r.x, r.y + r.h],
  ] as const
  const orient = (ax: number, ay: number, bx: number, by: number, px: number, py: number): number =>
    (bx - ax) * (py - ay) - (by - ay) * (px - ax)
  for (const [x1, y1, x2, y2] of edges) {
    const d1 = orient(x1, y1, x2, y2, a.x, a.y)
    const d2 = orient(x1, y1, x2, y2, b.x, b.y)
    const d3 = orient(a.x, a.y, b.x, b.y, x1, y1)
    const d4 = orient(a.x, a.y, b.x, b.y, x2, y2)
    if (((d1 > 0) !== (d2 > 0) || d1 === 0 || d2 === 0) && ((d3 > 0) !== (d4 > 0) || d3 === 0 || d4 === 0)) return true
  }
  return false
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
  // Cross-axis positions do not depend on the gutters (the gutter is MAIN-axis
  // room between rank bands), so a pre-pass places every node's cross
  // coordinate first. That makes the STEEP-FAN gutter term below possible: it
  // needs each adjacent edge's vertical drop, which only exists once cross
  // positions are known — and the gutters must be known before main positions
  // are assigned. (Label-aware gutters, spec §2.7.)
  // Skip-rank band widening (skiprank spec §3.1) — on the CROSS axis: the
  // bypass band runs between the stacked boxes of a crossed rank, so the gap
  // following that rank's boxes widens to fit a one-line label block with the
  // bypass line 3px below it and BAND_PAD margins either side (14+3+12 = 29,
  // 1px more than GAP_CROSS — a small, bounded growth). Multi-line labels
  // re-check against the real block at route time and dip if they don't fit.
  const skipCrossRank = new Set<number>()
  for (const e of edges) {
    if (!e.label || backEdges.has(edgeKey(e))) continue
    const lo = Math.min(layer.get(e.from)!, layer.get(e.to)!)
    const hi = Math.max(layer.get(e.from)!, layer.get(e.to)!)
    if (hi - lo < 2) continue
    for (let r = lo + 1; r < hi; r++) skipCrossRank.add(r)
  }
  const crossGapFor = (r: number): number =>
    skipCrossRank.has(r) ? Math.max(GAP_CROSS, EDGE_LABEL_H + 6 + 2 * BAND_PAD) : GAP_CROSS
  const crossOf = new Map<string, number>()
  const sizeOf = new Map<string, { w: number; h: number }>()
  ranks.forEach((rankIds, r) => {
    let cross = PAD
    rankIds.forEach(id => {
      const n = byId.get(id)!
      const { w, lines, h } = wrapFor(n)
      sizeOf.set(id, { w, h })
      crossOf.set(id, cross)
      cross += (direction === "lr" ? h : w) + crossGapFor(r)
    })
    crossExtent = Math.max(crossExtent, cross - GAP_CROSS)
  })
  // Label-aware gutters (spec §2.7): the gap between rank r and r+1 widens to
  // fit the longest label crossing it, so an ordinary label sits on ONE line
  // instead of stacking into a narrow column. STEEP-FAN term (the 2026-10-08
  // Twinkle feedback): the VISUAL jumble on a many-to-few fan is line traffic
  // — a source 288px below its target draws a near-vertical curve inside a
  // 64px channel, and the fan's labels ride that channel 15px apart. The
  // gutter also scales with the steepest ADJACENT edge's drop-per-width
  // (vertical distance between endpoint centres over the horizontal span),
  // capped by the same MAX_LABEL_GUTTER so one extreme edge cannot blow up
  // the figure; shallow fans keep the compact 64px default.
  const gutters: number[] = ranks.map((_, r) => {
    let need = GAP_MAIN
    for (const e of edges) {
      const from = layer.get(e.from)!
      const to = layer.get(e.to)!
      if (Math.abs(from - to) !== 1 || Math.min(from, to) !== r) continue
      if (!e.label) continue
      need = Math.max(need, estimateEdgeTextWidth(e.label) + LABEL_PAD)
    }
    return Math.min(MAX_LABEL_GUTTER, need)
  })
  const slopeGutters: number[] = ranks.map((_, r) => {
    let need = GAP_MAIN
    for (const e of edges) {
      const from = layer.get(e.from)!
      const to = layer.get(e.to)!
      if (Math.abs(from - to) !== 1 || Math.min(from, to) !== r) continue
      const a = byId.get(e.from)!
      const b = byId.get(e.to)!
      const ac = crossOf.get(e.from)!
      const bc = crossOf.get(e.to)!
      const aMid = ac + (direction === "lr" ? sizeOf.get(e.from)!.h : sizeOf.get(e.from)!.w) / 2
      const bMid = bc + (direction === "lr" ? sizeOf.get(e.to)!.h : sizeOf.get(e.to)!.w) / 2
      const drop = Math.abs(bMid - aMid)
      if (drop <= 0) continue
      // Cubic with control points at the endpoints' x + gutter/3: the curve
      // occupies the middle third of the gutter. A steep edge needs the
      // chord's horizontal extent to keep its slope walkable — one unit of
      // gutter per 4 units of drop, and never below the label floor.
      need = Math.max(need, GAP_MAIN + drop / 4)
    }
    return Math.min(MAX_LABEL_GUTTER, need)
  })
  let lastGutter = GAP_MAIN
  ranks.forEach((rankIds, r) => {
    const gutter = Math.max(gutters[r] ?? GAP_MAIN, slopeGutters[r] ?? GAP_MAIN)
    rankIds.forEach(id => {
      const n = byId.get(id)!
      const { w, h, lines } = wrapFor(n)
      placed.set(id, {
        id,
        label: n.label,
        lines: lines.length > 1 ? lines : undefined,
        shape: n.shape ?? "box",
        tip: n.tip,
        w,
        h,
        x: direction === "lr" ? mainOffset : crossOf.get(id)!,
        y: direction === "lr" ? crossOf.get(id)! : mainOffset,
      })
    })
    lastGutter = gutter
    mainOffset += Math.max(0, ...rankIds.map(id => placed.get(id)!.w)) + lastGutter
  })
  let width = direction === "lr" ? mainOffset - lastGutter + PAD : crossExtent + PAD
  let height = direction === "lr" ? crossExtent + PAD : mainOffset - lastGutter + PAD
  // A return path leaves through the far side of the CROSS axis, so its lane
  // is offset from that axis' node extent: below every node for `lr`, to the
  // right of every node for `tb`. Provisional here (pre-clamp boxes); 6b
  // recomputes it from the final ones, since the clamp may shift them.

  // 6a. EDGE LABELS FIRST, before any path string exists.
  //
  //     Order matters: step 8 may have to shift the whole scene down when a
  //     wrapped label block hangs above the origin. That shift must move node
  //     boxes AND their edges together — the previous code adjusted
  //     `node-box.y` and `arrow.labelY` but not `ArrowEl.d`/`head`, which
  //     were already serialized strings, so nodes moved and arrows stayed put
  //     (every arrow then floated 21px above its node's centre, reading as
  //     "aligned to the top").
  //
  //     Labels need only node positions and line counts, never a path, so we
  //     can resolve the shift here and build every path afterwards from the
  //     final coordinates. Z-order is ARRAY order, not compute order, so edges
  //     still go into `elements` before nodes and keep painting underneath.
  interface EdgePlan {
    e: FlowEdgeSpec
    a: Placed
    b: Placed
    isBack: boolean
    lane: number
    adjacent: boolean
    lines: string[]
    labelX: number
    labelY: number
  }
  const laneBasePre = (() => {
    let m = 0
    for (const p of placed.values()) m = Math.max(m, direction === "lr" ? p.y + p.h : p.x + p.w)
    return m
  })()
  const plans: EdgePlan[] = []
  // Lane index per back edge, so a diagram with two cycles draws them at
  // different depths instead of overprinting.
  let returnLane = 0
  for (const e of edges) {
    const a = placed.get(e.from)!
    const b = placed.get(e.to)!
    const isBack = backEdges.has(edgeKey(e))
    const lane = isBack ? returnLane++ : 0
    const adjacent = Math.abs(layer.get(e.to)! - layer.get(e.from)!) === 1

    let labelX = 0
    let labelY = 0
    let gutterW = 0
    if (isBack) {
      // A feedback loop returns around the outside, so its label is bound by
      // the span it crosses, not by a column gutter. Positioned relative to
      // the lane depth; 6b refines it against the curve's true extremum.
      // For `tb` the anchor sits OUTSIDE the lane strip (laneY − 6 − half the
      // label's own width): laneY + 6 centred the text ON the strip the
      // return lane rides, where it sat on every rank it crossed (the run-4
      // "neutralizes pathogen (via APC)" case — the probe's ON-SHAPE hit).
      // Wrap width is the same distance, so the block ends at the strip edge.
      const laneY = laneBasePre + PAD + RETURN_DROP + lane * RETURN_LANE
      if (direction === "lr") {
        labelX = (a.x + a.w / 2 + b.x + b.w / 2) / 2
        labelY = laneY - 6
        gutterW = Math.max(8, Math.abs(a.x + a.w / 2 - (b.x + b.w / 2)))
      } else {
        // For `tb` the label rides the return curve's RIGHT FLANK (anchored
        // after the wrap below, which needs only this width): the curve
        // bulges RIGHT and runs near-vertical around its extremum, so a
        // word-wrapped block hugging that flank reads as text along the line
        // (2026-10-09 — the below-the-graph anchor of 2026-10-08 left the
        // block ~150px from its curve, "unclear as to what it refers to").
        // Wrap width: the full one-line width capped at 120 — a longer label
        // stacks into a tidy column beside the curve — floored at the widest
        // WORD's width, so wrapEdgeLabel can always break between words and
        // never mid-word.
        const words = (e.label ?? "").split(/\s+/).filter(Boolean)
        const widestWord = Math.max(0, ...words.map(w => estimateEdgeTextWidth(w)))
        gutterW = Math.max(widestWord, Math.min(estimateEdgeTextWidth(e.label ?? ""), 120))
      }
    } else if (direction === "lr") {
      // For `lr` the label sits in the horizontal gutter between two columns
      // (for a skip-rank edge, the whole span its route crosses).
      // Structurally non-negative: forward edges always run from a lower layer
      // to a higher one, and ranks advance strictly rightward, so the target
      // is always clear of the source's right edge. (This was NOT true before
      // cycles were handled -- a cycle could place a target LEFT of its
      // source, giving a gutter of -538 that clamped to 8 and shredded
      // "miss / stale" into two-character lines. Verified exhaustively over
      // all 4-node graphs: no rendered edge can now face a negative gutter,
      // so there is nothing here to warn about.)
      gutterW = Math.max(8, b.x - (a.x + a.w))
      const sx = a.x + a.w
      const sy = a.y + a.h / 2
      const ty = b.y + b.h / 2
      labelX = adjacent ? (sx + b.x - 2) / 2 : a.x + a.w + gutterW / 2
      labelY = adjacent ? (sy + ty) / 2 - 6 : Math.min(sy, ty) - 6
    } else {
      // For `tb` the label is horizontal text centred on the source column,
      // so its bound is that column's width — a cross-axis span would shred
      // it into three-character chunks.
      gutterW = Math.min(MAX_LABEL_GUTTER, Math.max(a.w, b.w))
      const sy = a.y + a.h
      const ty = b.y - 2
      if (adjacent) {
        // The curve runs source-centre → target-centre, so its visual middle
        // is the SPAN midpoint — anchoring there is what keeps a fan-out's
        // labels apart (each targets a different column) and near its own
        // curve. The old source-column anchor put every label of a fan-out
        // on ONE point, ~194px from the wide-span curves (fig 1's orphan
        // mechanism). Wrap width stays the column bound — horizontal text
        // shredded across a cross-axis span was the old bug; the ANCHOR is
        // what moves.
        labelX = (a.x + a.w / 2 + b.x + b.w / 2) / 2
        labelY = (sy + ty) / 2 - 6
      } else {
        const gutterY = sy + (b.y - sy) / 2
        labelX = a.x + a.w / 2
        labelY = gutterY - 6
      }
    }

    const lines = e.label ? wrapEdgeLabel(e.label, gutterW) : []
    if (isBack && direction === "tb" && lines.length > 0) {
      // Anchor the block on the return curve's RIGHT FLANK (see gutterW above):
      // left edge 6px right of the curve's extremum — the curve is near-
      // vertical there, so a word-wrapped block reads as text along the line.
      // The extremum is the DRAWN curve's, same cubic the emit branch draws
      // (base plane 9px right of the target's left edge); t* is the mirror of
      // cubicDepth's closed form, giving both coordinates exactly.
      const bw = Math.max(...lines.map(l => estimateEdgeTextWidth(l)))
      const bh = (lines.length - 1) * EDGE_LABEL_PITCH + EDGE_LABEL_H
      const sx = a.x + a.w
      const sy = a.y + a.h / 2
      const baseX = b.x + 9
      const ty = b.y + b.h / 2
      const control = laneBasePre + PAD + RETURN_DROP + lane * RETURN_LANE
      const u = Math.sqrt((control - sx) / (control - baseX))
      const tStar = u / (1 + u)
      const mt = 1 - tStar
      const extremumX =
        mt * mt * mt * sx + 3 * mt * mt * tStar * control + 3 * mt * tStar * tStar * control + tStar * tStar * tStar * baseX
      const extremumY =
        mt * mt * mt * sy + 3 * mt * mt * tStar * control + 3 * mt * tStar * tStar * control + tStar * tStar * tStar * ty
      // Walk down from the top for a slot whose rect clears every node box
      // (the flank strip can overlap a wide rank's boxes in x). Start at the
      // curve's extremum — text beside the bulge, where the reading eye is.
      const NODE_CLEAR = 4
      const overlapsNode = (yy: number): boolean =>
        [...placed.values()].some(
          n =>
            extremumX + 6 < n.x + n.w + NODE_CLEAR &&
            extremumX + 6 + bw > n.x - NODE_CLEAR &&
            yy - bh / 2 < n.y + n.h + NODE_CLEAR &&
            yy + bh / 2 > n.y - NODE_CLEAR,
        )
      let anchorY = Math.max(extremumY, PAD + bh / 2)
      if (overlapsNode(anchorY)) {
        let found = false
        for (let y = PAD + bh / 2; y <= height + 600; y += 8) {
          if (!overlapsNode(y)) {
            anchorY = y
            found = true
            break
          }
        }
        if (!found) {
          // Nothing clear along the flank: the below-graph strip (the
          // 2026-10-08 fallback) is still there — step 7 grows the scene for
          // a block that hangs below it, and the emit re-checks.
          const bottom = Math.max(...[...placed.values()].map(pp => pp.y + pp.h))
          anchorY = bottom + PAD + EDGE_LABEL_H / 2 + lane * (2 * EDGE_LABEL_H + 8)
        }
      }
      labelX = extremumX + 6 + bw / 2
      labelY = anchorY
      // The scene must be wide enough to hold the block beside the curve.
      width = Math.max(width, extremumX + 6 + bw + PAD)
    }
    // The maths above places the FIRST line; shift up by half the block so
    // the block as a whole is centred on the edge.
    plans.push({
      e,
      a,
      b,
      isBack,
      lane,
      adjacent,
      lines,
      labelX,
      labelY: labelY - ((lines.length - 1) * EDGE_LABEL_PITCH) / 2,
    })
  }

  // 7. The scene extent must CONTAIN every wrapped label block: a multi-line
  //    edge label can reach past the node bounds it was laid out against, and
  //    a viewBox clips whatever falls outside it. Resolve the shift NOW, while
  //    it can still be applied to node placement rather than to finished
  //    geometry.
  let minY = 0
  let maxY = height
  for (const p of plans) {
    const n = p.lines.length > 0 ? p.lines.length : 1
    const half = ((n - 1) * EDGE_LABEL_PITCH) / 2 + n * 2
    minY = Math.min(minY, p.labelY - half)
    maxY = Math.max(maxY, p.labelY + half)
  }
  if (minY < 0 || maxY > height) {
    // Shift everything down when a block hangs above the origin; grow the box
    // when it hangs below. Either way nothing is clipped.
    for (const p of placed.values()) p.y -= minY
    for (const p of plans) p.labelY -= minY
    height = Math.max(height - minY, maxY)
  }

  // 6b. Edge paths, built from the FINAL node coordinates. Skip-rank edges
  //     route orthogonally through the column gutter; back edges return around
  //     the outside. Edges go into `elements` first so opaque node fills cover
  //     any crossing line.
  //
  //     The return lane is measured from the SHIFTED node boxes rather than
  //     from `crossExtent`, which step 7 may have moved. Deriving it from the
  //     pre-shift extent lets the lane climb above the boxes once a clamp
  //     shift exceeds RETURN_DROP, and the "return path" then cuts straight
  //     through the nodes it is meant to pass outside of.
  let laneBase = 0
  for (const p of placed.values()) {
    laneBase = Math.max(laneBase, direction === "lr" ? p.y + p.h : p.x + p.w)
  }
  // Skip-rank routing state: a per-edge lane counter (stacks multiple skips)
  // and the bypass-band anchors already taken, so a second skip edge off the
  // same source steers to another band instead of sharing the first one's.
  let skipLane = 0
  const skipYs: number[] = []
  const skipXs: number[] = []
  const planIsSkip = new Map<string, boolean>()
  const elements: Scene["elements"] = []
  for (const p of plans) {
    const { e, a, b, isBack, lane, adjacent, lines } = p
    let d: string
    let head: string
    let labelX = p.labelX
    let labelY = p.labelY

    if (isBack) {
      // Route out of the source and back into the target from below (lr) or
      // from the right (tb), so it reads as "…and this feeds back" rather
      // than fighting the left-to-right reading order.
      if (direction === "lr") {
        const sx = a.x + a.w / 2
        const sy = a.y + a.h
        const tx = b.x + b.w / 2
        const ty = b.y + b.h
        // The shaft terminates at the head's BASE plane, not the tip: a
        // hollow triangle reads as an arrow only when the shaft stops where
        // the head's own width begins, entering through the middle of the
        // leg parallel to the box. The modes-cycle page (2026-10-08) showed
        // the old tip-anchored shaft's flattened arrival grazing the base
        // leg's corner instead.
        const baseY = ty + 9
        const control = laneBase + PAD + RETURN_DROP + lane * RETURN_LANE
        // Size the scene from the curve's TRUE depth, not its control line:
        // the curve only reaches 3/4 of the way to the control points.
        const real = cubicDepth(sy, baseY, control)
        height = Math.max(height, real + PAD)
        d =
          Math.abs(sx - tx) < 1
            ? `M ${sx} ${sy} L ${sx} ${control} L ${tx} ${control} L ${tx} ${baseY}`
            : `M ${sx} ${sy} C ${sx} ${control}, ${tx} ${control}, ${tx} ${baseY}`
        // Head at the target's bottom edge, pointing UP into it: tip on the
        // edge, base 9px lower, centred on tx. The shaft's endpoint sits on
        // that base leg's midpoint by construction.
        head = `M ${tx} ${ty} L ${tx - 4.5} ${ty + 9} L ${tx + 4.5} ${ty + 9} Z`
        // Keep the label clear of the curve it annotates.
        labelY = Math.min(labelY - ((lines.length - 1) * EDGE_LABEL_PITCH) / 2, real - 6)
      } else {
        const sx = a.x + a.w
        const sy = a.y + a.h / 2
        const tx = b.x
        const ty = b.y + b.h / 2
        // The shaft terminates at the head's BASE plane (9px right of the
        // target's left edge) — the lr mirror: the shaft enters the hollow
        // head through the middle of the leg parallel to the box.
        const baseX = tx + 9
        const control = laneBase + PAD + RETURN_DROP + lane * RETURN_LANE
        const real = cubicDepth(sx, baseX, control)
        width = Math.max(width, real + PAD)
        d =
          Math.abs(sy - ty) < 1
            ? `M ${sx} ${sy} L ${control} ${sy} L ${control} ${ty} L ${baseX} ${ty}`
            : `M ${sx} ${sy} C ${control} ${sy}, ${control} ${ty}, ${baseX} ${ty}`
        // Head at the target's right edge, pointing LEFT into it.
        head = `M ${tx} ${ty} L ${tx + 9} ${ty - 4.5} L ${tx + 9} ${ty + 4.5} Z`
        // The label rides BELOW the graph (see the plan-level anchor): the tb
        // return curve bulges RIGHT and never enters that space, so the plan
        // anchor stands — the block was already centred and clamped in-bounds
        // at plan level. Grow the scene for the block's true height (step 7's
        // label-extent allowance is 2px per line, ~6px short of a real one).
        height = Math.max(
          height,
          labelY + ((lines.length - 1) * EDGE_LABEL_PITCH + EDGE_LABEL_H) / 2 + PAD,
        )
      }
    } else if (direction === "lr") {
      const sx = a.x + a.w
      const sy = a.y + a.h / 2
      const tx = b.x - 2
      const ty = b.y + b.h / 2
      if (adjacent) {
        // The shaft terminates at the head's BASE plane, not at its tip: a
        // hollow triangle reads as an arrow only when the shaft stops where
        // the head's own width begins — the same invariant the back-edge
        // branches already enforce (visible in the run-5 "Mechanism of the
        // Backdoor ii-V" figure, where the tip-anchored shaft drew a second
        // line through the hollow head to the arrowhead's centre). The head
        // trio's first point is the tip; base legs at tx-9, so the base-leg
        // midpoint (lr: x = tx-9, y = ty) is where the shaft ends.
        const baseX = tx - 9
        const mx = (sx + baseX) / 2
        d = `M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ty}, ${baseX} ${ty}`
        head = `M ${tx} ${ty} L ${tx - 9} ${ty - 4.5} L ${tx - 9} ${ty + 4.5} Z`
      } else {
        // Skip-rank serpentine (skiprank spec §3.1): clear-corridor route.
        // Crossed boxes come from the ranks strictly between the endpoints';
        // bands [top, bottom] are their exact extents. laneIndex stacks skips
        // of the same source onto different lanes; excludeY steers later
        // skips off bands earlier ones took.
        const lo = Math.min(layer.get(e.from)!, layer.get(e.to)!)
        const hi = Math.max(layer.get(e.from)!, layer.get(e.to)!)
        const crossed = [] as Placed[]
        for (let r = lo + 1; r < hi; r++) {
          for (const id of ranks[r]) crossed.push(placed.get(id)!)
        }
        const top = crossed.length > 0 ? Math.min(...crossed.map(p => p.y)) : Math.min(sy, ty)
        const bottom = crossed.length > 0 ? Math.max(...crossed.map(p => p.y + p.h)) : Math.max(sy, ty)
        const colBands = ranks.map((rankIds, r) => {
          if (rankIds.length === 0) return null
          const xs = rankIds.map(id => placed.get(id)!.x)
          const xe = rankIds.map(id => placed.get(id)!.x + placed.get(id)!.w)
          return [Math.min(...xs), Math.max(...xe)] as [number, number]
        }).filter((b): b is [number, number] => b !== null)
        const blockH = e.label ? (p.lines.length - 1) * EDGE_LABEL_PITCH + EDGE_LABEL_H : 6
        let gutterW = 0
        planIsSkip.set(edgeKey(e), true)
        const route = routeSerpentine(a, b, colBands, crossed, skipLane, height, blockH, skipYs)
        if (route.dipped) {
          height = Math.max(height, route.bypassY + PAD)
        }
        if (!route.dipped && route.labelY !== undefined) {
          // the LINE y, not the label anchor — routeSerpentine's exclusion
          // compares candidate line positions, and the run-4 stacked-skip
          // steering unit test pins exactly this convention
          skipYs.push(route.bypassY)
        }
        skipLane++
        // Base-plane invariant as above: the route's final leg stops at the
        // head's base plane rather than running to the tip through the
        // hollow head.
        const segs = [...route.points]
        segs[segs.length - 1] = [tx - 9, segs[segs.length - 1]![1]!]
        d = `M ${segs.map(pt => `${String(Math.round(pt[0] * 100) / 100)} ${String(Math.round(pt[1] * 100) / 100)}`).join(" L ")}`
        head = `M ${tx} ${ty} L ${tx - 9} ${ty - 4.5} L ${tx - 9} ${ty + 4.5} Z`
        if (e.label && route.labelY !== undefined) {
          // Label anchored to the bypass segment — inside the band (banded)
          // or inside the dip strip (dipped): node overlap is structurally
          // impossible because the anchor lives on a segment the route just
          // proved clear. Wrap width is the bypass segment's real length.
          labelX = (route.points[2][0] + route.points[3][0]) / 2
          labelY = route.labelY
          gutterW = route.points[3][0] - route.points[2][0]
        }
      }
    } else {
      const sx = a.x + a.w / 2
      const sy = a.y + a.h
      const tx = b.x + b.w / 2
      const ty = b.y - 2
      if (adjacent) {
        // tb mirror of the lr base-plane invariant: the shaft stops at the
        // head's base leg (y = ty-9) instead of running to the tip.
        const baseY = ty - 9
        const my = (sy + baseY) / 2
        d = `M ${sx} ${sy} C ${sx} ${my}, ${tx} ${my}, ${tx} ${baseY}`
        head = `M ${tx} ${ty} L ${tx - 4.5} ${ty - 9} L ${tx + 4.5} ${ty - 9} Z`
      } else {
        // Skip-rank serpentine, tb mirror of the lr route (tb edge-label spec
        // D2): crossed boxes come from the ranks strictly between the
        // endpoints'; bands are x-intervals between their extents. The label
        // anchors on the bypass segment — node overlap is structurally
        // impossible because the anchor lives on a segment the route just
        // proved clear. The old arithmetic-midpoint route put the label at
        // the spans' midpoint Y, where a column graph keeps its boxes.
        const lo = Math.min(layer.get(e.from)!, layer.get(e.to)!)
        const hi = Math.max(layer.get(e.from)!, layer.get(e.to)!)
        const crossed = [] as Placed[]
        for (let r = lo + 1; r < hi; r++) {
          for (const id of ranks[r]) crossed.push(placed.get(id)!)
        }
        const rowBands = ranks.map((rankIds, r) => {
          if (rankIds.length === 0) return null
          const ys = rankIds.map(id => placed.get(id)!.y)
          const ye = rankIds.map(id => placed.get(id)!.y + placed.get(id)!.h)
          return [Math.min(...ys), Math.max(...ye)] as [number, number]
        }).filter((b): b is [number, number] => b !== null)
        const blockW = e.label ? Math.max(...p.lines.map(l => estimateEdgeTextWidth(l))) : 6
        planIsSkip.set(edgeKey(e), true)
        const route = routeSerpentineTb(a, b, rowBands, crossed, skipLane, width, blockW, skipXs)
        if (route.dipped) {
          // the dipped label rides RIGHT of the line: grow the scene for it
          width = Math.max(width, route.bypassX + 3 + blockW + PAD)
        }
        if (!route.dipped && route.labelX !== undefined) {
          // the LINE x, matching the lr convention the steering test pins
          skipXs.push(route.bypassX)
        }
        skipLane++
        // tb mirror of the lr base-plane invariant (see above).
        const segs = [...route.points]
        segs[segs.length - 1] = [segs[segs.length - 1]![0]!, ty - 9]
        d = `M ${segs.map(pt => `${String(Math.round(pt[0] * 100) / 100)} ${String(Math.round(pt[1] * 100) / 100)}`).join(" L ")}`
        head = `M ${tx} ${ty} L ${tx - 4.5} ${ty - 9} L ${tx + 4.5} ${ty - 9} Z`
        if (e.label && route.labelX !== undefined) {
          labelX = route.labelX
          labelY = (route.points[2][1] + route.points[3][1]) / 2
        }
      }
    }

    elements.push({
      kind: "arrow",
      d,
      head,
      edgeKind: e.kind ?? "leads",
      label: e.label,
      ...(lines.length > 1 ? { lines } : {}),
      labelX,
      labelY,
      id: edgeKey(e),
    })
  }

  const labelRects = elements.filter(
    (el): el is Extract<Scene["elements"][number], { kind: "arrow" }> => el.kind === "arrow" && el.label !== undefined,
  )
  const backIds = new Set(plans.filter(p => p.isBack).map(p => edgeKey(p.e)))
  // Sampled ADJACENT curves and box/foreign-curve hit tests, shared by the
  // 7c-pre slide and the 7c nudge's on-curve escape: the slide anchors labels
  // ON their curves, so the nudge's first escape must stay on the curve too —
  // an analytic axis jump that lands the block off its line re-creates the
  // orphan the slide just fixed (measured 63px off-curve on fig 1 with 88px
  // gutters, 2026-10-09).
  const polyOf = sampleArrowPolylines(elements, backIds)
  const boxList = [...placed.values()]
  const rectHitsBox = (r: Rect): boolean =>
    boxList.some(b => Math.min(r.x + r.w, b.x + b.w) - Math.max(r.x, b.x) > 1 && Math.min(r.y + r.h, b.y + b.h) - Math.max(r.y, b.y) > 1)
  /** Foreign curves passing through rect r (own curve excluded). */
  const foreignCurvesThrough = (r: Rect, ownId: string): number => {
    let hits = 0
    for (const [id, poly] of polyOf) {
      if (id === ownId) continue
      for (let i = 0; i + 1 < poly.length; i++) {
        if (segmentHitsRect(poly[i], poly[i + 1], r)) {
          hits++
          break
        }
      }
    }
    return hits
  }

  // 7c-pre. Label-off-crossing slide (the 2026-10-08 Twinkle follow-up): two
  //  adjacent curves converge on a shared target, so they cross EXACTLY at
  //  the gutter's mid-x — which is also where each label anchors (the span
  //  midpoint). A label sitting on a foreign curve reads as belonging to the
  //  wrong line; collision metrics never saw it because a CURVE is not a
  //  label. For every adjacent label (lr and tb alike): sample its own curve
  //  and every foreign curve into polylines, then walk the own curve for the
  //  anchor where the FEWEST foreign curves pass through the label RECT —
  //  rect, not anchor point: a first cut that cleared the point still
  //  shipped labels whose rect clipped a neighbouring curve 8px away. The
  //  block stays centred on a point of its own curve, so the label keeps
  //  riding its line; candidates that would overlap a node box or leave the
  //  canvas are rejected. The anchor only MOVES when it strictly reduces
  //  the foreign-curve count — an already-clear midpoint is never traded
  //  for distance. Runs BEFORE the 7c nudge: sliding changes label-label
  //  geometry, so the nudge must see post-slide rects (a first cut ran
  //  after and shipped 3 fresh overlaps on the Twinkle fig).
  {
    for (const cur of labelRects) {
      const own = cur.id !== undefined ? polyOf.get(cur.id) : undefined
      if (!own || cur.id === undefined) continue
      const w = edgeLabelRect(cur).w
      const h = edgeLabelRect(cur).h
      const rectAt = (pt: {x:number;y:number}): Rect => ({
        x: pt.x - w / 2, y: pt.y - h / 2, w, h,
      })
      const current = foreignCurvesThrough(rectAt({ x: cur.labelX!, y: cur.labelY! }), cur.id)
      if (current === 0) continue
      const ax = cur.labelX!
      const ay = cur.labelY!
      let best: { x: number; y: number; hits: number; dist: number } | null = null
      for (let i = 2; i + 2 < own.length; i++) {
        const pt = own[i]
        const r = rectAt(pt)
        if (r.x < 0.5 || r.y < 0.5 || r.x + r.w > width - 0.5 || r.y + r.h > height - 0.5) continue
        if (rectHitsBox(r)) continue
        const hits = foreignCurvesThrough(r, cur.id)
        const dist = Math.abs(pt.x - ax) + Math.abs(pt.y - ay)
        if (best === null || hits < best.hits || (hits === best.hits && dist < best.dist)) {
          best = { x: pt.x, y: pt.y, hits, dist }
        }
      }
      if (best && best.hits < current) {
        cur.labelX = best.x
        cur.labelY = best.y
      }
    }
  }


  // 7c. Label-label collision nudge (skiprank spec §3.2): the FIRST label in
  //  spec order keeps its anchor; a LATER label whose estimated text block
  //  overlaps ANY earlier one steps along its clear axis (NUDGE_STEP) until
  //  clear of ALL earlier labels or MAX_NUDGE_STEPS are exhausted. Skip
  //  labels participate too — in a fan-out (five labelled edges out of one
  //  source) their band rows can sit in the same gutter as adjacent labels —
  //  but they nudge along the axis with room: the bypass segment's axis.
  //  Runs to a fixed point over spec order (a later nudge can create a new
  //  collision with an even later label; re-scan until no move happens, hard
  //  cap on sweeps). `lr` nudges vertically, `tb` horizontally.
  const rectOfLabel = edgeLabelRect
  const overlaps = (A: { x: number; y: number; w: number; h: number }, B: { x: number; y: number; w: number; h: number }): boolean =>
    Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x) > 2 && Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y) > 2
  for (let sweep = 0; sweep < 3; sweep++) {
    let moved = false
    for (let i = 0; i < labelRects.length; i++) {
      const cur = labelRects[i]
      const isSkip = cur.id !== undefined && planIsSkip.get(cur.id) === true
      const axis = isSkip ? (direction === "lr" ? "x" : "y") : direction === "lr" ? "y" : "x"
      for (let j = 0; j < labelRects.length; j++) {
        if (j === i) continue
        const A = rectOfLabel(cur)
        const B = rectOfLabel(labelRects[j])
        if (!overlaps(A, B)) continue
        // The escape distance is ANALYTIC, not stepped: two same-anchor
        // 120px labels need ~124px of separation and a fixed 4×14px walk
        // never gets there (the run-4 fan-out case). Jump past B's rect
        // plus a 4px margin along the clear axis — trying BOTH directions
        // and a widening ladder of distances, because the analytic jump can
        // itself land on a third label (the run-4 fan-out with a labelled
        // edge right of the stack). First candidate that clears ALL other
        // labels wins; if none does, keep the original anchor (never make
        // it worse).
        const escape = axis === "y" ? A.h / 2 + B.h / 2 + 4 : A.w / 2 + B.w / 2 + 4
        const base = axis === "y" ? cur.labelY! : cur.labelX!
        // Escapes that would carry the label past the canvas edge are REJECTED:
        // off-canvas is invisible, which is worse than any overlap (the run-4
        // "Borrowed Supertonic" escaped to x=−112; tb edge-label spec D3).
        const inBounds = (x: number, y: number): boolean =>
          x - A.w / 2 >= -0.5 && x + A.w / 2 <= width + 0.5 && y - A.h / 2 >= -0.5 && y + A.h / 2 <= height + 0.5
        // ON-CURVE escape FIRST: the slide anchored this label on its own
        // curve, so the nudge's first move stays there — walk the curve for
        // the nearest point whose rect clears every label, node, and foreign
        // curve. Only when no on-curve point clears does the analytic axis
        // jump run (which may orphan the label — an overlap of two texts is
        // the lesser defect). The slide's own anchor is always on the walk.
        let landed = false
        const own = cur.id !== undefined ? polyOf.get(cur.id) : undefined
        if (own) {
          let onCurve: { x: number; y: number; dist: number } | null = null
          for (let k = 1; k < own.length; k++) {
            const pt = own[k]
            const r: Rect = { x: pt.x - A.w / 2, y: pt.y - A.h / 2, w: A.w, h: A.h }
            if (!inBounds(pt.x, pt.y)) continue
            if (labelRects.some((other, k2) => k2 !== i && overlaps(r, rectOfLabel(other)))) continue
            if (rectHitsBox(r)) continue
            if (foreignCurvesThrough(r, cur.id!) > 0) continue
            const dist = Math.abs(pt.x - cur.labelX!) + Math.abs(pt.y - cur.labelY!)
            if (onCurve === null || dist < onCurve.dist) onCurve = { x: pt.x, y: pt.y, dist }
          }
          if (onCurve) {
            cur.labelX = onCurve.x
            cur.labelY = onCurve.y
            moved = true
            landed = true
          }
        }
        const tryOrder: Array<[number, number]> = [
          [1, escape],
          [-1, escape],
          [1, escape / 2],
          [-1, escape / 2],
          [1, escape * 1.75],
          [-1, escape * 1.75],
        ]
        if (!landed) {
          for (const [sign, dist] of tryOrder) {
            const candY = axis === "y" ? base + sign * dist : cur.labelY!
            const candX = axis === "x" ? base + sign * dist : cur.labelX!
            if (!inBounds(candX, candY)) continue
            const CA = { x: candX - A.w / 2, y: candY - A.h / 2, w: A.w, h: A.h }
            const clearOfAll = labelRects.every((other, k) => k === i || !overlaps(CA, rectOfLabel(other)))
            if (clearOfAll) {
              cur.labelY = candY
              cur.labelX = candX
              moved = true
              landed = true
              break
            }
          }
        }
        if (!landed) {
          // No in-bounds candidate cleared every label: CLAMP the escape
          // target into the canvas and take it anyway. Priority is in-bounds
          // clear > in-bounds clamped (may still overlap — accepted, and the
          // DEBUGGING entry records why) > the original anchor. Never out of
          // bounds.
          for (const sign of [1, -1] as const) {
            const candX =
              axis === "x"
                ? Math.min(Math.max(base + sign * escape, A.w / 2), width - A.w / 2)
                : cur.labelX!
            const candY =
              axis === "y"
                ? Math.min(Math.max(base + sign * escape, A.h / 2), height - A.h / 2)
                : cur.labelY!
            const changed = axis === "x" ? candX !== cur.labelX! : candY !== cur.labelY!
            if (inBounds(candX, candY) && changed) {
              cur.labelY = candY
              cur.labelX = candX
              moved = true
              break
            }
          }
        }
        break // one resolver per pair per sweep
      }
    }
    if (!moved) break
  }

  // 7d. Back-edge label vs NODE clearance: back-edge labels are anchored at
  //  plan level, and neither the 7c-pre slide (a back edge has no sample in
  //  `polyOf`, which excluded them) nor the 7c nudge (labels compared only
  //  against labels) ever checks one against a NODE box. Measured on the
  //  2026-10-10 reharm page, "V-I" printed 3px (est) into Bb Major's rect —
  //  the reader saw head + label vanish behind the opaque node. Walk the
  //  nudge axis in 8px steps, both directions, preferring the in-bounds,
  //  box-clear, label-label-clear candidate NEAREST the label's own drawn
  //  return path (a block that still rides its curve beats one that merely
  //  left the box). Never out of bounds; the anchor stands when nothing is
  //  clear.
  const backPolyOf = sampleArrowPolylines(elements, new Set(planIsSkip.keys()))
  for (const cur of labelRects) {
    if (cur.id === undefined || !backIds.has(cur.id)) continue
    const A = rectOfLabel(cur)
    if (!rectHitsBox(A)) continue
    const own = backPolyOf.get(cur.id)
    const clearAt = (x: number, y: number): boolean => {
      const r: Rect = { x: x - A.w / 2, y: y - A.h / 2, w: A.w, h: A.h }
      if (r.x < -0.5 || r.y < -0.5 || r.x + r.w > width + 0.5 || r.y + r.h > height + 0.5) return false
      if (rectHitsBox(r)) return false
      return labelRects.every(other => other === cur || !overlaps(r, rectOfLabel(other)))
    }
    const dist2own = (x: number, y: number): number => {
      if (!own) return Math.abs(x - cur.labelX!) + Math.abs(y - cur.labelY!)
      let d = Infinity
      for (const pt of own) d = Math.min(d, Math.hypot(x - pt.x, y - pt.y))
      return d
    }
    const axisY = direction === "lr"
    const found: { x: number; y: number; d: number }[] = []
    for (let step = 8; step <= 240; step += 8) {
      for (const sign of [1, -1] as const) {
        const x = axisY ? cur.labelX! : cur.labelX! + sign * step
        const y = axisY ? cur.labelY! + sign * step : cur.labelY!
        if (clearAt(x, y)) found.push({ x, y, d: dist2own(x, y) })
      }
      if (found.length >= 2) break // one candidate per direction is enough
    }
    if (found.length > 0) {
      found.sort((a, b) => a.d - b.d)
      cur.labelX = found[0]!.x
      cur.labelY = found[0]!.y
    }
  }

  // 8. Nodes AFTER edges: their opaque fill covers crossings. Their y comes
  //    from `placed`, which step 7 already shifted, so it matches the paths.
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

  return { scene: { width: Math.max(width, 240), height: Math.max(height, 76), elements }, warnings }
}
