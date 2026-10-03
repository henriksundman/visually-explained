import { describe, expectTypeOf, it } from "vitest"
import type { Block, ImageBlock, SourcesBlock } from "../src/core/schema"

/** Runtime no-op; pins the type surface. The Block union previously omitted
 *  SourcesBlock — masked by the `as unknown as` cast in blockUnionSchema, so
 *  only tsc could catch it. Extend this pin when payload types are added. */
describe("Block union type pin", () => {
  it("includes every payload type, SourcesBlock included", () => {
    expectTypeOf<SourcesBlock>().toExtend<Block>()
    expectTypeOf<ImageBlock>().toExtend<Block>()
  })
})
