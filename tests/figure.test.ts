import { describe, expect, it } from "vitest"
import { renderBlock, renderExplanation } from "../src/core/render"
import { explanationSchema } from "../src/core/schema"
import "../src/core/registerAll"
import { buildAuthored } from "../src/primitives/figure"

const base = {
  version: 1 as const,
  blocks: [
    {
      type: "figure" as const,
      title: "Orbit",
      caption: "A circle-ish thing.",
      params: [{ name: "r", min: 5, max: 50, step: 1, initial: 20 }],
      elements: [
        { kind: "arc" as const, cx: 100, cy: 80, rx: "r", ry: "r", start: 0, end: 270 },
        { kind: "label" as const, x: 100, y: 80, text: "r = <r>", anchor: "middle" as const },
      ],
    },
  ],
}

describe("figure primitive", () => {
  it("is schema-valid", () => {
    expect(explanationSchema.safeParse(base).success).toBe(true)
  })

  it("renders a themed figure with param-driven geometry", () => {
    const { html, warnings } = renderExplanation(base)
    expect(html).toContain(`<div class="exp-block exp-figure">`)
    expect(html).toContain(`<svg class="exp-figure"`)
    expect(html).toContain(`A 20 20 0 1 1`) // rx = ry = initial r = 20, large+sweep for 270°
    expect(html).toContain(`<h4 class="exp-fig-title">Orbit</h4>`)
    expect(html).toContain(`<p class="exp-fig-caption">A circle-ish thing.</p>`)
    expect(html).toContain("r = &lt;r&gt;")
    expect(warnings).toEqual([])
  })

  it("drops invalid elements individually and keeps the rest", () => {
    const { html, warnings } = renderExplanation({
      version: 1,
      blocks: [
        {
          type: "figure",
          elements: [{ kind: "dot", cx: "bogus + 1", cy: 5 }, { kind: "dot", cx: 5, cy: 5 }],
        },
      ],
    })
    expect(warnings.some(w => w.includes("figure-dot-resolve"))).toBe(true)
    expect(html).toContain(`class="exp-fig-dot"`)
  })

  it("degrades to exp-fig-empty when everything drops, including empty elements", () => {
    const dropped = renderExplanation({ version: 1, blocks: [{ type: "figure", elements: [{ kind: "wedge" }] }] })
    expect(dropped.html).toContain(`class="exp-fig-empty"`)
    expect(dropped.html).not.toContain(`exp-fig-dot`)
    const empty = renderExplanation({ version: 1, blocks: [{ type: "figure", elements: [] }] })
    expect(empty.html).toContain(`class="exp-fig-empty"`)
  })

  it("drops duplicate param names, first definition wins", () => {
    const { html, warnings } = renderExplanation({
      version: 1,
      blocks: [
        {
          type: "figure",
          params: [
            { name: "r", min: 1, max: 9, step: 1, initial: 4 },
            { name: "r", min: 1, max: 9, step: 1, initial: 8 },
          ],
          elements: [{ kind: "dot", cx: "r * 10", cy: 10 }],
        },
      ],
    })
    expect(warnings.some(w => w.includes("figure-param-duplicate"))).toBe(true)
    expect(html).toContain(`cx="40"`)
  })

  it("a schema-invalid figure never renders a broken figure", () => {
    const { html } = renderExplanation({
      version: 1,
      blocks: [{ type: "figure", params: [{ name: "r", min: 1, max: 2, step: 1, initial: 9 }], elements: [] }],
    })
    expect(html).not.toContain(`<svg class="exp-figure"`)
  })

  it("sketch option produces rough strokes, in both entry points", () => {
    expect(renderExplanation(base, { sketch: true }).html).toContain(`class="exp-fig-sketch"`)
    // Sketch mode emits only rough strokes (labels stay crisp) — no clean classes.
    const html = renderBlock("figure", { title: "T", elements: [{ kind: "dot", cx: 1, cy: 2 }] }, 1, { sketch: true })
    expect(html).toContain(`class="exp-fig-sketch"`)
  })

  it("accepts sweep as an identifier and rejects non-identifiers", () => {
    const withSweep = { ...base, blocks: [{ ...base.blocks[0], sweep: "t" }] }
    expect(explanationSchema.safeParse(withSweep).success).toBe(true)
    const badSweep = { ...base, blocks: [{ ...base.blocks[0], sweep: "not a name!" }] }
    expect(explanationSchema.safeParse(badSweep).success).toBe(false)
  })

  it("rejects reserved evaluator constants as param names (they would be shadowed)", () => {
    for (const name of ["PI", "E", "TAU"]) {
      const bad = {
        ...base,
        blocks: [{ ...base.blocks[0], params: [{ name, min: 1, max: 9, step: 1, initial: 4 }] }],
      }
      expect(explanationSchema.safeParse(bad).success, `param name ${name}`).toBe(false)
    }
  })

  it("rejects reserved evaluator constants as derived names and sweep", () => {
    for (const name of ["PI", "E", "TAU"]) {
      const badDerived = { ...base, blocks: [{ ...base.blocks[0], derived: [{ name, expr: "1 + 2" }] }] }
      expect(explanationSchema.safeParse(badDerived).success, `derived name ${name}`).toBe(false)
      const badSweep = { ...base, blocks: [{ ...base.blocks[0], sweep: name }] }
      expect(explanationSchema.safeParse(badSweep).success, `sweep ${name}`).toBe(false)
    }
  })

  it("still accepts identifiers that merely contain a reserved name", () => {
    const ok = {
      ...base,
      blocks: [
        {
          ...base.blocks[0],
          params: [{ name: "PI_x", min: 1, max: 9, step: 1, initial: 4 }],
          derived: [{ name: "TIME", expr: "t * 2" }],
          sweep: "E2",
        },
      ],
    }
    expect(explanationSchema.safeParse(ok).success).toBe(true)
  })
})

describe("draggable parsing", () => {
  const base = {
    type: "figure" as const,
    params: [{ name: "r", min: 0, max: 360, step: 1, initial: 120 }],
    elements: [{ kind: "dot" as const, id: "bob", cx: "r", cy: 130, r: 6 }],
  }

  it("parses a draggable entry and drops unknown keys", () => {
    const w: string[] = []
    const a = buildAuthored(
      { ...base, draggable: [{ id: "bob", x: "r", y: "nope", bogus: 1 }] } as never,
      w,
    )
    expect(a.draggable).toEqual([{ id: "bob", x: "r", y: "nope" }])
  })

  it("warns and drops an entry with no axis", () => {
    const w: string[] = []
    const a = buildAuthored({ ...base, draggable: [{ id: "bob" }] } as never, w)
    expect(a.draggable).toEqual([])
    expect(w.join(" ")).toContain("figure-drag-no-axis")
  })

  it("warns and drops an id that violates the element-id rule", () => {
    const w: string[] = []
    const a = buildAuthored({ ...base, draggable: [{ id: "bad id!", x: "r" }] } as never, w)
    expect(a.draggable).toEqual([])
    expect(w.join(" ")).toContain("figure-drag-id-invalid")
  })

  it("bounds the entry count", () => {
    const w: string[] = []
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `d${i}`, x: "r" }))
    const a = buildAuthored({ ...base, draggable: many } as never, w)
    expect(a.draggable!.length).toBeLessThanOrEqual(16)
    expect(w.join(" ")).toContain("figure-drag-too-many")
  })

  it("leaves draggable undefined when absent — the common case is untouched", () => {
    const w: string[] = []
    const a = buildAuthored(base as never, w)
    expect(a.draggable).toBeUndefined()
  })
})
