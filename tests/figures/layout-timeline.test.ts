import { describe, expect, it } from "vitest"
import { layoutTimeline } from "../../src/figures/layoutTimeline"

describe("layoutTimeline", () => {
  it("places events on a horizontal spine, alternating above/below", () => {
    const { scene, warnings } = layoutTimeline([
      { when: "Sep 12", what: "Ships" },
      { when: "Sep 14", what: "Spikes" },
      { when: "Sep 18", what: "Holds" },
    ])
    expect(warnings).toEqual([])
    const dots = scene.elements.filter(e => e.kind === "dot")
    expect(dots).toHaveLength(3)
    const labels = scene.elements.filter(e => e.kind === "label") as { y: number; text: string }[]
    const above = labels.filter(l => l.y < 90)
    const below = labels.filter(l => l.y > 90)
    expect(above.length).toBeGreaterThan(0)
    expect(below.length).toBeGreaterThan(0)
    expect(above.some(l => l.text === "Sep 12")).toBe(true)
    expect(below.some(l => l.text === "Sep 14")).toBe(true)
  })

  it("widens for many events", () => {
    const one = layoutTimeline([{ when: "t0", what: "only" }])
    const many = layoutTimeline(Array.from({ length: 12 }, (_, i) => ({ when: `t${i}`, what: `event ${i}` })))
    expect(many.scene.width).toBeGreaterThan(one.scene.width)
  })
})
