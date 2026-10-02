import type { Scene } from "./scene"

export interface TimelineEventSpec {
  when: string
  what: string
  tip?: string
}

export interface TimelineLayoutResult {
  scene: Scene
  warnings: string[]
}

const PAD = 20
const SPINE_Y = 90
const H = 180
const STEM = 36
const MIN_EVENT_WIDTH = 90
const LABEL_CHAR_W = 6.6 // per-char estimate at the 11px .exp-fig-label size
const MAX_EVENT_STEP = 320 // cap, so an unbounded `what` cannot blow up width

/** Estimated rendered width of a timeline label. */
function labelWidth(text: string): number {
  return Math.round(text.length * LABEL_CHAR_W)
}

/** Ordinal spacing: `when` is an arbitrary string, so events are evenly spaced,
 *  not scaled — the IR carries no dates and no coordinates (spec §Decisions).
 *
 *  Spacing is label-aware: events alternate sides, so same-side labels sit two
 *  steps apart and the first event is half a step from the edge. A step of at
 *  least the widest label therefore keeps every label clear of its neighbour
 *  AND inside the scene, which is what stops the overlap and edge clipping.
 *  `what`/`when` are unbounded schema strings, so the step is capped and an
 *  over-long label is dropped rather than allowed to overlap (spec §2.4). */
export function layoutTimeline(events: TimelineEventSpec[]): TimelineLayoutResult {
  const widest = events.reduce((m, e) => Math.max(m, labelWidth(e.what), labelWidth(e.when)), 0)
  const baseWidth = Math.max(460, PAD * 2 + events.length * MIN_EVENT_WIDTH)
  const baseStep = (baseWidth - PAD * 2) / events.length
  const step = Math.min(MAX_EVENT_STEP, Math.max(baseStep, MIN_EVENT_WIDTH, widest))
  const width = Math.max(baseWidth, PAD * 2 + events.length * step)
  const elements: Scene["elements"] = [
    { kind: "axis", x1: PAD, y1: SPINE_Y, x2: width - PAD, y2: SPINE_Y },
  ]
  events.forEach((e, i) => {
    const x = PAD + (i + 0.5) * step
    elements.push({ kind: "dot", x, y: SPINE_Y, id: `event:${i}`, tip: e.tip })
    const up = i % 2 === 0
    const endY = up ? SPINE_Y - STEM : SPINE_Y + STEM
    elements.push({ kind: "line-path", d: `M ${x} ${SPINE_Y} L ${x} ${endY}` })
    // Degrade rather than overlap: a label wider than its own step cannot be
    // placed without colliding, so it is omitted — the dot, stem and tip stay.
    const show = (text: string) => labelWidth(text) <= step
    if (up) {
      if (show(e.what)) elements.push({ kind: "label", x, y: endY - 18, text: e.what, anchor: "middle" })
      if (show(e.when)) elements.push({ kind: "label", x, y: endY - 4, text: e.when, anchor: "middle", emphasis: true })
    } else {
      if (show(e.when)) elements.push({ kind: "label", x, y: endY + 14, text: e.when, anchor: "middle", emphasis: true })
      if (show(e.what)) elements.push({ kind: "label", x, y: endY + 28, text: e.what, anchor: "middle" })
    }
  })
  return { scene: { width, height: H, elements }, warnings: [] }
}
