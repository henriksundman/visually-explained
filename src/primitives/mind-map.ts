import { registerPrimitive, type RenderContext } from "../core/registry"
import { mindMapBlockSchema, type MindMapBlock, type MindMapNode } from "../core/schema"
import { renderInline } from "../core/inline"
import {
  layoutTree,
  mindMapTreeStats,
  mindMapFigureFits,
  TREE_MAX_SCENE_W,
  type TreeNodeSpec,
} from "../figures/layoutTree"
import { sceneToSvg } from "../figures/svg"
import { hashSeed } from "../figures/seed"

/** Legibility policy — how deep a readable tree is. Deliberately NOT the
 *  schema's crash guard (MIND_MAP_SCHEMA_DEPTH = 12): a 6-deep tree is valid
 *  but unreadable, so it degrades to text and says so, rather than being
 *  dropped as an invalid block. */
export const MIND_MAP_MAX_DEPTH = 5
/** Crude first guard, subordinate to the measured width check. */
export const MIND_MAP_MAX_NODES = 24

/** Why the list form was chosen, when it was a DEGRADATION rather than a
 *  request. `reason` is absent for an explicit `presentation`, so the caller
 *  cannot report a degradation the author actually asked for. */
type Presentation = { form: "text" | "figure"; reason?: string }

/**
 * Figure or nested list?
 *
 * Degrades on THREE independent conditions, and the width check is the one
 * that matters most — count alone let a 3-event timeline with 40-character
 * names through once, and the figure silently overlapped its own labels. A
 * tree of 24 one-word labels is very wide; a tree of 6 long ones is very
 * deep. `mindMapFigureFits` measures the laid-out scene against the 825px
 * ceiling, the same arithmetic layoutTimeline uses.
 *
 * Width is a function of DEPTH, not label length: node labels wrap at
 * TREE_NODE_W_MAX, so one column per level is what sets the scene width. The
 * width guard is therefore reachable only at the depth limit with
 * full-column labels — a condition node count and depth alone both miss.
 *
 * Returning the REASON rather than a bare "text" matters: without it an
 * explicit `presentation: "text"` is indistinguishable from a degradation,
 * and the host gets a warning blaming the width for a choice the author made.
 *
 * The list is the better outcome, not a consolation prize: it is also the
 * degradation target, the accessible form, and the no-SVG fallback, so those
 * three cannot drift apart.
 */
function resolvePresentation(block: MindMapBlock): Presentation {
  if (block.presentation === "text") return { form: "text" }
  if (block.presentation === "figure") return { form: "figure" } // deliberate override
  const stats = mindMapTreeStats(block.root as TreeNodeSpec)
  if (stats.nodes > MIND_MAP_MAX_NODES) {
    return { form: "text", reason: `${stats.nodes} nodes exceeds ${MIND_MAP_MAX_NODES}` }
  }
  if (stats.depth > MIND_MAP_MAX_DEPTH) {
    return { form: "text", reason: `depth ${stats.depth} exceeds ${MIND_MAP_MAX_DEPTH}` }
  }
  if (!mindMapFigureFits(block.root as TreeNodeSpec)) {
    return { form: "text", reason: `scene is wider than ${TREE_MAX_SCENE_W}px` }
  }
  return { form: "figure" }
}

/** "Cache contains Browser cache, Shared cache; Shared cache contains
 *  In-memory, On-disk." The figure carries no text a screen reader can use
 *  otherwise, and the SVG has no accessible structure of its own.
 *
 *  Raw label text, NOT renderInline: sceneToSvg escapes the attribute, so
 *  markup would be announced literally ("less than strong"). This matches
 *  diagram, cause-effect and timeline, which all pass plain labels here. */
function ariaFor(node: MindMapNode): string {
  const kids = node.children ?? []
  if (kids.length === 0) return node.label
  const parts = kids.map(k => ariaFor(k))
  return `${node.label} contains ${parts.join(", ")}`
}

function listHtml(node: MindMapNode): string {
  const kids = node.children ?? []
  const item = `<li>${renderInline(node.label, undefined)}`
  return kids.length === 0
    ? `${item}</li>`
    : `${item}<ul>${kids.map(listHtml).join("")}</ul></li>`
}

export function renderMindMap(block: MindMapBlock, ctx: RenderContext): string {
  const { form, reason } = resolvePresentation(block)
  if (form === "text") {
    if (reason) ctx.addWarning(`[mind-map] ${reason} — rendered as a nested list`)
    return `<div class="exp-block exp-mind-map exp-mind-map-text"><ul class="exp-mind-map-list">${listHtml(block.root)}</ul></div>`
  }
  const { scene } = layoutTree(block.root as TreeNodeSpec)
  const aria = ariaFor(block.root)
  const svg = sceneToSvg(scene, { ariaLabel: aria, sketch: ctx.sketch, seed: block.id ?? hashSeed(aria) })
  return `<div class="exp-block exp-mind-map exp-mind-map-figure">${svg}</div>`
}

registerPrimitive("mind-map", { schema: mindMapBlockSchema, render: renderMindMap })