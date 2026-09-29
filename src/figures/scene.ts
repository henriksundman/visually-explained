/** Scene model — the internal currency of the figure system.
 *  Layouts compile semantic specs INTO a Scene; sceneToSvg compiles a Scene OUT to SVG.
 *  No coordinates ever enter or leave the IR — Scene is internal to src/figures. */

export type NodeShape = "box" | "round" | "pill" | "note"

/** Element identity for the interactivity layer (events spec §4). Set by
 *  authors (authored leaves via compileFigure) or derived by layouts (arrows,
 *  chart points, timeline events). Consumed only by the SVG emit layer. */
export interface SceneIdentity {
  id?: string
  tip?: string
}

export interface NodeBoxEl {
  kind: "node-box"
  id: string
  tip?: string
  x: number
  y: number
  w: number
  h: number
  shape: NodeShape
  label: string
  /** Pre-wrapped lines (layout-owned). Single-line nodes may omit it. */
  lines?: string[]
}

export type EdgeKind = "causes" | "leads" | "part-of" | "conflict"

export interface ArrowEl {
  kind: "arrow"
  /** Shaft path; ends just short of the head tip. */
  d: string
  /** Closed triangle path for the arrowhead. */
  head: string
  label?: string
  /** Label anchor point (computed by the layout, absolute scene coordinates). */
  labelX?: number
  labelY?: number
  edgeKind: EdgeKind
  id?: string
  tip?: string
}

export interface LabelEl {
  kind: "label"
  x: number
  y: number
  text: string
  anchor: "start" | "middle" | "end"
  /** Emphasis labels are ink-colored and bold; default labels are muted. */
  emphasis?: boolean
  id?: string
  tip?: string
}

export interface AxisEl {
  kind: "axis"
  x1: number
  y1: number
  x2: number
  y2: number
  id?: string
  tip?: string
}

export interface BarEl {
  kind: "bar"
  x: number
  y: number
  w: number
  h: number
  /** Preformatted value label (unit already applied) — the layout emits the matching LabelEl. */
  valueLabel: string
  id?: string
  tip?: string
}

export interface LinePathEl {
  kind: "line-path"
  d: string
  id?: string
  tip?: string
}

export interface DotEl {
  kind: "dot"
  x: number
  y: number
  id?: string
  tip?: string
}

export interface SparklineEl {
  kind: "sparkline"
  d: string
  trend: "up" | "down" | "flat"
  id?: string
  tip?: string
}

export type FigureTone = "ink" | "muted" | "accent"

export interface FigurePathEl {
  kind: "figure-path"
  d: string
  tone: FigureTone
  fill: FigureTone | null
  width: number
  id?: string
  tip?: string
}

export interface FigureBoxEl {
  kind: "figure-box"
  x: number
  y: number
  w: number
  h: number
  r: number
  label: string | null
  tone: FigureTone
  fill: FigureTone | null
  id?: string
  tip?: string
}

export interface FigureLineEl {
  kind: "figure-line"
  x1: number
  y1: number
  x2: number
  y2: number
  tone: FigureTone
  width: number
  id?: string
  tip?: string
}

export interface FigureDotEl {
  kind: "figure-dot"
  cx: number
  cy: number
  r: number
  tone: FigureTone
  id?: string
  tip?: string
}

export interface FigureLabelEl {
  kind: "figure-label"
  x: number
  y: number
  text: string
  size: number
  anchor: "start" | "middle" | "end"
  id?: string
  tip?: string
}

export type SceneElement =
  | NodeBoxEl
  | ArrowEl
  | LabelEl
  | AxisEl
  | BarEl
  | LinePathEl
  | DotEl
  | SparklineEl
  | FigurePathEl
  | FigureBoxEl
  | FigureLineEl
  | FigureDotEl
  | FigureLabelEl

export interface Scene {
  width: number
  height: number
  elements: SceneElement[]
}
