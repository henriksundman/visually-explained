import { describe, expect, it } from "vitest"
import { escapeHtml } from "../src/core/inline"
import { renderExplanation } from "../src/core/render"
import { renderDocument } from "../src/core/renderDocument"
import "../src/core/registerAll"

describe("concept", () => {
  it("renders term, definition, and labeled intuition/analogy when present", () => {
    const { html } = renderExplanation({
      version: 1,
      blocks: [
        {
          type: "concept",
          term: "Recursion",
          definition: "A function that calls itself",
          intuition: "Russian dolls",
        },
      ],
    })
    expect(html).toContain(`<p class="exp-concept-term">Recursion</p>`)
    expect(html).toContain(`<p class="exp-concept-definition">A function that calls itself</p>`)
    expect(html).toContain(`<p class="exp-concept-intuition"><span class="exp-label">Intuition</span> Russian dolls</p>`)
    expect(html).not.toContain("exp-concept-analogy")
  })
})

describe("cause-effect", () => {
  it("renders because/therefore pairs", () => {
    const { html } = renderExplanation({
      version: 1,
      blocks: [{ type: "cause-effect", chain: [{ because: "load doubled", therefore: "latency rose" }], presentation: "text" }],
    })
    expect(html).toContain(`<ol class="exp-cause-chain">`)
    expect(html).toContain(`<p class="exp-cause"><span class="exp-label">Because</span> load doubled</p>`)
    expect(html).toContain(`<p class="exp-effect"><span class="exp-label">Therefore</span> latency rose</p>`)
  })
})

describe("derivation", () => {
  it("renders expression and conclusion as TeX, keeping note as prose", () => {
    const { html } = renderExplanation({
      version: 1,
      blocks: [
        {
          type: "derivation",
          steps: [{ expression: String.raw`\frac{a}{b}`, note: "Pythagoras, **restated**" }],
          conclusion: String.raw`c^2 = a^2 + b^2`,
        },
      ],
    })
    expect(html).toContain("<mfrac>")
    expect(html).toContain("<msup>")
    // Rendered math is output, not source — <code> must not wrap it.
    expect(html).not.toContain(`<code class="exp-derivation-expr">`)
    expect(html).toContain('<span class="exp-derivation-expr">')
    // note stays prose — emphasis markup must still be processed there
    expect(html).toContain(`<p class="exp-derivation-note">Pythagoras, <strong>restated</strong></p>`)
  })

  it("degrades malformed TeX to the escaped literal plus a warning", () => {
    const { html, warnings } = renderExplanation({
      version: 1,
      blocks: [{ type: "derivation", steps: [{ expression: String.raw`\frac{1` }] }],
    })
    expect(html).toContain(`<code class="exp-math-literal">\\frac{1</code>`)
    expect(warnings.some((w) => w.startsWith("[math]"))).toBe(true)
  })

  it("degrades the TeX that throws a TypeError rather than a ParseError", () => {
    // Measured 2026-10-04: Temml's parser dereferences a null group for a
    // trailing super/subscript, so it throws a TypeError, not a ParseError.
    // The old "narrow to MathParseError and rethrow the rest" pattern let
    // these escape the render pass and take the whole explanation with them.
    for (const expression of ["x^", "x_", "^", "_", "x^{^{^}}", "x^&"]) {
      const { html, warnings } = renderExplanation({
        version: 1,
        blocks: [{ type: "derivation", steps: [{ expression }] }],
      })
      expect(html).toContain(`<code class="exp-math-literal">${escapeHtml(expression)}</code>`)
      expect(warnings.some((w) => w.startsWith("[math]"))).toBe(true)
    }
  })

  it("names the error type in the warning so a novel failure stays visible", () => {
    const { warnings } = renderExplanation({
      version: 1,
      blocks: [{ type: "derivation", steps: [{ expression: "x^" }] }],
    })
    expect(warnings.some((w) => w.includes("(TypeError)"))).toBe(true)
  })

  it("escapes the literal it degrades to, so malformed TeX cannot emit markup", () => {
    const { html } = renderExplanation({
      version: 1,
      blocks: [{ type: "derivation", steps: [{ expression: `<img src=x onerror=alert(1)>` }] }],
    })
    // This payload PARSES as math — Temml emits `&lt;` as an operator followed
    // by separate <mi>i</mi><mi>m</mi><mi>g</mi> elements, so there is no
    // contiguous "&lt;img" to assert on. The invariant is that no element was
    // created, which is what "no <img" checks.
    expect(html).not.toContain("<img")
    expect(html).not.toMatch(/<[a-z]+[^>]*onerror/i)
    expect(html).toContain("&lt;")
  })

  it("degrades rather than throwing under renderDocument + strict", () => {
    // NOT what the spec claimed. `renderDocument`'s strict gate runs before any
    // block renders, so no render-time warning — [math] included — can trip it.
    // Strict gates document/section *validation*; degradation is reported in
    // `warnings` either way. Pinned so a future change to strict is deliberate.
    const { warnings } = renderDocument(
      {
        version: 1,
        title: "D",
        sections: [
          {
            title: "S",
            blocks: [{ type: "derivation", steps: [{ expression: String.raw`\frac{1` }] }],
          },
        ],
      },
      { strict: true },
    )
    expect(warnings.some((w) => w.startsWith("[math]"))).toBe(true)
  })

  it("does not throw under renderExplanation + strict for the same input", () => {
    const { warnings } = renderExplanation(
      {
        version: 1,
        blocks: [{ type: "derivation", steps: [{ expression: String.raw`\frac{1` }] }],
      },
      { strict: true },
    )
    expect(warnings.some((w) => w.startsWith("[math]"))).toBe(true)
  })

  it("still throws under strict when the block itself is invalid", () => {
    // The other half of the contract: strict DOES gate validation.
    expect(() =>
      renderDocument(
        { version: 1, title: "D", sections: [{ title: "S", blocks: "not-an-array" }] },
        { strict: true },
      ),
    ).toThrow(/invalid/)
  })
})

