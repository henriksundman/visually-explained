import { registerPrimitive, type RenderContext } from "../core/registry"
import { timelineBlockSchema, type TimelineBlock } from "../core/schema"
import { renderInline } from "../core/inline"

export function renderTimeline(block: TimelineBlock, _ctx: RenderContext): string {
  const events = block.events
    .map(
      e =>
        `<li class="exp-event">` +
        `<span class="exp-event-when">${renderInline(e.when)}</span>` +
        `<p class="exp-event-what">${renderInline(e.what)}</p>` +
        (e.detail ? `<p class="exp-event-detail">${renderInline(e.detail)}</p>` : "") +
        `</li>`,
    )
    .join("")
  return `<div class="exp-block exp-timeline"><ol class="exp-timeline-events">${events}</ol></div>`
}

registerPrimitive("timeline", { schema: timelineBlockSchema, render: renderTimeline })
