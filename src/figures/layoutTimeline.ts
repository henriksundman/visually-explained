import type { Scene } from "./scene"

export interface TimelineEventSpec {
  when: string
  what: string
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

/** Ordinal spacing: `when` is an arbitrary string, so events are evenly spaced,
 *  not scaled — the IR carries no dates and no coordinates (spec §Decisions). */
export function layoutTimeline(events: TimelineEventSpec[]): TimelineLayoutResult {
  const width = Math.max(460, PAD * 2 + events.length * MIN_EVENT_WIDTH)
  const step = (width - PAD * 2) / events.length
  const elements: Scene["elements"] = [
    { kind: "axis", x1: PAD, y1: SPINE_Y, x2: width - PAD, y2: SPINE_Y },
  ]
  events.forEach((e, i) => {
    const x = PAD + (i + 0.5) * step
    elements.push({ kind: "dot", x, y: SPINE_Y })
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
