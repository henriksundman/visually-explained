import { registerPrimitive, type RenderContext } from "../core/registry"
import { derivationBlockSchema, type DerivationBlock } from "../core/schema"
import { escapeHtml, renderInline } from "../core/inline"

export function renderDerivation(block: DerivationBlock, _ctx: RenderContext): string {
  const steps = block.steps
    .map(
      s =>
        `<li class="exp-derivation-step">` +
        `<code class="exp-derivation-expr">${escapeHtml(s.expression)}</code>` +
        (s.note ? `<p class="exp-derivation-note">${renderInline(s.note)}</p>` : "") +
        `</li>`,
    )
    .join("")
  const conclusion = block.conclusion
    ? `<p class="exp-derivation-conclusion">${renderInline(block.conclusion)}</p>`
    : ""
  return `<div class="exp-block exp-derivation"><ol class="exp-derivation-steps">${steps}</ol>${conclusion}</div>`
}

registerPrimitive("derivation", { schema: derivationBlockSchema, render: renderDerivation })
