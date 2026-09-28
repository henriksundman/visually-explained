import { registerPrimitive, type RenderContext } from "../core/registry"
import { figureBlockSchema, type FigureBlock } from "../core/schema"
import { renderInline } from "../core/inline"
import {
  compileFigure,
  parseFigureElement,
  type AuthoredFigure,
  type DerivedSpec,
  type FigureEl,
  type FigureSpec,
} from "../figures/authored"
import { hashSeed } from "../figures/seed"
import { sceneToSvg } from "../figures/svg"

const MAX_TOTAL_ELEMENTS = 200

function dedupeNames<T extends { name: string }>(
  items: T[] | undefined,
  warnings: string[],
  what: string,
): T[] | undefined {
  if (!items) return undefined
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of items) {
    if (seen.has(item.name)) {
      warnings.push(`figure-${what}-duplicate: "${item.name}" is defined more than once; later definition dropped`)
      continue
    }
    seen.add(item.name)
    out.push(item)
  }
  return out
}

/** Builds the authored figure from the lenient schema output: elements are
 *  parsed one-by-one so a malformed element drops alone (spec §Salvage). */
function buildAuthored(block: FigureBlock, warnings: string[]): AuthoredFigure {
  const elements: FigureEl[] = []
  for (const raw of block.elements) {
    if (elements.length >= MAX_TOTAL_ELEMENTS) {
      warnings.push(`figure-too-many-elements: more than ${MAX_TOTAL_ELEMENTS} elements; excess dropped`)
      break
    }
    const el = parseFigureElement(raw, m => warnings.push(m))
    if (el) elements.push(el)
  }
  return {
    title: block.title,
    caption: block.caption,
    width: block.width,
    height: block.height,
    params: dedupeNames(block.params as FigureSpec[] | undefined, warnings, "param"),
    derived: dedupeNames(block.derived as DerivedSpec[] | undefined, warnings, "derived"),
    elements,
  }
}

export function renderFigure(block: FigureBlock, ctx: RenderContext): string {
  const warnings: string[] = []
  const authored = buildAuthored(block, warnings)
  const { scene, warnings: compileWarnings } = compileFigure(authored)
  warnings.push(...compileWarnings)
  for (const w of warnings) ctx.addWarning(w)

  const header = block.title ? `<h4 class="exp-fig-title">${renderInline(block.title)}</h4>` : ""
  const caption = block.caption ? `<p class="exp-fig-caption">${renderInline(block.caption)}</p>` : ""
  const aria = block.title ?? block.caption ?? "Authored figure"
  const body =
    scene.elements.length > 0
      ? sceneToSvg(scene, {
          ariaLabel: aria,
          sketch: ctx.sketch,
          seed: block.id ?? hashSeed(`${block.title ?? ""}|${block.caption ?? ""}|${block.elements.length}`),
        })
      : `<p class="exp-fig-empty">Figure could not be drawn.</p>`
  return `<div class="exp-block exp-figure">${header}${body}${caption}</div>`
}

registerPrimitive("figure", { schema: figureBlockSchema, render: renderFigure })
