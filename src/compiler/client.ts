import { safeHref } from "../core/inline"

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
