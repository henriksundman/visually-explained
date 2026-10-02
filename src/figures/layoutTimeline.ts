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

/**
 * Widest scene the figure form may occupy.
 *
 * The scene has no width attribute and `.exp-figure` is `width: 100%`, so the
 * SVG does not overflow its column — it SCALES DOWN to fit. An 11px label in a
 * scene of width W therefore renders at 11 × (column / W). Holding that at a
 * readable 8px in a ~600px column puts the ceiling at 825. Past it the figure
 * is not a wide diagram, it is a shrunken one, and the text form carries the
 * same content legibly (plus `detail`, which the figure drops).
 */
const MAX_FIGURE_WIDTH = 825

/** Estimated rendered width of a timeline label. */
function labelWidth(text: string): number {
  return Math.round(text.length * LABEL_CHAR_W)
}

/**
 * Step needed for every label to clear its same-side neighbour and stay inside
 * the scene.
 *
 * Events alternate sides, so same-side labels sit `2 × step` apart and each
 * label only has to clear half of each neighbour's width. The two edge events
 * are the binding constraint in practice: the first is centred half a step
 * from the left edge, so it needs `step ≥ width − 2 × PAD` to avoid clipping.
 */
export function requiredTimelineStep(events: TimelineEventSpec[]): number {
  const n = events.length
  if (n === 0) return MIN_EVENT_WIDTH
  const widest = (e: TimelineEventSpec) => Math.max(labelWidth(e.what), labelWidth(e.when))
  let step = MIN_EVENT_WIDTH
  // Edge clearance, FIRST AND LAST ONLY. An interior event is a full step from
  // both edges and can never clip; applying this to every event would inflate
  // the step on account of a label that was never near an edge.
  for (const i of [0, n - 1]) {
    step = Math.max(step, widest(events[i]) - 2 * PAD)
  }
  // Same-side clearance: events alternate sides, so i and i-2 are the
  // neighbours sharing a baseline, 2 steps apart. Each only has to clear half
  // the other's width.
  for (let i = 2; i < n; i++) {
    step = Math.max(step, (widest(events[i]) + widest(events[i - 2])) / 4)
  }
  return step
}

/**
 * The step actually used for layout.
 *
 * Two floors apply and they must not disagree. The label-derived step is the
 * minimum needed to avoid overlap; the 460px minimum width is the minimum
 * needed to look like a figure at all. When the WIDTH floor is the binding one
 * the step grows to fill it — otherwise events bunch to the left of a spine
 * that runs past the last dot, leaving dead space (and the demo timeline
 * visibly narrower than it should be).
 */
export function timelineStep(events: TimelineEventSpec[]): number {
  const n = events.length
  if (n === 0) return MIN_EVENT_WIDTH
  return Math.max(requiredTimelineStep(events), (460 - PAD * 2) / n)
}

/** Scene width the figure form would occupy for these events. */
export function timelineFigureWidth(events: TimelineEventSpec[]): number {
  if (events.length === 0) return 460
  return PAD * 2 + events.length * timelineStep(events)
}

/**
 * Can these events be drawn as a figure without either overlapping or
 * shrinking past legibility?
 *
 * This is the whole fit rule, and it lives here rather than in the primitive
 * so the text-measurement constants stay in one file with the layout that
 * uses them. The primitive degrades to the text form when it returns false.
 */
export function timelineFigureFits(events: TimelineEventSpec[]): boolean {
  return timelineFigureWidth(events) <= MAX_FIGURE_WIDTH
}

/**
 * Ordinal spacing: `when` is an arbitrary string, so events are evenly spaced,
 * not scaled — the IR carries no dates and no coordinates (spec §Decisions).
 *
 * The step is label-aware so that a caller which reaches here anyway gets a
 * figure with no overlap rather than a broken one. Nothing is dropped: an
 * over-long `what` widens the scene instead of silently vanishing. Callers
 * that care about legibility should gate on `timelineFigureFits` first and
 * render the text form — that is a visible, author-facing degradation, which
 * is the property this file deliberately does not have.
 */
export function layoutTimeline(events: TimelineEventSpec[]): TimelineLayoutResult {
  const step = timelineStep(events)
  const width = timelineFigureWidth(events)
  const elements: Scene["elements"] = [
    { kind: "axis", x1: PAD, y1: SPINE_Y, x2: width - PAD, y2: SPINE_Y },
  ]
  events.forEach((e, i) => {
    const x = PAD + (i + 0.5) * step
    elements.push({ kind: "dot", x, y: SPINE_Y, id: `event:${i}`, tip: e.tip })
    const up = i % 2 === 0
    const endY = up ? SPINE_Y - STEM : SPINE_Y + STEM
    elements.push({ kind: "line-path", d: `M ${x} ${SPINE_Y} L ${x} ${endY}` })
    if (up) {
      elements.push({ kind: "label", x, y: endY - 18, text: e.what, anchor: "middle" })
      elements.push({ kind: "label", x, y: endY - 4, text: e.when, anchor: "middle", emphasis: true })
    } else {
      elements.push({ kind: "label", x, y: endY + 14, text: e.when, anchor: "middle", emphasis: true })
      elements.push({ kind: "label", x, y: endY + 28, text: e.what, anchor: "middle" })
    }
  })
  return { scene: { width, height: H, elements }, warnings: [] }
}
