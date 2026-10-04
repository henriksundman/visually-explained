import type { FC } from "react"
import { renderBlock, formatDegradationError } from "../core/render"
import { renderInline } from "../core/inline"
import { collectAnchors, documentDiagnostics, sectionOk } from "../core/renderDocument"
import { validateDocument } from "../core/documentValidate"
import type { DocumentSection } from "../core/documentSchema"

export interface DocumentProps {
  ir: unknown
  theme?: "light" | "dark" | "none"
  /** Throw when the top level or any section is invalid instead of degrading. */
  strict?: boolean
  /** Render the table of contents. Default true. */
  toc?: boolean
  /** Emit exp-doc-toc-inline to un-pin the TOC (themes default to sticky). Default false. */
  tocSticky?: boolean
  /** Hand-drawn (rough.js) stroke pass, matching renderDocument's option. */
  sketch?: boolean
  /** Host-supplied datasets for blocks carrying a `dataset` key. */
  datasets?: Record<string, unknown>
  /** Host-supplied image catalog for `image` blocks. */
  images?: Record<string, unknown>
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
   * failOnWarning. Not fixable here -- this is a server component with no
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

/**
 * Server component (no hooks, no client JS). Renders the same skeleton as
 * renderDocument: header, derived TOC, flat h2 sections whose blocks reuse
 * the existing block pipeline. Block HTML is library-generated markup via
 * renderBlock (model text only ever passes through renderInline), matching
 * the Explanation component's pattern.
 */
export const Document: FC<DocumentProps> = ({ ir, theme = "light", strict, toc = true, tocSticky = true, sketch = false, datasets, images, onWarning, failOnWarning }) => {
  if (strict) {
    const v = validateDocument(ir)
    if (!v.ok) throw new Error(`invalid document: ${v.diagnostics.map(d => d.message).join("; ")}`)
  }
  // Document-level diagnostics come from the shared helper so React and the
  // string renderer agree on what counts as broken -- an inline reimplementation
  // here already drifted once, reporting no warnings for a non-object IR where
  // renderDocument reports three.
  const { warnings, rec } = documentDiagnostics(ir)
  const title = typeof rec?.title === "string" && rec.title.length > 0 ? rec.title : null
  const summary = typeof rec?.summary === "string" && rec.summary.length > 0 ? rec.summary : null
  const rawSections = Array.isArray(rec?.sections) ? (rec!.sections as unknown[]) : []
  // Survivor filter uses the shared predicate, so the set of sections React
  // renders is the set renderDocument renders -- the two must not disagree.
  const sections = rawSections.filter(sectionOk)

  // Anchor assignment mirrors renderDocument exactly: collectAnchors runs
  // over the SURVIVORS in survivor order (a dropped section never shifts a
  // later section's fallback index), using the shared helper so HTML and
  // React cannot drift (parity is test-enforced in document-react.test.tsx).
  const { anchors } = collectAnchors(sections)

  // Block warnings are threaded through renderBlock into this same array --
  // a plain local per render pass, because a hook here would make this a
  // client component. The `strict` check above already threw, so a validation
  // failure is reported before any degradation policy applies.
  const blockOpts = { sketch, datasets, images, warnings }

  // Built BEFORE the policy check: renderBlock populates `warnings` as a side
  // effect of this map, so checking first would always see an empty array.
  const body = sections.map((s, i) => (
    <section key={anchors[i]} className="exp-doc-section" id={anchors[i]}>
      <h2 className="exp-doc-section-title" dangerouslySetInnerHTML={{ __html: renderInline(s.title) }} />
      {(s.blocks as unknown[]).map((raw, bi) => {
        const type =
          typeof (raw as Record<string, unknown>)?.type === "string"
            ? ((raw as Record<string, unknown>).type as string)
            : ""
        return <div key={bi} dangerouslySetInnerHTML={{ __html: renderBlock(type, raw, 1, blockOpts) }} />
      })}
    </section>
  ))

  if (onWarning) onWarning([...warnings])
  if (failOnWarning && warnings.length > 0) {
    throw new Error(formatDegradationError(warnings))
  }

  const rootClass = `exp exp-doc${theme === "none" ? "" : ` exp-theme-${theme}`}${sketch ? " exp-sketch" : ""}`
  return (
    <article className={rootClass}>
      {title && (
        <header className="exp-doc-header">
          <h1 className="exp-doc-title" dangerouslySetInnerHTML={{ __html: renderInline(title) }} />
          {summary && <p className="exp-doc-summary" dangerouslySetInnerHTML={{ __html: renderInline(summary) }} />}
        </header>
      )}
      {toc && sections.length > 0 && (
        // Sticky comes from the theme (default); tocSticky: false adds the
        // opt-out class so the nav renders in normal flow instead of pinning.
        <nav className={tocSticky ? "exp-doc-toc" : "exp-doc-toc exp-doc-toc-inline"} aria-label="On this page">
          <ol className="exp-doc-toc-list">
            {sections.map((s, i) => (
              <li key={anchors[i]}>
                <a href={`#${anchors[i]}`} dangerouslySetInnerHTML={{ __html: renderInline(s.title) }} />
              </li>
            ))}
          </ol>
        </nav>
      )}
      {body}
    </article>
  )
}
