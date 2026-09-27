import type { Block } from "./schema"
import { registry } from "./registry"

export type BlockKind = "valid" | "unknown" | "invalid"

export interface SalvagedBlock {
  index: number
  type: string
  kind: BlockKind
  /** Parsed payload for valid blocks, raw record for unknown types, null for invalid. */
  data: Block | Record<string, unknown> | null
}

export interface Diagnostic {
  index: number | null
  code: "invalid-explanation" | "wrong-version" | "invalid-block" | "unknown-type"
  message: string
}

export interface SalvagedExplanation {
  version: number | null
  title: string | null
  summary: string | null
  blocks: SalvagedBlock[]
  diagnostics: Diagnostic[]
  warnings: string[]
}

function stringify(diagnostics: Diagnostic[]): string[] {
  return diagnostics.map(d => `[${d.code}] ${d.message}`)
}

export function salvageBlock(raw: unknown, index: number, diagnostics: Diagnostic[]): SalvagedBlock {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    diagnostics.push({ index, code: "invalid-block", message: `block ${index}: not an object` })
    return { index, type: "", kind: "invalid", data: null }
  }
  const rec = raw as Record<string, unknown>
  const type = typeof rec.type === "string" ? rec.type : null
  if (!type) {
    diagnostics.push({ index, code: "invalid-block", message: `block ${index}: missing "type"` })
    return { index, type: "", kind: "invalid", data: null }
  }
  const entry = registry[type]
  if (!entry) {
    diagnostics.push({
      index,
      code: "unknown-type",
      message: `block ${index}: unknown type "${type}", rendering fallback`,
    })
    return { index, type, kind: "unknown", data: rec }
  }
  const parsed = entry.schema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const path = issue?.path.join(".") ?? ""
    diagnostics.push({
      index,
      code: "invalid-block",
      message: `block ${index} (${type}): skipped — ${path || "payload"} ${issue?.message ?? "invalid"}`,
    })
    return { index, type, kind: "invalid", data: null }
  }
  return { index, type, kind: "valid", data: parsed.data as Block }
}

export function salvageExplanation(input: unknown): SalvagedExplanation {
  const diagnostics: Diagnostic[] = []
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    diagnostics.push({ index: null, code: "invalid-explanation", message: "explanation must be an object" })
    return { version: null, title: null, summary: null, blocks: [], diagnostics, warnings: stringify(diagnostics) }
  }
  const rec = input as Record<string, unknown>
  const version = typeof rec.version === "number" ? rec.version : null
  if (version !== 1) {
    diagnostics.push({
      index: null,
      code: "wrong-version",
      message: `expected version 1, got ${JSON.stringify(rec.version ?? null)}`,
    })
  }
  const title = typeof rec.title === "string" ? rec.title : null
  const summary = typeof rec.summary === "string" ? rec.summary : null
  if (!Array.isArray(rec.blocks)) {
    diagnostics.push({ index: null, code: "invalid-explanation", message: "blocks must be an array" })
  }
  const rawBlocks = Array.isArray(rec.blocks) ? rec.blocks : []
  const blocks = rawBlocks.map((b, i) => salvageBlock(b, i, diagnostics))
  return { version, title, summary, blocks, diagnostics, warnings: stringify(diagnostics) }
}
