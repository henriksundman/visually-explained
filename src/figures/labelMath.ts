import { plausibleDollarMath } from "../core/inline"

/** TeX-to-plain mapping for SVG-drawn text (host report: math-bearing labels
 *  in figures drew literal `\\(x - 3 = 5\\)` — SVG text has no MathML surface,
 *  and foreignObject/MathML positioning is out of scope by contract).
 *
 *  The contract, from the consumer agreement:
 *  - `\\(…\\)` spans render as readable plain text: delimiters stripped, the
 *    inner TeX mapped through a small unicode table (`\\times` → ×, `\\le` →
 *    ≤, `\\frac{a}{b}` → a/b, `^{}`/`_{}` flattened with the marker kept).
 *  - `$…$` spans pass the SAME plausibility gate `extractMath` uses (shared
 *    via core/inline) before stripping, so currency prose ("Costs $5 and
 *    returns $10") stays verbatim; a rejected pair is also rewound one char,
 *    mirroring extractMath, so a later real pair still strips.
 *  - Unknown commands degrade: backslash dropped, name kept; group braces are
 *    flattened; an unclosed delimiter passes through untouched.
 *  - A label with no delimiters passes through BYTE-IDENTICAL — verbatim
 *    labels are relied on today, so the fast path is load-bearing.
 *
 *  NOT touched: renderInline / extractMath / renderMath / popovers / text-mode
 *  list rendering — those have a MathML surface and render real math; the
 *  scope pin in mind-map.test.ts guards that boundary. */

/** Unicode for commands whose plain rendering is obvious. `\\min`/`\\max` are
 *  deliberately NOT here: their names are the rendering, which the unknown
 *  fallback already yields. `\\left`/`\\right` map to "" — the delimiter that
 *  follows them survives as the literal character. */
const TEX_TEXT: Record<string, string> = {
  times: "×",
  div: "÷",
  cdot: "·",
  pm: "±",
  mp: "∓",
  leq: "≤",
  le: "≤",
  geq: "≥",
  ge: "≥",
  neq: "≠",
  ne: "≠",
  equiv: "≡",
  approx: "≈",
  propto: "∝",
  to: "→",
  rightarrow: "→",
  leftarrow: "←",
  Rightarrow: "⇒",
  Leftarrow: "⇐",
  mapsto: "↦",
  cdots: "⋯",
  ldots: "…",
  dots: "…",
  vdots: "⋮",
  infty: "∞",
  in: "∈",
  notin: "∉",
  subset: "⊂",
  supset: "⊃",
  cup: "∪",
  cap: "∩",
  emptyset: "∅",
  forall: "∀",
  exists: "∃",
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ε",
  zeta: "ζ",
  eta: "η",
  theta: "θ",
  iota: "ι",
  kappa: "κ",
  lambda: "λ",
  mu: "μ",
  nu: "ν",
  xi: "ξ",
  pi: "π",
  rho: "ρ",
  sigma: "σ",
  tau: "τ",
  upsilon: "υ",
  phi: "φ",
  chi: "χ",
  psi: "ψ",
  omega: "ω",
  Gamma: "Γ",
  Delta: "Δ",
  Theta: "Θ",
  Lambda: "Λ",
  Xi: "Ξ",
  Pi: "Π",
  Sigma: "Σ",
  Phi: "Φ",
  Psi: "Ψ",
  Omega: "Ω",
  degree: "°",
  circ: "∘",
  left: "",
  right: "",
}

/** `\text`-family: the group content is prose, emitted verbatim (no mapping
 *  inside, no marker flattening) rather than glued to the command name. */
const TEXT_LIKE = new Set(["text", "mathrm", "mathit", "operatorname", "mbox"])

/** Reads one TeX argument at `i`: a `{…}` group (braces flattened by the
 *  caller's group stripping — we return the INNER span) or a single character.
 *  Returns the content and the index just past it; `null` when nothing is
 *  there (malformed `\\frac` falls back to the name). */
function groupAt(tex: string, i: number): { content: string; next: number } | null {
  if (i >= tex.length) return null
  if (tex[i] === "{") {
    let depth = 1
    for (let j = i + 1; j < tex.length; j++) {
      if (tex[j] === "{") depth++
      else if (tex[j] === "}") {
        depth--
        if (depth === 0) return { content: tex.slice(i + 1, j), next: j + 1 }
      }
    }
    return null // unclosed group: fallback, caller keeps the name
  }
  return { content: tex[i]!, next: i + 1 }
}

/** Map the INNER content of one math span to plain text. Pure: no delimiter
 *  logic here, only TeX-command flattening. */
function texToPlain(tex: string): string {
  let out = ""
  let i = 0
  while (i < tex.length) {
    const ch = tex[i]!
    if (ch === "\\") {
      const next = tex[i + 1]
      if (next === undefined) break
      // Escaped punctuation (`\\{`, `\\$`, `\\&`, …) is the literal char;
      // `\\\\` is a TeX line break → space. Spacing commands (\\, \\; \\: \\!)
      // are thin spaces.
      if (!/[A-Za-z]/.test(next)) {
        if (next === "\\") out += " "
        else if (",;:! ".includes(next)) out += " "
        else out += next
        i += 2
        continue
      }
      const name = /^[A-Za-z]+/.exec(tex.slice(i + 1))![0]
      let j = i + 1 + name.length
      if (TEXT_LIKE.has(name)) {
        const g = groupAt(tex, j)
        if (g) {
          out += texToPlain(g.content) // group content is prose: recurse
          i = g.next
          continue
        }
      }
      if (name === "frac") {
        const num = groupAt(tex, j)
        if (num) {
          const den = groupAt(tex, num.next)
          if (den) {
            out += `${texToPlain(num.content)}/${texToPlain(den.content)}`
            i = den.next
            continue
          }
        }
      }
      out += TEX_TEXT[name] ?? name
      // The space after a command name is TeX's terminator, not content: keep
      // one space in the output (`\\alpha b` → "α b", `\\min_{x} f` → "min_x f").
      if (tex[j] === " ") {
        out += " "
        j++
      }
      i = j
      continue
    }
    if (ch === "{" || ch === "}") {
      i++
      continue
    }
    out += ch
    i++
  }
  return out
}

/** The SVG emit layer's label filter. See the module comment for the contract. */
export function plainMathLabel(text: string): string {
  if (!text.includes("\\(") && !text.includes("$")) return text
  let out = ""
  let i = 0
  while (i < text.length) {
    if (text.startsWith("\\(", i)) {
      const close = text.indexOf("\\)", i + 2)
      if (close === -1) {
        out += text[i]
        i++
        continue
      }
      out += texToPlain(text.slice(i + 2, close))
      i = close + 2
      continue
    }
    if (text[i] === "$") {
      const nl = text.indexOf("\n", i + 1)
      let close = text.indexOf("$", i + 1)
      if (nl !== -1 && (close === -1 || nl < close)) close = -1 // $ never spans a line
      if (close === -1) {
        out += text[i]
        i++
        continue
      }
      const content = text.slice(i + 1, close)
      const after = text[close + 1]
      const gate =
        !(after !== undefined && after >= "0" && after <= "9") && plausibleDollarMath(content)
      if (!gate) {
        out += text[i] // rewind one char, mirroring extractMath's resume rule
        i++
        continue
      }
      out += texToPlain(content)
      i = close + 1
      continue
    }
    out += text[i]
    i++
  }
  return out
}
