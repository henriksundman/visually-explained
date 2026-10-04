import { z } from "zod"

export const idSchema = z.string().min(1).optional()

export const presentationSchema = z.enum(["auto", "text", "figure"])
export type Presentation = z.infer<typeof presentationSchema>

export const stepSchema = z.object({
  title: z.string().min(1),
  detail: z.string().min(1).optional(),
})
export type Step = z.infer<typeof stepSchema>

export const stepListBlockSchema = z.object({
  id: idSchema,
  type: z.literal("step-list"),
  steps: z.array(stepSchema).min(1),
})
export type StepListBlock = z.infer<typeof stepListBlockSchema>

export const workedExampleBlockSchema = z.object({
  id: idSchema,
  type: z.literal("worked-example"),
  problem: z.string().min(1),
  steps: z.array(stepSchema).min(1),
  result: z.string().min(1),
})
export type WorkedExampleBlock = z.infer<typeof workedExampleBlockSchema>

export const derivationStepSchema = z.object({
  expression: z.string().min(1),
  note: z.string().min(1).optional(),
})
export const derivationBlockSchema = z.object({
  id: idSchema,
  type: z.literal("derivation"),
  steps: z.array(derivationStepSchema).min(1),
  conclusion: z.string().min(1).optional(),
})
export type DerivationBlock = z.infer<typeof derivationBlockSchema>

export const conceptBlockSchema = z.object({
  id: idSchema,
  type: z.literal("concept"),
  term: z.string().min(1),
  definition: z.string().min(1),
  intuition: z.string().min(1).optional(),
  analogy: z.string().min(1).optional(),
})
export type ConceptBlock = z.infer<typeof conceptBlockSchema>

export const comparisonBlockSchema = z.object({
  id: idSchema,
  type: z.literal("comparison"),
  items: z.array(z.object({ name: z.string().min(1) })).min(2),
  dimensions: z
    .array(
      z.object({
        name: z.string().min(1),
        values: z.array(z.string()),
      }),
    )
    .min(1),
})
export type ComparisonBlock = z.infer<typeof comparisonBlockSchema>

export const causeEffectBlockSchema = z.object({
  id: idSchema,
  type: z.literal("cause-effect"),
  chain: z.array(z.object({ because: z.string().min(1), therefore: z.string().min(1) })).min(1),
  presentation: presentationSchema.optional(),
})
export type CauseEffectBlock = z.infer<typeof causeEffectBlockSchema>

export const dataCalloutBlockSchema = z.object({
  id: idSchema,
  type: z.literal("data-callout"),
  metric: z.string().min(1),
  label: z.string().min(1),
  delta: z.string().min(1).optional(),
  trend: z.enum(["up", "down", "flat"]).optional(),
  series: z.array(z.number()).min(2).max(24).optional(),
  presentation: presentationSchema.optional(),
  context: z.string().min(1).optional(),
  // Host dataset key: materializes data fields at render time (real-data spec §3).
  dataset: z.string().min(1).optional(),
})
export type DataCalloutBlock = z.infer<typeof dataCalloutBlockSchema>

export const timelineBlockSchema = z.object({
  id: idSchema,
  type: z.literal("timeline"),
  events: z
    .array(
      z.object({
        when: z.string().min(1),
        what: z.string().min(1),
        detail: z.string().min(1).optional(),
        tip: z.string().min(1).max(200).optional(),
      }),
    )
    .min(1),
  presentation: presentationSchema.optional(),
  // Host dataset key: materializes data fields at render time (real-data spec §3).
  dataset: z.string().min(1).optional(),
})
export type TimelineBlock = z.infer<typeof timelineBlockSchema>

export const calloutBlockSchema = z.object({
  id: idSchema,
  type: z.literal("callout"),
  variant: z.enum(["note", "tip", "warning"]),
  body: z.string().min(1),
})
export type CalloutBlock = z.infer<typeof calloutBlockSchema>

export const textBlockSchema = z.object({
  id: idSchema,
  type: z.literal("text"),
  body: z.string().min(1),
})
export type TextBlock = z.infer<typeof textBlockSchema>

