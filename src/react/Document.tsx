import type { FC } from "react"
import { renderBlock } from "../core/render"
import { renderInline } from "../core/inline"
import { collectAnchors } from "../core/renderDocument"
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
}

/**
 * Server component (no hooks, no client JS). Renders the same skeleton as
 * renderDocument: header, derived TOC, flat h2 sections whose blocks reuse
 * the existing block pipeline. Block HTML is library-generated markup via
 * renderBlock (model text only ever passes through renderInline), matching
 * the Explanation component's pattern.
 */
export const Document: FC<DocumentProps> = ({ ir, theme = "light", strict, toc = true, tocSticky = true, sketch = false, datasets }) => {
  if (strict) {
    const v = validateDocument(ir)
    if (!v.ok) throw new Error(`invalid document: ${v.diagnostics.map(d => d.message).join("; ")}`)
  }
  const rec = typeof ir === "object" && ir !== null && !Array.isArray(ir) ? (ir as Record<string, unknown>) : null
  const title = typeof rec?.title === "string" && rec.title.length > 0 ? rec.title : null
  const summary = typeof rec?.summary === "string" && rec.summary.length > 0 ? rec.summary : null
  const rawSections = Array.isArray(rec?.sections) ? (rec!.sections as unknown[]) : []
  const sections = rawSections.filter(
    (raw): raw is DocumentSection =>
      typeof raw === "object" && raw !== null && !Array.isArray(raw) &&
      typeof (raw as Record<string, unknown>).title === "string" &&
      ((raw as Record<string, unknown>).title as string).length > 0 &&
      Array.isArray((raw as Record<string, unknown>).blocks),
  )

  // Anchor assignment mirrors renderDocument exactly: collectAnchors runs
  // over the SURVIVORS in survivor order (a dropped section never shifts a
  // later section's fallback index), using the shared helper so HTML and
  // React cannot drift (parity is test-enforced in document-react.test.tsx).
  const { anchors } = collectAnchors(sections)

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
      {sections.map((s, i) => (
        <section key={anchors[i]} className="exp-doc-section" id={anchors[i]}>
          <h2 className="exp-doc-section-title" dangerouslySetInnerHTML={{ __html: renderInline(s.title) }} />
          {(s.blocks as unknown[]).map((raw, bi) => {
            const type =
              typeof (raw as Record<string, unknown>)?.type === "string"
                ? ((raw as Record<string, unknown>).type as string)
                : ""
            return <div key={bi} dangerouslySetInnerHTML={{ __html: renderBlock(type, raw, 1, { sketch, datasets }) }} />
          })}
        </section>
      ))}
    </article>
  )
}
