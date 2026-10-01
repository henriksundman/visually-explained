import type { CompileEvent, CompileOptions, CompileResult } from "./client"
import { compileDocumentStream } from "./stream"

/** Accumulate-all convenience: drains the stream (one code path). The
 *  contract tests run both APIs against the same scripted clients, so the
 *  two surfaces cannot drift. */
export async function compileDocument(topic: string, opts: CompileOptions): Promise<CompileResult> {
  let document: unknown
  let warnings: string[] = []
  const events: CompileEvent[] = []
  for await (const e of compileDocumentStream(topic, opts)) {
    if (e.kind === "compile-done") {
      document = e.document
      warnings = e.warnings
    } else {
      events.push(e)
    }
  }
  return { document, events, warnings }
}
