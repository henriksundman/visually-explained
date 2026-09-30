export interface DocumentDiagnostic {
  code: "invalid-document" | "wrong-version" | "invalid-section"
  message: string
}

export interface DocumentValidationResult {
  ok: boolean
  diagnostics: DocumentDiagnostic[]
}

/** Document-scoped validation for dev tooling and the React strict path.
 *  Mirrors validateExplanation: collects every diagnostic, ok = none. */
export function validateDocument(input: unknown): DocumentValidationResult {
  const diagnostics: DocumentDiagnostic[] = []
  const rec =
    typeof input === "object" && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : null
  if (!rec) {
    diagnostics.push({ code: "invalid-document", message: "document must be an object" })
    return { ok: false, diagnostics }
  }
  if (rec.version !== 1) {
    diagnostics.push({ code: "wrong-version", message: `expected version 1, got ${JSON.stringify(rec.version ?? null)}` })
  }
  if (typeof rec.title !== "string" || rec.title.length === 0) {
    diagnostics.push({ code: "invalid-document", message: "title must be a non-empty string" })
  }
  if (!Array.isArray(rec.sections) || rec.sections.length === 0) {
    diagnostics.push({ code: "invalid-document", message: "sections must be a non-empty array" })
    return { ok: false, diagnostics }
  }
  for (let i = 0; i < rec.sections.length; i++) {
    const raw = rec.sections[i]
    const bad =
      typeof raw !== "object" || raw === null || Array.isArray(raw) ||
      typeof (raw as Record<string, unknown>).title !== "string" ||
      ((raw as Record<string, unknown>).title as string).length === 0 ||
      !Array.isArray((raw as Record<string, unknown>).blocks)
    if (bad) {
      diagnostics.push({
        code: "invalid-section",
        message: `section ${i}: dropped — title must be a non-empty string and blocks an array`,
      })
    }
  }
  return { ok: diagnostics.length === 0, diagnostics }
}
