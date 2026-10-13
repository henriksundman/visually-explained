import { z } from "zod"

export const outlineVisualSchema = z.enum(["figure", "diagram", "chart"])
export const outlineSectionSchema = z.object({
  title: z.string().min(1),
  goal: z.string().min(1),
  visual: outlineVisualSchema.optional(),
  // Retrieval-check declaration (quiz-placement spec §3): the outline may
  // mark sections where a quiz consolidates the learning. Flag-gated: the
  // prompt only invites it when opts.checks is on, but the schema accepts it
  // unconditionally (zod leniency; undeclared quizzes are also allowed).
  check: z.boolean().optional(),
  // Host-catalog image this section wants (image spec §6). Flag-gated in the
  // prompt like `check`: the outline is only invited to set it when a catalog
  // exists, but the schema accepts it unconditionally (zod leniency).
  image: z.string().min(1).optional(),
})
export const outlineSchema = z.object({
  version: z.literal(1),
  title: z.string().min(1),
  summary: z.string().min(1).optional(),
  sections: z.array(outlineSectionSchema).min(1),
})
export type Outline = z.infer<typeof outlineSchema>

export type Extracted =
  | { ok: true; value: unknown }
  | { ok: false; snippet: string }

const JSON_VALID_ESCAPE = new Set(["\"", "\\", "/", "b", "f", "n", "r", "t", "u"])

/** Doubling pass over the string segments of a balanced JSON object.
 *
 *  `tex` (always run before the raw parse): doubles every bare backslash whose
 *  next two chars are both letters — a TeX command lead (\frac, \ne, \times,
 *  \Delta...). Models embed TeX bare in JSON strings; a legal JSON escape then
 *  SILENTLY eats the command's first letter (\frac parses to formfeed+"rac",
 *  \ne to newline+"e", \times to tab+"imes") and an illegal one makes the
 *  whole parse throw. Neither failure names the corruption after the fact:
 *  the mangled reply parses fine and the illegal one only says "bad escape",
 *  so the doubling cannot wait for the failure. `\uXXXX` is left alone — the
 *  four hex digits mark a genuine unicode escape, which a TeX command never
 *  starts with; `\underbar` (u + non-hex) still doubles.
 *
 *  `full` (rides in only when parsing still fails and no TeX command shape
 *  explains it): doubles every bare backslash not followed by a valid JSON
 *  escape char — `\(`, `\{`, `\,`, `\ `. A doubled-segment copy never runs on
 *  a reply that parsed: a correct reply is byte-identical, so nothing a valid
 *  parse would have produced is rewritten after the fact.
 *
 *  Escaped pairs ("\\") are consumed as pairs, so both modes are no-ops on
 *  correctly double-escaped replies. Recorded trade: an in-string JSON
 *  newline escape followed DIRECTLY by a letter ("a\nline2") is raw-identical
 *  to TeX "\neline"; TeX wins the ambiguity (see the salvage tests). */
function doubleBareBackslashes(text: string, mode: "tex" | "full"): string {
  if (!text.includes("\\")) return text
  let out = ""
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (!inString) {
      if (ch === '"') inString = true
      out += ch
      continue
    }
    if (ch !== "\\") {
      if (ch === '"') inString = false
      out += ch
      continue
    }
    const next = text[i + 1] ?? ""
    if (next === "\\") {
      out += "\\\\"
      i++
      continue
    }
    const after = text[i + 2] ?? ""
    let double: boolean
    if (mode === "tex") {
      if (next === "u" && /^[0-9a-fA-F]{4}/.test(after)) double = false
      else double = /[a-zA-Z]/.test(next) && /[a-zA-Z]/.test(after)
    } else {
      double = !JSON_VALID_ESCAPE.has(next)
    }
    out += double ? "\\\\" : ch
  }
  return out
}

/** Pull the first balanced JSON object out of model text. Tolerates code
 *  fences and leading commentary; tracks string state so braces inside
 *  strings never confuse the balance count. On the model's reply the
 *  TeX-lead doubling pass runs before the raw parse (see above) and the
 *  full-doubling pass catches escapes the TeX pass cannot name. */
export function extractJson(text: string): Extracted {
  const start = text.indexOf("{")
  if (start === -1) return { ok: false, snippet: text.slice(0, 200) }
  let depth = 0
  let inString = false
  let escaped = false
  let end: number | null = null
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === "\\") escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === "{") depth++
    else if (ch === "}") {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  if (end === null) return { ok: false, snippet: text.slice(start, Math.min(text.length, start + 200)) }
  const raw = text.slice(start, end + 1)
  const texSanitized = doubleBareBackslashes(raw, "tex")
  try {
    return { ok: true, value: JSON.parse(texSanitized) }
  } catch {
    // keep raw in the diagnostic, not the doubled attempt: a failed
    // sanitized parse is the model's own text, closer to the truth for the
    // repair loop's "Offending output" fragment than a doubled phantom.
    try {
      return { ok: true, value: JSON.parse(doubleBareBackslashes(texSanitized, "full")) }
    } catch {
      return { ok: false, snippet: raw.slice(0, 200) }
    }
  }
}
