/** Block-type description lines shared by the explanation and document prompt
 *  snippets. Extracted verbatim from the original systemPromptSnippet so both
 *  contracts stay in lockstep (spec §6); the explanation snippet's rendered
 *  text is regression-guarded by tests/llm.test.ts. */
export const BLOCK_TYPE_DOCS = `
Every block is one flat object: a "type" field naming the block type, with that type's payload fields beside it — e.g. { "type": "heading", "text": "Why caches work" }. The lines below are the payload reference: every block carries "type" at the top level, never nested under the type name.
- heading: { text } — a subheading inside a section. Use it to break a long explanation into parts; use sections for a document's top-level split. Keep it to a few words, never repeat one, and never use it to label a single following sentence.
- step-list: { steps: [{ title, detail? }] } — numbered steps.
- worked-example: { problem, steps: [{ title, detail? }], result } — a full worked problem.
- derivation: { steps: [{ expression, note? }], conclusion? } — equation/argument steps. expression is TeX and spans the whole field — no $ delimiters, no wrapping. conclusion is prose — a concluding sentence, symbols inside it as inline math \(…\) — not a formula, so the final equation belongs in the last step's expression. note is prose. Keep each expression on one line.
- concept: { term, definition, intuition?, analogy? } — define and ground an idea.
- comparison: { items: [{ name }], dimensions: [{ name, values: string[] }] } — dimensions x items table.
- mind-map: { root: { label, children?, tip? } } — what nests inside what. Nest a label's children under it to show containment at a glance; the renderer computes all layout. Use it for a taxonomy ("kinds of cache"), never for a sequence — use timeline or step-list for that. Keep labels to a few words; the figure wraps long ones but gets wide. Drawn as a figure by default, falling back to a nested list when the tree is too deep, too many nodes, or too wide to read; presentation forces either form. A node's tip (1-200 chars) is hover/focus text and is what makes that node reachable by keyboard — give one only to a node whose label alone leaves the reader guessing, never to every node.
- cause-effect: { chain: [{ because, therefore }] } — causal reasoning.
- data-callout: { metric, label, delta?, trend?: "up"|"down"|"flat", series?: number[] (2-24 samples for the trend sparkline), context? } — one number that matters.
- timeline: { events: [{ when, what, detail? }], presentation?: "auto"|"text"|"figure" } — ordered events. By default a timeline is drawn as a figure when its labels are short enough to stay legible, and falls back to a text list when they are not; set presentation to force either form.
- callout: { variant: "note"|"tip"|"warning", body } — aside or caution.
- diagram: { nodes: [{ id, label, shape?: "box"|"round"|"pill"|"note" }], edges: [{ from, to, label?, kind?: "causes"|"leads"|"part-of"|"conflict" }], direction?: "lr"|"tb" } — semantic nodes/edges only; the renderer computes all layout. Edge from/to must reference node ids. Nodes accept an optional tip (1-200 chars) shown on hover; chart points and timeline events accept the same optional tip. Reach for a diagram only when the reader must TRACE a web of relationships — branching, convergence, feedback, one thing feeding several others, a node with two or more edges entering or leaving it — or when edges themselves carry meaning a list cannot hold. A chain where every node has at most one edge in and one out is a step-list, not a diagram, whatever its topic is; a per-item mapping (each melody note to each chord that fits it, each bar to its chord) is prose or a table. Before emitting one, ask what a reader LEARNS from the shape they trace; if the answer is nothing the surrounding prose did not already say, the diagram is decoration and must be cut.
- chart: { kind: "bar"|"line", points: [{ label, value }], unit?, caption? } — value is a number or numeric string; line points are an ordered series.
- figure: { title?, caption?, width?, height?, params?: [{ name, min, max, step, initial }], derived?: [{ name, expr }], draggable?: [{ id, x?, y? }], elements: Element[] } — a bespoke drawn figure on a 360×240 canvas. Elements: { kind: "path", d } (d is path data: M L H V C S Q T A Z only, with optional {{expr}} slots), { kind: "curve", from, cp1, cp2, to } (each { x, y }), { kind: "arc", cx, cy, rx, ry, start, end } (degrees), { kind: "box", x, y, w, h, label? }, { kind: "line", x1, y1, x2, y2 }, { kind: "dot", cx, cy, r? }, { kind: "label", x, y, text, anchor? }, { kind: "group", dx?, dy?, elements } (one level), sweep?: param name for play to animate (pick the one that makes the figure move meaningfully). Param/derived/sweep names must not be the exact names PI, E or TAU — write those constants directly in expressions instead. Numbers may be expressions over params/derived (e.g. "a * 2", "sin(PI/4)"); path d may embed {{expr}} slots evaluated the same way (e.g. "M 0 0 L {{a}} {{b * 2}}") — prefer slots for sampled parametric outlines and plain path data otherwise; tones are "ink"|"muted"|"accent". Leaf elements accept optional id (identifier, ≤100 chars), tip (≤200 chars, shown on hover), and label (rendered beside the shape); give ids/tips only to elements worth explaining. Label everything; ≤60 elements. Keep every element inside the 360×240 canvas and spread elements out — stacked or out-of-canvas elements are unreadable; give each box room for its label (long labels wrap to the box width). draggable marks a dot or box as a drag handle for the interactive runtime: id is the element's own id, and x/y name the params the drag writes (omit an axis to fix it). The element's coordinate must be expression-driven off that param (e.g. cx: "px" with derived px) so the figure re-solves around the drag; a handle with no axis is dropped. Handles are also keyboard-operable (arrows nudge, Home/End jump to the ends).
- sources: { title?, items: [{ id, title, url?, detail? }] } — a numbered reference list; each item anchors as source-<id> for inline citations ([label](#source-<id>) in body text, or [label](url) when the source has one). List the sources that ground the explanation; keep ids short and stable.
- quiz: { question, options: [{ text, why? }], answer, explanation? } — a multiple-choice check for the reader. 2-6 options; answer is the 0-based index of the one correct option. Write plausible distractors whose why names the misconception they encode, and give the correct option a why that completes the idea. Never reveal the answer inside the question; place the quiz after the material it checks.
- image: { image, caption?, body? } — one image from the host catalog, referenced by key. Place it only to anchor an analogy or set a scene; never to illustrate a derivation (a drawn figure does that better). Put no text in the image itself — labels belong in the caption. The body field is prose that belongs to this picture and renders beside it; use it for the explanation the picture carries (max 1200 chars) instead of a separate text block, and omit it when the caption alone says enough.
- stack: { blocks: Block[] } — group of blocks.
- text: { body } — plain paragraph.
- code: { language?, code } — a verbatim source snippet for how-tos; never contains HTML or markdown (rendered exactly as written).
`.trim()

