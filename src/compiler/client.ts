import { safeHref } from "../core/inline"
import type { ImageRef } from "../core/images"

/** The one LLM surface the library knows: host-injected, text-in/text-out.
 *  Works with any provider — with or without JSON mode — because the
 *  compiler owns extraction, validation, and repair. */
export type LlmClient = (req: { system: string; user: string }) => Promise<string>

/** Host-supplied grounding material (compiler spec §3). Chunking/sizing is
 *  host-side; the compiler interpolates what it is given. */
export interface SourceExcerpt {
  /** Citation target — anchors as source-<id>. 1-64 chars. */
  id: string
  /** 1-200 chars. */
  title: string
  /** Host-pre-chunked excerpt, interpolated into section prompts. 1-2000 chars. */
  text: string
  /** Cited directly when present. http(s) only, 1-500 chars. */
  url?: string
}

export interface CompileOptions {
  client: LlmClient
  /** Repair re-asks per stage before salvage. Default 2. */
  maxRepairs?: number
  /** Host steering (audience, tone, constraints) interpolated into both user prompts. */
  guidance?: string
  /** Cap on outline sections. Default 12. */
  maxSections?: number
  /** Grounding material interpolated into the prompts; validated leniently. */
  sources?: SourceExcerpt[]
  /** Retrieval practice (quiz placement spec §3): invite the outline to mark
   *  sections where a quiz consolidates the learning, and audit declared
   *  sections for a placed quiz. Off by default — absent the flag, compiles
   *  are byte-identical to unflagged ones. */
  checks?: boolean
  /** Host image catalog the compiler may place (image spec §4.5). Deliberately
   *  the SAME Record shape as the render-side `images` option, so one object
   *  serves both compileDocument and renderDocument without reshaping, and the
   *  key the model writes into `image` is the key resolveImage looks up.
   *  Validated leniently before any prompting; absent or empty means the
   *  compile behaves exactly like an ungrounded one. */
  images?: Record<string, ImageRef>
}

/** Largest excerpt set the compiler accepts — matches the sources block
 *  schema's items cap, so the auto-appended block is always schema-valid. */
export const MAX_SOURCES = 24

/** Lenient validation of host excerpts (spec §3): out-of-shape excerpts drop
 *  with a `[grounding]` warning before any prompting (bad ids would poison
 *  anchors); duplicate ids keep the first; the set is capped at MAX_SOURCES.
 *  Hand-rolled checks — not zod — so warning strings are stable across zod
 *  versions. URL scheme reuses the render-time gate (core/inline). */
export function validateSources(
  raw?: SourceExcerpt[],
): { excerpts: SourceExcerpt[]; warnings: string[] } {
  const warnings: string[] = []
  const excerpts: SourceExcerpt[] = []
  const seen = new Set<string>()
  for (let i = 0; i < (raw?.length ?? 0); i++) {
    const s = raw![i] as Partial<SourceExcerpt> | null
    if (typeof s !== "object" || s === null) {
      warnings.push(`[grounding] source ${i} dropped — not an object`)
      continue
    }
    const issues: string[] = []
    if (typeof s.id !== "string" || s.id.length < 1 || s.id.length > 64) issues.push("id must be 1-64 chars")
    if (typeof s.title !== "string" || s.title.length < 1 || s.title.length > 200)
      issues.push("title must be 1-200 chars")
    if (typeof s.text !== "string" || s.text.length < 1 || s.text.length > 2000)
      issues.push("text must be 1-2000 chars")
    if (s.url !== undefined) {
      if (typeof s.url !== "string" || s.url.length < 1 || s.url.length > 500) {
        issues.push("url must be 1-500 chars")
      } else {
        const href = safeHref(s.url)
        if (href === null || !/^https?:/i.test(href)) issues.push("url must be http(s)")
      }
    }
    if (issues.length > 0) {
      warnings.push(`[grounding] source ${i} dropped — ${issues.join("; ")}`)
      continue
    }
    const id = s.id as string
    if (seen.has(id)) {
      warnings.push(`[grounding] duplicate source id "${id}" dropped`)
      continue
    }
    if (excerpts.length >= MAX_SOURCES) {
      warnings.push(`[grounding] source ${i} dropped — at most ${MAX_SOURCES} sources`)
      continue
    }
    seen.add(id)
    excerpts.push({
      id,
      title: s.title as string,
      text: s.text as string,
      ...(s.url !== undefined ? { url: s.url as string } : {}),
    })
  }
  return { excerpts, warnings }
}

/** Largest catalog the compiler accepts — the same budget as MAX_SOURCES, so
 *  the interpolated menu stays bounded. */
export const MAX_IMAGES = 24

/** Lenient validation of the host catalog (image spec §4.5). Hand-rolled, not
 *  zod, so warning strings stay stable across zod versions — the same
 *  deliberate choice as validateSources.
 *
 *  The Record key IS the catalog key: the model writes it into `image` and
 *  resolveImage looks it up, so the prompt menu and the renderer cannot drift.
 *  (An array could not carry a key at all — that is why this is not one.)
 *  Iteration is Object.entries order = host key order, unsorted. Own enumerable
 *  keys only, so an inherited member never becomes an entry. Keys are truncated
 *  in warnings: they are host-supplied, and unbounded output must not bloat
 *  the diagnostics channel. */
export function validateImages(raw?: Record<string, unknown>): { catalog: Record<string, ImageRef>; warnings: string[] } {
  const warnings: string[] = []
  const catalog: Record<string, ImageRef> = {}
  let kept = 0
  for (const [key, value] of Object.entries(raw ?? {})) {
    const label = `"${key.slice(0, 64)}"`
    if (kept >= MAX_IMAGES) {
      warnings.push(`[images] image ${label} dropped — at most ${MAX_IMAGES} images`)
      continue
    }
    const r = value as Partial<ImageRef> | null
    if (typeof r !== "object" || r === null || Array.isArray(r)) {
      warnings.push(`[images] image ${label} dropped — not an object`)
      continue
    }
    const issues: string[] = []
    if (typeof r.src !== "string" || r.src.length < 1) issues.push("src must be a non-empty string")
    if (typeof r.alt !== "string" || r.alt.length < 1 || r.alt.length > 300) issues.push("alt must be 1-300 chars")
    if (typeof r.width !== "number" || !Number.isInteger(r.width) || r.width <= 0 || r.width > 4000)
      issues.push("width must be a positive integer")
    if (typeof r.height !== "number" || !Number.isInteger(r.height) || r.height <= 0 || r.height > 4000)
      issues.push("height must be a positive integer")
    if (typeof r.subject !== "string" || r.subject.length < 1 || r.subject.length > 200)
      issues.push("subject must be 1-200 chars")
    if (issues.length > 0) {
      warnings.push(`[images] image ${label} dropped — ${issues.join("; ")}`)
      continue
    }
    catalog[key] = {
      src: r.src as string,
      alt: r.alt as string,
      width: r.width as number,
      height: r.height as number,
      subject: r.subject as string,
    }
    kept++
  }
  return { catalog, warnings }
}

/** Extra fields per kind are specified in the compiler spec §5 table. */
export interface CompileEvent {
  kind: "outline-start" | "outline-done" | "section-start" | "section-done" | "section-failed" | "repair-attempt"
  [key: string]: unknown
}

export interface CompileResult {
  /** Assembled document IR — parses against documentSchema (contract-locked in tests). */
  document: unknown
  events: CompileEvent[]
  warnings: string[]
}
