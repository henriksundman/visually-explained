import { describe, expect, it } from "vitest"
import { renderMath, MathParseError } from "../src/core/math"

/** Tags the engine may emit. Anything else means model text escaped into
 *  markup. Text content is entity-escaped by the engine (`<` → `&lt;`), so a
 *  `<` inside model text cannot match the tag regexes below — which is the
 *  whole reason these assertions are tag-shaped rather than substring-shaped. */
const ALLOWED_TAGS = new Set([
  "math", "mrow", "mi", "mn", "mo", "mtext", "mspace", "mfrac", "msqrt", "mroot",
  "msup", "msub", "msubsup", "munder", "mover", "munderover", "mtable", "mtr",
  "mtd", "mlabeledtr", "mstyle", "mpadded", "mphantom", "menclose", "merror",
  "semantics", "annotation",
])

/** Attributes that could navigate, fetch, or execute. */
const FORBIDDEN_ATTRS = new Set(["href", "src", "xlink:href", "style", "srcdoc", "formaction"])

const HOSTILE_TEX: ReadonlyArray<readonly [string, string]> = [
  ["href-js", String.raw`\href{javascript:alert(1)}{click}`],
  ["href-https", String.raw`\href{https://evil.example}{click}`],
  ["url", String.raw`\url{https://evil.example}`],
  ["includegraphics", String.raw`\includegraphics{https://evil.example/x.png}`],
  ["htmlClass", String.raw`\htmlClass{evil}{x}`],
  ["htmlId", String.raw`\htmlId{evil}{x}`],
  ["def-abuse", String.raw`\def\evil{\href{javascript:alert(1)}{x}}\evil`],
]

/** Payloads smuggled through \text, which PARSES — so the assertions below
 *  actually execute. The constructs in HOSTILE_TEX all throw, so testing only
 *  those would skip every assertion and pass vacuously: a boundary that
 *  returned its input unchanged emits no tags at all and would sail through. */
const INJECTION_TEX: ReadonlyArray<readonly [string, string]> = [
  ["anchor", String.raw`\text{<a href="javascript:alert(1)">x</a>}`],
  ["img-onerror", String.raw`\text{<img src=x onerror=alert(1)>}`],
  ["style-attr", String.raw`\text{<div style="background:url(javascript:alert(1))">x</div>}`],
  ["script-tag", String.raw`\text{<script>alert(1)</script>}`],
]

const COVERAGE_TEX: ReadonlyArray<readonly [string, string, string]> = [
  ["frac", String.raw`\frac{a+b}{c}`, "mfrac"],
  ["sup", String.raw`x^{2n}`, "msup"],
  ["sub", String.raw`a_{ij}`, "msub"],
  ["subsup", String.raw`x_i^2`, "msubsup"],
  ["sqrt", String.raw`\sqrt{x^2+y^2}`, "msqrt"],
  ["greek", String.raw`\theta = \pi/4`, "mi"],
  ["sum", String.raw`\sum_{i=1}^{n} i`, "msubsup"],
  ["int", String.raw`\int_0^1 f(x)\,dx`, "msubsup"],
  ["matrix", String.raw`\begin{pmatrix} a & b \\ c & d \end{pmatrix}`, "mtable"],
  ["accent", String.raw`\hat{x} + \bar{y}`, "mover"],
]

function tagsIn(html: string): string[] {
  return [...html.matchAll(/<\/?\s*([a-zA-Z][a-zA-Z0-9-]*)/g)].map((m) => m[1].toLowerCase())
}

/** Attribute names, read from inside real tags only — never from text nodes. */
function attrsInTags(html: string): string[] {
  const attrs: string[] = []
  for (const m of html.matchAll(/<([a-zA-Z][a-zA-Z0-9-]*)((?:\s[^<>]*?)?)\/?>/g)) {
    for (const a of m[2].matchAll(/\s([a-zA-Z-]+)\s*=/g)) attrs.push(a[1].toLowerCase())
  }
  return attrs
}

describe("renderMath security", () => {
  it("rejects every construct that could navigate, fetch, or execute", () => {
    // Asserted, not skipped. "It threw" is a security property that must be
    // re-verified when the engine changes — KaTeX renders these inertly rather
    // than throwing, so a silent `continue` here would hide a real regression.
    for (const [name, tex] of HOSTILE_TEX) {
      expect(() => renderMath(tex), `${name} must be rejected, not rendered`).toThrow(MathParseError)
    }
  })

  it("escapes tags smuggled through text content", () => {
    for (const [name, tex] of INJECTION_TEX) {
      const out = renderMath(tex)
      // These parse, so the output is real MathML — assert we got it rather
      // than an empty string or a passthrough.
      expect(out, `${name}: expected rendered MathML`).toContain("<math")
      for (const tag of tagsIn(out)) {
        expect(ALLOWED_TAGS.has(tag), `${name}: disallowed <${tag}> in output`).toBe(true)
      }
      for (const attr of attrsInTags(out)) {
        const isHandler = attr.startsWith("on")
        expect(
          isHandler || FORBIDDEN_ATTRS.has(attr),
          `${name}: forbidden attribute "${attr}"`,
        ).toBe(false)
      }
      expect(out, `${name}: markup smuggled through as a tag`).not.toMatch(/<[a-z]+[^>]*href/i)
    }
  })

  it("escapes angle brackets in model text rather than emitting elements", () => {
    const out = renderMath(String.raw`\text{<script>alert(1)</script>}`)
    expect(out).not.toContain("<script")
    expect(out).toContain("&lt;script&gt;")
    // The payload survives as readable text, which is correct — it is content.
    expect(tagsIn(out).every((t) => ALLOWED_TAGS.has(t))).toBe(true)
  })
})

describe("renderMath coverage", () => {
  it.each(COVERAGE_TEX)("renders %s", (_name, tex, element) => {
    expect(renderMath(tex)).toContain(`<${element}`)
  })
})

describe("renderMath errors", () => {
  it("throws MathParseError on unterminated input", () => {
    expect(() => renderMath(String.raw`\frac{1`)).toThrow(MathParseError)
  })

  it("throws on an unknown control sequence", () => {
    expect(() => renderMath(String.raw`\unknowncmd{x}`)).toThrow(MathParseError)
  })

  it("throws on display-only constructs used inline", () => {
    expect(() => renderMath(String.raw`\begin{align} a &= b \end{align}`)).toThrow(MathParseError)
  })

  it("reports a parse position for the warning message", () => {
    try {
      renderMath(String.raw`\frac{1`)
      expect.unreachable("should have thrown")
    } catch (e) {
      expect(e).toBeInstanceOf(MathParseError)
      expect(typeof (e as { position?: unknown }).position).toBe("number")
    }
  })
})

describe("renderMath determinism", () => {
  it("returns byte-identical output for identical input", () => {
    const tex = String.raw`\sum_{i=1}^{n} \frac{1}{i^2} = \frac{\pi^2}{6}`
    expect(renderMath(tex)).toBe(renderMath(tex))
  })
})

describe("renderMath packaging", () => {
  it("emits no font declaration and no external reference", () => {
    const out = renderMath(String.raw`\frac{a}{b}`)
    expect(out).not.toMatch(/font-family/i)
    expect(out).not.toMatch(/url\s*\(/i)
    expect(out).not.toMatch(/https?:\/\//i)
  })
})
