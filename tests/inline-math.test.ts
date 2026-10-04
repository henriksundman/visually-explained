import { describe, expect, it } from "vitest"
import { escapeHtml, renderInline } from "../src/core/inline"

/** Collects warnings so a degradation can be asserted, not just observed. */
function collector(): { warnings: string[]; ctx: { addWarning(m: string): void } } {
  const warnings: string[] = []
  return { warnings, ctx: { addWarning: m => warnings.push(m) } }
}

/** True when the output contains a typeset formula rather than literal text. */
function isMath(html: string): boolean {
  return html.includes('<span class="exp-math-inline">')
}

/** The prose strings a `$...$` scanner must NOT touch (inline-math spec §4).
 *  Each was measured against Temml: the naive capture parses cleanly as a run
 *  of variables and emits zero warnings, so nothing downstream can catch it. */
const PROSE_WITH_DOLLARS: ReadonlyArray<readonly [string, string]> = [
  ["currency-sentence", "It costs $5 and returns $10."],
  ["currency-range", "Prices range from $5 to $10 per unit."],
  ["currency-millions", "Revenue was $5M, up from $4M."],
  ["currency-comma", "$50,000 or $60,000"],
  ["shell-vars", "Set $HOME and $PATH before running."],
  ["shell-command", "echo $HOME; ls $PWD"],
  ["arithmetic-accident", "costs $5-$3 total"],
  ["arithmetic-spaced", "costs $5 - $3 total"],
  ["ordinal-range", "between $1 and $2"],
  ["single-amount", "totalling $100"],
  ["regex-end-anchor", "sed -i 's/$//' file"],
  ["spaced-dollars", "a $ b $ c"],
  ["bare-number", "The answer is $5$"],
]

describe("inline math delimiter gate", () => {
  it.each(PROSE_WITH_DOLLARS)("leaves %s alone", (_name, prose) => {
    const { warnings, ctx } = collector()
    expect(renderInline(prose, ctx)).toBe(escapeHtml(prose))
    expect(warnings).toEqual([])
    expect(isMath(renderInline(prose, ctx))).toBe(false)
  })

  it.each([
    ["single-letter", "where $x$ is the input", "x"],
    ["exponent", "The $x^2$ term dominates.", "x2"],
    ["relation", "holds when $r < 1$", "r<1"],
    ["fraction", "the ratio $\\frac{a}{b}$ matters", "ab"],
    ["greek", "$\\alpha \\le \\beta$", "\\alpha\\le\\beta"],
    ["tight-call", "$f(x)$ is continuous", "f(x)"],
    ["tight-plus", "$a+b$", "a+b"],
  ])("typesets %s", (_name, prose) => {
    expect(isMath(renderInline(prose))).toBe(true)
  })

  it("honors \\(...\\) with no gate at all", () => {
    expect(isMath(renderInline("\\(5 and \\)"))).toBe(true)
  })

  it("captures TeX commands containing backslashes inside \\(...\\)", () => {
    // The naive [^\\]*? body cannot cross a command's backslash and silently
    // fails to match this at all.
    const html = renderInline("Use \\(\\frac{a}{b}\\) here.")
    expect(html).toContain("<mfrac>")
    expect(html).toContain("<mi>a</mi>")
  })

  it("takes a $ closer that a digit follows, per Pandoc", () => {
    // "$5 and $10" must not capture " and ".
    expect(isMath(renderInline("costs $5 and $10"))).toBe(false)
  })

  it("leaves an empty \\(\\) alone", () => {
    expect(renderInline("a \\(\\) b")).toBe("a \\(\\) b")
  })
})

