import { salvageExplanation, type Diagnostic } from "./salvage"

export interface ValidationResult {
  ok: boolean
  diagnostics: Diagnostic[]
}

/** Full top-level validation for dev tooling. Unknown types count as diagnostics. */
export function validateExplanation(input: unknown): ValidationResult {
  const { diagnostics } = salvageExplanation(input)
  return { ok: diagnostics.length === 0, diagnostics }
}
