// The comparison engine. `katex` is a devDependency and this file lives in the
// demo, so it is never reachable from a shipped path — see spec §5.
import katex from "katex"
import temml from "temml"

/** KaTeX with trust disabled. Note the divergence from Temml: KaTeX renders
 *  \href and \url *inertly* rather than rejecting them, so "safe" here means
 *  "produced no navigable output", not "threw". */
export function renderWithKaTeX(tex) {
  try {
    return katex.renderToString(tex, { throwOnError: true, trust: false, displayMode: false })
  } catch (e) {
    return { error: String(e.message).split("\n")[0].slice(0, 120) }
  }
}

export function renderWithTemml(tex) {
  try {
    return temml.renderToString(tex, { throwOnError: true, displayMode: false })
  } catch (e) {
    return { error: String(e.message).split("\n")[0].slice(0, 120) }
  }
}
