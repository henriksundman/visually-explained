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

describe("authored figure elements", () => {
  const scene: Scene = {
    width: 200,
    height: 100,
    elements: [
      { kind: "figure-path", d: "M 0 0 L 10 10", tone: "accent", fill: null, width: 2 },
      { kind: "figure-box", x: 10, y: 10, w: 80, h: 30, r: 4, label: "Box", tone: "ink", fill: null },
      { kind: "figure-line", x1: 0, y1: 0, x2: 5, y2: 5, tone: "muted", width: 1 },
      { kind: "figure-dot", cx: 50, cy: 50, r: 3, tone: "accent" },
      { kind: "figure-label", x: 5, y: 20, text: "a<b", size: 11, anchor: "middle" },
    ],
  }

  it("renders clean svg with tone vars and escaped text", () => {
    const svg = sceneToSvg(scene, { ariaLabel: "f" })
    expect(svg).toContain(`class="exp-fig-path"`)
    expect(svg).toContain(`stroke="var(--exp-accent)"`)
    expect(svg).toContain(`stroke="var(--exp-text-muted)"`)
    expect(svg).toContain(`class="exp-fig-box"`)
    expect(svg).toContain(">Box</text>")
    expect(svg).toContain(`class="exp-fig-line"`)
    expect(svg).toContain(`class="exp-fig-dot"`)
    expect(svg).toContain(`class="exp-fig-label"`)
    expect(svg).toContain("&lt;b") // hostile text escaped
  })

  it("renders sketch passes for the new kinds", () => {
    const svg = sceneToSvg(scene, { ariaLabel: "f", sketch: true, seed: "s" })
    expect(svg).toContain(`class="exp-fig-sketch"`)
  })

  it("wraps identified elements with data-el-id and data-tip", () => {
    const svg = sceneToSvg(
      {
        width: 200,
        height: 100,
        elements: [
          { kind: "node-box", id: "lat", tip: "p95 spikes when the deploy lands", x: 20, y: 20, w: 90, h: 44, shape: "box", label: "Latency" },
          { kind: "figure-dot", id: "pen", tip: "The pen dot", cx: 50, cy: 50, r: 3, tone: "accent" },
        ],
      },
      { ariaLabel: "f" },
    )
    expect(svg).toContain(`<g class="exp-el" data-el-id="lat" data-tip="p95 spikes when the deploy lands" tabindex="0">`)
    expect(svg).toContain(`data-el-id="pen"`)
  })

  it("leaves anonymous elements untouched (no exp-el, no tabindex)", () => {
    const svg = sceneToSvg(
      { width: 100, height: 100, elements: [{ kind: "figure-dot", cx: 5, cy: 5, r: 3, tone: "ink" }] },
      { ariaLabel: "f" },
    )
    expect(svg).not.toContain(`exp-el`)
    expect(svg).not.toContain(`data-el-id`)
    expect(svg).not.toContain(`tabindex`)
  })

  it("gives hairline elements a transparent twin stroke inside the wrapper", () => {
    const svg = sceneToSvg(
      {
        width: 200,
        height: 100,
        elements: [
          { kind: "figure-path", id: "wave", d: "M 0 0 L 10 10", tone: "ink", fill: null, width: 2 },
          { kind: "figure-line", id: "axis", x1: 0, y1: 0, x2: 5, y2: 5, tone: "muted", width: 1 },
          { kind: "figure-dot", id: "pen", cx: 50, cy: 50, r: 3, tone: "accent" },
        ],
      },
      { ariaLabel: "f" },
    )
    expect(svg).toContain(`<path class="exp-el-hit" d="M 0 0 L 10 10" stroke="transparent" stroke-width="12" fill="none" pointer-events="stroke"/>`)
    expect(svg).toContain(`<path class="exp-el-hit" d="M 0 0 L 5 5" stroke="transparent"`) // line → path form
    const dotPart = svg.slice(svg.indexOf(`data-el-id="pen"`))
    expect(dotPart).not.toContain(`exp-el-hit`) // dots have real area; no twin
  })

  it("tabindex only appears on tip-bearing elements", () => {
    const svg = sceneToSvg(
      { width: 100, height: 100, elements: [{ kind: "figure-dot", id: "d", cx: 5, cy: 5, r: 3, tone: "ink" }] },
      { ariaLabel: "f" },
    )
    expect(svg).toContain(`data-el-id="d"`)
    expect(svg).not.toContain(`tabindex`)
  })

  it("carries identity through the sketch pass", () => {
    const svg = sceneToSvg(
      {
        width: 200,
        height: 100,
        elements: [
          { kind: "node-box", id: "lat", tip: "t", x: 20, y: 20, w: 90, h: 44, shape: "box", label: "Latency" },
          { kind: "figure-dot", id: "pen", tip: "p", cx: 50, cy: 50, r: 3, tone: "accent" },
        ],
      },
      { ariaLabel: "f", sketch: true, seed: "s" },
    )
    expect(svg).toContain(`data-el-id="lat"`)
    expect(svg).toContain(`data-el-id="pen"`)
    expect(svg).toContain(`class="exp-fig-sketch"`) // rough strokes still emitted
  })

  it("escapes hostile identity values", () => {
    const svg = sceneToSvg(
      { width: 100, height: 100, elements: [{ kind: "figure-dot", id: 'x"y', tip: "<script>", cx: 5, cy: 5, r: 3, tone: "ink" }] },
      { ariaLabel: "f" },
    )
    expect(svg).toContain(`data-el-id="x&quot;y"`)
    expect(svg).toContain(`data-tip="&lt;script&gt;"`)
    expect(svg).not.toContain("<script>")
  })

  it("first duplicate id wins; later duplicates emit anonymous but keep tips", () => {
    const svg = sceneToSvg(
      {
        width: 100,
        height: 100,
        elements: [
          { kind: "figure-dot", id: "d", cx: 5, cy: 5, r: 3, tone: "ink" },
          { kind: "figure-dot", id: "d", tip: "dup", cx: 20, cy: 20, r: 3, tone: "ink" },
        ],
      },
      { ariaLabel: "f" },
    )
    expect(svg.match(/data-el-id="d"/g)).toHaveLength(1)
    expect(svg).toContain(`data-tip="dup"`)
  })
})