export const codeBlockSchema = z.object({
  id: idSchema,
  type: z.literal("code"),
  language: z.string().min(1).optional(),
  // Display-snippet cap: bounds the highlighter's regex pass (ReDoS
  // defense-in-depth — the TOKEN_RE is linear-shaped but unbounded input is
  // still attacker-controlled work). Salvage-degraded at render.
  code: z.string().min(1).max(20000),
})
export type CodeBlock = z.infer<typeof codeBlockSchema>

// Recursion through z.lazy needs an explicit type annotation (zod docs pattern).
export interface StackBlock {
  id?: string
  type: "stack"
  blocks: Block[]
}

export type Block =
  | StepListBlock
  | WorkedExampleBlock
  | DerivationBlock
  | ConceptBlock
  | ComparisonBlock
  | CauseEffectBlock
  | DataCalloutBlock
  | TimelineBlock
  | CalloutBlock
  | TextBlock
  | CodeBlock
  | StackBlock
  | DiagramBlock
  | ChartBlock
  | FigureBlock
  | SourcesBlock
  | QuizBlock
  | ImageBlock

export const stackBlockSchema = z.object({
  id: idSchema,
  type: z.literal("stack"),
  // Children are z.unknown() on purpose: strict child parsing would let one
  // malformed child invalidate the whole stack. Leniency happens at render
  // time, where invalid children are skipped and reported individually.
  blocks: z.array(z.unknown()),
})

export const sourcesBlockSchema = z.object({
  id: idSchema,
  type: z.literal("sources"),
  title: z.string().min(1).max(200).optional(),
  items: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        title: z.string().min(1).max(200),
        url: z.string().min(1).max(500).optional(),
        detail: z.string().min(1).max(400).optional(),
      }),
    )
    .min(1)
    .max(24),
})
export type SourcesBlock = z.infer<typeof sourcesBlockSchema>

export const quizOptionSchema = z.object({
  text: z.string().min(1).max(300),
  why: z.string().min(1).max(400).optional(),
})
export type QuizOption = z.infer<typeof quizOptionSchema>

export const quizBlockSchema = z.object({
  id: idSchema,
  type: z.literal("quiz"),
  question: z.string().min(1).max(500),
  // 2-6 options (retrieval-practice spec §3); the answer is a 0-based index,
  // range-checked at render time (cross-field, so not expressible here).
  options: z.array(quizOptionSchema).min(2).max(6),
  answer: z.number().int().min(0),
  explanation: z.string().min(1).max(500).optional(),
})
export type QuizBlock = z.infer<typeof quizBlockSchema>

export const imageBlockSchema = z.object({
  id: idSchema,
  type: z.literal("image"),
  // Host catalog key, resolved at render time (image spec §4.1).
  image: z.string().min(1),
  caption: z.string().min(1).max(300).optional(),
})
export type ImageBlock = z.infer<typeof imageBlockSchema>

export const blockUnionSchema: z.ZodType<Block> = z.lazy(() =>
  z.discriminatedUnion("type", [
    stepListBlockSchema,
    workedExampleBlockSchema,
    derivationBlockSchema,
    conceptBlockSchema,
    comparisonBlockSchema,
    causeEffectBlockSchema,
    dataCalloutBlockSchema,
    timelineBlockSchema,
    calloutBlockSchema,
    textBlockSchema,
    codeBlockSchema,
    stackBlockSchema,
    diagramBlockSchema,
    chartBlockSchema,
    figureBlockSchema,
    sourcesBlockSchema,
    quizBlockSchema,
    imageBlockSchema,
  ]) as unknown as z.ZodType<Block>,
)

export const explanationSchema = z.object({
  version: z.literal(1),
  title: z.string().min(1).optional(),
  summary: z.string().min(1).optional(),
  blocks: z.array(blockUnionSchema),
})
export type Explanation = z.infer<typeof explanationSchema>

