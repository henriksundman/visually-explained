import { BLOCK_TYPE_DOCS } from "../core/blockTypes"

export function outlineSystemPrompt(maxSections: number): string {
  return `
You design outlines for multi-section explanation documents. Output ONLY the JSON object — no markdown fences, no commentary.

Shape: { "version": 1, "title": string, "summary"?: string, "sections": [{ "title": string, "goal": string, "visual"?: "figure" | "diagram" | "chart" }] }

Rules:
- "version" must be exactly 1.
- "title" is the PAGE title; do not preface it.
- Plan at most ${maxSections} sections. Each section covers one idea-arc, ordered as the reader should meet them.
- "goal" is one or two sentences on what the section must accomplish for the reader; later steps write the section's blocks from it.
- Add "visual" only where a visual genuinely earns its place: "figure" (bespoke drawn diagram), "diagram" (semantic nodes/edges), "chart" (data). Most sections need none.
- Put no HTML in any field.
`.trim()
}

export function outlineUserPrompt(topic: string, guidance?: string): string {
  return [
    `Topic: ${topic}`,
    guidance ? `Guidance: ${guidance}` : "",
    "",
    "Design the outline. Reply with the JSON object ONLY.",
  ]
    .filter(Boolean)
    .join("\n")
}

export function sectionSystemPrompt(): string {
  return `
You write one section of a multi-section explanation document. Output ONLY the JSON object — no markdown fences, no commentary.

Shape: { "title": string, "blocks": Block[] } — you are writing ONE section: never emit a "sections" key, never emit a "version" key.

Rules:
- Each section's "blocks" follow exactly the same rules as a single explanation. Pick the most specific block type for each idea; do not repeat content in two places; group related blocks with "stack".
- Put no HTML in any field. Inline emphasis only: **bold**, *italic*, \`code\`.
- Math and expressions go in plain strings (e.g. derivation "expression"); no LaTeX delimiters.
- cause-effect/timeline/data-callout accept presentation?: "auto"|"text"|"figure". Default auto draws a figure when the data fits. Leave it as auto unless asked otherwise.

Block types:
${BLOCK_TYPE_DOCS}
`.trim()
}

export function sectionUserPrompt(args: {
  index: number
  title: string
  goal: string
  visual?: string
  guidance?: string
}): string {
  return [
    `Write section ${args.index + 1} of the document: "${args.title}"`,
    `Goal: ${args.goal}`,
    args.visual ? `Visual: include one ${args.visual} block in this section.` : "",
    args.guidance ? `Guidance: ${args.guidance}` : "",
    "",
    'Reply with the section JSON object ONLY: { "title": string, "blocks": Block[] }.',
  ]
    .filter(Boolean)
    .join("\n")
}
