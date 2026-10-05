import { registerPrimitive, type RenderContext } from "../core/registry"
import { headingBlockSchema, type HeadingBlock } from "../core/schema"
import { escapeHtml, renderInline } from "../core/inline"

/** A subheading inside a section's block flow. This library emits no heading
 *  element of its own: the document title is the h1, a section title the h2,
 *  and a figure's own title the h4 — so in a document the outline runs
 *  h1 → h2 → nothing → h4, and h3 was the empty slot this block fills.
 *
 *  The level is FIXED. A `level` field was rejected (heading spec §3.1): it
 *  would let a model drop an h1 into the middle of a document and break its
 *  title, and it makes a *skipped* level expressible, which is the actual
 *  accessibility failure — an h2 → h4 jump leaves nothing owning h3.
 *
 *  The anchor is the block's own `id`, prefixed `h-`, and only when one is
 *  given. Text is NOT auto-slugged: two identically-worded headings in one
 *  document are normal in generated content, duplicate DOM ids are invalid
 *  HTML, and a primitive has no per-document `taken` set to deduplicate with —
 *  `collectAnchors` threads one for sections, but `renderSalvagedBlock` is
 *  stateless per block. The prefix makes a heading/section collision
 *  structurally impossible rather than merely unlikely. */
export function renderHeading(block: HeadingBlock, ctx: RenderContext): string {
  const id = block.id ? ` id="h-${escapeHtml(block.id)}"` : ""
  return `<h3 class="exp-heading"${id}>${renderInline(block.text, ctx)}</h3>`
}

registerPrimitive("heading", { schema: headingBlockSchema, render: renderHeading })