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
   * Called once at the end of the render with every warning emitted during
   * the pass (an empty array when nothing degraded). Observation only — the
   * host decides what to do with it; the renderer never throws on its behalf.
   *
   * Receives a copy: mutating it cannot corrupt the array returned alongside
   * the html.
   */
  onWarning?: (warnings: string[]) => void
  /**
   * Throw when the pass emitted any warning, instead of returning.
   *
   * This gates the OUTPUT, which `strict` does not. `strict` gates the INPUT
   * and runs before any block renders, so it can never fire on a degradation —
   * and nearly every degradation here is a render-time one. The two options
   * are deliberately not merged: widening `strict` would change behavior for
   * every existing caller. When both are set, `strict` throws first.
   *
   * Counts lenient-validation diagnostics too (a dropped section is a
   * degradation). Filter the `[code]` prefix if you want render-time failures
   * only.
   */
  failOnWarning?: boolean
  /**
   * When false, no root wrapper is emitted — the consumer's own element is the
   * token-bearing `.exp` scope. Use this when styling tokens on a wrapper you
   * control (demo pages, design-system hosts); a nested default `.exp` would
   * otherwise re-declare default tokens and defeat wrapper overrides.
   */
  root?: boolean
  /** Host-supplied datasets for blocks carrying a `dataset` key. */
  datasets?: Record<string, unknown>
  /** Host-supplied image catalog for `image` blocks. */
  images?: Record<string, unknown>
}

export interface RenderResult {
  html: string
  warnings: string[]
}

/** Per-fragment bound on the thrown degradation message, matching the
 *  MathML parse-error bound already applied in src/primitives/derivation.ts.
 *  Message-only: a host inspecting `warnings` always gets the full text, so
 *  truncation can never hide a warning from the policy that matters. */
const MAX_WARNING_FRAGMENT = 120
/** Cap on fragments rendered before summarizing. Mirrors the compiler's habit
 *  of bounding warning payloads (MAX_SOURCES, MAX_IMAGES). */
const MAX_WARNING_FRAGMENTS = 10

/**
 * Render the message for a `failOnWarning` throw.
 *
 * Bounded because warnings embed model- and host-supplied text (a MathML parse
 * error, an image catalog key), and an unbounded join is a memory and log
 * hazard in exactly the CI context this option targets. Plain text in an
 * `Error` — never markup, so a hostile key cannot escape into rendered output.
 *
 * Shared by the string renderers and both React components so the four entry
 * points cannot drift in how they report a failure.
 */
export function formatDegradationError(warnings: string[]): string {
  const shown = warnings.slice(0, MAX_WARNING_FRAGMENTS)
  const parts = shown.map(w => (w.length > MAX_WARNING_FRAGMENT ? w.slice(0, MAX_WARNING_FRAGMENT) + "…" : w))
  const rest = warnings.length - shown.length
  const tail = rest > 0 ? `; … and ${rest} more` : ""
  return `Degradation policy: ${warnings.length} warning(s) — ${parts.join("; ")}${tail}`
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
    salvaged.blocks.map(b => renderSalvagedBlock(b, 1, warnings, opts.sketch ?? false, opts.datasets, opts.images)).join("")
  // Every block has rendered, so `warnings` is complete. Placed before both
  // return paths so opts.root: false is covered too. renderExplanation has no
  // early return for a broken top level (salvage always yields a shape), so a
  // single check here is sufficient — unlike renderDocument.
  if (opts.onWarning) opts.onWarning([...warnings])
  if (opts.failOnWarning && warnings.length > 0) {
    throw new Error(formatDegradationError(warnings))
  }
  if (opts.root === false) return { html: inner, warnings }
  return { html: `<div class="exp${themeClass}${opts.sketch ? " exp-sketch" : ""}">${inner}</div>`, warnings }
}

export function renderHeader(title: string | null, summary: string | null): string {
  let out = ""
  if (title) out += `<h3 class="exp-title">${renderInline(title)}</h3>`
  if (summary) out += `<p class="exp-summary">${renderInline(summary)}</p>`
  return out
}

/** Renders a single block by type; used by the React adapter. Warnings are
 *  discarded unless the caller supplies `opts.warnings` — the React components
 *  pass a per-render-pass array so a host can observe degradations, while a
 *  standalone caller that omits it keeps the original discard behavior. */
export function renderBlock(
  type: string,
  data: unknown,
  depth = 1,
  opts: { sketch?: boolean; datasets?: Record<string, unknown>; images?: Record<string, unknown>; warnings?: string[] } = {},
): string {
  const raw = typeof data === "object" && data !== null ? { ...(data as object), type } : { type }
  const diagnostics: Diagnostic[] = []
  const b = salvageBlock(raw, -1, diagnostics)
  return renderSalvagedBlock(b, depth, opts.warnings ?? [], opts.sketch ?? false, opts.datasets, opts.images)
}

// Exported for renderDocument (document spec §4): the document composer
// reuses this block renderer verbatim so fallback/stack/leniency stay in one
// implementation. Not part of the public surface beyond internal reuse.
export function renderSalvagedBlock(b: SalvagedBlock, depth: number, warnings: string[], sketch: boolean, datasets?: Record<string, unknown>, images?: Record<string, unknown>): string {
  if (b.kind === "invalid") return ""
  const entry = registry[b.type]
  if (b.kind === "unknown" || !entry) return renderFallback(b.type, b.data)
  const ctx: RenderContext = {
    depth,
    sketch,
    datasets,
    images,
    addWarning: m => warnings.push(m),
    renderChildren: (children, d) => renderChildrenLenient(children, d ?? depth + 1, warnings, sketch, datasets, images),
  }
  return entry.render(b.data as Block, ctx)
}

function renderChildrenLenient(children: unknown[], depth: number, warnings: string[], sketch: boolean, datasets?: Record<string, unknown>, images?: Record<string, unknown>): string {
  const diagnostics: Diagnostic[] = []
  const blocks = children.map((raw, i) => salvageBlock(raw, i, diagnostics))
  for (const d of diagnostics) warnings.push(`[${d.code}] ${d.message}`)
  return blocks.map(b => renderSalvagedBlock(b, depth, warnings, sketch, datasets, images)).join("")
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
