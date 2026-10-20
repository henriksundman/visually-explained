import { registerPrimitive, type RenderContext } from "../core/registry"
import { derivationBlockSchema, type DerivationBlock } from "../core/schema"
import { escapeHtml, renderInline } from "../core/inline"
import { renderMath, looksLikeProse } from "../core/math"

/** The field's TeX-parse-failure degradation (spec §7), shared by expression
 *  and conclusion: escaped literal source plus a warning — never the engine's
 *  own error markup, which differs per engine (KaTeX emits `span.katex-error`,
 *  Temml has no equivalent) and would leak into themed output. The fallback
 *  keeps `<code>` because at that point the text genuinely IS source. */
function mathLiteral(tex: string, e: unknown, ctx: RenderContext): string {
  // Every failure degrades to literal text, not just MathParseError. Measured
  // 2026-10-04: `x^`, `x_`, `^`, `_`, `x^{^{^}}`, `x^&` and `x_^{\` throw a
  // TypeError out of Temml's parser, so narrowing to ParseError let a single
  // malformed model-authored expression escape the render pass entirely. The
  // error type rides in the message so a novel failure stays visible under a
  // host's failOnWarning instead of being silently swallowed.
  const name = (e as { constructor?: { name?: string } })?.constructor?.name ?? "Error"
  const detail = String((e as { message?: string }).message ?? e).slice(0, 120)
  ctx.addWarning(`[math] not TeX (${name}) — rendered as literal text: ${detail}`)
  return `<code class="exp-math-literal">${escapeHtml(tex)}</code>`
}

/** Render one whole-field TeX string. A parse failure degrades via
 *  `mathLiteral`. Kept for the expression path (unchanged per follow-up 4). */
function mathOrLiteral(tex: string, ctx: RenderContext): string {
  try {
    return renderMath(tex)
  } catch (e) {
    return mathLiteral(tex, e, ctx)
  }
}

/** The conclusion is prose (host follow-up 4, 2026-10-20). "Conclusion" reads
 *  as "the concluding sentence", so models write prose there — and prose is
 *  VALID TeX: a run of letters is a run of variables, so the old
 *  whole-field-TeX path rendered "Where F is the gravitational force…" as
 *  "WhereFisthe…", one <mi> per letter, silent (no parse error, no warning).
 *
 *  Gate order, written to keep every previously-correct render byte-identical:
 *  1. Accepted \(…\)/$…$ spans (the same scanner prose paths use) make prose
 *     intent explicit → `renderInline`, prose with inline math.
 *  2. No spans → render as math once and let the shared fingerprint
 *     (`looksLikeProse`) decide: a bare formula keeps its math render;
 *     prose renders as prose, warn-free — it is the documented contract
 *     again, not a violation to report.
 *  3. A hard parse failure degrades with a `[math]` warning exactly like an
 *     expression — never silently swallowed, `failOnWarning` hosts must
 *     still see it. */
function renderConclusion(conclusion: string, ctx: RenderContext): string {
  const asProse = renderInline(conclusion, ctx)
  if (asProse.includes(`class="exp-math-inline"`)) return asProse
  try {
    const rendered = renderMath(conclusion)
    if (!looksLikeProse(conclusion, rendered)) return rendered
    return asProse
  } catch (e) {
    return mathLiteral(conclusion, e, ctx)
  }
}

export function renderDerivation(block: DerivationBlock, ctx: RenderContext): string {
  const steps = block.steps
    .map((s) => {
      const expression = mathOrLiteral(s.expression, ctx)
      return (
        `<li class="exp-derivation-step">` +
        // Rendered math is output, not source: <code> told assistive tech the
        // formula was literal code and pulled in a monospace face that renders
        // math badly. The class is kept so existing theme rules still apply.
        `<span class="exp-derivation-expr">${expression}</span>` +
        (s.note ? `<p class="exp-derivation-note">${renderInline(s.note, ctx)}</p>` : "") +
        `</li>`
      )
    })
    .join("")
  const conclusion = block.conclusion
    ? `<p class="exp-derivation-conclusion">${renderConclusion(block.conclusion, ctx)}</p>`
    : ""
  return `<div class="exp-block exp-derivation"><ol class="exp-derivation-steps">${steps}</ol>${conclusion}</div>`
}

registerPrimitive("derivation", { schema: derivationBlockSchema, render: renderDerivation })