/** Math-rule lines shared by every prompt surface (the explanation snippet,
 *  the document snippet in llm.ts, and the compiler's section prompt in
 *  compiler/prompts.ts), extracted verbatim from sectionSystemPrompt where the
 *  2026-10-04 inline-math cycle left them. Sharing one constant is the drift
 *  guard the 2026-10-07 block-discriminator lesson demands: a prompt rule
 *  maintained in two places reached only one surface (text/code shipped to
 *  systemPromptSnippet alone), and it hit this family again when the host
 *  snippets kept the pre-inline-math "no LaTeX delimiters" rule while the
 *  renderer honours \(...\) — so the model was actively taught to avoid the
 *  spans the renderer supports (host report 2026-10-13). */
export const MATH_RULES = `
- Full formulas go in a derivation block's "expression"/"conclusion" as bare TeX with no delimiters.
- A formula inside prose is inline math: \\(...\\) , or $...$ for a short expression. Prefer \\(...\\) — it is never ambiguous. A $...$ that does not look like math is left as literal text, and a dollar amount in prose needs no escaping.
`.trim()

/** The no-catalog counterpart of the image menu (host follow-up 3,
 *  BUG-REPORT-sweep-focus-storm.md): BLOCK_TYPE_DOCS teaches the `image` block
 *  unconditionally ("one image from the host catalog"), so every prompt
 *  surface that embeds it invited models to place image blocks for invented
 *  subjects — validate-time passed and the miss only warned at RENDER time
 *  ([image] no image named …), silently salvaged in prod, a render boundary
 *  under failOnWarning. Shared like MATH_RULES so every surface that teaches
 *  image can print the prohibition in the same breath. Land it after the
 *  block-type docs, right where a host that HAS a catalog prints
 *  imageMenuText (core/images) instead. */
export const NO_IMAGE_CATALOG_RULE = `No image catalog was provided, so never emit an image block.`
