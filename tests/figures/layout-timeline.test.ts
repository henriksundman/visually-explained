import { describe, expect, it } from "vitest"
import {
  layoutTimeline,
  requiredTimelineStep,
  timelineFigureFits,
  timelineFigureWidth,
  timelineStep,
  type TimelineEventSpec,
} from "../../src/figures/layoutTimeline"
import type { LabelEl, Scene } from "../../src/figures/scene"

const PAD = 20

// .exp-fig-label is 11px; ~6.6px per character at that size.
const CHAR_W = 6.6
const textW = (s: string) => Math.round(s.length * CHAR_W)

/** The shipped demo's timeline — the shape that must never change. */
const DEMO_EVENTS: TimelineEventSpec[] = [
  { when: "Sep 12", what: "Onboarding redesign ships" },
  { when: "Sep 14", what: "Week-over-week activations triple" },
  { when: "Sep 18", what: "Retention holds at day 7" },
]

/** The case that used to overflow: 46-char names, 8 events. */
const LONG_EVENTS: TimelineEventSpec[] = Array.from({ length: 8 }, (_, i) => ({
  when: `2024-Q${i + 1}`,
  what: "An extremely long milestone description indeed",
}))

function labels(scene: Scene): LabelEl[] {
  return scene.elements.filter((e): e is LabelEl => e.kind === "label")
}

/** Half-width of a rendered label. */
function halfWidth(l: LabelEl): number {
  return textW(l.text) / 2
}

/** Extent of a centred label, accounting for its anchor. */
function extent(l: LabelEl): { left: number; right: number } {
  const half = halfWidth(l)
  if (l.anchor === "start") return { left: l.x, right: l.x + half * 2 }
  if (l.anchor === "end") return { left: l.x - half * 2, right: l.x }
  return { left: l.x - half, right: l.x + half }
}

/**
 * Labels sit on one baseline per side of the spine (even events up, odd down),
 * so only same-side events can collide. `what` and `when` are on DIFFERENT
 * baselines within an event and can never collide with each other — grouping
 * them as one slot (as an earlier version of this file did) reports a
 * guaranteed collision that does not exist.
 */
function rows(scene: Scene): Map<string, { x: number; half: number; text: string }[]> {
  const spine = 90
  const byRow = new Map<string, { x: number; half: number; text: string }[]>()
  for (const l of labels(scene)) {
    const side = l.y < spine ? "up" : "down"
    const kind = l.emphasis ? "when" : "what"
    const key = `${side}:${kind}`
    const bucket = byRow.get(key)
    if (bucket) bucket.push({ x: l.x, half: halfWidth(l), text: l.text })
    else byRow.set(key, [{ x: l.x, half: halfWidth(l), text: l.text }])
  }
  for (const bucket of byRow.values()) bucket.sort((a, b) => a.x - b.x)
  return byRow
}

describe("layoutTimeline presence", () => {
  it("renders a label for every event, whatever the label length", () => {
    // PRESENCE FIRST. Every geometry assertion below passes vacuously if
    // labels are missing, and this file exists because an earlier fix dropped
    // them silently while the suite stayed green. Nothing in layoutTimeline may
    // omit a label — degrading to the text list is the primitive's job, and it
    // is visible; a vanished label inside a figure is not.
    for (const events of [DEMO_EVENTS, LONG_EVENTS]) {
      const { scene } = layoutTimeline(events)
      const texts = labels(scene).map(l => l.text)
      for (const e of events) {
        expect(texts).toContain(e.what)
        expect(texts).toContain(e.when)
      }
      expect(labels(scene)).toHaveLength(events.length * 2)
    }
  })

  it("keeps the dot, stem and tip for every event", () => {
    const events = LONG_EVENTS.map((e, i) => ({ ...e, tip: `tip ${i}` }))
    const { scene } = layoutTimeline(events)
    expect(scene.elements.filter(e => e.kind === "dot")).toHaveLength(events.length)
    expect(scene.elements.filter(e => e.kind === "line-path")).toHaveLength(events.length)
    expect(scene.elements.filter(e => e.kind === "dot" && e.tip)).toHaveLength(events.length)
  })

  it("emits no warnings of its own — it never salvages by omission", () => {
    expect(layoutTimeline(LONG_EVENTS).warnings).toEqual([])
    expect(layoutTimeline(DEMO_EVENTS).warnings).toEqual([])
  })
})

