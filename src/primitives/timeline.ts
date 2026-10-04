import { registerPrimitive, type RenderContext } from "../core/registry"
import { timelineBlockSchema, type TimelineBlock } from "../core/schema"
import { resolveDataset, applyDatasetFields, timelineDatasetSchema } from "../core/datasets"
import { renderInline } from "../core/inline"
import { layoutTimeline, timelineFigureFits } from "../figures/layoutTimeline"
import { sceneToSvg } from "../figures/svg"
import { hashSeed } from "../figures/seed"

const TIMELINE_FIGURE_MAX = 12

/**
 * Figure or text list?
 *
 * `auto` degrades on TWO independent conditions, and the second is the one that
 * matters. Event count alone let a 3-event timeline with 40-character
 * milestone names through, and the figure silently overlapped its own labels
 * (the labels were never measured — the root cause of every figure-label bug
 * in this library). So `auto` also requires the events to MEASURE as a
 * legible figure: `timelineFigureFits` rejects when the scene would have to
 * grow past the width at which `width: 100%` scaling shrinks the 11px labels
 * into illegibility.
 *
 * The text form is the better outcome, not a consolation prize — it renders
 * `detail`, which the figure drops entirely.
 *
 * An author who sets `presentation` explicitly always gets what they asked for.
 * That is the point of an explicit field: it is a deliberate override, and
 * silently ignoring it would be its own lie.
 */
function resolvePresentation(block: TimelineBlock): "text" | "figure" {
  if (block.presentation === "text") return "text"
  if (block.presentation === "figure") return "figure"
  if (block.events.length > TIMELINE_FIGURE_MAX) return "text" // auto
  const events = block.events.map(e => ({ when: e.when, what: e.what, tip: e.tip }))
  return timelineFigureFits(events) ? "figure" : "text" // auto
}

function renderTextForm(block: TimelineBlock, ctx: RenderContext): string {
  const events = block.events
    .map(
      e =>
        `<li class="exp-event">` +
        `<span class="exp-event-when">${renderInline(e.when, ctx)}</span>` +
        `<p class="exp-event-what">${renderInline(e.what, ctx)}</p>` +
        (e.detail ? `<p class="exp-event-detail">${renderInline(e.detail, ctx)}</p>` : "") +
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
  const events = b.events.map(e => ({ when: e.when, what: e.what, tip: e.tip }))
  const figure = resolvePresentation(b)
  if (figure === "text") {
    // Make the downgrade loud. Every other primitive pipes layout warnings to
    // the host; this one used to discard them, so a host collecting warnings
    // could not tell that a figure had become a list.
    if (b.presentation !== "text" && !timelineFigureFits(events)) {
      ctx.addWarning(
        "timeline-figure-too-wide: milestone labels are too long to draw legibly; rendered the text list instead (set presentation: \"figure\" to override)",
      )
    }
    return renderTextForm(b, ctx)
  }
  const { scene, warnings } = layoutTimeline(events)
  for (const w of warnings) ctx.addWarning(w)
  // `detail` is prose too long for figure labels; the text form carries it (spec §1).
  const aria = `Timeline: ${b.events.map(e => `${e.when} ${e.what}`).join(" → ")}`
  const svg = sceneToSvg(scene, { ariaLabel: aria, sketch: ctx.sketch, seed: b.id ?? hashSeed(aria) })
  return `<div class="exp-block exp-timeline exp-timeline-figure">${svg}</div>`
}

registerPrimitive("timeline", { schema: timelineBlockSchema, render: renderTimeline })
