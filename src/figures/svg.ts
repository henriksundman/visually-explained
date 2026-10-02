import { escapeHtml } from "../core/inline"
import { FIGURE_TONE_VAR, sketchElementSvg } from "./sketch"
import type {
  ArrowEl,
  BarEl,
  DotEl,
  FigureBoxEl,
  FigureDotEl,
  FigureLabelEl,
  FigureLineEl,
  FigurePathEl,
  LabelEl,
  LinePathEl,
  NodeBoxEl,
  Scene,
  SceneElement,
  SparklineEl,
} from "./scene"

export interface SceneSvgOptions {
  /** Accessible name, derived deterministically from the block's own fields. */
  ariaLabel: string
  /** Sketch pass (Task 6): rough.js hand-drawn strokes instead of clean shapes. */
  sketch?: boolean
  /** Deterministic seed for the sketch pass (block id, else content hash). */
  seed?: string
  /**
   * Element id → draggable axes, for the interactive runtime
   * (drag-to-vary spec §4). Opt-in: the static renderer never sets this, so
   * its output stays byte-identical. When present, a matching `.exp-el`
   * wrapper gains `data-draggable` plus a tabindex so it is keyboard-reachable.
   */
  draggable?: ReadonlyMap<string, DraggableAxes>
}

/** Which axes a declared drag handle moves. */
export type DraggableAxes = "x" | "y" | "xy"

/** Format a number deterministically: integers plain, else up to 2 decimals. */
export function n2(n: number): string {
  return String(Math.round(n * 100) / 100)
}

/** Emit-layer identity gate: escape-safety only. Author ids were already
 *  regex-validated at parse time; derived ids (dep->lat, bar:Wed) are built
 *  from schema-validated strings. escapeHtml makes any of them attribute-safe. */
function hasIdentity(el: SceneElement): boolean {
  return typeof el.id === "string" && el.id !== "" && el.id.length <= 100
}

function hasTip(el: SceneElement): boolean {
  return typeof el.tip === "string" && el.tip.trim() !== "" && el.tip.length <= 200
}

/** Hairline elements are nearly impossible to hover; a transparent 12px twin
 *  stroke inside the same wrapper widens the hit area without new geometry
 *  layers. Arcs/curves compile to figure-path, so they are covered by d. */
function twinStroke(el: SceneElement): string {
  const d =
    el.kind === "figure-path" || el.kind === "line-path" || el.kind === "arrow"
      ? el.d
      : el.kind === "figure-line"
        ? `M ${n2(el.x1)} ${n2(el.y1)} L ${n2(el.x2)} ${n2(el.y2)}`
        : null
  if (d === null) return ""
  return `<path class="exp-el-hit" d="${d}" stroke="transparent" stroke-width="12" fill="none" pointer-events="stroke"/>`
}

/** Wrap in the .exp-el group when the element carries identity. Duplicate ids
 *  resolve first-wins via `claimId` (silent salvage — the emit layer has no
 *  warning channel): a duplicate emits anonymous but keeps its tip. */
function wrapIdentity(
  el: SceneElement,
  inner: string,
  claimId: (id: string) => boolean,
  draggable?: ReadonlyMap<string, DraggableAxes>,
): string {
  const idOk = hasIdentity(el) && claimId(el.id!)
  const axes = idOk ? draggable?.get(el.id!) : undefined
  if (!idOk && !hasTip(el)) return inner
  const attrs =
    (idOk ? ` data-el-id="${escapeHtml(el.id!)}"` : "") +
    (hasTip(el) ? ` data-tip="${escapeHtml(el.tip!)}"` : "") +
    // A declared handle is focusable even without a tip, so the keyboard path
    // (spec §8) has something to focus.
    (axes ? ` data-draggable="${axes}"` : "")
  const tabindex = hasTip(el) || axes ? ` tabindex="0"` : ""
  const label = axes ? ` aria-label="${escapeHtml(dragLabel(el, axes))}"` : ""
  return `<g class="exp-el"${attrs}${tabindex}${label}>${inner}</g>`
}

/** Human name for a handle's accessible label. */
function dragLabel(el: SceneElement, axes: DraggableAxes): string {
  const axis = axes === "xy" ? "in both directions" : axes === "x" ? "horizontally" : "vertically"
  return `Drag to vary (${axis})`
}

