import { describe, expect, it } from "vitest"
import { compileFigure, parseFigureElement } from "../../src/figures/authored"

describe("authored element identity", () => {
  it("preserves id and tip on compiled leaf elements", () => {
    const { scene, warnings } = compileFigure({
      elements: [
        { kind: "dot", cx: 5, cy: 5, id: "pen", tip: "The pen dot" },
        { kind: "line", x1: 0, y1: 0, x2: 5, y2: 5, id: "axis" },
      ],
    })
    expect(warnings).toEqual([])
    expect(scene.elements[0]).toMatchObject({ id: "pen", tip: "The pen dot" })
    expect(scene.elements[1]).toMatchObject({ id: "axis" })
    expect(scene.elements[1].tip).toBeUndefined()
  })

  it("drops an invalid id with figure-id-invalid", () => {
    const { scene, warnings } = compileFigure({
      elements: [{ kind: "dot", cx: 5, cy: 5, id: "not a name!" }],
    })
    expect(warnings.some(w => w.startsWith("figure-id-invalid"))).toBe(true)
    expect(scene.elements[0].id).toBeUndefined()
  })

  it("drops an over-long tip with figure-tip-too-long", () => {
    const { scene, warnings } = compileFigure({
      elements: [{ kind: "dot", cx: 5, cy: 5, tip: "x".repeat(201) }],
    })
    expect(warnings.some(w => w.startsWith("figure-tip-too-long"))).toBe(true)
    expect(scene.elements[0].tip).toBeUndefined()
  })

  it("warns figure-id-unsupported and drops group identity, keeps child identity", () => {
    const { scene, warnings } = compileFigure({
      elements: [
        // Deliberately type-hostile fixture: groups must REJECT id/tip at
        // runtime, so the FigureEl type cannot express them — hence the cast.
        {
          kind: "group",
          dx: 10,
          id: "g1",
          tip: "group tip",
          elements: [{ kind: "dot", cx: 0, cy: 0, id: "kid" }],
        } as never,
      ],
    })
    expect(warnings.some(w => w.startsWith("figure-id-unsupported"))).toBe(true)
    expect(scene.elements[0].id).toBe("kid")
  })
})

describe("compileFigure", () => {
  it("resolves numeric fields from params and derived values", () => {
    const { scene, warnings } = compileFigure({
      params: [{ name: "t", min: 0, max: 10, step: 0.5, initial: 5 }],
      derived: [{ name: "d", expr: "t * 2" }],
      elements: [
        { kind: "box", x: "10 + t", y: "d", w: 50, h: 20 },
        { kind: "label", x: "t", y: 10, text: "pos" },
      ],
    })
    expect(warnings).toEqual([])
    const box = scene.elements[0] as { kind: string; x: number; y: number }
    expect(box.x).toBe(15)
    expect(box.y).toBe(10)
    const label = scene.elements[1] as { x: number }
    expect(label.x).toBe(5)
  })

  it("compiles curve and arc into safe path d strings", () => {
    const { scene, warnings } = compileFigure({
      elements: [
        { kind: "curve", from: { x: 0, y: 0 }, cp1: { x: 10, y: 0 }, cp2: { x: 10, y: 20 }, to: { x: 20, y: 20 } },
        { kind: "arc", cx: 50, cy: 50, rx: 20, ry: 10, start: 0, end: 90 },
      ],
    })
    expect(warnings).toEqual([])
    const curve = scene.elements[0] as { kind: string; d: string }
    expect(curve.kind).toBe("figure-path")
    expect(curve.d).toMatch(/^M 0 0 C /)
    const arc = scene.elements[1] as { d: string }
    expect(arc.d).toContain(" A 20 10 0 0 1 ")
  })

  it("sets the large-arc flag for arcs over 180°", () => {
    const { scene } = compileFigure({
      elements: [{ kind: "arc", cx: 50, cy: 50, rx: 20, ry: 20, start: 0, end: 270 }],
    })
    expect((scene.elements[0] as { d: string }).d).toContain(" A 20 20 0 1 1 ")
  })

  it("applies group offsets to coordinate elements, bakes them into curve/arc, and leaves authored paths absolute", () => {
    const { scene, warnings } = compileFigure({
      elements: [
        {
          kind: "group",
          dx: 10,
          dy: "5",
          elements: [
            { kind: "dot", cx: 1, cy: 2 },
            { kind: "curve", from: { x: 0, y: 0 }, cp1: { x: 1, y: 0 }, cp2: { x: 1, y: 1 }, to: { x: 2, y: 2 } },
            { kind: "path", d: "M 0 0 L 5 5" },
          ],
        },
      ],
    })
    expect(warnings).toEqual([])
    const dot = scene.elements[0] as { cx: number; cy: number }
    expect(dot.cx).toBe(11)
    expect(dot.cy).toBe(7)
    const curve = scene.elements[1] as { d: string }
    expect(curve.d).toContain("M 10 5")
    const path = scene.elements[2] as { d: string }
    expect(path.d).toBe("M 0 0 L 5 5") // authored d is never rewritten
  })

  it("rejects nested groups with a warning", () => {
    const warnings: string[] = []
    const inner = parseFigureElement({ kind: "dot", cx: 0, cy: 0 }, m => warnings.push(m))
    const outer = parseFigureElement(
      { kind: "group", elements: [{ kind: "group", elements: inner ? [inner] : [] }] },
      m => warnings.push(m),
    )
    const { scene } = compileFigure({ elements: outer ? [outer] : [] })
    expect(warnings.some(w => w.includes("group"))).toBe(true)
    expect(scene.elements).toEqual([])
  })

  it("drops elements with unresolvable expressions and reports them", () => {
    const { scene, warnings } = compileFigure({
      params: [{ name: "t", min: 0, max: 5, step: 1, initial: 1 }],
      elements: [
        { kind: "dot", cx: "nope + 1", cy: 5 },
        { kind: "dot", cx: "1/0", cy: 5 },
        { kind: "dot", cx: 3, cy: 4 },
      ],
    })
    expect(scene.elements).toHaveLength(1)
    expect(warnings).toHaveLength(2)
  })

  it("rejects unsafe path d at compile time", () => {
    const { scene, warnings } = compileFigure({
      elements: [{ kind: "path", d: "M 0 0 < 5" }],
    })
    expect(scene.elements).toEqual([])
    expect(warnings[0]).toContain("figure-path-unsafe")
  })

  it("caps the scene at 60 elements with a warning", () => {
    const elements = Array.from({ length: 70 }, () => ({ kind: "dot", cx: 1, cy: 1 }) as const)
    const { scene, warnings } = compileFigure({ elements: [...elements] })
    expect(scene.elements).toHaveLength(60)
    expect(warnings.some(w => w.includes("figure-too-many"))).toBe(true)
  })

  it("defaults canvas to 360×240 and honors overrides", () => {
    expect(compileFigure({ elements: [] }).scene.width).toBe(360)
    expect(compileFigure({ elements: [] }).scene.height).toBe(240)
    expect(compileFigure({ width: 500, height: 100, elements: [] }).scene.width).toBe(500)
  })
})

