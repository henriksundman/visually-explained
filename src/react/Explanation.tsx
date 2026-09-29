import type { FC } from "react"
import { salvageExplanation } from "../core/salvage"
import { renderBlock } from "../core/render"
import { renderInline } from "../core/inline"
import { validateExplanation } from "../core/validate"
import { InteractiveFigure } from "./InteractiveFigure"
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
  /** Route figure blocks to the interactive runtime (sliders + play).
   *  Default false — keeps this component RSC-safe. */
  interactive?: boolean
}

function themeClassName(theme: "light" | "dark" | "none"): string {
  return theme === "none" ? "exp" : `exp exp-theme-${theme}`
}

/**
 * Server component (no hooks, no client JS). Safe in Next.js RSC.
 * Custom components receive the parsed block payload.
 */
export function Explanation({ ir, theme = "light", components, strict, sketch, interactive }: ExplanationProps) {
  if (strict) {
    const v = validateExplanation(ir)
    if (!v.ok) {
      throw new Error(`invalid explanation: ${v.diagnostics.map(d => d.message).join("; ")}`)
    }
  }
  const salvaged = salvageExplanation(ir)
  return (
    <div className={themeClassName(theme) + (sketch ? " exp-sketch" : "")}>
      {salvaged.title && (
        <h3 className="exp-title" dangerouslySetInnerHTML={{ __html: renderInline(salvaged.title) }} />
      )}
      {salvaged.summary && (
        <p className="exp-summary" dangerouslySetInnerHTML={{ __html: renderInline(salvaged.summary) }} />
      )}
      {salvaged.blocks.map(b => {
        if (b.kind === "invalid") return null
        const Custom = components?.[b.type]
        if (Custom && b.kind === "valid") {
          return <Custom key={b.index} block={b.data as Block} />
        }
        if (interactive && b.kind === "valid" && b.type === "figure") {
          return <InteractiveFigure key={b.index} block={b.data} sketch={sketch} />
        }
        return <div key={b.index} dangerouslySetInnerHTML={{ __html: renderBlock(b.type, b.data, 1, { sketch }) }} />
      })}
    </div>
  )
}
