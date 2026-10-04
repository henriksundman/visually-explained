import { registerPrimitive, type RenderContext } from "../core/registry"
import { textBlockSchema, type TextBlock } from "../core/schema"
import { renderInline } from "../core/inline"

export function renderText(block: TextBlock, ctx: RenderContext): string {
  return `<div class="exp-block exp-text"><p>${renderInline(block.body, ctx)}</p></div>`
}

registerPrimitive("text", { schema: textBlockSchema, render: renderText })
