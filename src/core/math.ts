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
