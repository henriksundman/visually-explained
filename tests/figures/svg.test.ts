import { describe, expect, it } from "vitest"
import { sceneToSvg } from "../../src/figures/svg"
import type { Scene } from "../../src/figures/scene"

const scene: Scene = {
  width: 240,
  height: 76,
  elements: [
    { kind: "node-box", id: "a", x: 16, y: 16, w: 90, h: 44, shape: "box", label: "Start" },
    {
      kind: "arrow",
      d: "M106 38 C 133 38, 133 38, 160 38",
      head: "M160 38 L151 33.5 L151 42.5 Z",
      label: "then",
      labelX: 133,
      labelY: 32,
      edgeKind: "causes",
    },
    { kind: "node-box", id: "b", x: 160, y: 16, w: 64, h: 44, shape: "round", label: "End" },
  ],
}

describe("sceneToSvg", () => {
  it("emits an accessible, token-based svg", () => {
    const svg = sceneToSvg(scene, { ariaLabel: "Start → End" })
    expect(svg).toMatch(/^<svg class="exp-figure" viewBox="0 0 240 76" role="img" aria-label="Start → End"/)
    expect(svg).toContain(`<title>Start → End</title>`)
    expect(svg).toContain(`fill="var(--exp-node-fill)"`)
    expect(svg).toContain(`stroke="var(--exp-node-stroke)"`)
    expect(svg).toContain(`class="exp-arrow"`)
    expect(svg).not.toMatch(/#[0-9a-f]{3,8}/i) // no literal colors
  })

  it("escapes IR text inside labels, titles, and aria", () => {
    const s: Scene = {
      width: 100,
      height: 40,
      elements: [{ kind: "label", x: 4, y: 20, text: "<b>&x</b>", anchor: "start" }],
    }
    const svg = sceneToSvg(s, { ariaLabel: "<script>alert(1)</script>" })
    expect(svg).toContain("&lt;b&gt;&amp;x&lt;/b&gt;")
    expect(svg).toContain("<title>&lt;script&gt;alert(1)&lt;/script&gt;</title>")
    expect(svg).not.toContain("<script>")
  })

  it("stamps a per-element --draw-i style for later draw-in animation", () => {
    const svg = sceneToSvg(scene, { ariaLabel: "x" })
    expect(svg).toContain(`style="--draw-i:0"`)
    expect(svg).toContain(`style="--draw-i:1"`)
  })

  it("is deterministic", () => {
    expect(sceneToSvg(scene, { ariaLabel: "x" })).toBe(sceneToSvg(scene, { ariaLabel: "x" }))
  })

  it("renders each element kind with its class", () => {
    const s: Scene = {
      width: 200,
      height: 120,
      elements: [
        { kind: "axis", x1: 10, y1: 100, x2: 190, y2: 100 },
        { kind: "bar", x: 20, y: 40, w: 30, h: 60, valueLabel: "3ms" },
        { kind: "line-path", d: "M20 80 L60 50" },
        { kind: "dot", x: 60, y: 50 },
        { kind: "sparkline", d: "M0 24 L40 12 L80 4", trend: "up" },
        { kind: "node-box", id: "n", x: 120, y: 20, w: 70, h: 30, shape: "pill", label: "P" },
        { kind: "label", x: 20, y: 20, text: "L", anchor: "middle", emphasis: true },
      ],
    }
    const svg = sceneToSvg(s, { ariaLabel: "kinds" })
    expect(svg).toContain(`class="exp-axis"`)
    expect(svg).toContain(`class="exp-bar"`)
    expect(svg).toContain(`class="exp-line-path"`)
    expect(svg).toContain(`class="exp-dot"`)
    expect(svg).toContain(`class="exp-sparkline exp-sparkline-up"`)
    expect(svg).toContain(`class="exp-node exp-node-pill"`)
    expect(svg).toContain(`class="exp-fig-label exp-fig-label-emphasis"`)
  })
})
