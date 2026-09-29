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
- cause-effect/timeline/data-callout accept presentation?: "auto"|"text"|"figure". Default auto draws a figure when the data fits (cause-effect ≤5 links, timeline ≤12 events, data-callout with a series). Leave it as auto unless asked otherwise.

Block types:
- step-list: { steps: [{ title, detail? }] } — numbered steps.
- worked-example: { problem, steps: [{ title, detail? }], result } — a full worked problem.
- derivation: { steps: [{ expression, note? }], conclusion? } — equation/argument steps.
- concept: { term, definition, intuition?, analogy? } — define and ground an idea.
- comparison: { items: [{ name }], dimensions: [{ name, values: string[] }] } — dimensions x items table.
- cause-effect: { chain: [{ because, therefore }] } — causal reasoning.
- data-callout: { metric, label, delta?, trend?: "up"|"down"|"flat", series?: number[] (2-24 samples for the trend sparkline), context? } — one number that matters.
- timeline: { events: [{ when, what, detail? }] } — ordered events.
- callout: { variant: "note"|"tip"|"warning", body } — aside or caution.
- diagram: { nodes: [{ id, label, shape?: "box"|"round"|"pill"|"note" }], edges: [{ from, to, label?, kind?: "causes"|"leads"|"part-of"|"conflict" }], direction?: "lr"|"tb" } — semantic nodes/edges only; the renderer computes all layout. Edge from/to must reference node ids. Nodes accept an optional tip (1-200 chars) shown on hover; chart points and timeline events accept the same optional tip.
- chart: { kind: "bar"|"line", points: [{ label, value }], unit?, caption? } — value is a number or numeric string; line points are an ordered series.
- figure: { title?, caption?, width?, height?, params?: [{ name, min, max, step, initial }], derived?: [{ name, expr }], elements: Element[] } — a bespoke drawn figure on a 360×240 canvas. Elements: { kind: "path", d } (d is path data: M L H V C S Q T A Z only, with optional {{expr}} slots), { kind: "curve", from, cp1, cp2, to } (each { x, y }), { kind: "arc", cx, cy, rx, ry, start, end } (degrees), { kind: "box", x, y, w, h, label? }, { kind: "line", x1, y1, x2, y2 }, { kind: "dot", cx, cy, r? }, { kind: "label", x, y, text, anchor? }, { kind: "group", dx?, dy?, elements } (one level), sweep?: param name for play to animate (pick the one that makes the figure move meaningfully). Param/derived/sweep names must not be the exact names PI, E or TAU — write those constants directly in expressions instead. Numbers may be expressions over params/derived (e.g. "a * 2", "sin(PI/4)"); path d may embed {{expr}} slots evaluated the same way (e.g. "M 0 0 L {{a}} {{b * 2}}") — prefer slots for sampled parametric outlines and plain path data otherwise; tones are "ink"|"muted"|"accent". Leaf elements accept optional id (identifier, ≤100 chars) and tip (≤200 chars, shown on hover); give ids/tips only to elements worth explaining. Label everything; ≤60 elements.
- stack: { blocks: Block[] } — group of blocks.
- text: { body } — plain paragraph.
- code: { language?, code } — a verbatim source snippet for how-tos; never contains HTML or markdown (rendered exactly as written).
`.trim()