describe("inline math vs the rest of the inline grammar", () => {
  it("does not typeset math inside a code span", () => {
    expect(renderInline("`$x$`")).toBe("<code>$x$</code>")
    expect(renderInline("`a $ b $ c`")).toBe("<code>a $ b $ c</code>")
    expect(renderInline("`\\(\\alpha\\)`")).toBe("<code>\\(\\alpha\\)</code>")
  })

  it("pairs emphasis ACROSS a math boundary", () => {
    // Splitting the prose into fragments and processing each would leave the
    // two ** with nothing to pair with, which is why the placeholder exists.
    const html = renderInline("**bold $x$ term**")
    expect(html).toBe(
      '<strong>bold <span class="exp-math-inline"><math><mi>x</mi></math></span> term</strong>'
    )
    expect(html.match(/<strong>/g)).toHaveLength(1)
  })

  it("pairs italic across a math boundary", () => {
    expect(renderInline("*a $x$ b*")).toContain("<em>a <span")
  })

  it("typesets math inside a link label", () => {
    const html = renderInline("[the $x$ term](https://ex.com)")
    expect(html).toContain('<a href="https://ex.com">')
    expect(html).toContain('exp-math-inline')
    expect(html).toContain("</a>")
  })

  it("never puts a placeholder in a link target", () => {
    // safeHref strips \\u0000-\\u0020, so an unguarded placeholder here would
    // emit a silently corrupted href of https://ex.com/EXP_MATH_0.
    const html = renderInline("[x](https://ex.com/$y$)")
    expect(html).toContain('<a href="https://ex.com/$y$">')
    expect(html).not.toContain("EXP_MATH")
  })

  it("keeps a javascript: href degraded even with math in the label", () => {
    const html = renderInline("[the $x$ term](javascript:alert(1))")
    expect(html).not.toContain("<a ")
    expect(html).not.toContain("EXP_MATH")
    // The href stays literal text; the label's math still typesets, which is
    // harmless because nothing is wrapped in an anchor.
    expect(html).toContain("javascript:alert(1)")
    expect(html).toContain("exp-math-inline")
  })
})

describe("inline math degradation", () => {
  it("leaves unparseable TeX as literal text and warns", () => {
    const { warnings, ctx } = collector()
    const html = renderInline("bad math $x^$ here", ctx)
    expect(html).toBe("bad math $x^$ here")
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("[math] not TeX")
  })

  it.each([
    ["trailing-caret", "$x^$"],
    ["trailing-underscore", "$x_$"],
    ["bare-caret", "$^$"],
    ["unbalanced-braces", "$\\frac{1}$"],
    ["unknown-command", "$\\notacommand$"],
  ])("degrades %s rather than throwing", (_name, math) => {
    const { ctx } = collector()
    expect(() => renderInline(`a ${math} b`, ctx)).not.toThrow()
    expect(isMath(renderInline(`a ${math} b`, ctx))).toBe(false)
  })

  it("survives the TeX that throws a TypeError rather than a ParseError", () => {
    // Temml's parser dereferences a null group for these, so the pre-existing
    // "narrow to MathParseError" pattern let them escape the render pass.
    for (const tex of ["x^", "x_", "^", "_", "x^{^{^}}", "x^&", "x_^{\\"]) {
      const { ctx } = collector()
      expect(() => renderInline(`a \\(${tex}\\) b`, ctx)).not.toThrow()
    }
  })

  it("names the error type so a novel failure stays visible", () => {
    const { warnings, ctx } = collector()
    renderInline("$x^$", ctx)
    expect(warnings[0]).toContain("(TypeError)")
  })

  it("still degrades when no warnings sink is supplied", () => {
    expect(renderInline("$x^$")).toBe("$x^$")
  })
})

describe("inline math determinism and isolation", () => {
  it("returns byte-identical output for identical input", () => {
    const prose = "the rate \\(r < 1\\) and the cost $5 and $10 and $x^2$"
    expect(renderInline(prose)).toBe(renderInline(prose))
  })

  it("derives a sentinel absent from the input, so none can be forged", () => {
    const html = renderInline("a \u0000EXP_MATH_0\u0000 b", collector().ctx)
    expect(html).toBe("a \u0000EXP_MATH_0\u0000 b")
    expect(html).not.toContain("<math>")
  })

  it("handles several spans in one sentence in order", () => {
    const html = renderInline("\\(a\\) then \\(b\\) then \\(c\\)")
    expect(html.match(/<math>/g)).toHaveLength(3)
    expect(html.indexOf("<mi>a</mi>")).toBeLessThan(html.indexOf("<mi>b</mi>"))
    expect(html.indexOf("<mi>b</mi>")).toBeLessThan(html.indexOf("<mi>c</mi>"))
  })

  it("does not backtrack pathologically on adversarial input", () => {
    const evil = "$".repeat(200) + "x".repeat(20000)
    const started = Date.now()
    expect(() => renderInline(evil)).not.toThrow()
    expect(Date.now() - started).toBeLessThan(2000)
  })
})

