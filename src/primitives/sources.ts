import { registerPrimitive, type RenderContext } from "../core/registry"
import { sourcesBlockSchema, type SourcesBlock } from "../core/schema"
import { escapeHtml, renderInline, safeHref } from "../core/inline"

export function renderSources(block: SourcesBlock, ctx: RenderContext): string {
  const items = block.items
    .map(it => {
      const href = it.url !== undefined ? safeHref(it.url) : null
      const title = href
        ? `<a class="exp-source-link" href="${escapeHtml(href)}">${renderInline(it.title, ctx)}</a>`
        : renderInline(it.title, ctx)
      const detail = it.detail ? `<p class="exp-source-detail">${renderInline(it.detail, ctx)}</p>` : ""
      return `<li id="source-${escapeHtml(it.id)}" class="exp-source">${title}${detail}</li>`
    })
    .join("")
  const heading = block.title ? `<p class="exp-sources-title">${renderInline(block.title, ctx)}</p>` : ""
  return `<div class="exp-block exp-sources">${heading}<ol class="exp-sources-list">${items}</ol></div>`
}

registerPrimitive("sources", { schema: sourcesBlockSchema, render: renderSources })
