import { sectionAnchor, type DocumentSection } from "./documentSchema"
import { renderSalvagedBlock } from "./render"
import { salvageBlock, type Diagnostic } from "./salvage"
import { renderInline } from "./inline"

export interface RenderDocumentOptions {
  /** Throw instead of degrading when any document-level or section-level diagnostic exists. */
  strict?: boolean
  /** Theme class on the article root. Default "none". */
  theme?: "light" | "dark" | "none"
  /** Hand-drawn (rough.js) stroke pass, passed through to every block. */
  sketch?: boolean
  /** Host-supplied datasets for blocks carrying a `dataset` key. */
  datasets?: Record<string, unknown>
  /** Render the table of contents. Default true. */
  toc?: boolean
  /** Emit exp-doc-toc-inline to un-pin the TOC (themes default to sticky). Default false. */
  tocSticky?: boolean
}

export interface RenderDocumentResult {
  html: string
  warnings: string[]
}

/** Anchor ids for sections in document order (shared with the React layer):
 *  computed over the sections given, first wins, later collisions get
 *  -2/-3 … via sectionAnchor's taken set. */
export function collectAnchors(sections: DocumentSection[]): { anchors: string[]; taken: Set<string> } {
  const taken = new Set<string>()
  const anchors = sections.map((s, i) => {
    const id = sectionAnchor(s, i, taken)
    taken.add(id)
    return id
  })
  return { anchors, taken }
}

function blockWarning(d: Diagnostic): string {
  return `[${d.code}] ${d.message}`
}

function renderSectionBlocks(rawBlocks: unknown[], warnings: string[], sketch: boolean, datasets?: Record<string, unknown>): string {
  const diagnostics: Diagnostic[] = []
  const blocks = rawBlocks.map((raw, i) => salvageBlock(raw, i, diagnostics))
  for (const d of diagnostics) warnings.push(blockWarning(d))
  // render.ts's renderer owns invalid ("") / unknown (escaped fallback) /
  // valid (registry) dispatch and stack children — one implementation, no drift.
  return blocks.map(b => renderSalvagedBlock(b, 1, warnings, sketch, datasets)).join("")
}

function renderToc(sections: { title: string; anchor: string }[], tocSticky: boolean): string {
  const items = sections
    .map(s => `<li><a href="#${s.anchor}">${renderInline(s.title)}</a></li>`)
    .join("")
  // Sticky comes from the theme (default); tocSticky: false adds the opt-out
  // class so the nav renders in normal flow instead of pinning.
  const cls = tocSticky ? "exp-doc-toc" : "exp-doc-toc exp-doc-toc-inline"
  return `<nav class="${cls}" aria-label="On this page"><ol class="exp-doc-toc-list">${items}</ol></nav>`
}

export function renderDocument(input: unknown, opts: RenderDocumentOptions = {}): RenderDocumentResult {
  const warnings: string[] = []
  const theme = opts.theme ?? "none"
  const themeClass = theme === "none" ? "" : ` exp-theme-${theme}`
  const root = `<article class="exp exp-doc${themeClass}${opts.sketch ? " exp-sketch" : ""}">`

  const rec = typeof input === "object" && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : null
  let docBroken = false
  if (!rec || rec.version !== 1) {
    warnings.push("[wrong-version] expected version 1, got " + JSON.stringify(rec?.version ?? null))
    docBroken = true
  }
  if (!rec || typeof rec.title !== "string" || rec.title.length === 0) {
    warnings.push("[invalid-document] title must be a non-empty string")
    docBroken = true
  }
  if (!rec || !Array.isArray(rec.sections) || rec.sections.length === 0) {
    warnings.push("[invalid-document] sections must be a non-empty array")
    docBroken = true
  }

  const rawSections = docBroken ? [] : (rec!.sections as unknown[])
  const sectionOk = (raw: unknown): raw is DocumentSection =>
    typeof raw === "object" && raw !== null && !Array.isArray(raw) &&
    typeof (raw as Record<string, unknown>).title === "string" &&
    ((raw as Record<string, unknown>).title as string).length > 0 &&
    Array.isArray((raw as Record<string, unknown>).blocks)
  const good = rawSections.filter(sectionOk)
  for (let i = 0; i < rawSections.length; i++) {
    if (!sectionOk(rawSections[i])) {
      warnings.push(`[invalid-section] section ${i}: dropped — title must be a non-empty string and blocks an array`)
    }
  }

  // Strict throws on document-level AND section-level diagnostics; lenient
  // degrades: broken top level to the empty shell, bad section alone dropped.
  if (opts.strict && warnings.length > 0) {
    throw new Error(`invalid document: ${warnings.join("; ")}`)
  }
  if (docBroken) {
    return { html: `${root}</article>`, warnings }
  }

  // Anchors over the survivors, in survivor order: a dropped section never
  // leaves a hole or shifts a later fallback id.
  const { anchors } = collectAnchors(good)

  const toc =
    opts.toc !== false && good.length > 0
      ? renderToc(good.map((s, i) => ({ title: s.title, anchor: anchors[i] })), opts.tocSticky !== false)
      : ""
  const body = good
    .map((s, i) => {
      const blocksHtml = renderSectionBlocks(s.blocks, warnings, opts.sketch ?? false, opts.datasets)
      return (
        `<section class="exp-doc-section" id="${anchors[i]}">` +
        `<h2 class="exp-doc-section-title">${renderInline(s.title)}</h2>` +
        blocksHtml +
        `</section>`
      )
    })
    .join("")

  const title = rec!.title as string
  const summary = typeof rec!.summary === "string" && rec!.summary.length > 0 ? rec!.summary : null
  const header =
    `<header class="exp-doc-header">` +
    `<h1 class="exp-doc-title">${renderInline(title)}</h1>` +
    (summary ? `<p class="exp-doc-summary">${renderInline(summary)}</p>` : "") +
    `</header>`

  return { html: root + header + toc + body + `</article>`, warnings }
}
