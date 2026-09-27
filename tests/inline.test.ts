import { describe, expect, it } from "vitest"
import { escapeHtml, renderInline } from "../src/core/inline"

describe("escapeHtml", () => {
  it("escapes html-significant characters", () => {
    expect(escapeHtml(`<img src="x" onerror='alert(1)'>&`)).toBe(
      "&lt;img src=&quot;x&quot; onerror=&#39;alert(1)&#39;&gt;&amp;",
    )
  })
})

describe("renderInline", () => {
  it("leaves plain text untouched", () => {
    expect(renderInline("hello world")).toBe("hello world")
  })

  it("converts bold, italic, and code markers", () => {
    expect(renderInline("**bold** and *italic* and `code`")).toBe(
      "<strong>bold</strong> and <em>italic</em> and <code>code</code>",
    )
  })

  it("escapes html before applying markers", () => {
    expect(renderInline("<script>alert(1)</script>")).toBe("&lt;script&gt;alert(1)&lt;/script&gt;")
  })

  it("code spans win over other markers", () => {
    expect(renderInline("`**not bold**`")).toBe("<code>**not bold**</code>")
  })

  it("leaves unmatched markers literal", () => {
    expect(renderInline("*unclosed and `unticked")).toBe("*unclosed and `unticked")
  })
})
