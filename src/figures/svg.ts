import { escapeHtml } from "../core/inline"
import { sketchElementSvg } from "./sketch"
import type {
  ArrowEl,
  BarEl,
  DotEl,
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
}

/** Format a number deterministically: integers plain, else up to 2 decimals. */
export function n2(n: number): string {
  return String(Math.round(n * 100) / 100)
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

function arrow(el: ArrowEl, i: number): string {
  const cls = el.edgeKind === "causes" || el.edgeKind === "leads" ? "exp-edge" : `exp-edge exp-edge-${el.edgeKind}`
  const label =
    el.label && el.labelX !== undefined && el.labelY !== undefined
      ? `<text class="exp-fig-label exp-edge-label" text-anchor="middle" transform="translate(${n2(el.labelX)},${n2(el.labelY)})">${escapeHtml(el.label)}</text>`
      : ""
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

function cleanElement(el: SceneElement, i: number): string {
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
    default:
      return "" // figure-* kinds: compiled in Task 4
  }
}

export function sceneToSvg(scene: Scene, opts: SceneSvgOptions): string {
  const body = opts.sketch
    ? scene.elements
        .map((el, i) => {
          const roughPart = sketchElementSvg(el, opts.seed ?? "", i)
          const labelPart =
            el.kind === "node-box" ? nodeLabel(el) : el.kind === "label" ? label(el, i) : ""
          return roughPart + labelPart
        })
        .join("")
    : scene.elements.map(cleanElement).join("")
  return (
    `<svg class="exp-figure" viewBox="0 0 ${n2(scene.width)} ${n2(scene.height)}" role="img" ` +
    `aria-label="${escapeHtml(opts.ariaLabel)}" xmlns="http://www.w3.org/2000/svg">` +
    `<title>${escapeHtml(opts.ariaLabel)}</title>` +
    body +
    `</svg>`
  )
}
