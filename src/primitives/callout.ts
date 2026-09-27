import { registerPrimitive, type RenderContext } from "../core/registry"
import { calloutBlockSchema, type CalloutBlock } from "../core/schema"
import { renderInline } from "../core/inline"

export function renderCallout(block: CalloutBlock, _ctx: RenderContext): string {
  return (
    `<div class="exp-block exp-callout exp-callout-${block.variant}">` +
    `<p class="exp-callout-body">${renderInline(block.body)}</p>` +
    `</div>`
  )
}

registerPrimitive("callout", { schema: calloutBlockSchema, render: renderCallout })
