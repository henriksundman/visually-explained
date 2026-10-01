import type { z } from "zod"
import type { CompileEvent, CompileOptions } from "./client"
import { outlineSchema, type Outline } from "./extract"
import { parseWithIssues, repairUserPrompt } from "./repair"
import {
  outlineSystemPrompt,
  outlineUserPrompt,
  sectionSystemPrompt,
  sectionUserPrompt,
} from "./prompts"
import { documentSectionSchema, type DocumentSection } from "../core/documentSchema"

export type StreamCompileEvent =
  | CompileEvent
  | { kind: "compile-done"; document: unknown; warnings: string[] }

type StageOutcome<T> = { ok: true; value: T } | { ok: false; issues: string[] }

interface StageArgs<T> {
  client: CompileOptions["client"]
  maxRepairs: number
  stage: "outline" | "section"
  system: string
  user: string
  rules: string
  schema: z.ZodType<T>
  index?: number
}

/** Mechanical LLM stage: call → parse → re-ask, at most maxRepairs times.
 *  Yields repair-attempt events the moment they happen and RETURNS the
 *  outcome (consume via yield*). Purely mechanical — the throw-for-outline /
 *  drop-for-section policy lives in the orchestrator. */
async function* runStage<T>(args: StageArgs<T>): AsyncGenerator<CompileEvent, StageOutcome<T>, undefined> {
  let user = args.user
  for (let attempt = 0; ; attempt++) {
    const raw = await args.client({ system: args.system, user })
    const parsed = parseWithIssues(args.schema, raw)
    if (parsed.ok) return { ok: true, value: parsed.value }
    if (attempt >= args.maxRepairs) return { ok: false, issues: parsed.issues }
    yield {
      kind: "repair-attempt",
      stage: args.stage,
      index: args.index,
      attempt: attempt + 1,
      issues: parsed.issues,
    }
    user = repairUserPrompt({ previous: parsed.snippet, issues: parsed.issues, rules: args.rules })
  }
}

/** Stream the compile: yields the v1 event vocabulary live (spec §5), then a
 *  terminal compile-done carrying { document, warnings }. Outline exhaustion
 *  throws (unchanged v1 contract); a failed section is warned + dropped. */
export async function* compileDocumentStream(
  topic: string,
  opts: CompileOptions,
): AsyncGenerator<StreamCompileEvent> {
  const warnings: string[] = []
  const maxSections = opts.maxSections ?? 12
  const maxRepairs = opts.maxRepairs ?? 2

  yield { kind: "outline-start", topic }
  const outlineOutcome = yield* runStage<Outline>({
    client: opts.client,
    maxRepairs,
    stage: "outline",
    system: outlineSystemPrompt(maxSections),
    user: outlineUserPrompt(topic, opts.guidance),
    rules: outlineSystemPrompt(maxSections),
    schema: outlineSchema,
  })
  if (!outlineOutcome.ok) {
    throw new Error(
      `compile: outline failed validation after ${maxRepairs + 1} calls: ${outlineOutcome.issues.join("; ")}`,
    )
  }
  const outline = outlineOutcome.value

  // Clamp BEFORE outline-done so the shell (title/summary/sectionTitles)
  // always matches the final document.
  const clamped: Outline = { ...outline, sections: outline.sections.slice(0, maxSections) }

  yield {
    kind: "outline-done",
    title: clamped.title,
    summary: clamped.summary,
    sections: clamped.sections.length,
    visualHints: clamped.sections.filter(s => s.visual).length,
    sectionTitles: clamped.sections.map(s => s.title),
  }

  const sections: DocumentSection[] = []
  for (let i = 0; i < clamped.sections.length; i++) {
    const entry = clamped.sections[i]
    yield { kind: "section-start", index: i, title: entry.title }
    const outcome = yield* runStage<z.infer<typeof documentSectionSchema>>({
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
      index: i,
    })
    if (!outcome.ok) {
      warnings.push(`[compile] section ${i} dropped — ${outcome.issues.join("; ")}`)
      yield { kind: "section-failed", index: i, title: entry.title }
      continue
    }
    // Canonical title: the outline's title wins over the section call's own.
    sections.push({ title: entry.title, blocks: outcome.value.blocks })
    yield { kind: "section-done", index: i, title: entry.title, blocks: outcome.value.blocks }
  }

  yield {
    kind: "compile-done",
    document: { version: 1, title: clamped.title, summary: clamped.summary, sections },
    warnings,
  }
}
