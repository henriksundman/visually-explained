import { describe, expect, it } from "vitest"
import { renderExplanation } from "../src/core/render"
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
      blocks: [{ type: "cause-effect", chain: [{ because: "load doubled", therefore: "latency rose" }] }],
    })
    expect(html).toContain(`<ol class="exp-cause-chain">`)
    expect(html).toContain(`<p class="exp-cause"><span class="exp-label">Because</span> load doubled</p>`)
    expect(html).toContain(`<p class="exp-effect"><span class="exp-label">Therefore</span> latency rose</p>`)
  })
})

describe("derivation", () => {
  it("renders escaped expressions with optional notes and conclusion", () => {
    const { html } = renderExplanation({
      version: 1,
      blocks: [
        {
          type: "derivation",
          steps: [{ expression: "a**2 + b**2", note: "Pythagoras" }],
          conclusion: "c**2 = a**2 + b**2",
        },
      ],
    })
    expect(html).toContain(`<code class="exp-derivation-expr">a**2 + b**2</code>`)
    expect(html).toContain(`<p class="exp-derivation-note">Pythagoras</p>`)
    expect(html).toContain(`<p class="exp-derivation-conclusion">c**2 = a**2 + b**2</p>`)
  })
})
