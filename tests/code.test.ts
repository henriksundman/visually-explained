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

  it("renders language label and escaped source", () => {
    const { html } = renderExplanation({
      version: 1,
      blocks: [{ type: "code", language: "ts", code: "const x = 1" }],
    })
    expect(html).toContain(`<div class="exp-block exp-code">`)
    expect(html).toContain(`<span class="exp-code-lang">ts</span>`)
    expect(html).toContain(`<code class="exp-code-source">const x = 1</code>`)
  })

  it("escapes HTML in source and language", () => {
    const { html } = renderExplanation({
      version: 1,
      blocks: [{ type: "code", language: "<x>", code: "<script>alert(1)</script>" }],
    })
    expect(html).not.toContain("<script>")
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;")
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
})
