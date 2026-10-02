import { describe, expect, it } from "vitest"
import { layoutTimeline, type TimelineEventSpec } from "../../src/figures/layoutTimeline"
import type { LabelEl, Scene } from "../../src/figures/scene"

// .exp-fig-label is 11px; ~6.6px per character at that size.
const CHAR_W = 6.6
const textW = (s: string) => Math.round(s.length * CHAR_W)

/** One entry per event, not per text node: an event emits BOTH a `what` and a
 *  `when` label at the same x, so the pair must be grouped before spacing can
 *  be judged — otherwise every event overlaps itself. */
interface EventSlot {
  x: number
  halfWidth: number
  texts: string[]
}

/** Labels sit on one baseline per side of the spine (even events up, odd down),
 *  so only same-side events can collide. */
function eventSlots(scene: Scene, side: "up" | "down"): EventSlot[] {
  const spine = 90
  const labels = scene.elements.filter(
    (e): e is LabelEl => e.kind === "label" && (side === "up" ? e.y < spine : e.y > spine),
  )
  const byX = new Map<number, LabelEl[]>()
  for (const l of labels) {
    const key = Math.round(l.x)
    const bucket = byX.get(key)
    if (bucket) bucket.push(l)
    else byX.set(key, [l])
  }
  return [...byX.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([x, group]) => ({
      x,
      halfWidth: Math.max(...group.map(l => textW(l.text))) / 2,
      texts: group.map(l => l.text),
    }))
}

describe("layoutTimeline label spacing", () => {
  it("never lets adjacent events on the same side overlap", () => {
    // Same-side events sit 2 steps apart, so a short label at the demo's
    // event count fits by accident. A long milestone name at a higher count
    // is what actually collides — see the DEBUGGING entry.
    const events: TimelineEventSpec[] = Array.from({ length: 8 }, (_, i) => ({
      when: `2024-Q${i + 1}`,
      what: "An extremely long milestone description indeed",
    }))
    const { scene, warnings } = layoutTimeline(events)
    expect(warnings).toEqual([])

    for (const side of ["up", "down"] as const) {
      const slots = eventSlots(scene, side)
      expect(slots.length).toBeGreaterThan(1)
      for (let i = 1; i < slots.length; i++) {
        const prev = slots[i - 1]
        const cur = slots[i]
        expect(cur.x - cur.halfWidth).toBeGreaterThanOrEqual(prev.x + prev.halfWidth)
      }
    }
  })

  it("caps the width an untrusted label can demand, degrading rather than overlapping", () => {
    // `what` is an unbounded schema string, so a runaway value must not be
    // able to widen the figure without limit — and must not overlap either.
    const runaway = "x".repeat(400)
    const { scene } = layoutTimeline([
      { when: "2019", what: runaway },
      { when: "2020", what: "b" },
    ])
    expect(scene.width).toBeLessThanOrEqual(1200)
    for (const side of ["up", "down"] as const) {
      const slots = eventSlots(scene, side)
      for (let i = 1; i < slots.length; i++) {
        expect(slots[i].x - slots[i].halfWidth).toBeGreaterThanOrEqual(
          slots[i - 1].x + slots[i - 1].halfWidth,
        )
      }
    }
  })

  it("grows the scene so the widest label is not clipped at either edge", () => {
    const { scene } = layoutTimeline([
      { when: "2019", what: "An extremely long milestone description indeed" },
      { when: "2020", what: "b" },
    ])
    for (const l of scene.elements) {
      if (l.kind !== "label") continue
      expect(l.x - textW(l.text) / 2).toBeGreaterThanOrEqual(0)
      expect(l.x + textW(l.text) / 2).toBeLessThanOrEqual(scene.width)
    }
  })

  it("keeps three short events at the original compact spacing", () => {
    // Guards against the fix inflating every timeline: the shipped demo's
    // 3-event timeline must not change shape.
    const { scene } = layoutTimeline([
      { when: "2024-Q1", what: "Design partners" },
      { when: "2024-Q3", what: "Beta" },
      { when: "2025-Q1", what: "GA" },
    ])
    expect(scene.width).toBe(460)
    const ups = eventSlots(scene, "up")
    expect(ups.length).toBe(2)
    expect(Math.abs(ups[1].x - ups[0].x)).toBeGreaterThan(100)
  })
})