describe("parseFigureElement", () => {
  it("parses every kind leniently", () => {
    const warnings: string[] = []
    const warn = (m: string) => warnings.push(m)
    expect(parseFigureElement({ kind: "path", d: "M 0 0 L 1 1", tone: "ink", width: "w" }, warn)).toMatchObject({ kind: "path" })
    expect(parseFigureElement({ kind: "curve", from: { x: 0, y: 0 }, cp1: { x: 0, y: 0 }, cp2: { x: 1, y: 1 }, to: { x: 2, y: 2 } }, warn)).toMatchObject({ kind: "curve" })
    expect(parseFigureElement({ kind: "arc", cx: 0, cy: 0, rx: 1, ry: 1, start: 0, end: 90 }, warn)).toMatchObject({ kind: "arc" })
    expect(parseFigureElement({ kind: "box", x: 0, y: 0, w: 10, h: 5, label: "L" }, warn)).toMatchObject({ kind: "box" })
    expect(parseFigureElement({ kind: "line", x1: 0, y1: 0, x2: 1, y2: 1 }, warn)).toMatchObject({ kind: "line" })
    expect(parseFigureElement({ kind: "dot", cx: 1, cy: 2 }, warn)).toMatchObject({ kind: "dot" })
    expect(parseFigureElement({ kind: "label", x: 0, y: 0, text: "hi" }, warn)).toMatchObject({ kind: "label" })
    expect(parseFigureElement({ kind: "group", elements: [] }, warn)).toMatchObject({ kind: "group" })
    expect(warnings).toEqual([])
  })

  it("returns null with a warning for garbage", () => {
    const warnings: string[] = []
    const warn = (m: string) => warnings.push(m)
    expect(parseFigureElement(null, warn)).toBeNull()
    expect(parseFigureElement({ kind: "wedge" }, warn)).toBeNull()
    expect(parseFigureElement({ kind: "path" }, warn)).toBeNull() // missing d
    expect(parseFigureElement({ kind: "dot", cx: "x" }, warn)).toBeNull() // missing cy
    expect(parseFigureElement({ kind: "label", x: 0, y: 0, text: "  " }, warn)).toBeNull() // empty text
    expect(parseFigureElement({ kind: "dot", cx: 0, cy: 0, tone: "chartreuse" }, warn)).toBeNull()
    expect(warnings.length).toBeGreaterThanOrEqual(6)
  })
})

