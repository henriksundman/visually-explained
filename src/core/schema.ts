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
  code: z.string().min(1),
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

export const stackBlockSchema = z.object({
  id: idSchema,
  type: z.literal("stack"),
  // Children are z.unknown() on purpose: strict child parsing would let one
  // malformed child invalidate the whole stack. Leniency happens at render
  // time, where invalid children are skipped and reported individually.
  blocks: z.array(z.unknown()),
})

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
  // Lenient like stack children / chart points: elements are parsed at render
  // time so one malformed element drops alone instead of the whole figure.
  elements: z.array(z.unknown()),
})
export type FigureBlock = z.infer<typeof figureBlockSchema>
