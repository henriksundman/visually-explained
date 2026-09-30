/** The one LLM surface the library knows: host-injected, text-in/text-out.
 *  Works with any provider — with or without JSON mode — because the
 *  compiler owns extraction, validation, and repair. */
export type LlmClient = (req: { system: string; user: string }) => Promise<string>

export interface CompileOptions {
  client: LlmClient
  /** Repair re-asks per stage before salvage. Default 2. */
  maxRepairs?: number
  /** Host steering (audience, tone, constraints) interpolated into both user prompts. */
  guidance?: string
  /** Cap on outline sections. Default 12. */
  maxSections?: number
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
