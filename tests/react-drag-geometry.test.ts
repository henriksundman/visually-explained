import { describe, expect, it } from "vitest"
import { clampParam, clientToScene, dragValueFor } from "../src/react/dragGeometry"

describe("clientToScene", () => {
  it("maps a client point through the screen CTM", () => {
    // scale 2, translate (100, 50) — a point at client (300, 250) is scene (100, 100).
    const m = { a: 2, b: 0, c: 0, d: 2, e: 100, f: 50 }
    const p = clientToScene(
      { clientX: 300, clientY: 250 },
      { matrix: m, rect: null, viewW: 360, viewH: 240 },
    )
    expect(p).toEqual({ x: 100, y: 100 })
  })

  it("falls back to the bounding rect when there is no matrix", () => {
    // rect is 720x480 for a 360x240 viewBox ⇒ scale 2, no translation.
    const p = clientToScene(
      { clientX: 300, clientY: 250 },
      { matrix: null, rect: { left: 0, top: 0, width: 720, height: 480 }, viewW: 360, viewH: 240 },
    )
    expect(p).toEqual({ x: 150, y: 125 })
  })

  it("returns null when both sources are unavailable — a drag must not guess", () => {
    const p = clientToScene(
      { clientX: 10, clientY: 10 },
      { matrix: null, rect: null, viewW: 360, viewH: 240 },
    )
    expect(p).toBeNull()
  })

  it("returns null for a degenerate (zero-scale) rect", () => {
    const p = clientToScene(
      { clientX: 10, clientY: 10 },
      { matrix: null, rect: { left: 0, top: 0, width: 0, height: 0 }, viewW: 360, viewH: 240 },
    )
    expect(p).toBeNull()
  })

  it("falls back to the rect when the matrix is singular", () => {
    // A zero-determinant matrix must not produce Infinity; the rect takes over.
    const p = clientToScene(
      { clientX: 300, clientY: 250 },
      {
        matrix: { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 },
        rect: { left: 0, top: 0, width: 720, height: 480 },
        viewW: 360,
        viewH: 240,
      },
    )
    expect(p).toEqual({ x: 150, y: 125 })
  })

  it("returns null for a non-finite client point", () => {
    const p = clientToScene(
      { clientX: Number.NaN, clientY: 0 },
      { matrix: null, rect: { left: 0, top: 0, width: 720, height: 480 }, viewW: 360, viewH: 240 },
    )
    expect(p).toBeNull()
  })
})

describe("clampParam", () => {
  it("clamps to the declared range", () => {
    expect(clampParam(500, { min: 0, max: 360 })).toBe(360)
    expect(clampParam(-5, { min: 0, max: 360 })).toBe(0)
  })

  it("clamps the LOWER bound last, so min > max cannot win the wrong way", () => {
    // Degenerate LLM-authored range: the lower bound is applied last.
    expect(clampParam(50, { min: 100, max: 10 })).toBe(100)
  })

  it("passes an in-range value through untouched", () => {
    expect(clampParam(42, { min: 0, max: 360 })).toBe(42)
  })

  it("does not quantise to any step — a drag is continuous", () => {
    expect(clampParam(137.4, { min: 0, max: 360 })).toBe(137.4)
  })
})

describe("dragValueFor", () => {
  it("ignores the slider step and keeps the raw pointer value", () => {
    // step 5 would quantise 137.4 → 135; a drag must not.
    expect(dragValueFor(137.4, { min: 0, max: 360, step: 5 })).toBeCloseTo(137.4, 6)
  })

  it("applies the grab offset so the element does not snap to the cursor", () => {
    // pointer at scene 120, element at 100 ⇒ grabbed 20px to the right of centre.
    expect(
      dragValueFor(120, { min: 0, max: 360, step: 1 }, { value: 100, grabOffset: 20 }),
    ).toBe(100)
  })

  it("clamps after removing the offset", () => {
    expect(
      dragValueFor(500, { min: 0, max: 360, step: 1 }, { value: 0, grabOffset: 0 }),
    ).toBe(360)
  })
})

// The hook's pure helpers. The pointer path needs a DOM, so what is asserted
// here is the DECISION layer: which handle is draggable, on which axes, and
// how far a keypress moves it.
import { axesFor, dragAxes, isDraggable, nudge } from "../src/react/useDragVary"

describe("drag resolution", () => {
  it("resolves a declared axis to its param and leaves the other fixed", () => {
    expect(dragAxes([{ id: "bob", x: "r" }], "bob")).toEqual({ x: "r" })
  })

  it("reports an undeclared id as not draggable", () => {
    expect(isDraggable([{ id: "bob", x: "r" }], "nope")).toBe(false)
    expect(dragAxes([{ id: "bob", x: "r" }], "nope")).toBeNull()
  })

  it("treats an absent draggable list as nothing draggable", () => {
    expect(isDraggable(undefined, "bob")).toBe(false)
    expect(axesFor(undefined, "bob")).toBeNull()
  })

  it("labels the axes for the DOM attribute", () => {
    expect(axesFor([{ id: "a", x: "r" }], "a")).toBe("x")
    expect(axesFor([{ id: "a", y: "r" }], "a")).toBe("y")
    expect(axesFor([{ id: "a", x: "r", y: "s" }], "a")).toBe("xy")
  })
})

describe("nudge", () => {
  it("moves by the axis increment, not the param step", () => {
    // step 5 must not quantise a keyboard nudge.
    expect(nudge(1, false)).toBe(1)
    expect(nudge(1, true)).toBe(10)
  })

  it("is signed by direction", () => {
    expect(nudge(-1, false)).toBe(-1)
  })
})