function nodeLabel(el: NodeBoxEl): string {
  const lines = el.lines && el.lines.length > 0 ? el.lines : [el.label]
  if (lines.length <= 1) {
    return (
      `<text x="${n2(el.x + el.w / 2)}" y="${n2(el.y + el.h / 2)}" text-anchor="middle" dominant-baseline="central" ` +
      `class="exp-node-label">${escapeHtml(lines[0] ?? el.label)}</text>`
    )
  }
  const cx = el.x + el.w / 2
  const cy = el.y + el.h / 2
  const pitch = 16
  const tspans = lines
    .map((line, i) => {
      const y = cy - ((lines.length - 1) * pitch) / 2 + i * pitch
      return `<tspan x="${n2(cx)}" y="${n2(y)}">${escapeHtml(line)}</tspan>`
    })
    .join("")
  return `<text text-anchor="middle" dominant-baseline="central" class="exp-node-label">${tspans}</text>`
}

function nodeBox(el: NodeBoxEl, i: number): string {
  const rx = el.shape === "pill" ? el.h / 2 : el.shape === "round" ? 10 : el.shape === "note" ? 2 : 4
  return (
    `<g class="exp-node exp-node-${el.shape}" style="--draw-i:${i}">` +
    `<rect x="${n2(el.x)}" y="${n2(el.y)}" width="${n2(el.w)}" height="${n2(el.h)}" rx="${n2(rx)}"` +
    ` fill="var(--exp-node-fill)" stroke="var(--exp-node-stroke)"/>` +
    nodeLabel(el) +
    `</g>`
  )
}

function arrowLabel(el: ArrowEl): string {
  if (!el.label || el.labelX === undefined || el.labelY === undefined) return ""
  const open =
    `<text class="exp-fig-label exp-edge-label" text-anchor="middle" ` +
    `transform="translate(${n2(el.labelX)},${n2(el.labelY)})"`
  const lines = el.lines && el.lines.length > 0 ? el.lines : [el.label]
  // Single line: exactly the markup shipped before, so nothing downstream
  // churns (spec §2.6).
  if (lines.length === 1) return `${open}>${escapeHtml(lines[0])}</text>`
  // tspan coordinates resolve INSIDE the translated group, so they are local:
  // x stays 0 (text-anchor=middle centres on the translate point) and y is the
  // offset from the block centre. Baking labelX into the tspan x as well would
  // double-offset the block.
  const pitch = 15
  const tspans = lines
    .map((line, i) => {
      const y = -((lines.length - 1) * pitch) / 2 + i * pitch
      return `<tspan x="0" y="${n2(y)}">${escapeHtml(line)}</tspan>`
    })
    .join("")
  return `${open}>${tspans}</text>`
}

function arrow(el: ArrowEl, i: number): string {
  const cls = el.edgeKind === "causes" || el.edgeKind === "leads" ? "exp-edge" : `exp-edge exp-edge-${el.edgeKind}`
  const label = arrowLabel(el)
  return (
    `<g class="exp-arrow" style="--draw-i:${i}">` +
    `<path class="${cls}" d="${el.d}"/>` +
    `<path class="${cls}" d="${el.head}"/>` +
    label +
    `</g>`
  )
}

function label(el: LabelEl, i: number): string {
  const cls = el.emphasis ? "exp-fig-label exp-fig-label-emphasis" : "exp-fig-label"
  return (
    `<text class="${cls}" x="${n2(el.x)}" y="${n2(el.y)}" text-anchor="${el.anchor}" style="--draw-i:${i}">` +
    `${escapeHtml(el.text)}</text>`
  )
}

function axis(el: { x1: number; y1: number; x2: number; y2: number }, i: number): string {
  return (
    `<line class="exp-axis" x1="${n2(el.x1)}" y1="${n2(el.y1)}" x2="${n2(el.x2)}" y2="${n2(el.y2)}" ` +
    `style="--draw-i:${i}"/>`
  )
}

function bar(el: BarEl, i: number): string {
  return (
    `<rect class="exp-bar" x="${n2(el.x)}" y="${n2(el.y)}" width="${n2(el.w)}" height="${n2(el.h)}" ` +
    `style="--draw-i:${i}"/>`
  )
}

function linePath(el: LinePathEl, i: number): string {
  return `<path class="exp-line-path" d="${el.d}" style="--draw-i:${i}"/>`
}

function dot(el: DotEl, i: number): string {
  return `<circle class="exp-dot" cx="${n2(el.x)}" cy="${n2(el.y)}" r="4" style="--draw-i:${i}"/>`
}

function sparkline(el: SparklineEl, i: number): string {
  return `<path class="exp-sparkline exp-sparkline-${el.trend}" d="${el.d}" style="--draw-i:${i}"/>`
}

function figurePath(el: FigurePathEl, i: number): string {
  const fill = el.fill ? FIGURE_TONE_VAR[el.fill] : "none"
  const opacity = el.fill ? ` fill-opacity="0.12"` : ""
  return (
    `<path class="exp-fig-path" d="${el.d}" fill="${fill}"${opacity} stroke="${FIGURE_TONE_VAR[el.tone]}" ` +
    `stroke-width="${n2(el.width)}" stroke-linecap="round" style="--draw-i:${i}"/>`
  )
}

