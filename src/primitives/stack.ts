import { registerPrimitive, MAX_STACK_DEPTH, type RenderContext } from "../core/registry"
import { stackBlockSchema, type StackBlock } from "../core/schema"

export function renderStack(block: StackBlock, ctx: RenderContext): string {
  const childDepth = ctx.depth + 1
  if (childDepth > MAX_STACK_DEPTH) {
    ctx.addWarning(
      `[stack-too-deep] stack at depth ${ctx.depth} exceeds max nesting ${MAX_STACK_DEPTH}; rendering children at depth ${ctx.depth}`,
    )
    return `<div class="exp-block exp-stack">${ctx.renderChildren(block.blocks, ctx.depth)}</div>`
  }
  return `<div class="exp-block exp-stack">${ctx.renderChildren(block.blocks, childDepth)}</div>`
}

registerPrimitive("stack", { schema: stackBlockSchema, render: renderStack })
