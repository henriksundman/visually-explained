import { registerPrimitive, type RenderContext } from "../core/registry"
import { timelineBlockSchema, type TimelineBlock } from "../core/schema"
import { renderInline } from "../core/inline"
import { layoutTimeline } from "../figures/layoutTimeline"
import { sceneToSvg } from "../figures/svg"
import { hashSeed } from "../figures/seed"

const TIMELINE_FIGURE_MAX = 12

function resolvePresentation(block: TimelineBlock): "text" | "figure" {
  if (block.presentation === "text") return "text"
  if (block.presentation === "figure") return "figure"
  return block.events.length <= TIMELINE_FIGURE_MAX ? "figure" : "text" // auto
}

function renderTextForm(block: TimelineBlock): string {
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

export function renderTimeline(block: TimelineBlock, ctx: RenderContext): string {
  if (resolvePresentation(block) === "text") return renderTextForm(block)
  const { scene } = layoutTimeline(block.events.map(e => ({ when: e.when, what: e.what, tip: e.tip })))
  // `detail` is prose too long for figure labels; the text form carries it (spec §1).
  const aria = `Timeline: ${block.events.map(e => `${e.when} ${e.what}`).join(" → ")}`
  const svg = sceneToSvg(scene, { ariaLabel: aria, sketch: ctx.sketch, seed: block.id ?? hashSeed(aria) })
  return `<div class="exp-block exp-timeline exp-timeline-figure">${svg}</div>`
}

registerPrimitive("timeline", { schema: timelineBlockSchema, render: renderTimeline })
