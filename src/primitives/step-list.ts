import { registerPrimitive, type RenderContext } from "../core/registry"
import { stepListBlockSchema, type Step, type StepListBlock } from "../core/schema"
import { renderInline } from "../core/inline"

export function renderStepLi(step: Step, index: number, ctx: RenderContext): string {
  return (
    `<li class="exp-step">` +
    `<span class="exp-step-num">${index + 1}</span>` +
    `<div class="exp-step-body">` +
    `<p class="exp-step-title">${renderInline(step.title, ctx)}</p>` +
    (step.detail ? `<p class="exp-step-detail">${renderInline(step.detail, ctx)}</p>` : "") +
    `</div></li>`
  )
}

export function renderStepList(block: StepListBlock, ctx: RenderContext): string {
  return `<div class="exp-block exp-step-list"><ol class="exp-steps">${block.steps
    .map((s, i) => renderStepLi(s, i, ctx))
    .join("")}</ol></div>`
}

registerPrimitive("step-list", { schema: stepListBlockSchema, render: renderStepList })
