import { z } from "zod"
import type { RenderContext } from "./registry"

/** A host-catalog image entry. `alt` and both dimensions are REQUIRED, not
 *  optional: an image without alt is inaccessible and an image without
 *  intrinsic dimensions reflows the document as it loads (image spec §4.2).
 *  `subject` describes the image in words for the prompt menu and is never
 *  rendered — the LLM is text-only and cannot see the picture.
 *
 *  There is deliberately no `key` field: the catalog is a Record whose key IS
 *  the catalog key, so a key here would duplicate it and could drift from it. */
export const imageRefSchema = z.object({
  src: z.string().min(1),
  alt: z.string().min(1).max(300),
  width: z.number().int().positive().max(4000),
  height: z.number().int().positive().max(4000),
  subject: z.string().min(1).max(200),
})
export type ImageRef = z.infer<typeof imageRefSchema>

export type ImageResolution = { ok: true; ref: ImageRef } | { ok: false }

/** Look up a block's catalog key and validate it. Emits a lenient warning on
 *  miss/invalid and never throws — block-level salvage, even under strict
 *  (image spec §4.3). Own-property guard: a host key must not resolve
 *  "constructor"/"__proto__"/"toString" to inherited Object members. */
export function resolveImage(ctx: RenderContext, key: string, blockId: string | undefined): ImageResolution {
  const label = blockId ?? key
  const images = ctx.images
  if (!images || !Object.hasOwn(images, key)) {
    ctx.addWarning(`[image] image ${label}: no image named "${key}"`)
    return { ok: false }
  }
  const parsed = imageRefSchema.safeParse(images[key])
  if (!parsed.success) {
    const issues = parsed.error.issues.map(i => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")
    ctx.addWarning(`[image] image ${label}: invalid entry — ${issues}`)
    return { ok: false }
  }
  return { ok: true, ref: parsed.data }
}

/** The catalog menu the model sees (image spec §6), shared by the compiler's
 *  prompts AND the host-facing explanation/document snippets (moved verbatim
 *  from compiler/prompts.ts after host follow-up 3, when the snippets had to
 *  honor the same catalog gate as the pipeline — one source, zero drift). The
 *  record key + subject ONLY: the key is exactly what the model writes into
 *  `image` and what resolveImage looks up, so the prompt and the renderer
 *  cannot drift. The LLM is text-only and has never seen these pictures — no
 *  URL, no alt, just a word for what each shows. Host key order, unsorted. */
export function imageMenuText(images: Record<string, ImageRef>): string {
  return [
    "Images available (place by key where one earns its place):",
    ...Object.entries(images).map(([key, r]) => `- ${key}: ${r.subject}`),
    "",
    "Place an image only to anchor an analogy or set a scene. Images never illustrate a derivation — a drawn figure does that better. Put no text in the image itself: labels belong in the caption. The explanation a picture carries goes in that same image block's body, not in a separate text block beside it.",
  ].join("\n")
}
