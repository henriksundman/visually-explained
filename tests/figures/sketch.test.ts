import { describe, expect, it } from "vitest"
import { hashSeed } from "../../src/figures/seed"
import { sketchElementSvg } from "../../src/figures/sketch"

describe("hashSeed", () => {
  it("is deterministic and input-sensitive", () => {
    expect(hashSeed("diagram:1")).toBe(hashSeed("diagram:1"))
    expect(hashSeed("a")).not.toBe(hashSeed("b"))
  })
})

describe("sketchElementSvg", () => {
  it("renders a node box as rough paths with token colors", () => {
    const svg = sketchElementSvg(
      { kind: "node-box", id: "a", x: 10, y: 10, w: 90, h: 44, shape: "box", label: "Hi" },
      "seed1",
      0,
    )
    expect(svg).toContain(`class="exp-fig-sketch"`)
    expect(svg).toContain(`var(--exp-node-fill)`)
    expect(svg).toContain(`var(--exp-node-stroke)`)
    expect(svg).toContain(`style="--draw-i:0"`)
  })

  it("same seed → byte-identical; different seed → different wobble", () => {
    const el = { kind: "node-box" as const, id: "a", x: 0, y: 0, w: 90, h: 44, shape: "box" as const, label: "Hi" }
    expect(sketchElementSvg(el, "s", 0)).toBe(sketchElementSvg(el, "s", 0))
    expect(sketchElementSvg(el, "s", 0)).not.toBe(sketchElementSvg(el, "t", 0))
  })

  it("keeps text labels crisp (not roughed)", () => {
    const svg = sketchElementSvg(
      { kind: "node-box", id: "a", x: 0, y: 0, w: 90, h: 44, shape: "box", label: "Hi" },
      "s",
      0,
    )
    expect(svg).not.toContain("Hi") // labels are emitted by the clean/sketch label path, not the rough pass
  })
})

describe("sketchElementSvg: authored figure kinds", () => {
  it("roughes figure-path, figure-box, figure-line, figure-dot", () => {
    const cases = [
      { kind: "figure-path" as const, d: "M 0 0 L 10 10", tone: "accent" as const, fill: null, width: 2 },
      { kind: "figure-box" as const, x: 0, y: 0, w: 10, h: 10, r: 2, label: null, tone: "ink" as const, fill: null },
      { kind: "figure-line" as const, x1: 0, y1: 0, x2: 1, y2: 1, tone: "muted" as const, width: 1 },
      { kind: "figure-dot" as const, cx: 1, cy: 1, r: 3, tone: "accent" as const },
    ]
    for (const el of cases) {
      const svg = sketchElementSvg(el, "s", 0)
      expect(svg).toContain(`class="exp-fig-sketch"`)
      expect(svg).toContain(`style="--draw-i:0"`)
    }
  })

  it("leaves figure-label crisp (returns empty)", () => {
    expect(sketchElementSvg({ kind: "figure-label", x: 0, y: 0, text: "t", size: 11, anchor: "start" }, "s", 0)).toBe(
      "",
    )
  })
})
