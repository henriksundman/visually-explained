import { z } from "zod"

export const documentSectionSchema = z.object({
  id: z.string().min(1).optional(),
  title: z.string().min(1),
  // Lenient like stack children / chart points: per-block salvage happens at
  // render time, so one malformed block drops alone instead of failing the
  // section (spec §3).
  blocks: z.array(z.unknown()),
})
export type DocumentSection = z.infer<typeof documentSectionSchema>

export const documentSchema = z.object({
  version: z.literal(1),
  title: z.string().min(1),
  summary: z.string().min(1).optional(),
  sections: z.array(documentSectionSchema).min(1),
})
export type DocumentIR = z.infer<typeof documentSchema>

/** Turn free text into a URL-safe slug: lowercase, whitespace → -, strip to
 *  [a-z0-9_-] (underscores survive, matching the figure-id pattern), collapse
 *  repeats, trim, cap at 100 chars. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100)
}

/** Final anchor id for a section: `sec-` + slug(authored id ?? title), first
 *  wins; later collisions get -2, -3 …; empty slug → section-<index>.
 *  Both fields optional so the helper accepts raw (unparsed) sections too.
 *  Pure over (section, index, taken) so HTML, React, and tests share it. */
export function sectionAnchor(
  section: { id?: string; title?: string },
  index: number,
  taken: Set<string>,
): string {
  const slug = slugify(section.id ?? section.title ?? "")
  const base = slug.length > 0 ? `sec-${slug}` : `section-${index}`
  let id = base
  let n = 2
  while (taken.has(id)) {
    id = `${base}-${n}`
    n++
  }
  return id
}
