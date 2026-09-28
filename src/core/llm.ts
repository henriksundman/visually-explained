import { z } from "zod"
import { explanationSchema } from "./schema"

/** JSON Schema for structured outputs / tool calling. `io: "input"` keeps optional fields optional for the model. */
export const explanationJsonSchema = z.toJSONSchema(explanationSchema, { io: "input" })

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

Block types:
- step-list: { steps: [{ title, detail? }] } — numbered steps.
- worked-example: { problem, steps: [{ title, detail? }], result } — a full worked problem.
- derivation: { steps: [{ expression, note? }], conclusion? } — equation/argument steps.
- concept: { term, definition, intuition?, analogy? } — define and ground an idea.
- comparison: { items: [{ name }], dimensions: [{ name, values: string[] }] } — dimensions x items table.
- cause-effect: { chain: [{ because, therefore }] } — causal reasoning.
- data-callout: { metric, label, delta?, trend?: "up"|"down"|"flat", context? } — one number that matters.
- timeline: { events: [{ when, what, detail? }] } — ordered events.
- callout: { variant: "note"|"tip"|"warning", body } — aside or caution.
- diagram: { nodes: [{ id, label, shape?: "box"|"round"|"pill"|"note" }], edges: [{ from, to, label?, kind?: "causes"|"leads"|"part-of"|"conflict" }], direction?: "lr"|"tb" } — semantic nodes/edges only; the renderer computes all layout. Edge from/to must reference node ids.
- chart: { kind: "bar"|"line", points: [{ label, value }], unit?, caption? } — value is a number or numeric string; line points are an ordered series.
- stack: { blocks: Block[] } — group of blocks.
- text: { body } — plain paragraph.
`.trim()