// Host follow-up 4 (BUG-REPORT-sweep-focus-storm.md, 2026-10-20): prose in
// `derivation.conclusion` parses as VALID TeX — one <mi> per letter with every
// space collapsed — so the whole-field-TeX path mangled it silently with zero
// warnings ("WhereFisthe…"). The conclusion now renders through a mixed gate:
// accepted \(…\)/$…$ spans make prose intent explicit; otherwise the shared
// prose fingerprint (the hygiene sweep's own heuristic) separates prose from a
// bare formula, which keeps its math render byte-identical to before.
describe("derivation conclusion: prose with inline math", () => {
  const fixtureConc =
    "Where F is the gravitational force, G is the gravitational constant, m_1 and m_2 are the masses of the two objects, and r is the distance between their centers."

  function withConclusion(conclusion: string, expression?: string) {
    return renderExplanation({
      version: 1,
      blocks: [
        { type: "derivation", steps: [{ expression: expression ?? String.raw`F = G \frac{m_1 m_2}{r^2}` }], conclusion },
      ],
    })
  }

  it("renders prose readable instead of shredded into <mi> runs", () => {
    // Verbatim from the Luma capture trail — the recorded failure shape.
    const { html } = withConclusion(fixtureConc)
    expect(html).toContain("Where F is the gravitational force")
    expect(html).toContain("the distance between their centers")
    expect(html).not.toContain("<mi>W</mi>")
    expect(html).not.toContain(`<code class="exp-math-literal">`)
  })

  it("renders an empty/no-span prose paragraph without warnings", () => {
    const { warnings } = withConclusion("Mass falls when distance falls.")
    expect(warnings.some((w) => w.startsWith("[math]"))).toBe(false)
  })

  it("renders accepted \\[…\\] spans as inline math inside prose", () => {
    const { html } = withConclusion(
      String.raw`where \(c^2 = a^2 + b^2\) ties the sides to the hypotenuse`,
    )
    expect(html).toContain(`class="exp-math-inline"`)
    expect(html).toContain("ties the sides to the hypotenuse")
    expect(html).not.toContain(`c^2 = a^2`) // link content is rendered math, not leftover source
  })

  it("renders $…$ spans the same way", () => {
    const { html } = withConclusion("energy scales with $mc^2$, so mass bends light")
    expect(html).toContain(`class="exp-math-inline"`)
    expect(html).toContain("so mass bends light")
  })

  it("keeps a whole-field TeX conclusion on the math path, byte for body", () => {
    const { html } = withConclusion(String.raw`c^2 = a^2 + b^2`)
    expect(html).toContain("<msup>")
    expect(html).toContain("<msup><mi>c</mi>")
    expect(html).not.toContain(`exp-math-inline`)
    expect(html).not.toContain("c^2 = a^2 + b^2") // raw TeX must not surface
  })

  it("does not flip formula-heavy TeX into prose (fingerprint control)", () => {
    // Eight single-letter <mi>s plus pure words is the prose shape; commands
    // like \frac are not words, so this must stay inside the math path.
    const { html } = withConclusion(String.raw`\frac{a}{b} + \frac{c}{d} = \frac{e}{f} + \frac{g}{h}`)
    expect(html).toContain("<mfrac>")
    expect(html).not.toContain("exp-math-inline")
  })

  it("still degrades malformed conclusion TeX loudly", () => {
    const { html, warnings } = withConclusion(String.raw`\frac{1`)
    expect(html).toContain(`<code class="exp-math-literal">\\frac{1</code>`)
    expect(warnings.some((w) => w.startsWith("[math]"))).toBe(true)
  })
})
