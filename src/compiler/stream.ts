import type { z } from "zod"
import { validateSources, validateImages, type CompileEvent, type CompileOptions, type SourceExcerpt } from "./client"
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

/** Anchor citation ids referenced anywhere in a block tree's string fields
 *  (spec §5: walk string fields — bodies, captions, every rendered surface's
 *  input — for `(#source-<id>)` anchor references). Model-authored `sources`
 *  blocks are skipped: they list sources, they do not cite them. Linear scan,
 *  no backtracking-prone patterns. */
function collectCitationIds(value: unknown, into = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    for (const m of value.matchAll(/#source-([^)\s]+)/g)) into.add(m[1])
  } else if (Array.isArray(value)) {
    for (const v of value) collectCitationIds(v, into)
  } else if (value !== null && typeof value === "object") {
    if ((value as { type?: unknown }).type === "sources") return into
    for (const v of Object.values(value)) collectCitationIds(v, into)
  }
  return into
}

/** The auto-appended provenance list (spec §4). `detail` is the excerpt text
 *  truncated to the sources-block schema's 400-char cap. */
function sourcesBlockFrom(excerpts: SourceExcerpt[]) {
  return {
    type: "sources",
    id: "compile-sources",
    title: "Sources",
    items: excerpts.map(s => ({
      id: s.id,
      title: s.title,
      ...(s.url ? { url: s.url } : {}),
      detail: s.text.slice(0, 400),
    })),
  }
}

/** Whether a block tree contains a quiz anywhere, recursing into `stack`
 *  children (quiz-placement spec §5). Tolerates raw/unvalidated children —
 *  blocks are z.unknown() until render, and one malformed child must not
 *  crash the audit. */
function hasQuiz(blocks: unknown[]): boolean {
  return blocks.some(b => {
    if (typeof b !== "object" || b === null) return false
    const rec = b as { type?: unknown; blocks?: unknown }
    if (rec.type === "quiz") return true
    return rec.type === "stack" && Array.isArray(rec.blocks) && hasQuiz(rec.blocks)
  })
}

/** Whether any `diagram` block in a block tree is a CHAIN — every node has at
 *  most one edge in and one edge out, so the graph reads as a sequence and a
 *  `step-list` renders it better (2026-10-10 review finding 4). Recursing into
 *  `stack` children exactly like `hasQuiz`; tolerates malformed payloads:
 *  missing or wrong-typed `nodes`/`edges` are simply not auditable, so they
 *  never crash and never fire. Degenerate shapes (single node or nodeless) do
 *  not count as chains. */
function hasChainDiagram(blocks: unknown[]): boolean {
  return blocks.some(b => {
    if (typeof b !== "object" || b === null) return false
    const rec = b as { type?: unknown; blocks?: unknown; nodes?: unknown; edges?: unknown }
    if (rec.type === "diagram" && Array.isArray(rec.nodes)) {
      const ids = new Set<string>()
      for (const n of rec.nodes) {
        if (typeof n === "object" && n !== null && typeof (n as { id?: unknown }).id === "string") {
          ids.add((n as { id: string }).id)
        }
      }
      const inDeg = new Map<string, number>()
      const outDeg = new Map<string, number>()
      let knownEdges = 0
      if (Array.isArray(rec.edges)) {
        for (const e of rec.edges) {
          if (typeof e !== "object" || e === null) continue
          const from = (e as { from?: unknown }).from
          const to = (e as { to?: unknown }).to
          if (typeof from !== "string" || typeof to !== "string") continue
          if (!ids.has(from) || !ids.has(to)) continue
          outDeg.set(from, (outDeg.get(from) ?? 0) + 1)
          inDeg.set(to, (inDeg.get(to) ?? 0) + 1)
          knownEdges++
        }
      }
      // At least one resolvable edge: with no valid edges the degree claim is
      // vacuous (any node is trivially ≤1/≤1), and a malformed payload must
      // stay silent rather than guess.
      if (ids.size >= 2 && knownEdges >= 1) {
        let chain = true
        for (const id of ids) {
          if ((inDeg.get(id) ?? 0) > 1 || (outDeg.get(id) ?? 0) > 1) {
            chain = false
            break
          }
        }
        if (chain) return true
      }
    }
    return rec.type === "stack" && Array.isArray(rec.blocks) && hasChainDiagram(rec.blocks)
  })
}

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

  // Grounding (spec §3/§4): validate once before any prompting; empty after
  // validation means the compile behaves exactly like an ungrounded one.
  const { excerpts, warnings: sourceWarnings } = validateSources(opts.sources)
  warnings.push(...sourceWarnings)
  const grounded = excerpts.length > 0 ? excerpts : undefined
  const knownSourceIds = new Set(excerpts.map(s => s.id))
  const citedIds = new Set<string>()

  // Retrieval checks (quiz-placement spec §3): flag-gated. Off ⇒ byte-identical
  // prompts, events, and warnings.
  const checksOn = opts.checks === true

  // Diagram audit (2026-10-10 review finding 4): flag-gated, same shape as
  // `checks` — a warn-only heuristic must not reach into every host's default
  // compile, where `failOnWarning` would convert it into an exception.
  const diagramAuditOn = opts.diagramAudit === true

  // Image catalog (image spec §6): validated once, before any prompting. Empty
  // after validation ⇒ byte-identical USER prompts to an uncatalogued compile.
  // (The section SYSTEM prompt still carries the - image: contract line for
  // every host; that cost is unconditional and cannot be gated.)
  const { catalog, warnings: imageWarnings } = validateImages(opts.images)
  warnings.push(...imageWarnings)
  const images = Object.keys(catalog).length > 0 ? catalog : undefined

  yield { kind: "outline-start", topic }
  const outlineOutcome = yield* runStage<Outline>({
    client: opts.client,
    maxRepairs,
    stage: "outline",
    system: outlineSystemPrompt(maxSections),
    user: outlineUserPrompt(topic, opts.guidance, grounded, checksOn, images),
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
    ...(checksOn ? { checks: clamped.sections.filter(s => s.check === true).length } : {}),
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
        sources: grounded,
        check: checksOn && entry.check === true,
        images,
        image: images && entry.image !== undefined ? entry.image : undefined,
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

    // Grounding audit (spec §5): post-repair accepted blocks only. A cited id
    // outside the validated set is a dead link — warn, never drop. Model ids
    // are truncated to 64 chars so unbounded output cannot bloat warnings.
    for (const id of collectCitationIds(outcome.value.blocks)) {
      citedIds.add(id)
      if (grounded && !knownSourceIds.has(id)) {
        warnings.push(`[grounding] section ${i} cites unknown source "${id.slice(0, 64)}"`)
      }
    }

    // Checks audit (quiz-placement spec §5): a declared check must place a
    // quiz — recurse into stack children; constrain-and-warn only, never drop.
    if (checksOn && entry.check === true && !hasQuiz(outcome.value.blocks)) {
      warnings.push(`[checks] section ${i} declared a check but placed no quiz`)
    }

    // Diagram audit (finding 4): a diagram whose every node has at most one
    // edge in and one out is a chain — warn, never drop or rewrite.
    if (diagramAuditOn && hasChainDiagram(outcome.value.blocks)) {
      warnings.push(
        `[diagram] section ${i}: a diagram reads as a chain (every node has at most one edge in and out) — consider a step-list`,
      )
    }

    yield { kind: "section-done", index: i, title: entry.title, blocks: outcome.value.blocks }
  }

  // Provenance (spec §4): append to the LAST SURVIVING section — no new
  // section, maxSections semantics intact. Then report never-cited excerpts
  // (spec §5) at compile-done time.
  if (grounded) {
    if (sections.length > 0) {
      sections[sections.length - 1].blocks.push(sourcesBlockFrom(grounded))
    } else {
      warnings.push("[grounding] sources block not appended — no surviving section")
    }
    for (const s of excerpts) {
      if (!citedIds.has(s.id)) warnings.push(`[grounding] source "${s.id}" never cited`)
    }
  }

  yield {
    kind: "compile-done",
    document: { version: 1, title: clamped.title, summary: clamped.summary, sections },
    warnings,
  }
}
