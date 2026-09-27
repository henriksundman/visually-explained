import { registerPrimitive, type RenderContext } from "../core/registry"
import { comparisonBlockSchema, type ComparisonBlock } from "../core/schema"
import { renderInline } from "../core/inline"

export function renderComparison(block: ComparisonBlock, ctx: RenderContext): string {
  const n = block.items.length
  const headCells = block.items.map(i => `<th class="exp-th">${renderInline(i.name)}</th>`).join("")
  const rows = block.dimensions
    .map(dim => {
      let values = dim.values
      if (values.length < n) {
        ctx.addWarning(
          `[comparison-value-count] dimension "${dim.name}" has ${values.length} values for ${n} items; padded`,
        )
        values = [...values, ...Array<string>(n - values.length).fill("")]
      } else if (values.length > n) {
        ctx.addWarning(
          `[comparison-value-count] dimension "${dim.name}" has ${values.length} values for ${n} items; truncated`,
        )
        values = values.slice(0, n)
      }
      const cells = values.map(v => `<td class="exp-td">${renderInline(v)}</td>`).join("")
      return `<tr><th class="exp-th exp-row-th">${renderInline(dim.name)}</th>${cells}</tr>`
    })
    .join("")
  return (
    `<div class="exp-block exp-comparison">` +
    `<table class="exp-table">` +
    `<thead><tr><th class="exp-th exp-corner"></th>${headCells}</tr></thead>` +
    `<tbody>${rows}</tbody>` +
    `</table></div>`
  )
}

registerPrimitive("comparison", { schema: comparisonBlockSchema, render: renderComparison })
