import { z } from "zod"
import { explanationSchema } from "./schema"
import { documentSchema } from "./documentSchema"
import { BLOCK_TYPE_DOCS, MATH_RULES, NO_IMAGE_CATALOG_RULE } from "./blockTypes"
import { imageMenuText } from "./images"
import type { ImageRef } from "./images"
export { BLOCK_TYPE_DOCS }

/** JSON Schema for structured outputs / tool calling. `io: "input"` keeps optional fields optional for the model. */
export const explanationJsonSchema = z.toJSONSchema(explanationSchema, { io: "input" })
export const documentJsonSchema = z.toJSONSchema(documentSchema, { io: "input" })

/** Last block-type section of both snippets: the image menu when the host has
 *  a catalog, the no-catalog prohibition when it does not (host follow-up 3 —
 *  BLOCK_TYPE_DOCS teaches `image` unconditionally, and the document pipeline
 *  already gates its menu the same way, so the snippets must too: a host with
 *  no catalog no longer invites models to invent image subjects that only
 *  warn at render time). Empty record behaves like no record. */
function imageSection(images?: Record<string, ImageRef>): string {
  return images && Object.keys(images).length > 0 ? imageMenuText(images) : NO_IMAGE_CATALOG_RULE
}

/** Tested instruction block (tests/llm.test.ts): paste into your system prompt
 *  when asking an LLM for an explanation tree. Pass the host image catalog to
 *  get the key:subject image menu; without one the model is told never to
 *  place images. */
export function systemPromptSnippet(images?: Record<string, ImageRef>): string {
  return `
You produce explanation trees as JSON. Output ONLY the JSON object — no markdown fences, no commentary.

Shape: { "version": 1, "title"?: string, "summary"?: string, "blocks": Block[] }

Rules:
- "version" must be exactly 1.
- Pick the most specific block type for each idea; do not repeat the same content in two blocks.
- Group related blocks with "stack". A stack may contain a stack at most one level deep.
- Put no HTML in any field. Inline emphasis only: **bold**, *italic*, \`code\`, [text](url).
${MATH_RULES}
- comparison: "items" are the columns (min 2), each dimension has one value per item, in the same order.
- cause-effect/timeline/data-callout accept presentation?: "auto"|"text"|"figure". Default auto draws a figure when the data fits (cause-effect ≤5 links, timeline ≤12 events, data-callout with a series). Leave it as auto unless asked otherwise.

Block types:
${BLOCK_TYPE_DOCS}
${imageSection(images)}
`.trim()
}

/** Tested instruction block (tests/document-llm.test.ts): paste into your
 *  system prompt when asking an LLM for a document. Same catalog gating as
 *  systemPromptSnippet. */
export function documentSystemPromptSnippet(images?: Record<string, ImageRef>): string {
  return `
You produce multi-section explanation documents as JSON. Output ONLY the JSON object — no markdown fences, no commentary.

Shape: { "version": 1, "title": string, "summary"?: string, "sections": [{ "id"?: string, "title": string, "blocks": Block[] }] }

Rules:
- "version" must be exactly 1.
- "title" is the PAGE title (h1); each section "title" is a section heading (h2). Do not repeat the page title inside section titles.
- Section order is the document outline — plan it before writing sections, one idea-arc per section.
- Each section's "blocks" follow exactly the same rules as a single explanation. Pick the most specific block type for each idea; do not repeat content in two places; group related blocks with "stack".
- Give a section "id" only when a stable anchor matters (cross-page links); otherwise leave it off and the renderer derives one from the title.
- Section titles are heading-style: short, no trailing punctuation.
- Put no HTML in any field. Inline emphasis only: **bold**, *italic*, \`code\`, [text](url).
${MATH_RULES}

Block types:
${BLOCK_TYPE_DOCS}
${imageSection(images)}
`.trim()
}
