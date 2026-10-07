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

describe("intrinsic figure size", () => {
  // `.exp-figure` is `max-width: 100%; height: auto`, which scales a too-wide
  // figure down and leaves a narrow one alone. That only works because the SVG
  // declares its own width/height; without them the browser has no intrinsic
  // size and falls back to filling the column, which stretched a tall `tb`
  // diagram to 26px labels and 1753px of height.
  it("emits width and height matching the viewBox", () => {
    const s: Scene = { width: 333, height: 865, elements: [] }
    const svg = sceneToSvg(s, { ariaLabel: "f" })
    expect(svg).toContain('width="333"')
    expect(svg).toContain('height="865"')
    expect(svg).toContain('viewBox="0 0 333 865"')
  })

  it("keeps the attributes in step with the viewBox after rounding", () => {
    // n2() rounds to 2dp; all three numbers must come from the same source or
    // the intrinsic aspect ratio stops matching the viewBox.
    const s: Scene = { width: 177.5, height: 76.25, elements: [] }
    const svg = sceneToSvg(s, { ariaLabel: "f" })
    expect(svg).toContain('width="177.5" height="76.25"')
    expect(svg).toContain('viewBox="0 0 177.5 76.25"')
  })

  it("emits the same intrinsic size in the sketch pass", () => {
    const s: Scene = { width: 460, height: 220, elements: [] }
    expect(sceneToSvg(s, { ariaLabel: "f", sketch: true })).toContain('width="460" height="220"')
  })
})

describe("accessible name", () => {
  // The name used to be emitted TWICE — as `aria-label` and as a `<title>`
  // element from the same variable, on consecutive lines with no conditional
  // between them. `<title>` is a user-agent tooltip, so every figure showed one
  // per FIGURE, identical for every element; on a mind map that string is the
  // whole tree linearised. Suppressing it costs nothing for screen readers:
  // for `role="img"` the accessible name comes from `aria-label`, and `<title>`
  // is only a fallback for when there is no `aria-label`.
  //
  // Both halves are asserted. Asserting only the absence would still pass if
  // `aria-label` regressed; asserting only the presence would pass if
  // `<title>` came back. And the absence is asserted as the ELEMENT, not as
  // the `[title]` attribute — a `[title]` selector matches the attribute, which
  // is how the 2026-10-04 probe concluded no tooltip existed when one did.
  it("carries the name in aria-label and emits no <title> element", () => {
    const s: Scene = { width: 200, height: 100, elements: [] }
    const svg = sceneToSvg(s, { ariaLabel: "Cache hierarchy" })
    expect(svg).toContain('role="img"')
    expect(svg).toContain('aria-label="Cache hierarchy"')
    expect(svg).not.toContain("<title>")
  })

  // Same in the sketch pass: sceneToSvg emits the wrapper from one code path,
  // so this pins that the suppression is not clean-mode-only.
  it("emits no <title> in the sketch pass either", () => {
    const s: Scene = { width: 200, height: 100, elements: [] }
    const svg = sceneToSvg(s, { ariaLabel: "Cache hierarchy", sketch: true })
    expect(svg).toContain('aria-label="Cache hierarchy"')
    expect(svg).not.toContain("<title>")
  })
})

describe("sceneToSvg: grow-to-content viewBox", () => {
  const ARIA = { ariaLabel: "test" }
  const parseViewBox = (svg: string) =>
    svg.match(/viewBox="([^"]+)"/)![1].split(/\s+/).map(Number)

  it("grows the viewBox to contain an out-of-canvas figure-label", () => {
    const svg = sceneToSvg(
      {
        width: 360,
        height: 240,
        elements: [{ kind: "figure-label", x: 100, y: 250, text: "below the canvas", size: 11, anchor: "middle" }],
      },
      ARIA,
    )
    const vb = parseViewBox(svg)
    expect(vb[3]).toBeGreaterThanOrEqual(253) // baseline 250 + descender ~3
  })

  it("grows to negative bounds when content sits left of the canvas", () => {
    const svg = sceneToSvg(
      {
        width: 360,
        height: 240,
        elements: [{ kind: "figure-dot", cx: -10, cy: 20, r: 4, tone: "accent" }],
      },
      ARIA,
    )
    const vb = parseViewBox(svg)
    expect(vb[0]).toBeLessThanOrEqual(-14) // minX = cx - r
  })

  it("keeps the canvas floor: an in-canvas scene is byte-identical", () => {
    const svg = sceneToSvg(
      {
        width: 360,
        height: 240,
        elements: [{ kind: "figure-dot", cx: 180, cy: 120, r: 3, tone: "accent" }],
      },
      ARIA,
    )
    expect(svg).toContain('width="360" height="240" viewBox="0 0 360 240"')
  })

  it("layout-driven elements never grow the scene (corpus safety)", () => {
    const svg = sceneToSvg(
      {
        width: 360,
        height: 240,
        elements: [{ kind: "label", x: 350, y: 230, text: "very long layout label here", anchor: "start" }],
      },
      ARIA,
    )
    expect(svg).toContain('viewBox="0 0 360 240"')
  })

  // Regression: naive number-pairing of path data desyncs on `A` (7 params,
  // odd count) — the demo orbit's arc paired its large-arc flag with the next
  // x into a phantom point at (1,300) and grew the figure to 360×300. The
  // exact orbit arcs must keep the canvas floor, and a genuinely out-of-canvas
  // arc's bulge must be contained.
  it("arc parameters never become phantom coordinates", () => {
    const orbit: Scene = {
      width: 360,
      height: 240,
      elements: [
        { kind: "figure-path", d: "M 300 120 A 120 70 0 0 1 60 120", tone: "accent", fill: null, width: 2 },
        { kind: "figure-path", d: "M 60 120 A 120 70 0 0 1 300 120", tone: "accent", fill: null, width: 2 },
        { kind: "figure-line", x1: 50, y1: 120, x2: 310, y2: 120, tone: "muted", width: 1 },
        { kind: "figure-line", x1: 180, y1: 40, x2: 180, y2: 200, tone: "muted", width: 1 },
        { kind: "figure-dot", cx: 264.8528137423857, cy: 70.50252531694167, r: 3, tone: "ink" },
        { kind: "figure-label", x: 272.8528137423857, y: 64.50252531694167, text: "θ = 45°", size: 11, anchor: "start" },
        { kind: "figure-label", x: 12, y: 20, text: "rx × ry ellipse", size: 11, anchor: "start" },
      ],
    }
    expect(sceneToSvg(orbit, { ariaLabel: "Orbit anatomy" })).toContain('width="360" height="240" viewBox="0 0 360 240"')
  })

  it("contains an arc whose bulge leaves the canvas", () => {
    const svg = sceneToSvg(
      {
        width: 360,
        height: 240,
        elements: [{ kind: "figure-path", d: "M 100 200 A 80 80 0 0 0 260 200", tone: "accent", fill: null, width: 2 }],
      },
      ARIA,
    )
    const vb = parseViewBox(svg)
    // sweep=0 runs counterclockwise: left→right dips BELOW the chord, to
    // y = 200 + 80 = 280 — past the canvas floor, so the viewBox must grow
    expect(vb[1]).toBe(0)
    expect(vb[3]).toBeGreaterThanOrEqual(280)
  })
})
