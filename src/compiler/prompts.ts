import { BLOCK_TYPE_DOCS, MATH_RULES } from "../core/blockTypes"
import type { ImageRef } from "../core/images"
import type { SourceExcerpt } from "./client"

/** Catalog menu (image spec §6): the record key + subject ONLY. The key is
 *  exactly what the model writes into `image` and what resolveImage looks up,
 *  so the prompt and the renderer cannot drift. The LLM is text-only and has
 *  never seen these pictures — no URL, no alt, just a word for what each
 *  shows. Host key order, unsorted. */
function imageMenuBlock(images: Record<string, ImageRef>): string {
  return [
    "Images available (place by key where one earns its place):",
    ...Object.entries(images).map(([key, r]) => `- ${key}: ${r.subject}`),
    "",
    "Place an image only to anchor an analogy or set a scene. Images never illustrate a derivation — a drawn figure does that better. Put no text in the image itself: labels belong in the caption. The explanation a picture carries goes in that same image block's body, not in a separate text block beside it.",
  ].join("\n")
}

/** Outline-visible grounding list (spec §4): ids + titles (+ urls) only — the
 *  outline plans structure, it does not read excerpts. */
function outlineSourcesBlock(sources: SourceExcerpt[]): string {
  return [
    "Sources available (cite by id; sections must stay groundable in these):",
    ...sources.map(s => `- ${s.id}: ${s.title}${s.url ? ` — ${s.url}` : ""}`),
  ].join("\n")
}

/** Writer-visible grounding list (spec §4): full excerpt text + the citation
 *  contract. Excerpt order is host order — no sorting. */
function sectionSourcesBlock(sources: SourceExcerpt[]): string {
  return [
    "Sources for this document (ground claims in these):",
    ...sources.flatMap(s => [`[${s.id}] ${s.title}: ${s.text}`, ...(s.url ? [`[url: ${s.url}]`] : [])]),
    "",
    "Citation rules: cite the source a claim comes from as [label](#source-<id>) (or [label](url) when the source has one). Ground claims in these sources; if the sources don't cover something, leave it out rather than inventing facts or citations.",
  ].join("\n")
}

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

export function outlineUserPrompt(
  topic: string,
  guidance?: string,
  sources?: SourceExcerpt[],
  checks?: boolean,
  images?: Record<string, ImageRef>,
): string {
  return [
    `Topic: ${topic}`,
    guidance ? `Guidance: ${guidance}` : "",
    checks
      ? 'Checks: mark sections with "check": true where a short quiz would consolidate the learning — not every section; never the first; skip reference-style ones.'
      : "",
    sources && sources.length > 0 ? outlineSourcesBlock(sources) : "",
    images && Object.keys(images).length > 0 ? imageMenuBlock(images) : "",
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
- Put no HTML in any field. Inline emphasis only: **bold**, *italic*, \`code\`, [text](url).
${MATH_RULES}
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
  sources?: SourceExcerpt[]
  check?: boolean
  images?: Record<string, ImageRef>
  image?: string
}): string {
  return [
    `Write section ${args.index + 1} of the document: "${args.title}"`,
    `Goal: ${args.goal}`,
    args.visual ? `Visual: include one ${args.visual} block in this section.` : "",
    args.check
      ? "End this section with exactly ONE quiz block (the retrieval check the outline planned): question answerable from this section alone, 2-4 options, plausible distractors whose why names the misconception, answer as the 0-based index."
      : "",
    args.image
      ? `Include exactly ONE image block in this section, using the catalog key "${args.image}" the outline planned.`
      : "",
    args.guidance ? `Guidance: ${args.guidance}` : "",
    args.sources && args.sources.length > 0 ? sectionSourcesBlock(args.sources) : "",
    args.images && Object.keys(args.images).length > 0 ? imageMenuBlock(args.images) : "",
    "",
    'Reply with the section JSON object ONLY: { "title": string, "blocks": Block[] }.',
  ]
    .filter(Boolean)
    .join("\n")
}