describe("path slots", () => {
  it("expands {{expr}} slots against params and derived", () => {
    const { scene, warnings } = compileFigure({
      params: [{ name: "t", min: 0, max: 10, step: 1, initial: 5 }],
      derived: [{ name: "x2", expr: "t * 2" }],
      elements: [{ kind: "path", d: "M 0 0 L {{ x2 }} {{t + 1}}" }],
    })
    expect(warnings).toEqual([])
    expect((scene.elements[0] as { d: string }).d).toBe("M 0 0 L 10 6")
  })

  it("leaves a plain d byte-for-byte untouched", () => {
    const { scene, warnings } = compileFigure({ elements: [{ kind: "path", d: "M 0 0 L 5 5" }] })
    expect(warnings).toEqual([])
    expect((scene.elements[0] as { d: string }).d).toBe("M 0 0 L 5 5")
  })

  it("drops the element when a slot does not resolve, and salvages the rest", () => {
    const { scene, warnings } = compileFigure({
      elements: [{ kind: "path", d: "M {{nope}} 0 L 5 5" }, { kind: "dot", cx: 1, cy: 1 }],
    })
    expect(scene.elements).toHaveLength(1)
    expect(warnings.some(w => w.includes("figure-path-slot-expr"))).toBe(true)
  })

  it("rejects a slot expression over 80 characters", () => {
    const long = "1+".repeat(45) + "1" // 91 chars
    const { scene, warnings } = compileFigure({ elements: [{ kind: "path", d: `M {{${long}}} 0 L 5 5` }] })
    expect(scene.elements).toEqual([])
    expect(warnings.some(w => w.includes("figure-path-slot-length"))).toBe(true)
  })

  it("rejects more than 64 slots and accepts exactly 64", () => {
    const many = "M 0 0 L " + Array.from({ length: 65 }, () => "{{1}}").join(" ")
    const over = compileFigure({ elements: [{ kind: "path", d: many }] })
    expect(over.scene.elements).toEqual([])
    expect(over.warnings.some(w => w.includes("figure-path-slot-count"))).toBe(true)
    const ok = "M 0 0 L " + Array.from({ length: 64 }, () => "{{1}}").join(" ")
    const fit = compileFigure({ elements: [{ kind: "path", d: ok }] })
    expect(fit.warnings).toEqual([])
    expect(fit.scene.elements).toHaveLength(1)
  })

  it("still applies the grammar gate to the expanded string", () => {
    const { scene, warnings } = compileFigure({
      params: [{ name: "v", min: 0, max: 9, step: 1, initial: 1 }],
      elements: [{ kind: "path", d: "M {{v}} 0 < {{v}}" }],
    })
    expect(scene.elements).toEqual([])
    expect(warnings[0]).toContain("figure-path-unsafe")
  })

  it("applies the MAX_LEN gate after expansion, not before", () => {
    const d = "M " + " ".repeat(4085) + "{{9^99}}" // 4096 chars raw; expansion pushes it over
    const { scene, warnings } = compileFigure({ elements: [{ kind: "path", d }] })
    expect(scene.elements).toEqual([])
    expect(warnings[0]).toContain("figure-path-unsafe")
  })

  it("drops unbalanced braces via the grammar gate", () => {
    const { scene, warnings } = compileFigure({ elements: [{ kind: "path", d: "M {{1 0 L 5 5" }] })
    expect(scene.elements).toEqual([])
    expect(warnings[0]).toContain("figure-path-unsafe")
  })
})

describe("figure box label wrapping", () => {
  it("wraps a long box label to the box width", () => {
    const { scene } = compileFigure({
      elements: [{ kind: "box", x: 50, y: 200, w: 100, h: 40, label: "Proteasome (degrades proteins)" }],
    })
    const box = scene.elements[0]
    expect(box.kind).toBe("figure-box")
    const lines = (box as { lines?: string[] }).lines
    expect(lines).toBeDefined()
    expect(lines!.length).toBeGreaterThan(1)
    // every line fits the wrap width: (100 - 16) / 7.5 chars, min 6
    for (const line of lines!) expect(line.length).toBeLessThanOrEqual(Math.max(6, Math.floor((100 - 16) / 7.5)))
  })

  it("leaves a fitting label unwrapped (no lines field)", () => {
    const { scene } = compileFigure({
      elements: [{ kind: "box", x: 50, y: 30, w: 100, h: 40, label: "Cell" }],
    })
    const box = scene.elements[0] as { lines?: string[] }
    expect(box.lines).toBeUndefined()
  })

  it("keeps every word: rejoining the lines equals the label", () => {
    const { scene } = compileFigure({
      elements: [{ kind: "box", x: 150, y: 130, w: 100, h: 40, label: "ER (protein folding and loading)" }],
    })
    const box = scene.elements[0] as { label?: string; lines?: string[] }
    expect(box.lines!.join(" ")).toBe("ER (protein folding and loading)")
  })
})
