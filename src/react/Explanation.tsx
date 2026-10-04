import type { FC } from "react"
import { salvageExplanation } from "../core/salvage"
import { renderBlock, formatDegradationError } from "../core/render"
import { renderInline } from "../core/inline"
import { validateExplanation } from "../core/validate"
import { InteractiveFigure } from "./InteractiveFigure"
import { Quiz } from "./Quiz"
import { FigureEvents } from "./ElementPopover"
import type { FigureElementEvent } from "./figureEvents"
import type { Block } from "../core/schema"
import "../themes/tokens.css"
import "../themes/light.css"
import "../themes/dark.css"

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
export type ExplanationComponent = FC<{ block: any }>

export interface ExplanationProps {
  ir: unknown
  theme?: "light" | "dark" | "none"
  /** Swap in a custom React renderer for any registered block type. */
  components?: { [type: string]: ExplanationComponent | undefined }
  /** Throw when the top level is invalid instead of rendering leniently. */
  strict?: boolean
  /** Hand-drawn (rough.js) stroke pass on every figure. */
  sketch?: boolean
  /** Host-supplied datasets for blocks carrying a `dataset` key. */
  datasets?: Record<string, unknown>
  /** Host-supplied image catalog for `image` blocks. */
  images?: Record<string, unknown>
  /** Route figure blocks to the interactive runtime (sliders + play).
   *  Default false — keeps this component RSC-safe. */
  interactive?: boolean
  /** Delegate hover/click events for identified figure elements. Presence
   *  routes figure/diagram/chart/mind-map blocks through a small client
   *  wrapper; default undefined keeps this component RSC-safe.
   *
   *  mind-map participates for pointer events alone: every node already
   *  carries a `data-el-id`, but `wrapIdentity` only emits `tabindex` for an
   *  element with a `tip`, so a node without one is reachable by pointer and
   *  not by keyboard. Give a node a `tip` and it gets the popover and the
   *  keyboard path with it. */
  onElementEvent?: (e: FigureElementEvent) => void
  /**
   * Called once at the end of the render pass with every warning emitted
   * (an empty array when nothing degraded). Observation only; receives a copy.
   *
   * Before this existed a React host had no way to see a degradation at all:
   * renderBlock discarded its warnings, so a missing image catalog entry or
   * unparseable TeX rendered its fallback in total silence.
   *
   * Dev caveat: React StrictMode double-invokes renders, so the same set may
   * arrive twice in development. Dedupe by set membership, or rely on
   * failOnWarning. Not fixable here — this is a server component with no
   * render-scoped instance to dedupe against, and module-level state would
   * leak across requests.
   */
  onWarning?: (warnings: string[]) => void
  /**
   * Throw when the pass emitted any warning. Gates the OUTPUT, which `strict`
   * does not: `strict` gates the INPUT and runs first.
   */
  failOnWarning?: boolean
}

function themeClassName(theme: "light" | "dark" | "none"): string {
  return theme === "none" ? "exp" : `exp exp-theme-${theme}`
}

/**
 * Server component (no hooks, no client JS). Safe in Next.js RSC.
 * Custom components receive the parsed block payload.
 */
export function Explanation({
  ir,
  theme = "light",
  components,
  strict,
  sketch,
  datasets,
  images,
  interactive,
  onElementEvent,
  onWarning,
  failOnWarning,
}: ExplanationProps) {
  if (strict) {
    const v = validateExplanation(ir)
    if (!v.ok) {
      throw new Error(`invalid explanation: ${v.diagnostics.map(d => d.message).join("; ")}`)
    }
  }
  const salvaged = salvageExplanation(ir)
  // Collected per render pass into a plain local and threaded through
  // renderBlock -- a hook here would make this a client component. Seeded from
  // salvage so the set matches what renderExplanation reports for the same IR
  // (that parity is test-locked). The `strict` check above already threw, so a
  // validation failure is reported before any degradation policy applies.
  const warnings: string[] = [...salvaged.warnings]
  const blockOpts = { sketch, datasets, images, warnings }

  // Built BEFORE the policy check: renderBlock populates `warnings` as a
  // side effect of this map, so checking first would always see an empty
  // array and never throw.
  const body = salvaged.blocks.map(b => {
    if (b.kind === "invalid") return null
    const Custom = components?.[b.type]
    if (Custom && b.kind === "valid") {
      return <Custom key={b.index} block={b.data as Block} />
    }
    if (interactive && b.kind === "valid" && b.type === "figure") {
      return <InteractiveFigure key={b.index} block={b.data} sketch={sketch} />
    }
    if (interactive && b.kind === "valid" && b.type === "quiz") {
      return <Quiz key={b.index} block={b.data} />
    }
    if (onElementEvent && b.kind === "valid" && (b.type === "figure" || b.type === "diagram" || b.type === "chart" || b.type === "mind-map")) {
      const html = renderBlock(b.type, b.data, 1, blockOpts)
      return <FigureEvents key={b.index} html={html} onEvent={onElementEvent} />
    }
    return <div key={b.index} dangerouslySetInnerHTML={{ __html: renderBlock(b.type, b.data, 1, blockOpts) }} />
  })

  // Also built BEFORE the policy check, for the same reason as `body`: a title
  // or summary carrying unparseable inline math reports its degradation here,
  // and rendering it afterwards would report the array without it.
  const warnCtx = { addWarning: (m: string) => warnings.push(m) }
  const titleHtml = salvaged.title ? renderInline(salvaged.title, warnCtx) : null
  const summaryHtml = salvaged.summary ? renderInline(salvaged.summary, warnCtx) : null

  if (onWarning) onWarning([...warnings])
  if (failOnWarning && warnings.length > 0) {
    throw new Error(formatDegradationError(warnings))
  }

  return (
    <div className={themeClassName(theme) + (sketch ? " exp-sketch" : "")}>
      {titleHtml && (
        <h3 className="exp-title" dangerouslySetInnerHTML={{ __html: titleHtml }} />
      )}
      {summaryHtml && (
        <p className="exp-summary" dangerouslySetInnerHTML={{ __html: summaryHtml }} />
      )}
      {body}
    </div>
  )
}
