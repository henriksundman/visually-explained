import { renderMath } from "./math"

/** Where `renderInline` reports a degradation. Structurally satisfied by the
 *  full `RenderContext`; optional because the React adapter has no context at
 *  the sites that re-render authored prose (quiz, figure chrome, popovers) —
 *  those degrade silently rather than gaining a new warning surface here. */
export interface InlineWarnings {
  addWarning(message: string): void
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/** Renders the v1 inline subset: **bold**, *italic*, `code`, [label](href),
 * and inline math `\(...\)` / `$...$`.
 * Code spans are split out first so their content is never further processed —
 * which is also why `` `$x$` `` stays literal; everything else is
 * HTML-escaped, so no raw HTML can pass through and attribute breakout is
 * structurally impossible. Link hrefs are scheme-gated (https,
 * http, mailto, #anchor — after stripping control chars and spaces, the same
 * normalization browsers apply, which kills `jav\tascript:`); anything else
 * degrades to literal text. Nesting is not supported beyond emphasis inside
 * labels; markers render literally when unmatched — which is also how
 * unparseable math degrades, reported on `ctx` when one is supplied. */
const LINK_RE = /\[([^\]]+)\]\(([^)\s]+)\)/g

/** Shared href gate (link-inline spec §4): normalize control chars + spaces,
 *  then allowlist https/http/mailto/#anchor. Second consumer: the sources
 *  primitive (two link emitters, one policy). */
export function safeHref(href: string): string | null {
  const normalized = href.replace(/[\u0000-\u0020]/g, "")
  // A raw "<" in the candidate can only be emphasis markup that leaked into
  // the URL (a paired *…* before the link pass) — real "<" arrives escaped as
  // &lt;. Degrade the link to literal text rather than emit a corrupted href.
  if (normalized.includes("<")) return null
  if (/^https:/i.test(normalized)) return normalized
  if (/^http:/i.test(normalized)) return normalized
  if (/^mailto:/i.test(normalized)) return normalized
  if (normalized.startsWith("#")) return normalized
  return null
}

/** Inline math delimiters (inline-math spec §4).
 *
 *  Two forms in one alternation so a `$` inside `\(...\)` is never re-scanned
 *  as a dollar delimiter. The paren arm's `(?:\\[\s\S]|[^\\])*?` is REQUIRED:
 *  a plain `[^\\]*?` silently fails to match `\(\frac{a}{b}\)`, because it
 *  cannot cross the command's backslash. Both arms consume exactly one unit
 *  per step, so the lazy quantifier is linear — no backtracking blowup on
 *  adversarial input.
 *
 *  Group 1 captures only the dollar form's content; `undefined` distinguishes
 *  the two arms. */
const MATH_RE = /\\\((?:\\[\s\S]|[^\\])*?\\\)|\$([^$\n]*?)\$/g

/** Placeholder standing in for rendered MathML while the text passes through
 *  escaping, emphasis and links.
 *
 *  The sentinel is derived per call rather than fixed, and extended with more
 *  NULs until it does not occur in the input, so a caller can never forge one:
 *  a forged placeholder would substitute some other span's MathML. Deriving it
 *  is preferred over stripping NUL from the input, which would change the
 *  documented pass-through of `java\0script:` for no security gain here. */
function sentinelFor(text: string): string {
  let s = "\u0000EXP_MATH_"
  while (text.includes(s)) s += "\u0000"
  return s
}

/** A `$...$` candidate must contain one of these to be treated as math. */
const STRONG_TEX_SIGNAL = /[\\^_{}=<>]/

/** The plausibility gate for `$...$` (spec §4). Prose legitimately contains
 *  dollars — "costs $5 and returns $10" captures " and returns", which Temml
 *  renders as four variables with zero warnings. The existing not-TeX
 *  degradation cannot catch that (prose is valid TeX; open thread 2), so the
 *  gate is what stands between a dollar scanner and silent corruption.
 *
 *  Both arms are load-bearing. Strong signals alone reject `f(x)`. The tight
 *  arm alone accepts `5-` out of "costs $5-$3", because `-` looks like an
 *  operator — requiring a letter is what rejects arithmetic accidents while
 *  keeping symbolic ones.
 *
 *  A candidate that fails any gate is left as literal text, byte-identical to
 *  the pre-math output, so a false negative is the status quo and not a
 *  degradation. */
function plausibleDollarMath(content: string): boolean {
  if (content.length === 0) return false
  // Pandoc: no whitespace adjacent to either delimiter.
  if (/^\s|\s$/.test(content)) return false
  if (STRONG_TEX_SIGNAL.test(content)) return true
  // A tight symbolic expression: no whitespace, and a letter to be a symbol
  // rather than an arithmetic accident.
  return !/\s/.test(content) && /[A-Za-z]/.test(content)
}

