import { registerPrimitive, type RenderContext } from "../core/registry"
import { conceptBlockSchema, type ConceptBlock } from "../core/schema"
import { renderInline } from "../core/inline"

export function renderConcept(block: ConceptBlock, ctx: RenderContext): string {
  const intuition = block.intuition
    ? `<p class="exp-concept-intuition"><span class="exp-label">Intuition</span> ${renderInline(block.intuition, ctx)}</p>`
    : ""
  const analogy = block.analogy
    ? `<p class="exp-concept-analogy"><span class="exp-label">Analogy</span> ${renderInline(block.analogy, ctx)}</p>`
    : ""
  return (
    `<div class="exp-block exp-concept">` +
    `<p class="exp-concept-term">${renderInline(block.term, ctx)}</p>` +
    `<p class="exp-concept-definition">${renderInline(block.definition, ctx)}</p>` +
    intuition +
    analogy +
    `</div>`
  )
}

registerPrimitive("concept", { schema: conceptBlockSchema, render: renderConcept })
