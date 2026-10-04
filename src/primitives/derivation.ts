import { registerPrimitive, type RenderContext } from "../core/registry"
import { derivationBlockSchema, type DerivationBlock } from "../core/schema"
import { escapeHtml, renderInline } from "../core/inline"
import { renderMath } from "../core/math"

/** Render one TeX field. A parse failure degrades to the escaped literal
 *  source plus a warning (spec §7) — never the engine's own error markup,
 *  which differs per engine (KaTeX emits `span.katex-error`, Temml has no
 *  equivalent) and would leak into themed output. The fallback keeps `<code>`
 *  because at that point the text genuinely IS source. */
function mathOrLiteral(tex: string, ctx: RenderContext): string {
  try {
    return renderMath(tex)
  } catch (e) {
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
    ? `<p class="exp-derivation-conclusion">${mathOrLiteral(block.conclusion, ctx)}</p>`
    : ""
  return `<div class="exp-block exp-derivation"><ol class="exp-derivation-steps">${steps}</ol>${conclusion}</div>`
}

registerPrimitive("derivation", { schema: derivationBlockSchema, render: renderDerivation })
