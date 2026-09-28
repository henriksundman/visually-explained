import "./registerAll"
import { registry, type RenderContext } from "./registry"
import { salvageExplanation, salvageBlock, type Diagnostic, type SalvagedBlock } from "./salvage"
import { escapeHtml, renderInline } from "./inline"
import type { Block } from "./schema"

export interface RenderOptions {
  /** Throw instead of degrading when the top level is invalid. Nested stack children are always rendered leniently. */
  strict?: boolean
  /** Theme class to put on the root element. Core defaults to "none" (unstyled root); the React adapter defaults to "light". */
  theme?: "light" | "dark" | "none"
  /** Hand-drawn (rough.js) stroke pass on every figure. */
  sketch?: boolean
  /**
   * When false, no root wrapper is emitted — the consumer's own element is the
   * token-bearing `.exp` scope. Use this when styling tokens on a wrapper you
   * control (demo pages, design-system hosts); a nested default `.exp` would
   * otherwise re-declare default tokens and defeat wrapper overrides.
   */
  root?: boolean
}

export interface RenderResult {
  html: string
  warnings: string[]
}

export function renderExplanation(input: unknown, opts: RenderOptions = {}): RenderResult {
  const salvaged = salvageExplanation(input)
  if (opts.strict && salvaged.diagnostics.length > 0) {
    throw new Error(`invalid explanation: ${salvaged.warnings.join("; ")}`)
  }
  const warnings: string[] = [...salvaged.warnings]
  const theme = opts.theme ?? "none"
  const themeClass = theme === "none" ? "" : ` exp-theme-${theme}`
  const inner =
    renderHeader(salvaged.title, salvaged.summary) +
    salvaged.blocks.map(b => renderSalvagedBlock(b, 1, warnings, opts.sketch ?? false)).join("")
  if (opts.root === false) return { html: inner, warnings }
  return { html: `<div class="exp${themeClass}${opts.sketch ? " exp-sketch" : ""}">${inner}</div>`, warnings }
}

export function renderHeader(title: string | null, summary: string | null): string {
  let out = ""
  if (title) out += `<h3 class="exp-title">${renderInline(title)}</h3>`
  if (summary) out += `<p class="exp-summary">${renderInline(summary)}</p>`
  return out
}

/** Renders a single block by type; used by the React adapter. Warnings are discarded. */
export function renderBlock(type: string, data: unknown, depth = 1, opts: { sketch?: boolean } = {}): string {
  const raw = typeof data === "object" && data !== null ? { ...(data as object), type } : { type }
  const diagnostics: Diagnostic[] = []
  const b = salvageBlock(raw, -1, diagnostics)
  return renderSalvagedBlock(b, depth, [], opts.sketch ?? false)
}

function renderSalvagedBlock(b: SalvagedBlock, depth: number, warnings: string[], sketch: boolean): string {
  if (b.kind === "invalid") return ""
  const entry = registry[b.type]
  if (b.kind === "unknown" || !entry) return renderFallback(b.type, b.data)
  const ctx: RenderContext = {
    depth,
    sketch,
    addWarning: m => warnings.push(m),
    renderChildren: (children, d) => renderChildrenLenient(children, d ?? depth + 1, warnings, sketch),
  }
  return entry.render(b.data as Block, ctx)
}

function renderChildrenLenient(children: unknown[], depth: number, warnings: string[], sketch: boolean): string {
  const diagnostics: Diagnostic[] = []
  const blocks = children.map((raw, i) => salvageBlock(raw, i, diagnostics))
  for (const d of diagnostics) warnings.push(`[${d.code}] ${d.message}`)
  return blocks.map(b => renderSalvagedBlock(b, depth, warnings, sketch)).join("")
}

function renderFallback(type: string, data: unknown): string {
  const d = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {}
  const label = typeof d.title === "string" ? d.title : typeof d.body === "string" ? d.body : null
  return (
    `<div class="exp-block exp-fallback">` +
    `<span class="exp-fallback-label">${escapeHtml(type)}</span>` +
    (label ? `<p class="exp-fallback-body">${renderInline(label)}</p>` : "") +
    `</div>`
  )
}
