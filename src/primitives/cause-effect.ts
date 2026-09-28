import { registerPrimitive, type RenderContext } from "../core/registry"
import { causeEffectBlockSchema, type CauseEffectBlock } from "../core/schema"
import { renderInline } from "../core/inline"
import { layoutFlow, type FlowSpec } from "../figures/layoutFlow"
import { sceneToSvg } from "../figures/svg"
import { hashSeed } from "../figures/seed"

const CAUSE_EFFECT_FIGURE_MAX = 5

function resolvePresentation(block: CauseEffectBlock): "text" | "figure" {
  if (block.presentation === "text") return "text"
  if (block.presentation === "figure") return "figure"
  return block.chain.length <= CAUSE_EFFECT_FIGURE_MAX ? "figure" : "text" // auto
}

function renderTextForm(block: CauseEffectBlock): string {
  const items = block.chain
    .map(
      c =>
        `<li class="exp-cause-item">` +
        `<p class="exp-cause"><span class="exp-label">Because</span> ${renderInline(c.because)}</p>` +
        `<p class="exp-effect"><span class="exp-label">Therefore</span> ${renderInline(c.therefore)}</p>` +
        `</li>`,
    )
    .join("")
  return `<div class="exp-block exp-cause-effect"><ol class="exp-cause-chain">${items}</ol></div>`
}

function renderFigureForm(block: CauseEffectBlock, ctx: RenderContext): string {
  const spec: FlowSpec = {
    nodes: block.chain.flatMap((c, i) => [
      { id: `b${i}`, label: c.because, shape: "pill" as const },
      { id: `t${i}`, label: c.therefore, shape: "pill" as const },
    ]),
    edges: block.chain.map((_, i) => ({ from: `b${i}`, to: `t${i}`, kind: "causes" as const })),
    direction: "lr",
  }
  const { scene } = layoutFlow(spec)
  const aria = `Cause and effect: ${block.chain.map(c => `${c.because} → ${c.therefore}`).join("; ")}`
  const svg = sceneToSvg(scene, { ariaLabel: aria, sketch: ctx.sketch, seed: block.id ?? hashSeed(aria) })
  return `<div class="exp-block exp-cause-effect exp-cause-effect-figure">${svg}</div>`
}

export function renderCauseEffect(block: CauseEffectBlock, ctx: RenderContext): string {
  if (resolvePresentation(block) === "figure") return renderFigureForm(block, ctx)
  return renderTextForm(block)
}

registerPrimitive("cause-effect", { schema: causeEffectBlockSchema, render: renderCauseEffect })
