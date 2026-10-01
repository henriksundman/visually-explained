import { describe, expect, it } from "vitest"
import { escapeHtml, renderInline } from "../src/core/inline"
import { codeBlockSchema } from "../src/core/schema"

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

  it("renders safe links", () => {
    expect(renderInline("[docs](https://example.com/a)")).toBe(
      `<a href="https://example.com/a">docs</a>`,
    )
    expect(renderInline("[mail](mailto:a@b.co)")).toBe(`<a href="mailto:a@b.co">mail</a>`)
    expect(renderInline("[jump](#sec-1)")).toBe(`<a href="#sec-1">jump</a>`)
    expect(renderInline("[old](http://example.com)")).toBe(`<a href="http://example.com">old</a>`)
  })

  it("escapes labels and hrefs", () => {
    expect(renderInline(`["x"](https://e.com/?a=1&b=2)`)).toBe(
      `<a href="https://e.com/?a=1&amp;b=2">&quot;x&quot;</a>`,
    )
  })

  it("degrades unsafe schemes and relatives to literal text", () => {
    for (const bad of [
      "[x](javascript:alert(1))",
      "[x](JAvaScript:alert(1))",
      "[x](java\tscript:alert(1))", // \s in the href class stops the pair forming; tab stays literal
      "[x](java\u0000script:alert(1))", // non-whitespace control forms a candidate; the gate strips + rejects it
      "[x](data:text/html;base64,PHNjcmlwdD4=)",
      "[x](vbscript:x)",
      "[x](//host/path)",
      "[x](relative/path)",
    ]) {
      expect(renderInline(bad)).toBe(bad)
    }
  })

  it("renders malformed pairs literally", () => {
    expect(renderInline("[x](y z)")).toBe("[x](y z)")
    expect(renderInline("[x] alone stays")).toBe("[x] alone stays")
    expect(renderInline("[x](unclosed")).toBe("[x](unclosed")
  })

  it("nests emphasis inside labels and handles stars in hrefs", () => {
    expect(renderInline("[**bold label**](https://e.com)")).toBe(
      `<a href="https://e.com"><strong>bold label</strong></a>`,
    )
    expect(renderInline("[x](https://e.com/a*b)")).toBe(`<a href="https://e.com/a*b">x</a>`) // unpaired star survives
    // Paired star leaks <em> into the href candidate → the gate degrades the link.
    // The literal fallback is the emphasized string (the link pass sees post-emphasis text).
    expect(renderInline("[x](https://e.com/a*b*c)")).toBe("[x](https://e.com/a<em>b</em>c)")
  })

  it("code spans beat link syntax", () => {
    expect(renderInline("`[x](https://e.com)`")).toBe("<code>[x](https://e.com)</code>")
  })

  it("leaves link-free strings byte-identical", () => {
    expect(renderInline("plain **b** *i* `c` [ not a link (x")).toBe(
      "plain <strong>b</strong> <em>i</em> <code>c</code> [ not a link (x",
    )
  })
})

describe("code payload bounds (rafter hardening)", () => {
  it("caps code at 20k chars in the schema", () => {
    expect(codeBlockSchema.safeParse({ id: "c", type: "code", code: "x".repeat(20000) }).success).toBe(true)
    expect(codeBlockSchema.safeParse({ id: "c", type: "code", code: "x".repeat(20001) }).success).toBe(false)
  })
})
