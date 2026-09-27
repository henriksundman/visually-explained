import { registerPrimitive, type RenderContext } from "../core/registry"
import { dataCalloutBlockSchema, type DataCalloutBlock } from "../core/schema"
import { escapeHtml, renderInline } from "../core/inline"

export function renderDataCallout(block: DataCalloutBlock, _ctx: RenderContext): string {
  const delta = block.delta
    ? `<span class="exp-delta${block.trend ? ` exp-delta-${block.trend}` : ""}">${escapeHtml(block.delta)}</span>`
    : ""
  const context = block.context ? `<p class="exp-context">${renderInline(block.context)}</p>` : ""
  return (
    `<div class="exp-block exp-data-callout">` +
    `<span class="exp-metric">${escapeHtml(block.metric)}</span>` +
    `<span class="exp-metric-label">${renderInline(block.label)}</span>` +
    delta +
    context +
    `</div>`
  )
}

registerPrimitive("data-callout", { schema: dataCalloutBlockSchema, render: renderDataCallout })
