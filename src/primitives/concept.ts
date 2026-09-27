import { registerPrimitive, type RenderContext } from "../core/registry"
import { conceptBlockSchema, type ConceptBlock } from "../core/schema"
import { renderInline } from "../core/inline"

export function renderConcept(block: ConceptBlock, _ctx: RenderContext): string {
  const intuition = block.intuition
    ? `<p class="exp-concept-intuition"><span class="exp-label">Intuition</span> ${renderInline(block.intuition)}</p>`
    : ""
  const analogy = block.analogy
    ? `<p class="exp-concept-analogy"><span class="exp-label">Analogy</span> ${renderInline(block.analogy)}</p>`
    : ""
  return (
    `<div class="exp-block exp-concept">` +
    `<p class="exp-concept-term">${renderInline(block.term)}</p>` +
    `<p class="exp-concept-definition">${renderInline(block.definition)}</p>` +
    intuition +
    analogy +
    `</div>`
  )
}

registerPrimitive("concept", { schema: conceptBlockSchema, render: renderConcept })
