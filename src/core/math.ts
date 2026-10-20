import temml from "temml"

/**
 * Render TeX to inline HTML for `derivation` expressions and conclusions
 * (math spec §4).
 *
 * Internal by design: not re-exported from `src/index.ts`. An exported raw TeX
 * renderer would hand hosts a throwing, unguarded HTML emitter outside the
 * leniency wrapper, and would export our engine choice into their upgrade path
 * (MathML needs no assets; KaTeX needs 60 font files).
 *
 * Throws `MathParseError` on invalid TeX. Degradation belongs to the caller
 * (spec §7) — never return engine error markup, because the two engines
 * degrade differently and that difference would leak into themed output.
 *
 * Safe by construction: Temml implements none of `\href`, `\url`,
 * `\includegraphics`, `\htmlClass` or `\htmlId`, so model-authored TeX cannot
 * produce a link, URL, image, or script. Pinned per construct in
 * `tests/math.test.ts` — re-run that suite before trusting any engine upgrade.
 */
export function renderMath(tex: string): string {
  return temml.renderToString(tex, { throwOnError: true, displayMode: false })
}

/** The parse failure `renderMath` throws, re-exported so callers can narrow
 *  without importing temml themselves. */
export const MathParseError = temml.ParseError

/** The prose fingerprint (host follow-up 4, 2026-10-20): a whole-field TeX
 *  candidate is prose when its render leaves the distinctive shape prose
 *  always makes — many real words in the source AND many single-letter
 *  identifiers in the output. Promoted from tests/derivation-tex-hygiene's
 *  `looksLikeProse` (which shipped first and only ever saw demo fixtures), so
 *  the renderer and the sweep consult one definition and cannot disagree.
 *
 *  Words are PURE alphabetic tokens (optionally followed by punctuation):
 *  `\frac{`, `m_1`, `x^2` are not words, so formula-heavy TeX can never
 *  gather the four words it needs — the guard the first sweep's substring
 *  regex did not need but a renderer-side decision now does. Thresholds are
 *  the sweep's original ones: prose is verbose, formulas are not. */
export function looksLikeProse(tex: string, rendered: string): boolean {
  const words = tex.split(/\s+/).filter((w) => /^[A-Za-z]{3,}[.,;:!?"'“”’]*$/.test(w)).length
  const singleLetterMi = (rendered.match(/<mi>[a-zA-Z]<\/mi>/g) ?? []).length
  return words >= 4 && singleLetterMi >= 8
}
