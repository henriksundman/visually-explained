import { describe, expect, it } from "vitest"
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