export const diagramNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  shape: z.enum(["box", "round", "pill", "note"]).optional(),
  // Hover explanation for the interactivity layer (events spec §3).
  tip: z.string().min(1).max(200).optional(),
})
export type DiagramNode = z.infer<typeof diagramNodeSchema>

export const diagramEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  label: z.string().min(1).optional(),
  kind: z.enum(["causes", "leads", "part-of", "conflict"]).optional(),
})
export type DiagramEdge = z.infer<typeof diagramEdgeSchema>

export const diagramBlockSchema = z.object({
  id: idSchema,
  type: z.literal("diagram"),
  nodes: z.array(diagramNodeSchema).min(1),
  edges: z.array(diagramEdgeSchema),
  direction: z.enum(["lr", "tb"]).optional(),
})
export type DiagramBlock = z.infer<typeof diagramBlockSchema>

export const chartBlockSchema = z.object({
  id: idSchema,
  type: z.literal("chart"),
  kind: z.enum(["bar", "line"]),
  // Lenient like stack children: per-point validation happens at render time,
  // so one malformed point drops the point instead of the whole chart (spec §1).
  points: z.array(z.unknown()),
  unit: z.string().min(1).optional(),
  caption: z.string().min(1).optional(),
  // Host dataset key: materializes data fields at render time (real-data spec §3).
  dataset: z.string().min(1).optional(),
})
export type ChartBlock = z.infer<typeof chartBlockSchema>

// Identifier that is not an evaluator constant: evalExpr resolves PI/E/TAU
// before the param/derived env, so a binding with one of those exact names
// would be silently dead. Substrings (PI_x, TIME, E2) are fine.
const figureNamePattern = /^(?!(?:PI|E|TAU)$)[A-Za-z_][A-Za-z0-9_]*$/
const figureNameMessage = "must be an identifier other than the evaluator constants PI/E/TAU"

export const figureParamSchema = z
  .object({
    name: z.string().regex(figureNamePattern, figureNameMessage),
    min: z.number().finite(),
    max: z.number().finite(),
    step: z.number().finite().positive(),
    initial: z.number().finite(),
  })
  .refine(p => p.min <= p.initial && p.initial <= p.max, { message: "initial must lie within [min, max]" })
export type FigureParam = z.infer<typeof figureParamSchema>

export const figureDerivedSchema = z.object({
  name: z.string().regex(figureNamePattern, figureNameMessage),
  expr: z.string().min(1).max(80),
})
export type FigureDerived = z.infer<typeof figureDerivedSchema>

// Element ids, NOT figureNamePattern: a draggable handle is matched against a
// `data-el-id`, which uses the authored element-id rule (hyphens allowed).
// figureNamePattern exists to keep evaluator bindings clear of PI/E/TAU and
// correctly rejects hyphens, so reusing it here would refuse valid ids.
const figureElementIdPattern = /^[\w][\w-]*$/

export const figureDraggableSchema = z.object({
  id: z.string().regex(figureElementIdPattern, "must be an element id"),
  x: z.string().optional(),
  y: z.string().optional(),
})

export const figureBlockSchema = z.object({
  id: idSchema,
  type: z.literal("figure"),
  title: z.string().min(1).optional(),
  caption: z.string().min(1).optional(),
  width: z.number().finite().int().min(80).max(1200).optional(),
  height: z.number().finite().int().min(60).max(1200).optional(),
  // Identifier-validated on purpose: sweep names reach aria-labels, so only a
  // bare identifier may pass. Reserved evaluator constants are rejected (a
  // sweep over PI would animate nothing). Unknown names fall back to
  // params[0] at runtime.
  sweep: z.string().regex(figureNamePattern, figureNameMessage).optional(),
  params: z.array(figureParamSchema).max(8).optional(),
  derived: z.array(figureDerivedSchema).max(8).optional(),
  // Direct-manipulation handles (drag-to-vary spec §4). A handle names an
  // element and the params its drag writes; the element's own coordinate must
  // be expression-driven. Unparseable entries drop individually.
  draggable: z.array(figureDraggableSchema).max(16).optional(),
  // Lenient like stack children / chart points: elements are parsed at render
  // time so one malformed element drops alone instead of the whole figure.
  elements: z.array(z.unknown()),
})
export type FigureBlock = z.infer<typeof figureBlockSchema>