describe("layoutTimeline geometry", () => {
  it("never lets same-side labels overlap, for any label length", () => {
    // Same-side events sit 2 steps apart, so each label only has to clear half
    // of its neighbour's width. The long-label case is the one that actually
    // collided before (124px of shortfall per pair at 8 events).
    for (const events of [DEMO_EVENTS, LONG_EVENTS]) {
      const { scene } = layoutTimeline(events)
      const found = rows(scene)
      expect(found.size).toBeGreaterThan(0)
      for (const [key, row] of found) {
        for (let i = 1; i < row.length; i++) {
          const gap = row[i].x - row[i - 1].x
          const need = row[i].half + row[i - 1].half
          expect(`${key}: ${row[i - 1].text} | ${row[i].text} gap=${gap} need=${need}`).toBe(
            `${key}: ${row[i - 1].text} | ${row[i].text} gap=${gap} need=${need}`,
          )
          expect(gap).toBeGreaterThanOrEqual(need)
        }
      }
    }
  })

  it("keeps every label inside the scene, whatever its anchor", () => {
    for (const events of [DEMO_EVENTS, LONG_EVENTS]) {
      const { scene } = layoutTimeline(events)
      for (const l of labels(scene)) {
        const { left, right } = extent(l)
        expect(`${l.text}: left ${left}`).toBe(`${l.text}: left ${left}`)
        expect(left).toBeGreaterThanOrEqual(0)
        expect(right).toBeLessThanOrEqual(scene.width)
      }
    }
  })

  it("keeps the shipped demo's 3 short events at the original compact spacing", () => {
    // Guards against the fix inflating every timeline. The demo's timeline is
    // the one shape users already know; it must not change.
    const { scene } = layoutTimeline(DEMO_EVENTS)
    expect(scene.width).toBe(460)
    expect(scene.height).toBe(180)
    expect(requiredTimelineStep(DEMO_EVENTS)).toBe(125)
    // The 460px width floor binds here, so the step expands to fill it.
    expect(timelineStep(DEMO_EVENTS)).toBe(140)
  })

  it("fills the scene — no dead space between the last event and the spine end", () => {
    // The step has two floors (label clearance, and a 460px minimum width) and
    // they must agree. When the WIDTH floor binds, the step has to grow to fill
    // it; otherwise events bunch left of a spine that runs past the last dot.
    // This regressed once: the demo rendered 107px of empty spine on the right.
    for (const events of [DEMO_EVENTS, LONG_EVENTS]) {
      const { scene } = layoutTimeline(events)
      const xs = scene.elements.filter(e => e.kind === "dot").map(e => (e as { x: number }).x)
      const first = xs[0]
      const last = xs[xs.length - 1]
      // Symmetric margin: first and last events sit equally far from the edges.
      expect(first - PAD).toBeCloseTo(scene.width - PAD - last, 6)
    }
  })

  it("spaces events evenly — ordinal, not date-scaled", () => {
    // `when` is an arbitrary string; the IR carries no dates, so the spine is
    // ordinal spacing. Uneven gaps would imply a false time scale.
    const { scene } = layoutTimeline(LONG_EVENTS)
    const xs = scene.elements.filter(e => e.kind === "dot").map(e => (e as { x: number }).x)
    const gaps = xs.slice(1).map((x, i) => x - xs[i])
    for (const g of gaps) expect(g).toBeCloseTo(gaps[0], 6)
  })
})

describe("timelineFigureFits — the figure/text decision", () => {
  it("accepts the shipped demo's timeline", () => {
    expect(timelineFigureFits(DEMO_EVENTS)).toBe(true)
  })

  it("accepts long labels when there are few enough of them", () => {
    // The complement of the rejection below: label length alone must not
    // decide. Three 40-character names are perfectly drawable at 712px.
    const events = Array.from({ length: 3 }, (_, i) => ({ when: `Q${i + 1}`, what: "x".repeat(40) }))
    expect(timelineFigureFits(events)).toBe(true)
  })

  it("accepts short labels at a high event count", () => {
    const events = Array.from({ length: 8 }, (_, i) => ({ when: `Q${i + 1}`, what: "Ship it" }))
    expect(timelineFigureFits(events)).toBe(true)
  })

  it("rejects the long-label case that used to overflow", () => {
    expect(timelineFigureFits(LONG_EVENTS)).toBe(false)
  })

  it("rejects a small number of very long labels", () => {
    // Count alone never caught this: 4 events is far under the count cap of 12,
    // but 40-character names need a 224px step, which scales the labels to
    // ~7px. (At 3 events the same labels do fit — 712px, ~9px — so the rule is
    // a measurement, not a length cutoff.)
    const events = Array.from({ length: 4 }, (_, i) => ({ when: `Q${i + 1}`, what: "x".repeat(40) }))
    expect(timelineFigureFits(events)).toBe(false)
    expect(timelineFigureWidth(events)).toBe(936)
  })

  it("keeps every figure it accepts inside the legibility budget", () => {
    // The budget exists because the SVG has no width attribute and
    // `.exp-figure` is `width: 100%` — a wide scene does not overflow, it
    // SCALES DOWN. 825 is where an 11px label falls to ~8px in a 600px column.
    const cases: TimelineEventSpec[][] = [
      DEMO_EVENTS,
      Array.from({ length: 8 }, (_, i) => ({ when: `Q${i + 1}`, what: "Ship it" })),
      Array.from({ length: 6 }, (_, i) => ({ when: `Q${i + 1}`, what: "x".repeat(25) })),
      [{ when: "a", what: "b" }],
    ]
    for (const events of cases) {
      if (timelineFigureFits(events)) expect(timelineFigureWidth(events)).toBeLessThanOrEqual(825)
    }
  })

  it("treats an empty timeline as fitting without dividing by zero", () => {
    expect(timelineFigureFits([])).toBe(true)
    expect(timelineFigureWidth([])).toBe(460)
    expect(requiredTimelineStep([])).toBe(90)
  })

  it("grows monotonically with label length, so the decision has no dead zone", () => {
    // A non-monotonic fit predicate would let a slightly longer label pass
    // where a shorter one failed — an undebuggable cliff.
    let previous = 0
    for (const len of [5, 10, 15, 20, 25, 30, 35, 40, 45, 50]) {
      const events = Array.from({ length: 6 }, (_, i) => ({ when: `Q${i + 1}`, what: "x".repeat(len) }))
      const step = requiredTimelineStep(events)
      expect(step).toBeGreaterThanOrEqual(previous)
      previous = step
    }
  })
})
