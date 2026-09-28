import { describe, expect, it } from "vitest"
import { sceneToSvg } from "../../src/figures/svg"
import type { Scene } from "../../src/figures/scene"

describe("multi-line node labels", () => {
  it("renders wrapped labels as centered tspans", () => {
    const scene: Scene = {
      width: 200,
      height: 100,
      elements: [
        {
          kind: "node-box",
          id: "a",
          x: 20,
          y: 20,
          w: 160,
          h: 60,
          shape: "box",
          label: "one",
          lines: ["More signups", "reach the aha"],
        },
      ],
    }
    const svg = sceneToSvg(scene, { ariaLabel: "x" })
    expect(svg).toContain("<tspan")
    expect(svg).toContain(">More signups</tspan>")
    expect(svg).toContain(">reach the aha</tspan>")
    expect(svg).not.toContain(">one</text>") // lines replace the raw label
  })

  it("renders single-line labels exactly as before (no tspan)", () => {
    const scene: Scene = {
      width: 200,
      height: 100,
      elements: [
        { kind: "node-box", id: "a", x: 20, y: 20, w: 90, h: 44, shape: "box", label: "Start", lines: ["Start"] },
      ],
    }
    const svg = sceneToSvg(scene, { ariaLabel: "x" })
    expect(svg).not.toContain("<tspan")
    expect(svg).toContain(">Start</text>")
  })
})
