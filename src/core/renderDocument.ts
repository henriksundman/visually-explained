import { sectionAnchor, type DocumentSection } from "./documentSchema"
import { renderSalvagedBlock, formatDegradationError } from "./render"
import { salvageBlock, type Diagnostic } from "./salvage"
import { renderInline } from "./inline"

export interface RenderDocumentOptions {
  /** Throw instead of degrading when any document-level or section-level diagnostic exists. */
  strict?: boolean
  /** Theme class on the article root. Default "none". */
  theme?: "light" | "dark" | "none"
  /** Host-supplied datasets for blocks carrying a `dataset` key. */
  datasets?: Record<string, unknown>
  /** Host-supplied image catalog for `image` blocks. */
  images?: Record<string, unknown>
  /** Render the table of contents. Default true. */
  toc?: boolean
  /** Emit exp-doc-toc-inline to un-pin the TOC (themes default to sticky). Default false. */
  tocSticky?: boolean
  /** Hand-drawn (rough.js) stroke pass, passed through to every block. */
  sketch?: boolean
  /**
   * Called once at the end of the render with every warning emitted during
   * the pass (an empty array when nothing degraded). Observation only — the
   * host decides what to do with it. Receives a copy.
   *
   * Not fired for a broken top level, which returns before the body renders;
   * inspect the returned `warnings` for that case.
   */
  onWarning?: (warnings: string[]) => void
  /**
   * Throw when the pass emitted any warning, instead of returning.
   *
   * Gates the OUTPUT, which `strict` does not: `strict` gates the INPUT and
   * runs before any block renders, so it cannot fire on a degradation. Counts
   * lenient-validation diagnostics too (a dropped section is a degradation).
   * When both are set, `strict` throws first.
   */
  failOnWarning?: boolean
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

function renderSectionBlocks(rawBlocks: unknown[], warnings: string[], sketch: boolean, datasets?: Record<string, unknown>, images?: Record<string, unknown>): string {
  const diagnostics: Diagnostic[] = []
  const blocks = rawBlocks.map((raw, i) => salvageBlock(raw, i, diagnostics))
  for (const d of diagnostics) warnings.push(blockWarning(d))
  // render.ts's renderer owns invalid ("") / unknown (escaped fallback) /
  // valid (registry) dispatch and stack children — one implementation, no drift.
  return blocks.map(b => renderSalvagedBlock(b, 1, warnings, sketch, datasets, images)).join("")
}

function renderToc(sections: { title: string; anchor: string }[], tocSticky: boolean, warnings: string[]): string {
  const items = sections
    .map(s => `<li><a href="#${s.anchor}">${renderInline(s.title, { addWarning: m => warnings.push(m) })}</a></li>`)
    .join("")
  // Sticky comes from the theme (default); tocSticky: false adds the opt-out
  // class so the nav renders in normal flow instead of pinning.
  const cls = tocSticky ? "exp-doc-toc" : "exp-doc-toc exp-doc-toc-inline"
  return `<nav class="${cls}" aria-label="On this page"><ol class="exp-doc-toc-list">${items}</ol></nav>`
}

/** Document-level diagnostics, shared by renderDocument and the React
 *  <Document> so the two surfaces cannot drift on what counts as broken.
 *
 *  Exported for the React adapter (document parity spec §4), the same way
 *  renderSalvagedBlock is shared for block rendering. Note the `!rec ||` in
 *  every condition: a non-object IR is broken on all three counts, and an
 *  earlier React reimplementation guarded on `rec !== null` and so reported
 *  none of them.
 *
 *  Returns the warnings in order plus whether the top level is unusable. */
export function documentDiagnostics(input: unknown): { warnings: string[]; docBroken: boolean; rec: Record<string, unknown> | null; rawSections: unknown[] } {
  const rec = typeof input === "object" && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : null
  const warnings: string[] = []
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
  // Section-level pass. Skipped when the top level is already broken, matching
  // renderDocument: there are no sections to report on.
  const rawSections = docBroken ? [] : (rec!.sections as unknown[])
  rawSections.forEach((raw, i) => {
    if (!sectionOk(raw)) {
      warnings.push(`[invalid-section] section ${i}: dropped — title must be a non-empty string and blocks an array`)
    }
  })
  return { warnings, docBroken, rec, rawSections }
}

/** One section is usable iff it has a non-empty string title and a blocks
 *  array. Shared by both renderers' survivor filter and diagnostic pass. */
export function sectionOk(raw: unknown): raw is DocumentSection {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw) &&
    typeof (raw as Record<string, unknown>).title === "string" &&
    ((raw as Record<string, unknown>).title as string).length > 0 &&
    Array.isArray((raw as Record<string, unknown>).blocks)
}

export function renderDocument(input: unknown, opts: RenderDocumentOptions = {}): RenderDocumentResult {
  const theme = opts.theme ?? "none"
  const themeClass = theme === "none" ? "" : ` exp-theme-${theme}`
  const root = `<article class="exp exp-doc${themeClass}${opts.sketch ? " exp-sketch" : ""}">`

  const { warnings: docWarnings, docBroken, rec, rawSections } = documentDiagnostics(input)
  const warnings: string[] = [...docWarnings]

  const good = rawSections.filter(sectionOk)

  // Strict throws on document-level AND section-level diagnostics; lenient
  // degrades: broken top level to the empty shell, bad section alone dropped.
  if (opts.strict && warnings.length > 0) {
    throw new Error(`invalid document: ${warnings.join("; ")}`)
  }
  // Degradation policy, EARLY phase. Guarded on docBroken because the full
  // check runs at the end of the function; without this a broken top level
  // would hit the return below and hand back a silent empty shell — the most
  // total degradation the library can produce. After `strict` so a malformed
  // document reports validation rather than degradation.
  if (docBroken && opts.failOnWarning && warnings.length > 0) {
    throw new Error(formatDegradationError(warnings))
  }
  if (docBroken) {
    return { html: `${root}</article>`, warnings }
  }

  // Anchors over the survivors, in survivor order: a dropped section never
  // leaves a hole or shifts a later fallback id.
  const { anchors } = collectAnchors(good)

  const toc =
    opts.toc !== false && good.length > 0
      ? renderToc(good.map((s, i) => ({ title: s.title, anchor: anchors[i] })), opts.tocSticky !== false, warnings)
      : ""
  const body = good
    .map((s, i) => {
      const blocksHtml = renderSectionBlocks(s.blocks, warnings, opts.sketch ?? false, opts.datasets, opts.images)
      return (
        `<section class="exp-doc-section" id="${anchors[i]}">` +
        `<h2 class="exp-doc-section-title">${renderInline(s.title, { addWarning: m => warnings.push(m) })}</h2>` +
        blocksHtml +
        `</section>`
      )
    })
    .join("")

  const title = rec!.title as string
  const summary = typeof rec!.summary === "string" && rec!.summary.length > 0 ? rec!.summary : null
  const header =
    `<header class="exp-doc-header">` +
    `<h1 class="exp-doc-title">${renderInline(title, { addWarning: m => warnings.push(m) })}</h1>` +
    (summary ? `<p class="exp-doc-summary">${renderInline(summary, { addWarning: m => warnings.push(m) })}</p>` : "") +
    `</header>`

  // Degradation policy, FINAL phase: every block has now rendered, so the
  // array is complete. Section diagnostics were pushed earlier, block warnings
  // during the body render above.
  if (opts.onWarning) opts.onWarning([...warnings])
  if (opts.failOnWarning && warnings.length > 0) {
    throw new Error(formatDegradationError(warnings))
  }

  return { html: root + header + toc + body + `</article>`, warnings }
}
