import { registerPrimitive, type RenderContext } from "../core/registry"
import { timelineBlockSchema, type TimelineBlock } from "../core/schema"
import { resolveDataset, applyDatasetFields, timelineDatasetSchema } from "../core/datasets"
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
  let b: TimelineBlock = block
  if (block.dataset) {
    const r = resolveDataset(ctx, "timeline", block.id, block.dataset, timelineDatasetSchema)
    if (r.ok) b = applyDatasetFields(block, r.data)
  }
  if (resolvePresentation(b) === "text") return renderTextForm(b)
  const { scene } = layoutTimeline(b.events.map(e => ({ when: e.when, what: e.what, tip: e.tip })))
  // `detail` is prose too long for figure labels; the text form carries it (spec §1).
  const aria = `Timeline: ${b.events.map(e => `${e.when} ${e.what}`).join(" → ")}`
  const svg = sceneToSvg(scene, { ariaLabel: aria, sketch: ctx.sketch, seed: b.id ?? hashSeed(aria) })
  return `<div class="exp-block exp-timeline exp-timeline-figure">${svg}</div>`
}

registerPrimitive("timeline", { schema: timelineBlockSchema, render: renderTimeline })
