import { registerPrimitive, type RenderContext } from "../core/registry"
import { imageBlockSchema, type ImageBlock } from "../core/schema"
import { resolveImage } from "../core/images"
import { escapeHtml, renderInline } from "../core/inline"

/** One image from the host catalog. A miss or invalid entry degrades to the
 *  caption alone and warns (image spec §5) — never a broken <img>, and never
 *  the catalog key, which is a host-internal identifier. With no caption there
 *  is nothing worth showing, so the block renders nothing visible and the
 *  warning stands alone.
 *
 *  An optional `body` adds prose that belongs to the picture (image-body spec
 *  §3), rendered in its own column so the two read as one unit. Three
 *  properties this function must keep:
 *
 *  - **A body-less block is byte-identical to the shipped output.** Every
 *    wrapper class below is conditional on `body`. This is the unit-level twin
 *    of the rendered-corpus diff; the two together are what stop a "harmless"
 *    refactor from moving markup for the 18 primitives that never set it.
 *  - **<figcaption> stays a direct, last child of <figure>.** HTML allows it
 *    only as the first or last child, so the prose column is a sibling and CSS
 *    places the caption beneath both columns.
 *  - **A miss with a body drops `.exp-image-missing`.** The dashed border
 *    signals "degraded slot", which would be noise wrapped around the reader's
 *    own legitimate prose. The prose renders as an ordinary paragraph and the
 *    warning still fires — that is how a host learns, per OPEN_THREADS' "a
 *    degraded path must be loud". */
export function renderImage(block: ImageBlock, ctx: RenderContext): string {
  const resolved = resolveImage(ctx, block.image, block.id)
  const caption = block.caption
    ? `<figcaption class="exp-fig-caption">${renderInline(block.caption, ctx)}</figcaption>`
    : ""
  const prose = block.body
    ? `<div class="exp-image-prose"><p>${renderInline(block.body, ctx)}</p></div>`
    : ""
  const bodyClass = prose ? " exp-image-body" : ""

  if (!resolved.ok) {
    // Prose is a reason to render on its own; without it the shipped rule
    // stands, including emitting nothing when there is no caption either.
    if (prose) return `<figure class="exp-block exp-image${bodyClass}">${prose}${caption}</figure>`
    if (!caption) return ""
    return `<figure class="exp-block exp-image exp-image-missing">${caption}</figure>`
  }

  const { src, alt, width, height } = resolved.ref
  return (
    `<figure class="exp-block exp-image${bodyClass}">` +
    `<img class="exp-image-img" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"` +
    ` width="${width}" height="${height}" loading="lazy" decoding="async">` +
    prose +
    caption +
    `</figure>`
  )
}

registerPrimitive("image", { schema: imageBlockSchema, render: renderImage })