import { z } from "zod"
import { explanationSchema } from "./schema"
import { documentSchema } from "./documentSchema"
import { BLOCK_TYPE_DOCS } from "./blockTypes"
export { BLOCK_TYPE_DOCS }

/** JSON Schema for structured outputs / tool calling. `io: "input"` keeps optional fields optional for the model. */
export const explanationJsonSchema = z.toJSONSchema(explanationSchema, { io: "input" })
export const documentJsonSchema = z.toJSONSchema(documentSchema, { io: "input" })

/** Tested instruction block: paste into your system prompt when asking an LLM for an explanation tree. */
export const systemPromptSnippet = `
You produce explanation trees as JSON. Output ONLY the JSON object — no markdown fences, no commentary.

Shape: { "version": 1, "title"?: string, "summary"?: string, "blocks": Block[] }

Rules:
- "version" must be exactly 1.
- Pick the most specific block type for each idea; do not repeat the same content in two blocks.
- Group related blocks with "stack". A stack may contain a stack at most one level deep.
- Put no HTML in any field. Inline emphasis only: **bold**, *italic*, \`code\`.
- Math and expressions go in plain strings (e.g. derivation "expression"); no LaTeX delimiters.
- comparison: "items" are the columns (min 2), each dimension has one value per item, in the same order.
- cause-effect/timeline/data-callout accept presentation?: "auto"|"text"|"figure". Default auto draws a figure when the data fits (cause-effect ≤5 links, timeline ≤12 events, data-callout with a series). Leave it as auto unless asked otherwise.

Block types:
${BLOCK_TYPE_DOCS}
- text: { body } — plain paragraph.
- code: { language?, code } — a verbatim source snippet for how-tos; never contains HTML or markdown (rendered exactly as written).
`.trim()

/** Tested instruction block: paste into your system prompt when asking an LLM for a document. */
export const documentSystemPromptSnippet = `
You produce multi-section explanation documents as JSON. Output ONLY the JSON object — no markdown fences, no commentary.

Shape: { "version": 1, "title": string, "summary"?: string, "sections": [{ "id"?: string, "title": string, "blocks": Block[] }] }

Rules:
- "version" must be exactly 1.
- "title" is the PAGE title (h1); each section "title" is a section heading (h2). Do not repeat the page title inside section titles.
- Section order is the document outline — plan it before writing sections, one idea-arc per section.
- Each section's "blocks" follow exactly the same rules as a single explanation. Pick the most specific block type for each idea; do not repeat content in two places; group related blocks with "stack".
- Give a section "id" only when a stable anchor matters (cross-page links); otherwise leave it off and the renderer derives one from the title.
- Section titles are heading-style: short, no trailing punctuation.
- Put no HTML in any field. Inline emphasis only: **bold**, *italic*, \`code\`.

Block types:
${BLOCK_TYPE_DOCS}
`.trim()
