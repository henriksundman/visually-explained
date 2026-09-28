import { z } from "zod"

export const idSchema = z.string().min(1).optional()

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
})
export type CauseEffectBlock = z.infer<typeof causeEffectBlockSchema>

export const dataCalloutBlockSchema = z.object({
  id: idSchema,
  type: z.literal("data-callout"),
  metric: z.string().min(1),
  label: z.string().min(1),
  delta: z.string().min(1).optional(),
  trend: z.enum(["up", "down", "flat"]).optional(),
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
      }),
    )
    .min(1),
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
  | StackBlock
  | DiagramBlock
  | ChartBlock

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
    stackBlockSchema,
    diagramBlockSchema,
    chartBlockSchema,
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
})
export type ChartBlock = z.infer<typeof chartBlockSchema>
