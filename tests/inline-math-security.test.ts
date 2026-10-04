import { describe, expect, it } from "vitest"
import { renderInline } from "../src/core/inline"

/**
 * Inline math is a SECOND context, so the math spec's security argument is
 * re-derived here rather than cited. Two things make that necessary.
 *
 * 1. The construction argument ("Temml implements no \href, \url,
 *    \includegraphics, \htmlClass or \htmlId") holds too easily: all of those
 *    THROW, so a test feeding only dangerous constructs asserts nothing — a
 *    boundary that returned its input unchanged would pass every one of them.
 *    This file passed vacuously against three broken stubs once already.
 * 2. That argument says nothing about ATTRIBUTES. Temml emits
 *    style="padding-left:5.9776pt" and fence="true"; if an engine upgrade ever
 *    moved author text into one, no amount of "no \href" would catch it.
 *
 * So the assertions below are positive: they state what the output must
 * contain, and the payloads mostly PARSE, so the assertions actually execute.
 */

/** Payloads that PARSE, so the assertions below run against real output. */
const PARSING_PAYLOADS: ReadonlyArray<readonly [string, string]> = [
  ["img-onerror", String.raw`\text{<img src=x onerror=alert(1)>}`],
  ["script-tag", String.raw`\text{<script>alert(1)</script>}`],
  ["anchor-js", String.raw`\text{<a href="javascript:alert(1)">x</a>}`],
  ["style-attr", String.raw`\text{<div style="background:url(javascript:alert(1))">x</div>}`],
  ["quote-breakout", String.raw`\text{" onmouseover="alert(1)}`],
  ["attr-in-array", String.raw`\begin{array}{c}\text{"><script>}\end{array}`],
  ["hostile-text", String.raw`\begin{array}{cc}<<<<<<&&&&&&&&\end{array}`],
]

/** Attribute values Temml emits are all machine-computed: numbers, units,
 *  keywords and the `;` separator inside a style value
 *  (style="padding-left:0pt;padding-right:5.9776pt;"). Nothing an author typed
 *  belongs in one.
 *
 *  This is a CHARACTER check, so it is paired with EXECUTABLE below: the set
 *  allows letters, colons and parens, which is enough to spell
 *  `url(javascript:...)`. The charset says "machine-generated shape"; the
 *  scheme check says "and carries no URL". */