function figureBox(el: FigureBoxEl, i: number): string {
  const fill = el.fill ? FIGURE_TONE_VAR[el.fill] : "none"
  const opacity = el.fill ? ` fill-opacity="0.12"` : ""
  const label = el.label
    ? `<text x="${n2(el.x + el.w / 2)}" y="${n2(el.y + el.h / 2)}" text-anchor="middle" dominant-baseline="central" class="exp-fig-label">${escapeHtml(el.label)}</text>`
    : ""
  return (
    `<g class="exp-fig-box" style="--draw-i:${i}">` +
    `<rect x="${n2(el.x)}" y="${n2(el.y)}" width="${n2(el.w)}" height="${n2(el.h)}" rx="${n2(el.r)}" fill="${fill}"${opacity} stroke="${FIGURE_TONE_VAR[el.tone]}"/>` +
    label +
    `</g>`
  )
}

function figureLine(el: FigureLineEl, i: number): string {
  return (
    `<line class="exp-fig-line" x1="${n2(el.x1)}" y1="${n2(el.y1)}" x2="${n2(el.x2)}" y2="${n2(el.y2)}" ` +
    `stroke="${FIGURE_TONE_VAR[el.tone]}" stroke-width="${n2(el.width)}" style="--draw-i:${i}"/>`
  )
}

function figureDot(el: FigureDotEl, i: number): string {
  return (
    `<circle class="exp-fig-dot" cx="${n2(el.cx)}" cy="${n2(el.cy)}" r="${n2(el.r)}" ` +
    `fill="${FIGURE_TONE_VAR[el.tone]}" style="--draw-i:${i}"/>`
  )
}

function figureLabel(el: FigureLabelEl, i: number): string {
  return (
    `<text class="exp-fig-label" x="${n2(el.x)}" y="${n2(el.y)}" text-anchor="${el.anchor}" ` +
    `style="--draw-i:${i};font-size:${n2(el.size)}px">${escapeHtml(el.text)}</text>`
  )
}

function cleanElement(
  el: SceneElement,
  i: number,
  claimed: Set<string>,
  draggable?: ReadonlyMap<string, DraggableAxes>,
): string {
  const identity = hasIdentity(el) || hasTip(el)
  return wrapIdentity(
    el,
    cleanInner(el, i) + (identity ? twinStroke(el) : ""),
    id => {
      if (claimed.has(id)) return false
      claimed.add(id)
      return true
    },
    draggable,
  )
}

function cleanInner(el: SceneElement, i: number): string {
  switch (el.kind) {
    case "node-box":
      return nodeBox(el, i)
    case "arrow":
      return arrow(el, i)
    case "label":
      return label(el, i)
    case "axis":
      return axis(el, i)
    case "bar":
      return bar(el, i)
    case "line-path":
      return linePath(el, i)
    case "dot":
      return dot(el, i)
    case "sparkline":
      return sparkline(el, i)
    case "figure-path":
      return figurePath(el, i)
    case "figure-box":
      return figureBox(el, i)
    case "figure-line":
      return figureLine(el, i)
    case "figure-dot":
      return figureDot(el, i)
    case "figure-label":
      return figureLabel(el, i)
  }
}

export function sceneToSvg(scene: Scene, opts: SceneSvgOptions): string {
  const claimed = new Set<string>() // first id wins; later duplicates emit anonymous
  const body = opts.sketch
    ? scene.elements
        .map((el, i) => {
          const roughPart = sketchElementSvg(el, opts.seed ?? "", i)
          // rough.js cannot draw text, so sketchElementSvg deliberately skips
          // every label — sceneToSvg owns emitting them. Arrows belong here
          // too, or the sketch pass silently loses edge labels.
          const labelPart =
            el.kind === "node-box"
              ? nodeLabel(el)
              : el.kind === "arrow"
                ? arrowLabel(el)
                : el.kind === "label"
                  ? label(el, i)
                  : ""
          const identity = hasIdentity(el) || hasTip(el)
          return wrapIdentity(
            el,
            roughPart + labelPart + (identity ? twinStroke(el) : ""),
            id => {
              if (claimed.has(id)) return false
              claimed.add(id)
              return true
            },
            opts.draggable,
          )
        })
        .join("")
    : scene.elements.map((el, i) => cleanElement(el, i, claimed, opts.draggable)).join("")
  return (
    `<svg class="exp-figure" viewBox="0 0 ${n2(scene.width)} ${n2(scene.height)}" role="img" ` +
    `aria-label="${escapeHtml(opts.ariaLabel)}" xmlns="http://www.w3.org/2000/svg">` +
    `<title>${escapeHtml(opts.ariaLabel)}</title>` +
    body +
    `</svg>`
  )
}
