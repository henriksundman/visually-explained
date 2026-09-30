import type { z } from "zod"
import type { CompileEvent, CompileOptions, CompileResult } from "./client"
import { outlineSchema, type Outline } from "./extract"
import { parseWithIssues, repairUserPrompt } from "./repair"
import {
  outlineSystemPrompt,
  outlineUserPrompt,
  sectionSystemPrompt,
  sectionUserPrompt,
} from "./prompts"
import { documentSectionSchema, type DocumentSection } from "../core/documentSchema"

interface StageArgs<T> {
  client: CompileOptions["client"]
  maxRepairs: number
  stage: "outline" | "section"
  system: string
  user: string
  rules: string
  schema: z.ZodType<T>
  events: CompileEvent[]
  warnings: string[]
  index?: number
}

/** One LLM stage with bounded repair. Throws only for the outline stage when
 *  repairs are exhausted (nothing to salvage); sections return null and the
 *  caller warns + drops (spec §6). */
async function stage<T>(args: StageArgs<T>): Promise<T | null> {
  let user = args.user
  for (let attempt = 0; ; attempt++) {
    const raw = await args.client({ system: args.system, user })
    const parsed = parseWithIssues(args.schema, raw)
    if (parsed.ok) return parsed.value
    if (attempt >= args.maxRepairs) {
      if (args.stage === "outline") {
        throw new Error(
          `compile: outline failed validation after ${args.maxRepairs + 1} calls: ${parsed.issues.join("; ")}`,
        )
      }
      args.warnings.push(`[compile] section ${args.index} dropped — ${parsed.issues.join("; ")}`)
      return null
    }
    args.events.push({
      kind: "repair-attempt",
      stage: args.stage,
      index: args.index,
      attempt: attempt + 1,
      issues: parsed.issues,
    })
    user = repairUserPrompt({ previous: parsed.snippet, issues: parsed.issues, rules: args.rules })
  }
}

export async function compileDocument(topic: string, opts: CompileOptions): Promise<CompileResult> {
  const events: CompileEvent[] = []
  const warnings: string[] = []
  const maxSections = opts.maxSections ?? 12
  const maxRepairs = opts.maxRepairs ?? 2

  events.push({ kind: "outline-start", topic })
  const outline = await stage<Outline>({
    client: opts.client,
    maxRepairs,
    stage: "outline",
    system: outlineSystemPrompt(maxSections),
    user: outlineUserPrompt(topic, opts.guidance),
    rules: outlineSystemPrompt(maxSections),
    schema: outlineSchema,
    events,
    warnings,
  })
  // stage() throws for the outline, so `outline` is non-null here; the check
  // satisfies TS without changing behavior.
  if (!outline) throw new Error("compile: outline failed")

  // Cap outline sections at maxSections (defensive even though the schema
  // doesn't enforce the cap — the host asked for it, so honor it late too).
  const clamped: Outline = { ...outline, sections: outline.sections.slice(0, maxSections) }

  events.push({
    kind: "outline-done",
    title: clamped.title,
    sections: clamped.sections.length,
    visualHints: clamped.sections.filter(s => s.visual).length,
  })

  const sections: DocumentSection[] = []
  for (let i = 0; i < clamped.sections.length; i++) {
    const entry = clamped.sections[i]
    events.push({ kind: "section-start", index: i, title: entry.title })
    const raw = await stage<z.infer<typeof documentSectionSchema>>({
      client: opts.client,
      maxRepairs,
      stage: "section",
      system: sectionSystemPrompt(),
      user: sectionUserPrompt({
        index: i,
        title: entry.title,
        goal: entry.goal,
        visual: entry.visual,
        guidance: opts.guidance,
      }),
      rules:
        'Shape: { "title": string, "blocks": Block[] }. A section has "title" and "blocks" only — never "sections", never "version".',
      schema: documentSectionSchema,
      events,
      warnings,
      index: i,
    })
    if (!raw) {
      events.push({ kind: "section-failed", index: i, title: entry.title })
      continue
    }
    // Canonical title: the outline's title wins over the section call's own.
    sections.push({ title: entry.title, blocks: raw.blocks })
    events.push({ kind: "section-done", index: i, title: entry.title, blocks: raw.blocks.length })
  }

  return {
    document: { version: 1, title: clamped.title, summary: clamped.summary, sections },
    events,
    warnings,
  }
}
