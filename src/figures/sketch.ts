import rough from "roughjs"
import { seedNumber } from "./seed"
import type { FigureTone, SceneElement } from "./scene"

/** Authored-figure tone → theme token. Owned here; svg.ts imports it. */
export const FIGURE_TONE_VAR: Record<FigureTone, string> = {
  ink: "var(--exp-ink)",
  muted: "var(--exp-text-muted)",
  accent: "var(--exp-accent)",
}

const ROUGH_BASE = { roughness: 1, bowing: 1, fillStyle: "solid" } as const

type RoughGenerator = ReturnType<typeof rough.generator>
type Drawable = ReturnType<RoughGenerator["rectangle"]>

function drawablesFor(gen: RoughGenerator, el: SceneElement, seed: string, index: number): Drawable[] {
  const opt = { ...ROUGH_BASE, seed: seedNumber(seed, index) }
  switch (el.kind) {
    case "node-box":
      return [
        gen.rectangle(el.x, el.y, el.w, el.h, {
          ...opt,
          fill: "var(--exp-node-fill)",
          stroke: "var(--exp-node-stroke)",
        }),
      ]
    case "arrow": {
      const edgeOpt =
        el.edgeKind === "conflict"
          ? { ...opt, stroke: "var(--exp-warning)", strokeLineDash: [5, 4] }
          : el.edgeKind === "part-of"
            ? { ...opt, stroke: "var(--exp-text-muted)", strokeLineDash: [2, 3] }
            : { ...opt, stroke: "var(--exp-ink)" }
      return [gen.path(el.d, edgeOpt), gen.path(el.head, edgeOpt)]
    }
    case "axis":
      return [gen.line(el.x1, el.y1, el.x2, el.y2, { ...opt, stroke: "var(--exp-edge)" })]
    case "bar":
      return [
        gen.rectangle(el.x, el.y, el.w, el.h, { ...opt, fill: "var(--exp-accent)", stroke: "var(--exp-accent)" }),
      ]
    case "line-path":
      return [gen.path(el.d, { ...opt, stroke: "var(--exp-accent)", strokeWidth: 2 })]
    case "dot":
      return [gen.circle(el.x, el.y, 8, { ...opt, fill: "var(--exp-accent)", stroke: "var(--exp-accent)" })]
    case "sparkline": {
      const stroke =
        el.trend === "up" ? "var(--exp-up)" : el.trend === "down" ? "var(--exp-down)" : "var(--exp-flat)"
      return [gen.path(el.d, { ...opt, stroke, strokeWidth: 2 })]
    }
    case "figure-path":
      return [
        gen.path(el.d, {
          ...opt,
          stroke: FIGURE_TONE_VAR[el.tone],
          strokeWidth: el.width,
          fill: el.fill ? FIGURE_TONE_VAR[el.fill] : undefined,
        }),
      ]
    case "figure-box":
      return [
        gen.rectangle(el.x, el.y, el.w, el.h, {
          ...opt,
          stroke: FIGURE_TONE_VAR[el.tone],
          fill: el.fill ? FIGURE_TONE_VAR[el.fill] : undefined,
        }),
      ]
    case "figure-line":
      return [
        gen.line(el.x1, el.y1, el.x2, el.y2, { ...opt, stroke: FIGURE_TONE_VAR[el.tone], strokeWidth: el.width }),
      ]
    case "figure-dot":
      return [
        gen.circle(el.cx, el.cy, el.r * 2, { ...opt, stroke: FIGURE_TONE_VAR[el.tone], fill: FIGURE_TONE_VAR[el.tone] }),
      ]
    default:
      return [] // labels are never roughed
  }
}

/** Rough.js hand-drawn paths for one scene element. Labels are intentionally
 *  NOT roughed — text stays crisp; only strokes wobble. */
export function sketchElementSvg(el: SceneElement, seed: string, index: number): string {
  if (el.kind === "label") return ""
  const gen = rough.generator()
  const drawables = drawablesFor(gen, el, seed, index)
  return drawables
    .flatMap(d => gen.toPaths(d))
    .map(
      p =>
        `<path class="exp-fig-sketch" d="${p.d}" stroke="${p.stroke ?? "none"}" stroke-width="${p.strokeWidth ?? 1}" ` +
        `fill="${p.fill ?? "none"}" style="--draw-i:${index}"/>`,
    )
    .join("")
}
