import type { z } from "zod"
import type { Block } from "./schema"

/** A stack may contain a stack at most one level deep. */
export const MAX_STACK_DEPTH = 2

export interface RenderContext {
  depth: number
  addWarning(message: string): void
  /** Leniently renders child blocks (used by stack); depth defaults to ctx.depth + 1. */
  renderChildren(blocks: unknown[], depth?: number): string
}

export type BlockRenderer<T extends Block = Block> = (block: T, ctx: RenderContext) => string

export interface Primitive {
  schema: z.ZodTypeAny
  render: BlockRenderer<any>
}

export const registry: Record<string, Primitive> = Object.create(null) as Record<string, Primitive>
// Null prototype: lookups like registry["constructor"] or registry["__proto__"]
// must return undefined (→ fallback block), not inherited Object properties.

export function registerPrimitive(type: string, primitive: Primitive): void {
  registry[type] = primitive
}
