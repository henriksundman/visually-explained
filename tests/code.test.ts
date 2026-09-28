import { describe, expect, it } from "vitest"
import { renderExplanation } from "../src/core/render"
import { codeBlockSchema } from "../src/core/schema"
import "../src/core/registerAll"

describe("code", () => {
  it("schema accepts a code block with optional language", () => {
    expect(codeBlockSchema.safeParse({ type: "code", code: "hi()" }).success).toBe(true)
    expect(
      codeBlockSchema.safeParse({ type: "code", language: "ts", code: "const x = 1" }).success,
    ).toBe(true)
    expect(codeBlockSchema.safeParse({ type: "code" }).success).toBe(false)
    expect(codeBlockSchema.safeParse({ type: "code", code: "" }).success).toBe(false)
  })

  it("renders language label and highlighted source", () => {
    const { html } = renderExplanation({
      version: 1,
      blocks: [{ type: "code", language: "ts", code: "const x = 1" }],
    })
    expect(html).toContain(`<div class="exp-block exp-code">`)
    expect(html).toContain(`<span class="exp-code-lang">ts</span>`)
    expect(html).toContain(`<code class="exp-code-source">`)
    expect(html).toContain(`<span class="exp-tok-key">const</span>`)
    expect(html).toContain(` x = <span class="exp-tok-num">1</span>`)
  })

  it("escapes HTML in source and language", () => {
    const { html } = renderExplanation({
      version: 1,
      blocks: [{ type: "code", language: "<x>", code: "<script>alert(1)</script>" }],
    })
    expect(html).not.toContain("<script>")
    expect(html).toContain("&lt;script&gt;")
    expect(html).toContain("&lt;/script&gt;")
    expect(html).toContain("&lt;x&gt;")
  })

  it("keeps inline markers literal (no markdown in code)", () => {
    const { html } = renderExplanation({
      version: 1,
      blocks: [{ type: "code", code: "cache.set('k', **bold**) `tick`" }],
    })
    expect(html).toContain("**bold**")
    expect(html).toContain("`tick`")
    expect(html).not.toContain("<strong>")
    expect(html).not.toContain("<code class=\"exp-inline\">")
  })

  it("omits the language label when absent", () => {
    const { html } = renderExplanation({ version: 1, blocks: [{ type: "code", code: "x" }] })
    expect(html).not.toContain("exp-code-lang")
  })

  it("wraps keywords, strings, numbers, and comments in token spans", () => {
    const { html } = renderExplanation({
      version: 1,
      blocks: [{ type: "code", language: "ts", code: "const n = 42 // count" }],
    })
    expect(html).toContain(`<span class="exp-tok-key">const</span>`)
    expect(html).toContain(`<span class="exp-tok-num">42</span>`)
    expect(html).toContain(`<span class="exp-tok-com">// count</span>`)
  })

  it("string contents are not re-tokenized (one str span, keyword inside stays literal)", () => {
    const { html } = renderExplanation({
      version: 1,
      blocks: [{ type: "code", language: "ts", code: `const s = "const x"` }],
    })
    expect((html.match(/exp-tok-key/g) ?? []).length).toBe(1) // only the real `const`
    expect(html).toContain(`class="exp-tok-str"`)
    expect(html).toContain(`&quot;const x&quot;`) // quotes are escaped like any text
  })

  it("escapes html inside token spans", () => {
    const { html } = renderExplanation({
      version: 1,
      blocks: [{ type: "code", language: "ts", code: `const s = "<b>hi</b>"` }],
    })
    expect(html).not.toContain("<b>")
    expect(html).toContain(`class="exp-tok-str"`)
    expect(html).toContain("&lt;b&gt;hi&lt;/b&gt;")
  })

  it("uses # comments for python and leaves # plain in c-family languages", () => {
    const py = renderExplanation({
      version: 1,
      blocks: [{ type: "code", language: "python", code: "x = 1  # keep" }],
    })
    expect(py.html).toContain(`<span class="exp-tok-com"># keep</span>`)
    const ts = renderExplanation({
      version: 1,
      blocks: [{ type: "code", language: "ts", code: "x = 1  # keep" }],
    })
    expect(ts.html).not.toContain("exp-tok-com")
  })

  it("highlights literals and works without a language", () => {
    const { html } = renderExplanation({
      version: 1,
      blocks: [{ type: "code", code: "return true" }],
    })
    expect(html).toContain(`<span class="exp-tok-key">return</span>`)
    expect(html).toContain(`<span class="exp-tok-lit">true</span>`)
  })
})
