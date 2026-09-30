import type { z } from "zod"
import { extractJson } from "./extract"

export type Parsed<T> = { ok: true; value: T } | { ok: false; issues: string[]; snippet: string }

/** Extract + validate model text in one step, returning compact issues for
 *  the repair loop. Extraction failure IS a validation failure (spec §6). */
export function parseWithIssues<T>(schema: z.ZodType<T>, text: string): Parsed<T> {
  const extracted = extractJson(text)
  if (!extracted.ok) {
    return { ok: false, issues: ["output contained no JSON object"], snippet: extracted.snippet }
  }
  const parsed = schema.safeParse(extracted.value)
  if (parsed.success) return { ok: true, value: parsed.data }
  const issues = parsed.error.issues.map(iss => {
    const path = iss.path.join(".")
    return `${path || "(root)"}: ${iss.message}`
  })
  // Schema violation: the offending fragment is the raw model text itself.
  return { ok: false, issues, snippet: text.slice(0, 200) }
}

/** Repair re-ask: the offending fragment, the numbered issues, the rules. */
export function repairUserPrompt(args: { previous: string; issues: string[]; rules: string }): string {
  return [
    "Your previous reply failed validation.",
    "",
    "Problems:",
    ...args.issues.map((iss, i) => `${i + 1}. ${iss}`),
    "",
    "Offending output (fragment):",
    args.previous.slice(0, 400),
    "",
    "Rules that were violated:",
    args.rules,
    "",
    "Reply with the corrected JSON object ONLY — no fences, no commentary.",
  ].join("\n")
}
