import { registerPrimitive, type RenderContext } from "../core/registry"
import { diagramBlockSchema, type DiagramBlock } from "../core/schema"
import { layoutFlow, type FlowSpec } from "../figures/layoutFlow"
import { sceneToSvg } from "../figures/svg"

export function renderDiagram(block: DiagramBlock, ctx: RenderContext): string {
  const spec: FlowSpec = {
    nodes: block.nodes.map(n => ({ id: n.id, label: n.label, shape: n.shape })),
    edges: block.edges.map(e => ({ from: e.from, to: e.to, label: e.label, kind: e.kind })),
    direction: block.direction ?? "lr",
  }
  const { scene, warnings } = layoutFlow(spec)
  for (const w of warnings) ctx.addWarning(w)
  // Deterministic accessible name from the block's own fields (spec §2).
  const aria = `Diagram: ${block.nodes.map(n => n.label).join(" → ")}`
  const svg = sceneToSvg(scene, { ariaLabel: aria })
  return `<div class="exp-block exp-diagram">${svg}</div>`
}

registerPrimitive("diagram", { schema: diagramBlockSchema, render: renderDiagram })