const SAFE_ATTR_VALUE = /^[-#\w\s:.,;%()]*$/

/** The MathML vocabulary, plus the span this boundary wraps it in. Anything
 *  else is an element the model reached some other way. */
const ALLOWED_TAGS = new Set([
  "math", "mrow", "mi", "mn", "mo", "msup", "msub", "msubsup", "mfrac", "msqrt",
  "mroot", "mtext", "mtable", "mtr", "mtd", "mstyle", "mover", "munder",
  "munderover", "mspace", "mpadded", "menclose", "mphantom", "maction",
  "maligngroup", "malignmark", "semantics", "annotation", "span",
])

function tagsIn(html: string): string[] {
  return [...html.matchAll(/<\/?\s*([a-zA-Z][a-zA-Z0-9-]*)/g)].map(m => m[1]!.toLowerCase())
}

/** Attribute values, read from inside real tags only — never from text nodes,
 *  where an escaped "&lt;" would be mistaken for markup. */
function attrValuesIn(html: string): string[] {
  return attrsIn(html).map(a => a.value)
}

/** Schemes that execute or exfiltrate when they reach an href or a style. */
const EXECUTABLE = /\b(?:javascript|data|vbscript|blob|file):/i

/** Every attribute in the output, read from inside real tags only — never from
 *  text nodes, where an escaped "&quot; onmouseover=&quot;" would be mistaken
 *  for markup. That mistake is the whole reason these are attribute-scoped. */
function attrsIn(html: string): Array<{ name: string; value: string }> {
  const out: Array<{ name: string; value: string }> = []
  for (const m of html.matchAll(/<([a-zA-Z][a-zA-Z0-9-]*)((?:\s[^<>]*?)?)\/?>/g)) {
    for (const a of m[2]!.matchAll(/([a-zA-Z-]+)\s*=\s*"([^"]*)"/g)) out.push({ name: a[1]!.toLowerCase(), value: a[2]! })
    for (const a of m[2]!.matchAll(/([a-zA-Z-]+)\s*=\s*'([^']*)'/g)) out.push({ name: a[1]!.toLowerCase(), value: a[2]! })
  }
  return out
}

describe("inline math is safe by construction, asserted positively", () => {
  it.each(PARSING_PAYLOADS)("%s emits only MathML elements", (_name, tex) => {
    const html = renderInline(`\\(${tex}\\)`)
    const rogue = tagsIn(html).filter(t => !ALLOWED_TAGS.has(t))
    expect(rogue).toEqual([])
  })

  it.each(PARSING_PAYLOADS)("%s puts no author text in an attribute", (_name, tex) => {
    const html = renderInline(`\\(${tex}\\)`)
    // The assertion the "no \href" argument cannot make. If Temml ever moves
    // author text into style= or any other attribute, this goes RED.
    const unsafe = attrValuesIn(html).filter(v => !SAFE_ATTR_VALUE.test(v))
    expect(unsafe).toEqual([])
  })

  it.each(PARSING_PAYLOADS)("%s escapes its angle brackets", (_name, tex) => {
    const html = renderInline(`\\(${tex}\\)`)
    expect(html).not.toMatch(/<(?:img|script|iframe|object|embed|svg)\b/i)
  })

  it("renders, rather than throwing, for every payload", () => {
    for (const [, tex] of PARSING_PAYLOADS) {
      expect(() => renderInline(`\\(${tex}\\)`)).not.toThrow()
    }
  })

  // The anti-vacuity guard, and the reason this file exists. Every assertion
  // above runs against rendered output; if a payload ever stopped PARSING and
  // degraded to literal text instead, all of them would pass while checking
  // nothing -- the exact failure this suite already made once, when it passed
  // against three broken stubs. This turns that silent state into a RED one.
  it.each(PARSING_PAYLOADS)("%s actually renders math, so the assertions run", (_name, tex) => {
    const html = renderInline(`\\(${tex}\\)`)
    expect(html).toContain("<math>")
    expect(html).toContain("exp-math-inline")
  })

  // Split out because one payload has no \text{}: in the array payload the
  // "<" characters become <mo> operators, so there is legitimately no <mtext>.
  it.each(PARSING_PAYLOADS.filter(([, tex]) => tex.includes("\\text{")))(
    "%s routes its author text through <mtext>",
    (_name, tex) => {
      expect(renderInline(`\\(${tex}\\)`)).toContain("<mtext>")
    },
  )
})

describe("inline math at the real sink", () => {
  // The boundary's output lands in dangerouslySetInnerHTML at ~20 call sites,
  // so these assert on a whole rendered sentence rather than on the engine.
  const SENTENCES: ReadonlyArray<readonly [string, string]> = [
    ["img", String.raw`the rate \(\text{<img src=x onerror=alert(1)>}\) is set`],
    ["script", String.raw`see \(\text{<script>alert(1)</script>}\) for details`],
    ["anchor", String.raw`as in \(\text{<a href="javascript:alert(1)">x</a>}\)`],
    ["quote", String.raw`note \(\text{" onmouseover="alert(1)}\)`],
    ["style", String.raw`cf. \(\text{<div style="background:url(javascript:alert(1))">x</div>}\)`],
  ]

  // Asserted against ATTRIBUTES, not against the raw string. Every one of
  // these payloads leaves the literal text "javascript:" and "onmouseover="
  // sitting in an escaped <mtext>, which is harmless and expected; asserting
  // on the whole output would flag exactly that. What must not happen is
  // either reaching an attribute, which is the only place either becomes live.
  it.each(SENTENCES)("%s keeps its payload out of every attribute", (_name, prose) => {
    const attrs = attrsIn(renderInline(prose))
    expect(attrs.filter(a => /^on/i.test(a.name)).map(a => a.name)).toEqual([])
    expect(attrs.filter(a => EXECUTABLE.test(a.value)).map(a => a.value)).toEqual([])
    expect(attrs.filter(a => a.value.includes("://")).map(a => a.value)).toEqual([])
  })

  it.each(SENTENCES)("%s emits no element outside the MathML vocabulary", (_name, prose) => {
    const html = renderInline(prose)
    expect(tagsIn(html).filter(t => !ALLOWED_TAGS.has(t))).toEqual([])
    expect(html).not.toMatch(/<(?:img|script|iframe|object|embed|svg|a)\b/i)
  })

  it("leaves the payload readable as escaped text", () => {
    // Proof the assertions above are not passing because the payload vanished.
    const html = renderInline(SENTENCES[0]![1])
    expect(html).toContain("&lt;img")
    expect(html).toContain("<mtext>")
  })

  it("never emits an anchor the model asked for, through math", () => {
    // \\href is unsupported and throws, so the math degrades to literal text
    // rather than becoming a link the safeHref gate never sees.
    const html = renderInline("click \\(\\href{https://evil.example}{here}\\)")
    expect(html).not.toContain("<a ")
    expect(html).toContain("evil.example")
  })

  it("does not let math smuggle a link past the href scheme gate", () => {
    // The interesting shape: a real markdown link whose LABEL is math, paired
    // with a javascript: target. The gate still sees the href.
    const html = renderInline("[the \\(x\\) term](javascript:alert(1))")
    expect(html).not.toContain("<a ")
    expect(attrsIn(html).map(a => a.name)).not.toContain("href")
    // The target survives only as literal text, which is the intended degrade.
    expect(html).toContain("javascript:alert(1)")
  })

  it("keeps a hostile sentence readable as text rather than dropping it", () => {
    const html = renderInline("before \\(\\text{<b>x</b>}\\) after")
    expect(html.startsWith("before ")).toBe(true)
    expect(html.endsWith(" after")).toBe(true)
  })
})

describe("inline math cannot be used to escape the wrapper", () => {
  it("does not let a payload close the span it sits in", () => {
    const html = renderInline("a \\(\\text{</span><img src=x onerror=alert(1)>}\\) b")
    // Exactly one span opens and one closes: the wrapper we emit.
    expect(html.match(/<span\b/g)).toHaveLength(1)
    expect(html.match(/<\/span>/g)).toHaveLength(1)
    expect(html).not.toMatch(/<img/i)
  })

  it("keeps a math span from swallowing a following sibling", () => {
    const html = renderInline("\\(x\\) and [link](https://ex.com)")
    expect(html).toContain("</span> and <a href=\"https://ex.com\">")
  })
})