/** Byte ranges of link *targets* in the raw text. A math candidate inside one
 *  is skipped: the placeholder would land in an href, and `safeHref` strips
 *  `\u0000-\u0020`, so `[x](https://ex.com/$y$)` would emit a silently
 *  corrupted `https://ex.com/EXP_MATH_0`. Math in a link *label* is fine and
 *  still works — that is what the placeholder mechanism is for. */
function linkTargetRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  for (const m of text.matchAll(LINK_RE)) {
    const open = m[0].lastIndexOf("](")
    if (open < 0) continue
    ranges.push([m.index + open + 2, m.index + m[0].length - 1])
  }
  return ranges
}

/** Replaces every accepted math span with a NUL-delimited placeholder and
 *  returns the rendered MathML alongside. Everything else — a rejected
 *  candidate, unparseable TeX, an unclosed delimiter — stays in `marked` as
 *  its own source text, so the surrounding pipeline sees it unchanged.
 *
 *  The placeholder (rather than splitting the prose into fragments and
 *  processing each) is what lets emphasis and links pair ACROSS a math
 *  boundary: `**bold $x$ term**` is split into three pieces otherwise, and
 *  the `**` on either side pair with nothing. */
function extractMath(text: string, sentinel: string, ctx?: InlineWarnings): { marked: string; rendered: string[] } {
  const linkTargets = linkTargetRanges(text)
  const rendered: string[] = []
  const out: string[] = []
  let last = 0
  MATH_RE.lastIndex = 0
  /** Resume one character past a REJECTED candidate's opening delimiter.
   *
   *  Without this the rejection eats the next span: "Costs $12, so $y = mx$
   *  holds." matches `$12, so $y = ` first, the gate rejects it as prose, and
   *  because lastIndex has moved past that text the real `$y = mx$` is never
   *  offered as a candidate. A sentence containing a dollar amount followed by
   *  a formula is the common case, not the contrived one.
   *
   *  Strictly increasing (start + 1 > the index the match was found at), so
   *  the loop cannot spin. */
  const rewind = (start: number): void => {
    MATH_RE.lastIndex = start + 1
  }
  let m: RegExpExecArray | null
  while ((m = MATH_RE.exec(text)) !== null) {
    const full = m[0]
    const start = m.index
    const end = start + full.length
    if (linkTargets.some(([a, b]) => start < b && a < end)) continue

    let tex: string
    if (m[1] === undefined) {
      // \(...\) has no prose to collide with, so it is honored as written.
      tex = full.slice(2, -2)
      if (tex.length === 0) { rewind(start); continue }
    } else {
      const after = text[end]
      if (after !== undefined && after >= "0" && after <= "9") { rewind(start); continue }
      if (!plausibleDollarMath(m[1])) { rewind(start); continue }
      tex = m[1]
    }

    let html: string
    try {
      html = renderMath(tex)
    } catch (e) {
      // Every failure degrades, not just MathParseError. Measured 2026-10-04:
      // `x^`, `x_`, `^`, `_`, `x^{^{^}}`, `x^&` and `x_^{\` throw a TypeError
      // out of Temml's parser, not a ParseError, so narrowing to MathParseError
      // propagates them and a single malformed span takes down the whole render
      // pass. Inline math puts TeX in ambient prose, where that is reachable.
      // The error type goes in the message so a novel failure is still visible
      // under a host's failOnWarning rather than silently swallowed.
      const name = (e as { constructor?: { name?: string } })?.constructor?.name ?? "Error"
      const detail = String((e as { message?: string }).message ?? e).slice(0, 120)
      ctx?.addWarning(`[math] not TeX (${name}) — left as literal: ${detail}`)
      continue
    }
    out.push(text.slice(last, start))
    out.push(`${sentinel}${rendered.length}${sentinel}`)
    rendered.push(`<span class="exp-math-inline">${html}</span>`)
    last = end
  }
  out.push(text.slice(last))
  return { marked: out.join(""), rendered }
}

export function renderInline(text: string, ctx?: InlineWarnings): string {
  const sentinel = sentinelFor(text)
  const parts = text.split(/(`[^`]+`)/g)
  return parts
    .map(part => {
      if (part.length >= 2 && part.startsWith("`") && part.endsWith("`")) {
        return `<code>${escapeHtml(part.slice(1, -1))}</code>`
      }
      const { marked, rendered } = extractMath(part, sentinel, ctx)
      let out = escapeHtml(marked)
      out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      out = out.replace(/\*([^*]+)\*/g, "<em>$1</em>")
      out = out.replace(LINK_RE, (src: string, label: string, href: string): string => {
        const target = safeHref(href)
        if (target === null) return src
        return `<a href="${target}">${label}</a>`
      })
      // split/join rather than a regex: the sentinel is built per call, so it
      // cannot be a literal in a module-level pattern.
      return rendered.reduce((acc, html, n) => acc.split(`${sentinel}${n}${sentinel}`).join(html), out)
    })
    .join("")
}
