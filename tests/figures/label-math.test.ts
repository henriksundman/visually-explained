import { describe, expect, it } from "vitest"
import { plainMathLabel } from "../../src/figures/labelMath"
import { sceneToSvg } from "../../src/figures/svg"
import type { Scene } from "../../src/figures/scene"

// SVG-drawn labels have no MathML surface: a label authored as \(2 + 3 = 5\)
// used to draw the literal backslash-paren TeX into the figure (the Luma
// mind-map bug). The emit layer renders spans as READABLE PLAIN TEXT —
// delimiters stripped, obvious commands mapped to unicode — while prose
// outside spans passes through byte-identical. This file pins the helper;
// the wiring pins live in mind-map.test.ts.

describe("plainMathLabel — \\(…\\) spans", () => {
  it("strips the delimiters and keeps the readable text", () => {
    expect(plainMathLabel(String.raw`\(2 + 3 = 5\)`)).toBe("2 + 3 = 5")
  })

  it("maps inside prose and leaves surrounding text verbatim", () => {
    expect(plainMathLabel(String.raw`Rate \(a \times b\) over time`)).toBe("Rate a × b over time")
  })

  it("handles several spans in one label", () => {
    expect(plainMathLabel(String.raw`\(x\) then \(y \le 2\)`)).toBe("x then y ≤ 2")
  })

  it("leaves an unclosed \\( verbatim (no pairing, no mangling)", () => {
    const s = "x \\(2 + 3"
    expect(plainMathLabel(s)).toBe(s)
  })
})

describe("plainMathLabel — TeX-to-plain mapping", () => {
  it("maps operators with obvious unicode", () => {
    expect(plainMathLabel(String.raw`\(x \le 3\)`)).toBe("x ≤ 3")
    expect(plainMathLabel(String.raw`\(a \ne b\)`)).toBe("a ≠ b")
    expect(plainMathLabel(String.raw`\(a_1, a_2 \cdots a_n\)`)).toBe("a_1, a_2 ⋯ a_n")
    expect(plainMathLabel(String.raw`\(3 \div 4\)`)).toBe("3 ÷ 4")
  })

  it("maps \\\\min/\\\\max to their names (the fallback IS the obvious rendering)", () => {
    expect(plainMathLabel(String.raw`\(\min_{x} f\)`)).toBe("min_x f")
  })

  it("flattens \\frac{a}{b} to a/b", () => {
    expect(plainMathLabel(String.raw`\(\frac{a}{b}\)`)).toBe("a/b")
    expect(plainMathLabel(String.raw`\(\frac{3}{1/2}\)`)).toBe("3/1/2")
  })

  it("flattens superscripts and subscripts, keeping the markers", () => {
    expect(plainMathLabel(String.raw`\(x^{2} + y_{1}\)`)).toBe("x^2 + y_1")
    expect(plainMathLabel(String.raw`\(x^a_b\)`)).toBe("x^a_b")
  })

  it("maps Greek letters; one terminator space is always kept", () => {
    // Rule: the space after a command name is TeX's terminator and is
    // re-emitted as one space, uniformly for mapped names and fallbacks —
    // `\Delta t` reads "Δ t", `\min_{x} f` reads "min_x f".
    expect(plainMathLabel(String.raw`\(\eta \Delta t\)`)).toBe("η Δ t")
  })

  it("drops \\\\left/\\\\right, flattens group braces and \\\\text groups", () => {
    expect(plainMathLabel(String.raw`\(\left(a+b\right)\)`)).toBe("(a+b)")
    expect(plainMathLabel(String.raw`\(\text{Rate} x\)`)).toBe("Rate x")
    expect(plainMathLabel(String.raw`\(\{1, 2\}\)`)).toBe("{1, 2}")
  })

  it("degrades an unknown command to its name, backslash dropped", () => {
    expect(plainMathLabel(String.raw`\(\foobar y\)`)).toBe("foobar y")
    expect(plainMathLabel(String.raw`\(\sqrt{x}\)`)).toBe("sqrtx")
  })
})

describe("plainMathLabel — $…$ spans", () => {
  it("strips a plausible math pair", () => {
    // Plausibility is the SHARED gate: tight no-whitespace-with-letter, or a
    // strong TeX signal. "$a+b$" (tight) and "$\\frac{a}{b}$" (braces) pass.
    expect(plainMathLabel("$a+b$")).toBe("a+b")
    expect(plainMathLabel("$\\frac{a}{b}$")).toBe("a/b")
  })

  it("does NOT strip a spaced signal-less pair — the same gate prose uses", () => {
    // renderInline leaves "$a + b$" literal in prose (same gate, one
    // definition, two consumers — no drift between the SVG and prose paths).
    expect(plainMathLabel("$a + b$")).toBe("$a + b$")
  })

  it("leaves an impossible pair verbatim (currency prose)", () => {
    const s = "Costs $5 and returns $10"
    expect(plainMathLabel(s)).toBe(s)
  })

  it("rewinds past a rejected candidate so a later real pair still strips", () => {
    expect(plainMathLabel("Costs $12, so $y = mx$ holds.")).toBe("Costs $12, so y = mx holds.")
  })

  it("leaves an unclosed $ verbatim", () => {
    const s = "price is $5"
    expect(plainMathLabel(s)).toBe(s)
  })
})

describe("plainMathLabel — idempotence and scope", () => {
  it("passes a label with no delimiters through byte-identical", () => {
    for (const s of ["Browser cache", "x^2 = 4", "Temperature 25°", "p95 latency — the SLO number"]) {
      expect(plainMathLabel(s)).toBe(s)
    }
  })

  it("does not touch HTML-ish labels — escaping stays downstream", () => {
    const s = '<img src=x onerror=alert(1)>'
    expect(plainMathLabel(s)).toBe(s)
  })
})

describe("plainMathLabel — emit-layer integration", () => {
  it("sceneToSvg strips math spans in element labels (covers diagram/figure too)", () => {
    const scene: Scene = {
      width: 200,
      height: 40,
      elements: [{ kind: "label", x: 10, y: 20, text: String.raw`\(a \times b\)`, anchor: "start" }],
    }
    const svg = sceneToSvg(scene, { ariaLabel: "probe" })
    expect(svg).toContain(">a × b</text>")
    expect(svg).not.toContain("\\(")
    expect(svg).not.toContain("times")
  })
})
