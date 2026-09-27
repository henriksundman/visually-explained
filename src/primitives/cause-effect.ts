import { registerPrimitive, type RenderContext } from "../core/registry"
import { causeEffectBlockSchema, type CauseEffectBlock } from "../core/schema"
import { renderInline } from "../core/inline"

export function renderCauseEffect(block: CauseEffectBlock, _ctx: RenderContext): string {
  const items = block.chain
    .map(
      c =>
        `<li class="exp-cause-item">` +
        `<p class="exp-cause"><span class="exp-label">Because</span> ${renderInline(c.because)}</p>` +
        `<p class="exp-effect"><span class="exp-label">Therefore</span> ${renderInline(c.therefore)}</p>` +
        `</li>`,
    )
    .join("")
  return `<div class="exp-block exp-cause-effect"><ol class="exp-cause-chain">${items}</ol></div>`
}

registerPrimitive("cause-effect", { schema: causeEffectBlockSchema, render: renderCauseEffect })