describe("draggable handles", () => {
  const scene: Scene = {
    width: 200,
    height: 100,
    elements: [
      { kind: "dot", x: 40, y: 50, id: "bob" },
      { kind: "dot", x: 120, y: 50, id: "fixed" },
    ],
  }

  it("PRESENCE: emits data-draggable on a declared handle", () => {
    // Asserted before any positioning test: every geometry assertion below is
    // vacuous if the attribute never appears, which is the failure mode that
    // kept this suite green through three rejected timeline fixes.
    const svg = sceneToSvg(scene, {
      ariaLabel: "f",
      draggable: new Map([["bob", "x" as const]]),
    })
    expect(svg).toContain('data-draggable="x"')
  })

  it("emits nothing for an undeclared element", () => {
    const svg = sceneToSvg(scene, {
      ariaLabel: "f",
      draggable: new Map([["bob", "x" as const]]),
    })
    const fixed = svg.slice(svg.indexOf('data-el-id="fixed"'))
    expect(fixed.slice(0, 120)).not.toContain("data-draggable")
  })

  it("marks a handle focusable and named, even with no tip", () => {
    const svg = sceneToSvg(scene, { ariaLabel: "f", draggable: new Map([["bob", "xy" as const]]) })
    const at = svg.indexOf('data-el-id="bob"')
    const open = svg.slice(svg.lastIndexOf("<g", at), svg.indexOf(">", at))
    expect(open).toContain('tabindex="0"')
    expect(open).toContain("aria-label=")
    expect(open).toContain("both directions")
  })

  it("leaves the static render byte-identical when no handles are declared", () => {
    const plain = sceneToSvg(scene, { ariaLabel: "f" })
    const empty = sceneToSvg(scene, { ariaLabel: "f", draggable: new Map() })
    expect(empty).toBe(plain)
    expect(plain).not.toContain("data-draggable")
  })

  it("emits the handle in the sketch pass too", () => {
    const svg = sceneToSvg(scene, { ariaLabel: "f", sketch: true, draggable: new Map([["bob", "y" as const]]) })
    expect(svg).toContain('data-draggable="y"')
  })
})