// ---- mind-map ------------------------------------------------------------
// The node tree is validated by an EXPLICITLY UNROLLED ladder, not a
// recursive `z.lazy()`. A lazy schema re-enters the parser for every level of
// the input, so a deep enough tree overflows the JS stack: `safeParse` throws
// `RangeError` and does not catch it. `salvage.ts` calls `entry.schema.safeParse`
// with no try/catch, so that exception escapes `renderExplanation` and takes
// the whole render pass down — the same failure shape as the Temml TypeError
// fixed on 2026-10-04: a boundary whose error assumption was narrower than
// reality. An unrolled ladder makes validation O(1) in depth: level 13 simply
// matches nothing, so an absurd tree is an ordinary validation failure.
//
// MIND_MAP_SCHEMA_DEPTH is a CRASH guard (the deepest tree we can parse at
// all), not a design limit. The legibility policy is separate and much lower:
// see MIND_MAP_MAX_DEPTH in primitives/mind-map.
//
// It is paid for in the prompt: llm.ts runs this ladder through
// `z.toJSONSchema` for the model-facing schema, and each level is inlined in
// full. 12 levels costs ~2.2 KB against an 8.3 KB explanationJsonSchema today
// (~27% more prompt). Lowering MIND_MAP_SCHEMA_DEPTH is the dial if that
// matters; 12 is the largest depth the layout can usefully draw anyway.
export const MIND_MAP_SCHEMA_DEPTH = 12

// Siblings cap. Breadth is nearly free in layoutTree (each column hugs its own
// widest label), so this is a legibility/authoring bound rather than a width
// bound.
export const MIND_MAP_MAX_CHILDREN = 8

const treeLabel = z.string().min(1)

// `min(1)` so `children: []` is a validation failure rather than silently
// meaning "leaf" — the two spellings must not render identically, because a
// model that emits `children: []` is telling us it lost its children.
const treeChildren = <T extends z.ZodTypeAny>(inner: T) =>
  z.array(inner).min(1).max(MIND_MAP_MAX_CHILDREN).optional()

/**
 * Level 12, and any leaf: a label with no children.
 *
 * `.strict()` is load-bearing, not tidiness. zod's default object mode is
 * "strip": unknown keys are dropped rather than rejected. So a non-strict leaf
 * accepts `children` at level 12 and SILENTLY DISCARDS the entire subtree
 * below it — a 500-deep chain validates as a clean 12-deep tree, losing 488
 * nodes with no diagnostic at all. That is the same failure class as the
 * unguarded inline-math scanner fixed on 2026-10-04 (open thread 2): input that
 * looks fine and renders wrong, silently. Strict makes an over-deep tree an
 * ordinary validation failure, which is the whole point of the ladder.
 */
const treeLeaf = z.object({ label: treeLabel }).strict()

/** Level k (1..11): a label whose children are level k-1 nodes. */
const treeAt = (inner: z.ZodTypeAny) => z.object({ label: treeLabel, children: treeChildren(inner) })

const t12 = treeLeaf
const t11 = treeAt(t12)
const t10 = treeAt(t11)
const t9 = treeAt(t10)
const t8 = treeAt(t9)
const t7 = treeAt(t8)
const t6 = treeAt(t7)
const t5 = treeAt(t6)
const t4 = treeAt(t5)
const t3 = treeAt(t4)
const t2 = treeAt(t3)
const t1 = treeAt(t2)

export const mindMapNodeSchema = t1
export type MindMapNode = z.infer<typeof mindMapNodeSchema>

export const mindMapBlockSchema = z.object({
  id: idSchema,
  type: z.literal("mind-map"),
  root: mindMapNodeSchema,
  presentation: presentationSchema.optional(),
})
export type MindMapBlock = z.infer<typeof mindMapBlockSchema>
