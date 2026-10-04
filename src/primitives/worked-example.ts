import { registerPrimitive, type RenderContext } from "../core/registry"
import { workedExampleBlockSchema, type WorkedExampleBlock } from "../core/schema"
import { renderInline } from "../core/inline"
import { renderStepLi } from "./step-list"

export function renderWorkedExample(block: WorkedExampleBlock, ctx: RenderContext): string {
  return (
    `<div class="exp-block exp-worked-example">` +
    `<p class="exp-example-problem">${renderInline(block.problem, ctx)}</p>` +
    `<ol class="exp-example-steps">${block.steps.map((s, i) => renderStepLi(s, i, ctx)).join("")}</ol>` +
    `<p class="exp-example-result">${renderInline(block.result, ctx)}</p>` +
    `</div>`
  )
}

registerPrimitive("worked-example", { schema: workedExampleBlockSchema, render: renderWorkedExample })
