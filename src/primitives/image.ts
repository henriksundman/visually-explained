import { registerPrimitive, type RenderContext } from "../core/registry"
import { imageBlockSchema, type ImageBlock } from "../core/schema"
import { resolveImage } from "../core/images"
import { escapeHtml, renderInline } from "../core/inline"

/** One image from the host catalog. A miss or invalid entry degrades to the
 *  caption alone and warns (image spec §5) — never a broken <img>, and never
 *  the catalog key, which is a host-internal identifier. With no caption there
 *  is nothing worth showing, so the block renders nothing visible and the
 *  warning stands alone. */
export function renderImage(block: ImageBlock, ctx: RenderContext): string {
  const resolved = resolveImage(ctx, block.image, block.id)
  const caption = block.caption
    ? `<figcaption class="exp-fig-caption">${renderInline(block.caption)}</figcaption>`
    : ""
  if (!resolved.ok) {
    if (!caption) return ""
    return `<figure class="exp-block exp-image exp-image-missing">${caption}</figure>`
  }
  const { src, alt, width, height } = resolved.ref
  return (
    `<figure class="exp-block exp-image">` +
    `<img class="exp-image-img" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"` +
    ` width="${width}" height="${height}" loading="lazy" decoding="async">` +
    caption +
    `</figure>`
  )
}

registerPrimitive("image", { schema: imageBlockSchema, render: renderImage })