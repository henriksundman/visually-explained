import { z } from "zod"

export const outlineVisualSchema = z.enum(["figure", "diagram", "chart"])
export const outlineSectionSchema = z.object({
  title: z.string().min(1),
  goal: z.string().min(1),
  visual: outlineVisualSchema.optional(),
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

/** Pull the first balanced JSON object out of model text. Tolerates code
 *  fences and leading commentary; tracks string state so braces inside
 *  strings never confuse the balance count. */
export function extractJson(text: string): Extracted {
  const start = text.indexOf("{")
  if (start === -1) return { ok: false, snippet: text.slice(0, 200) }
  let depth = 0
  let inString = false
  let escaped = false
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
        try {
          return { ok: true, value: JSON.parse(text.slice(start, i + 1)) }
        } catch {
          return { ok: false, snippet: text.slice(start, Math.min(text.length, start + 200)) }
        }
      }
    }
  }
  return { ok: false, snippet: text.slice(start, Math.min(text.length, start + 200)) }
}
