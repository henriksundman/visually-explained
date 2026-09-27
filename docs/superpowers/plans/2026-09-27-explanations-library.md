# Explanations Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `explanations`, a TypeScript library that renders LLM-produced explanation trees (a typed JSON IR) as styleable semantic HTML, with a thin React adapter for Next.js.

**Architecture:** LLM → IR (JSON, zod-schema'd) → lenient salvage/validation → deterministic HTML string rendering via a primitive registry → themes via CSS custom properties → React server-component adapter. Spec: `docs/superpowers/specs/2026-09-27-explanations-library-design.md`.

**Tech Stack:** TypeScript (strict), zod v4 (only runtime dep), vitest, tsup, React 19 (peer/dev dep, type-import only in adapter).

## Global Constraints

- Runtime dependency: **zod ^4 only**. React is a peer/dev dependency. No other runtime deps, ever.
- Every string that came from the IR is escaped. Inline formatting is only `**bold**`, `*italic*`, `` `code` ``, parsed by the library — raw HTML is never rendered.
- All emitted CSS class names are prefixed `exp-`. Zero inline styles in rendered HTML.
- Lenient by default (degrade + warn); `strict: true` throws at the top level.
- Block catalog is frozen for v1: 9 composites (`step-list`, `worked-example`, `derivation`, `concept`, `comparison`, `cause-effect`, `data-callout`, `timeline`, `callout`) + escape hatch (`stack`, `text`). IR `version` is literal `1`.
- `stack` nests at most one stack deep (`MAX_STACK_DEPTH = 2`); deeper stacks flatten with a warning.
- Layout: `src/core/` (schema, inline, registry, salvage, validate, render, llm), `src/primitives/` (one file per block type), `src/react/`, `src/themes/`, `tests/`.
- TDD: write the failing test first, watch it fail, implement, watch it pass, commit. One commit per task.
- Package manager: npm. Node >= 20.

---

### Task 1: Package scaffold + IR schema (zod)

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`
- Create: `src/core/schema.ts`
- Test: `tests/schema.test.ts`

**Interfaces:**
- Produces: `explanationSchema` (z.ZodObject), `blockUnionSchema` (z.ZodType<Block>), per-block schemas (`stepListBlockSchema`, `workedExampleBlockSchema`, `derivationBlockSchema`, `conceptBlockSchema`, `comparisonBlockSchema`, `causeEffectBlockSchema`, `dataCalloutBlockSchema`, `timelineBlockSchema`, `calloutBlockSchema`, `textBlockSchema`, `stackBlockSchema`), inferred types `Block`, `StackBlock`, `Explanation`, `Step`, plus `idSchema`, `stepSchema`, `derivationStepSchema`.

- [ ] **Step 1: Create scaffold files**

`package.json`:

```json
{
  "name": "explanations",
  "version": "0.1.0",
  "description": "LLM-generated visual explanations as styleable HTML",
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "tsup": "^8.0.0",
    "typescript": "^5.6.0",
    "vitest": "^3.0.0"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src", "tests", "tsup.config.ts", "vitest.config.ts"]
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
})
```

`.gitignore`:

```
node_modules/
dist/
```

- [ ] **Step 2: Install dependencies**

Run: `npm install`
Expected: installs cleanly, creates `package-lock.json`.

- [ ] **Step 3: Write the failing test**

`tests/schema.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { explanationSchema } from "../src/core/schema"

describe("explanationSchema", () => {
  it("parses an explanation containing every block type", () => {
    const ir = {
      version: 1,
      title: "T",
      summary: "S",
      blocks: [
        { type: "text", body: "hello" },
        { type: "step-list", steps: [{ title: "a" }, { title: "b", detail: "d" }] },
        { type: "worked-example", problem: "p", steps: [{ title: "s" }], result: "r" },
        { type: "derivation", steps: [{ expression: "x = 1", note: "n" }], conclusion: "c" },
        { type: "concept", term: "t", definition: "d", intuition: "i", analogy: "a" },
        {
          type: "comparison",
          items: [{ name: "A" }, { name: "B" }],
          dimensions: [{ name: "D", values: ["1", "2"] }],
        },
        { type: "cause-effect", chain: [{ because: "b", therefore: "t" }] },
        { type: "data-callout", metric: "42%", label: "L", delta: "+1", trend: "up", context: "c" },
        { type: "timeline", events: [{ when: "1990", what: "w" }] },
        { type: "callout", variant: "tip", body: "b" },
        { type: "stack", blocks: [{ type: "text", body: "nested" }] },
      ],
    }
    expect(explanationSchema.safeParse(ir).success).toBe(true)
  })

  it("rejects a wrong version", () => {
    expect(explanationSchema.safeParse({ version: 2, blocks: [] }).success).toBe(false)
  })

  it("rejects unknown block types", () => {
    expect(explanationSchema.safeParse({ version: 1, blocks: [{ type: "nope" }] }).success).toBe(false)
  })

  it("accepts stack-in-stack (depth is a render-time concern, not schema)", () => {
    const deep = {
      type: "stack",
      blocks: [{ type: "stack", blocks: [{ type: "stack", blocks: [{ type: "text", body: "x" }] }] }],
    }
    expect(explanationSchema.safeParse({ version: 1, blocks: [deep] }).success).toBe(true)
  })

  it("rejects blocks missing required content", () => {
    expect(explanationSchema.safeParse({ version: 1, blocks: [{ type: "text" }] }).success).toBe(false)
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run tests/schema.test.ts`
Expected: FAIL — cannot resolve `../src/core/schema`.

- [ ] **Step 5: Write `src/core/schema.ts`**

```ts
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

export const stackBlockSchema = z.object({
  id: idSchema,
  type: z.literal("stack"),
  blocks: z.array(z.lazy(() => blockUnionSchema)),
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
  ]) as unknown as z.ZodType<Block>,
)

export const explanationSchema = z.object({
  version: z.literal(1),
  title: z.string().min(1).optional(),
  summary: z.string().min(1).optional(),
  blocks: z.array(blockUnionSchema),
})
export type Explanation = z.infer<typeof explanationSchema>
```

(The single `as unknown as z.ZodType<Block>` cast is confined to the recursive union; if zod v4 infers it cleanly without the cast in your installed version, drop it.)

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/schema.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore src/core/schema.ts tests/schema.test.ts
git commit -m "feat(schema): define IR zod schema for all v1 block types"
```

---

### Task 2: Inline rich text (escape + tiny markdown subset)

**Files:**
- Create: `src/core/inline.ts`
- Test: `tests/inline.test.ts`

**Interfaces:**
- Produces: `escapeHtml(s: string): string`, `renderInline(text: string): string` — later tasks use both for every IR string.

- [ ] **Step 1: Write the failing test**

`tests/inline.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { escapeHtml, renderInline } from "../src/core/inline"

describe("escapeHtml", () => {
  it("escapes html-significant characters", () => {
    expect(escapeHtml(`<img src="x" onerror='alert(1)'>&`)).toBe(
      "&lt;img src=&quot;x&quot; onerror=&#39;alert(1)&#39;&gt;&amp;",
    )
  })
})

describe("renderInline", () => {
  it("leaves plain text untouched", () => {
    expect(renderInline("hello world")).toBe("hello world")
  })

  it("converts bold, italic, and code markers", () => {
    expect(renderInline("**bold** and *italic* and `code`")).toBe(
      "<strong>bold</strong> and <em>italic</em> and <code>code</code>",
    )
  })

  it("escapes html before applying markers", () => {
    expect(renderInline("<script>alert(1)</script>")).toBe("&lt;script&gt;alert(1)&lt;/script&gt;")
  })

  it("code spans win over other markers", () => {
    expect(renderInline("`**not bold**`")).toBe("<code>**not bold**</code>")
  })

  it("leaves unmatched markers literal", () => {
    expect(renderInline("*unclosed and `unticked")).toBe("*unclosed and `unticked")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/inline.test.ts`
Expected: FAIL — cannot resolve `../src/core/inline`.

- [ ] **Step 3: Write `src/core/inline.ts`**

```ts
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/**
 * Renders the v1 inline subset: **bold**, *italic*, `code`.
 * Code spans are split out first so their content is never
 * further processed; everything is HTML-escaped, so no raw
 * HTML can pass through. Nesting is not supported in v1;
 * markers render literally when unmatched.
 */
export function renderInline(text: string): string {
  const parts = text.split(/(`[^`]+`)/g)
  return parts
    .map(part => {
      if (part.length >= 2 && part.startsWith("`") && part.endsWith("`")) {
        return `<code>${escapeHtml(part.slice(1, -1))}</code>`
      }
      let out = escapeHtml(part)
      out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      out = out.replace(/\*([^*]+)\*/g, "<em>$1</em>")
      return out
    })
    .join("")
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/inline.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/core/inline.ts tests/inline.test.ts
git commit -m "feat(inline): escaped inline text with bold/italic/code subset"
```

---

### Task 3: Registry, lenient salvage, validator, and the `text` primitive

**Files:**
- Create: `src/core/registry.ts`, `src/core/salvage.ts`, `src/core/validate.ts`, `src/primitives/text.ts`
- Test: `tests/salvage.test.ts`, `tests/validate.test.ts`

**Interfaces:**
- Consumes: `textBlockSchema`/`TextBlock` (Task 1), `renderInline` (Task 2).
- Produces:
  - `MAX_STACK_DEPTH = 2`, `interface RenderContext { depth: number; addWarning(message: string): void; renderChildren(blocks: unknown[], depth?: number): string }`, `type BlockRenderer<T> = (block: T, ctx: RenderContext) => string`, `interface Primitive { schema: z.ZodTypeAny; render: BlockRenderer<any> }`, `registry: Record<string, Primitive>`, `registerPrimitive(type, primitive)`
  - `type BlockKind = "valid" | "unknown" | "invalid"`, `interface SalvagedBlock { index: number; type: string; kind: BlockKind; data: Block | Record<string, unknown> | null }`, `interface Diagnostic { index: number | null; code: "invalid-explanation" | "wrong-version" | "invalid-block" | "unknown-type"; message: string }`, `interface SalvagedExplanation { version: number | null; title: string | null; summary: string | null; blocks: SalvagedBlock[]; diagnostics: Diagnostic[]; warnings: string[] }`, `salvageBlock(raw, index, diagnostics): SalvagedBlock`, `salvageExplanation(input): SalvagedExplanation`
  - `validateExplanation(input): { ok: boolean; diagnostics: Diagnostic[] }`
  - `renderText(block: TextBlock): string` + self-registration of `"text"` on import.

- [ ] **Step 1: Write the failing tests**

`tests/salvage.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import "../src/primitives/text" // registers the "text" primitive
import { salvageBlock, salvageExplanation, type Diagnostic } from "../src/core/salvage"

describe("salvageBlock", () => {
  it("marks a valid block", () => {
    const diagnostics: Diagnostic[] = []
    const b = salvageBlock({ type: "text", body: "hi" }, 0, diagnostics)
    expect(b.kind).toBe("valid")
    expect(b.type).toBe("text")
    expect(diagnostics).toEqual([])
  })

  it("marks unknown types for fallback rendering", () => {
    const diagnostics: Diagnostic[] = []
    const b = salvageBlock({ type: "chart", title: "Sales" }, 1, diagnostics)
    expect(b.kind).toBe("unknown")
    expect(b.data).toEqual({ type: "chart", title: "Sales" })
    expect(diagnostics[0]?.code).toBe("unknown-type")
  })

  it("marks blocks missing required content as invalid", () => {
    const diagnostics: Diagnostic[] = []
    const b = salvageBlock({ type: "text" }, 2, diagnostics)
    expect(b.kind).toBe("invalid")
    expect(b.data).toBeNull()
    expect(diagnostics[0]?.code).toBe("invalid-block")
    expect(diagnostics[0]?.message).toContain("skipped")
  })

  it("marks non-objects and missing type as invalid", () => {
    const diagnostics: Diagnostic[] = []
    expect(salvageBlock("nope", 0, diagnostics).kind).toBe("invalid")
    expect(salvageBlock({ body: "no type" }, 1, diagnostics).kind).toBe("invalid")
  })
})

describe("salvageExplanation", () => {
  it("salvages title, summary, and valid blocks", () => {
    const s = salvageExplanation({
      version: 1,
      title: "T",
      summary: "S",
      blocks: [{ type: "text", body: "x" }],
    })
    expect(s.title).toBe("T")
    expect(s.summary).toBe("S")
    expect(s.blocks).toHaveLength(1)
    expect(s.diagnostics).toEqual([])
  })

  it("warns on wrong version and tolerates missing optionals", () => {
    const s = salvageExplanation({ version: 2, blocks: [] })
    expect(s.version).toBe(2)
    expect(s.title).toBeNull()
    expect(s.diagnostics[0]?.code).toBe("wrong-version")
    expect(s.warnings[0]).toContain("expected version 1")
  })

  it("treats non-object input as an empty explanation with a diagnostic", () => {
    const s = salvageExplanation("junk")
    expect(s.blocks).toEqual([])
    expect(s.diagnostics[0]?.code).toBe("invalid-explanation")
  })

  it("treats non-array blocks as empty with a diagnostic", () => {
    const s = salvageExplanation({ version: 1, blocks: "nope" })
    expect(s.blocks).toEqual([])
    expect(s.diagnostics[0]?.message).toContain("blocks must be an array")
  })
})
```

`tests/validate.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import "../src/primitives/text"
import { validateExplanation } from "../src/core/validate"

describe("validateExplanation", () => {
  it("reports ok for a fully valid explanation", () => {
    const r = validateExplanation({ version: 1, blocks: [{ type: "text", body: "x" }] })
    expect(r.ok).toBe(true)
    expect(r.diagnostics).toEqual([])
  })

  it("collects diagnostics for invalid input", () => {
    const r = validateExplanation({ version: 2, blocks: [{ type: "text" }] })
    expect(r.ok).toBe(false)
    expect(r.diagnostics).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/salvage.test.ts tests/validate.test.ts`
Expected: FAIL — cannot resolve modules.

- [ ] **Step 3: Write `src/core/registry.ts`**

```ts
import type { z } from "zod"
import type { Block } from "./schema"

/** A stack may contain a stack at most one level deep. */
export const MAX_STACK_DEPTH = 2

export interface RenderContext {
  depth: number
  addWarning(message: string): void
  /** Leniently renders child blocks (used by stack); depth defaults to ctx.depth + 1. */
  renderChildren(blocks: unknown[], depth?: number): string
}

export type BlockRenderer<T extends Block = Block> = (block: T, ctx: RenderContext) => string

export interface Primitive {
  schema: z.ZodTypeAny
  render: BlockRenderer<any>
}

export const registry: Record<string, Primitive> = {}

export function registerPrimitive(type: string, primitive: Primitive): void {
  registry[type] = primitive
}
```

- [ ] **Step 4: Write `src/core/salvage.ts`**

```ts
import type { Block } from "./schema"
import { registry } from "./registry"

export type BlockKind = "valid" | "unknown" | "invalid"

export interface SalvagedBlock {
  index: number
  type: string
  kind: BlockKind
  /** Parsed payload for valid blocks, raw record for unknown types, null for invalid. */
  data: Block | Record<string, unknown> | null
}

export interface Diagnostic {
  index: number | null
  code: "invalid-explanation" | "wrong-version" | "invalid-block" | "unknown-type"
  message: string
}

export interface SalvagedExplanation {
  version: number | null
  title: string | null
  summary: string | null
  blocks: SalvagedBlock[]
  diagnostics: Diagnostic[]
  warnings: string[]
}

function stringify(diagnostics: Diagnostic[]): string[] {
  return diagnostics.map(d => `[${d.code}] ${d.message}`)
}

export function salvageBlock(raw: unknown, index: number, diagnostics: Diagnostic[]): SalvagedBlock {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    diagnostics.push({ index, code: "invalid-block", message: `block ${index}: not an object` })
    return { index, type: "", kind: "invalid", data: null }
  }
  const rec = raw as Record<string, unknown>
  const type = typeof rec.type === "string" ? rec.type : null
  if (!type) {
    diagnostics.push({ index, code: "invalid-block", message: `block ${index}: missing "type"` })
    return { index, type: "", kind: "invalid", data: null }
  }
  const entry = registry[type]
  if (!entry) {
    diagnostics.push({
      index,
      code: "unknown-type",
      message: `block ${index}: unknown type "${type}", rendering fallback`,
    })
    return { index, type, kind: "unknown", data: rec }
  }
  const parsed = entry.schema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const path = issue?.path.join(".") ?? ""
    diagnostics.push({
      index,
      code: "invalid-block",
      message: `block ${index} (${type}): skipped — ${path || "payload"} ${issue?.message ?? "invalid"}`,
    })
    return { index, type, kind: "invalid", data: null }
  }
  return { index, type, kind: "valid", data: parsed.data as Block }
}

export function salvageExplanation(input: unknown): SalvagedExplanation {
  const diagnostics: Diagnostic[] = []
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    diagnostics.push({ index: null, code: "invalid-explanation", message: "explanation must be an object" })
    return { version: null, title: null, summary: null, blocks: [], diagnostics, warnings: stringify(diagnostics) }
  }
  const rec = input as Record<string, unknown>
  const version = typeof rec.version === "number" ? rec.version : null
  if (version !== 1) {
    diagnostics.push({
      index: null,
      code: "wrong-version",
      message: `expected version 1, got ${JSON.stringify(rec.version ?? null)}`,
    })
  }
  const title = typeof rec.title === "string" ? rec.title : null
  const summary = typeof rec.summary === "string" ? rec.summary : null
  if (!Array.isArray(rec.blocks)) {
    diagnostics.push({ index: null, code: "invalid-explanation", message: "blocks must be an array" })
  }
  const rawBlocks = Array.isArray(rec.blocks) ? rec.blocks : []
  const blocks = rawBlocks.map((b, i) => salvageBlock(b, i, diagnostics))
  return { version, title, summary, blocks, diagnostics, warnings: stringify(diagnostics) }
}
```

- [ ] **Step 5: Write `src/core/validate.ts`**

```ts
import { salvageExplanation, type Diagnostic } from "./salvage"

export interface ValidationResult {
  ok: boolean
  diagnostics: Diagnostic[]
}

/** Full top-level validation for dev tooling. Unknown types count as diagnostics. */
export function validateExplanation(input: unknown): ValidationResult {
  const { diagnostics } = salvageExplanation(input)
  return { ok: diagnostics.length === 0, diagnostics }
}
```

- [ ] **Step 6: Write `src/primitives/text.ts`**

```ts
import { registerPrimitive, type RenderContext } from "../core/registry"
import { textBlockSchema, type TextBlock } from "../core/schema"
import { renderInline } from "../core/inline"

export function renderText(block: TextBlock, _ctx: RenderContext): string {
  return `<div class="exp-block exp-text"><p>${renderInline(block.body)}</p></div>`
}

registerPrimitive("text", { schema: textBlockSchema, render: renderText })
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run tests/salvage.test.ts tests/validate.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 8: Commit**

```bash
git add src/core/registry.ts src/core/salvage.ts src/core/validate.ts src/primitives/text.ts tests/salvage.test.ts tests/validate.test.ts
git commit -m "feat(core): lenient salvage/validate and primitive registry with text block"
```

---

### Task 4: HTML render core (root, header, fallback, strict mode, registerAll)

**Files:**
- Create: `src/core/render.ts`, `src/core/registerAll.ts`
- Test: `tests/render.test.ts`

**Interfaces:**
- Consumes: registry/salvage/inline/text (Tasks 2–3).
- Produces:
  - `interface RenderOptions { strict?: boolean; theme?: "light" | "dark" | "none" }`, `interface RenderResult { html: string; warnings: string[] }`
  - `renderExplanation(input: unknown, opts?: RenderOptions): RenderResult`
  - `renderHeader(title: string | null, summary: string | null): string`
  - `renderBlock(type: string, data: unknown, depth?: number): string` (single block, used by the React adapter)
- `registerAll.ts` imports every primitive file for side-effect registration; grows by one import line per later task.

- [ ] **Step 1: Write the failing test**

`tests/render.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { renderExplanation } from "../src/core/render"
import "../src/core/registerAll"

describe("renderExplanation", () => {
  it("wraps explanation with root, title, and summary", () => {
    const { html, warnings } = renderExplanation({
      version: 1,
      title: "How it works",
      summary: "Short",
      blocks: [{ type: "text", body: "Body" }],
    })
    expect(html).toBe(
      `<div class="exp"><h3 class="exp-title">How it works</h3><p class="exp-summary">Short</p>` +
        `<div class="exp-block exp-text"><p>Body</p></div></div>`,
    )
    expect(warnings).toEqual([])
  })

  it("renders unknown types as a styled fallback with a warning", () => {
    const { html, warnings } = renderExplanation({ version: 1, blocks: [{ type: "chart", title: "Sales" }] })
    expect(html).toContain("exp-fallback")
    expect(html).toContain("chart")
    expect(html).toContain("Sales")
    expect(warnings.some(w => w.includes("unknown type"))).toBe(true)
  })

  it("skips invalid blocks and reports them", () => {
    const { html, warnings } = renderExplanation({
      version: 1,
      blocks: [{ type: "text" }, { type: "text", body: "ok" }],
    })
    expect((html.match(/exp-block exp-text/g) ?? []).length).toBe(1)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("skipped")
  })

  it("escapes html coming from the IR", () => {
    const { html } = renderExplanation({
      version: 1,
      blocks: [{ type: "text", body: "<img src=x onerror=alert(1)>" }],
    })
    expect(html).not.toContain("<img")
    expect(html).toContain("&lt;img")
  })

  it("strict mode throws on invalid input", () => {
    expect(() => renderExplanation({ version: 2, blocks: [] }, { strict: true })).toThrow(/version/)
  })

  it("theme option adds a theme class", () => {
    const { html } = renderExplanation({ version: 1, blocks: [] }, { theme: "dark" })
    expect(html).toBe(`<div class="exp exp-theme-dark"></div>`)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/render.test.ts`
Expected: FAIL — cannot resolve `../src/core/render`.

- [ ] **Step 3: Write `src/core/render.ts`**

```ts
import "./registerAll"
import { registry, type RenderContext } from "./registry"
import { salvageExplanation, salvageBlock, type Diagnostic, type SalvagedBlock } from "./salvage"
import { escapeHtml, renderInline } from "./inline"
import type { Block } from "./schema"

export interface RenderOptions {
  /** Throw instead of degrading when the top level is invalid. Nested stack children are always rendered leniently. */
  strict?: boolean
  /** Theme class to put on the root element. Core defaults to "none" (unstyled root); the React adapter defaults to "light". */
  theme?: "light" | "dark" | "none"
}

export interface RenderResult {
  html: string
  warnings: string[]
}

export function renderExplanation(input: unknown, opts: RenderOptions = {}): RenderResult {
  const salvaged = salvageExplanation(input)
  if (opts.strict && salvaged.diagnostics.length > 0) {
    throw new Error(`invalid explanation: ${salvaged.warnings.join("; ")}`)
  }
  const warnings: string[] = [...salvaged.warnings]
  const theme = opts.theme ?? "none"
  const themeClass = theme === "none" ? "" : ` exp-theme-${theme}`
  const inner =
    renderHeader(salvaged.title, salvaged.summary) +
    salvaged.blocks.map(b => renderSalvagedBlock(b, 1, warnings)).join("")
  return { html: `<div class="exp${themeClass}">${inner}</div>`, warnings }
}

export function renderHeader(title: string | null, summary: string | null): string {
  let out = ""
  if (title) out += `<h3 class="exp-title">${renderInline(title)}</h3>`
  if (summary) out += `<p class="exp-summary">${renderInline(summary)}</p>`
  return out
}

/** Renders a single block by type; used by the React adapter. Warnings are discarded. */
export function renderBlock(type: string, data: unknown, depth = 1): string {
  const raw = typeof data === "object" && data !== null ? { ...(data as object), type } : { type }
  const warnings: string[] = []
  const b = salvageBlock(raw, -1, warnings)
  return renderSalvagedBlock(b, depth, warnings)
}

function renderSalvagedBlock(b: SalvagedBlock, depth: number, warnings: string[]): string {
  if (b.kind === "invalid") return ""
  const entry = registry[b.type]
  if (b.kind === "unknown" || !entry) return renderFallback(b.type, b.data)
  const ctx: RenderContext = {
    depth,
    addWarning: m => warnings.push(m),
    renderChildren: (children, d) => renderChildrenLenient(children, d ?? depth + 1, warnings),
  }
  return entry.render(b.data as Block, ctx)
}

function renderChildrenLenient(children: unknown[], depth: number, warnings: string[]): string {
  const diagnostics: Diagnostic[] = []
  const blocks = children.map((raw, i) => salvageBlock(raw, i, diagnostics))
  for (const d of diagnostics) warnings.push(`[${d.code}] ${d.message}`)
  return blocks.map(b => renderSalvagedBlock(b, depth, warnings)).join("")
}

function renderFallback(type: string, data: unknown): string {
  const d = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {}
  const label = typeof d.title === "string" ? d.title : typeof d.body === "string" ? d.body : null
  return (
    `<div class="exp-block exp-fallback">` +
    `<span class="exp-fallback-label">${escapeHtml(type)}</span>` +
    (label ? `<p class="exp-fallback-body">${renderInline(label)}</p>` : "") +
    `</div>`
  )
}
```

- [ ] **Step 4: Write `src/core/registerAll.ts`**

```ts
// Side-effect imports: each primitive file self-registers.
import "../primitives/text"
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/render.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/core/render.ts src/core/registerAll.ts tests/render.test.ts
git commit -m "feat(core): lenient HTML renderer with fallback blocks and strict mode"
```

---

### Task 5: `stack` primitive (nesting + depth flattening)

**Files:**
- Create: `src/primitives/stack.ts`
- Modify: `src/core/registerAll.ts` (add one import)
- Test: `tests/stack.test.ts`

**Interfaces:**
- Consumes: `stackBlockSchema`/`StackBlock` (Task 1), `MAX_STACK_DEPTH`, `RenderContext` (Task 3).
- Produces: `renderStack(block: StackBlock, ctx: RenderContext): string`, registered as `"stack"`.

- [ ] **Step 1: Write the failing test**

`tests/stack.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { renderExplanation } from "../src/core/render"
import "../src/core/registerAll"

describe("stack", () => {
  it("renders children inside a stack wrapper", () => {
    const { html, warnings } = renderExplanation({
      version: 1,
      blocks: [{ type: "stack", blocks: [{ type: "text", body: "a" }, { type: "text", body: "b" }] }],
    })
    expect(html).toContain(`<div class="exp-block exp-stack">`)
    expect((html.match(/exp-block exp-text/g) ?? []).length).toBe(2)
    expect(warnings).toEqual([])
  })

  it("leniently salvages invalid children", () => {
    const { html, warnings } = renderExplanation({
      version: 1,
      blocks: [{ type: "stack", blocks: [{ type: "text" }, { type: "text", body: "ok" }] }],
    })
    expect((html.match(/exp-block exp-text/g) ?? []).length).toBe(1)
    expect(warnings).toHaveLength(1)
  })

  it("flattens stacks deeper than MAX_STACK_DEPTH with a warning", () => {
    const { html, warnings } = renderExplanation({
      version: 1,
      blocks: [
        {
          type: "stack",
          blocks: [{ type: "stack", blocks: [{ type: "stack", blocks: [{ type: "text", body: "deep" }] }] }],
        },
      ],
    })
    expect(html).toContain("deep")
    expect(warnings.filter(w => w.includes("stack-too-deep"))).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/stack.test.ts`
Expected: FAIL — unknown type "stack" renders fallback; assertions on `exp-stack` fail.

- [ ] **Step 3: Write `src/primitives/stack.ts`**

```ts
import { registerPrimitive, MAX_STACK_DEPTH, type RenderContext } from "../core/registry"
import { stackBlockSchema, type StackBlock } from "../core/schema"

export function renderStack(block: StackBlock, ctx: RenderContext): string {
  const childDepth = ctx.depth + 1
  if (childDepth > MAX_STACK_DEPTH) {
    ctx.addWarning(
      `[stack-too-deep] stack at depth ${ctx.depth} exceeds max nesting ${MAX_STACK_DEPTH}; rendering children at depth ${ctx.depth}`,
    )
    return `<div class="exp-block exp-stack">${ctx.renderChildren(block.blocks, ctx.depth)}</div>`
  }
  return `<div class="exp-block exp-stack">${ctx.renderChildren(block.blocks, childDepth)}</div>`
}

registerPrimitive("stack", { schema: stackBlockSchema, render: renderStack })
```

- [ ] **Step 4: Register the primitive**

`src/core/registerAll.ts`:

```ts
// Side-effect imports: each primitive file self-registers.
import "../primitives/text"
import "../primitives/stack"
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/stack.test.ts`
Expected: PASS (3 tests). Also re-run `npx vitest run tests/render.test.ts` — still PASS.

- [ ] **Step 6: Commit**

```bash
git add src/primitives/stack.ts src/core/registerAll.ts tests/stack.test.ts
git commit -m "feat(primitives): stack block with depth-limited nesting"
```

---

### Task 6: `step-list` and `worked-example`

**Files:**
- Create: `src/primitives/step-list.ts`, `src/primitives/worked-example.ts`
- Modify: `src/core/registerAll.ts` (add two imports)
- Test: `tests/steps.test.ts`

**Interfaces:**
- Consumes: `stepListBlockSchema`, `workedExampleBlockSchema`, `Step`, `StepListBlock`, `WorkedExampleBlock` (Task 1); `renderInline` (Task 2).
- Produces: `renderStepLi(step: Step, index: number): string` (shared markup), `renderStepList`, `renderWorkedExample`; registered as `"step-list"`, `"worked-example"`.

- [ ] **Step 1: Write the failing test**

`tests/steps.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { renderExplanation } from "../src/core/render"
import "../src/core/registerAll"

describe("step-list", () => {
  it("renders numbered steps with optional detail", () => {
    const { html } = renderExplanation({
      version: 1,
      blocks: [{ type: "step-list", steps: [{ title: "Mix **dry** items" }, { title: "Add eggs", detail: "One at a time" }] }],
    })
    expect(html).toContain(`<div class="exp-block exp-step-list"><ol class="exp-steps">`)
    expect(html).toContain(`<span class="exp-step-num">1</span>`)
    expect(html).toContain(`<span class="exp-step-num">2</span>`)
    expect(html).toContain(`<strong>dry</strong>`)
    expect(html).toContain(`<p class="exp-step-detail">One at a time</p>`)
  })
})

describe("worked-example", () => {
  it("renders problem, steps, and result", () => {
    const { html } = renderExplanation({
      version: 1,
      blocks: [
        { type: "worked-example", problem: "Sum 1..3", steps: [{ title: "Add", detail: "1+2+3" }], result: "6" },
      ],
    })
    expect(html).toContain(`<p class="exp-example-problem">Sum 1..3</p>`)
    expect(html).toContain(`<ol class="exp-example-steps">`)
    expect(html).toContain(`<span class="exp-step-num">1</span>`)
    expect(html).toContain(`<p class="exp-example-result">6</p>`)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/steps.test.ts`
Expected: FAIL — unknown types render fallback.

- [ ] **Step 3: Write `src/primitives/step-list.ts`**

```ts
import { registerPrimitive, type RenderContext } from "../core/registry"
import { stepListBlockSchema, type Step, type StepListBlock } from "../core/schema"
import { renderInline } from "../core/inline"

export function renderStepLi(step: Step, index: number): string {
  return (
    `<li class="exp-step">` +
    `<span class="exp-step-num">${index + 1}</span>` +
    `<div class="exp-step-body">` +
    `<p class="exp-step-title">${renderInline(step.title)}</p>` +
    (step.detail ? `<p class="exp-step-detail">${renderInline(step.detail)}</p>` : "") +
    `</div></li>`
  )
}

export function renderStepList(block: StepListBlock, _ctx: RenderContext): string {
  return `<div class="exp-block exp-step-list"><ol class="exp-steps">${block.steps
    .map((s, i) => renderStepLi(s, i))
    .join("")}</ol></div>`
}

registerPrimitive("step-list", { schema: stepListBlockSchema, render: renderStepList })
```

- [ ] **Step 4: Write `src/primitives/worked-example.ts`**

```ts
import { registerPrimitive, type RenderContext } from "../core/registry"
import { workedExampleBlockSchema, type WorkedExampleBlock } from "../core/schema"
import { renderInline } from "../core/inline"
import { renderStepLi } from "./step-list"

export function renderWorkedExample(block: WorkedExampleBlock, _ctx: RenderContext): string {
  return (
    `<div class="exp-block exp-worked-example">` +
    `<p class="exp-example-problem">${renderInline(block.problem)}</p>` +
    `<ol class="exp-example-steps">${block.steps.map((s, i) => renderStepLi(s, i)).join("")}</ol>` +
    `<p class="exp-example-result">${renderInline(block.result)}</p>` +
    `</div>`
  )
}

registerPrimitive("worked-example", { schema: workedExampleBlockSchema, render: renderWorkedExample })
```

- [ ] **Step 5: Register both**

`src/core/registerAll.ts`:

```ts
// Side-effect imports: each primitive file self-registers.
import "../primitives/text"
import "../primitives/stack"
import "../primitives/step-list"
import "../primitives/worked-example"
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/steps.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add src/primitives/step-list.ts src/primitives/worked-example.ts src/core/registerAll.ts tests/steps.test.ts
git commit -m "feat(primitives): step-list and worked-example blocks"
```

---

### Task 7: `callout` and `data-callout`

**Files:**
- Create: `src/primitives/callout.ts`, `src/primitives/data-callout.ts`
- Modify: `src/core/registerAll.ts` (add two imports)
- Test: `tests/callouts.test.ts`

**Interfaces:**
- Consumes: `calloutBlockSchema`, `dataCalloutBlockSchema` and their types (Task 1); `renderInline`, `escapeHtml` (Task 2).
- Produces: `renderCallout`, `renderDataCallout`; registered as `"callout"`, `"data-callout"`.

- [ ] **Step 1: Write the failing test**

`tests/callouts.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { renderExplanation } from "../src/core/render"
import "../src/core/registerAll"

describe("callout", () => {
  it("renders each variant class", () => {
    for (const variant of ["note", "tip", "warning"] as const) {
      const { html } = renderExplanation({ version: 1, blocks: [{ type: "callout", variant, body: "**hi**" }] })
      expect(html).toContain(`<div class="exp-block exp-callout exp-callout-${variant}">`)
      expect(html).toContain(`<p class="exp-callout-body"><strong>hi</strong></p>`)
    }
  })
})

describe("data-callout", () => {
  it("renders metric, label, delta with trend class, and context", () => {
    const { html } = renderExplanation({
      version: 1,
      blocks: [
        { type: "data-callout", metric: "42%", label: "Pass rate", delta: "+3.1", trend: "up", context: "vs last week" },
      ],
    })
    expect(html).toContain(`<span class="exp-metric">42%</span>`)
    expect(html).toContain(`<span class="exp-metric-label">Pass rate</span>`)
    expect(html).toContain(`<span class="exp-delta exp-delta-up">+3.1</span>`)
    expect(html).toContain(`<p class="exp-context">vs last week</p>`)
  })

  it("omits optional parts and escapes metric", () => {
    const { html } = renderExplanation({
      version: 1,
      blocks: [{ type: "data-callout", metric: "<x>", label: "L" }],
    })
    expect(html).toContain(`<span class="exp-metric">&lt;x&gt;</span>`)
    expect(html).not.toContain("exp-delta")
    expect(html).not.toContain("exp-context")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/callouts.test.ts`
Expected: FAIL — unknown types render fallback.

- [ ] **Step 3: Write `src/primitives/callout.ts`**

```ts
import { registerPrimitive, type RenderContext } from "../core/registry"
import { calloutBlockSchema, type CalloutBlock } from "../core/schema"
import { renderInline } from "../core/inline"

export function renderCallout(block: CalloutBlock, _ctx: RenderContext): string {
  return (
    `<div class="exp-block exp-callout exp-callout-${block.variant}">` +
    `<p class="exp-callout-body">${renderInline(block.body)}</p>` +
    `</div>`
  )
}

registerPrimitive("callout", { schema: calloutBlockSchema, render: renderCallout })
```

- [ ] **Step 4: Write `src/primitives/data-callout.ts`**

```ts
import { registerPrimitive, type RenderContext } from "../core/registry"
import { dataCalloutBlockSchema, type DataCalloutBlock } from "../core/schema"
import { escapeHtml, renderInline } from "../core/inline"

export function renderDataCallout(block: DataCalloutBlock, _ctx: RenderContext): string {
  const delta = block.delta
    ? `<span class="exp-delta${block.trend ? ` exp-delta-${block.trend}` : ""}">${escapeHtml(block.delta)}</span>`
    : ""
  const context = block.context ? `<p class="exp-context">${renderInline(block.context)}</p>` : ""
  return (
    `<div class="exp-block exp-data-callout">` +
    `<span class="exp-metric">${escapeHtml(block.metric)}</span>` +
    `<span class="exp-metric-label">${renderInline(block.label)}</span>` +
    delta +
    context +
    `</div>`
  )
}

registerPrimitive("data-callout", { schema: dataCalloutBlockSchema, render: renderDataCallout })
```

- [ ] **Step 5: Register both**

`src/core/registerAll.ts`:

```ts
// Side-effect imports: each primitive file self-registers.
import "../primitives/text"
import "../primitives/stack"
import "../primitives/step-list"
import "../primitives/worked-example"
import "../primitives/callout"
import "../primitives/data-callout"
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/callouts.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add src/primitives/callout.ts src/primitives/data-callout.ts src/core/registerAll.ts tests/callouts.test.ts
git commit -m "feat(primitives): callout variants and data-callout metric block"
```

---

### Task 8: `comparison` and `timeline`

**Files:**
- Create: `src/primitives/comparison.ts`, `src/primitives/timeline.ts`
- Modify: `src/core/registerAll.ts` (add two imports)
- Test: `tests/comparison-timeline.test.ts`

**Interfaces:**
- Consumes: `comparisonBlockSchema`, `timelineBlockSchema` and types (Task 1); `renderInline` (Task 2); `RenderContext` for mismatch warnings.
- Produces: `renderComparison`, `renderTimeline`; registered as `"comparison"`, `"timeline"`.

- [ ] **Step 1: Write the failing test**

`tests/comparison-timeline.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { renderExplanation } from "../src/core/render"
import "../src/core/registerAll"

describe("comparison", () => {
  it("renders items as columns and dimensions as rows", () => {
    const { html } = renderExplanation({
      version: 1,
      blocks: [
        {
          type: "comparison",
          items: [{ name: "RPC" }, { name: "Queue" }],
          dimensions: [{ name: "Latency", values: ["low", "higher"] }],
        },
      ],
    })
    expect(html).toContain(`<table class="exp-table">`)
    expect(html).toContain(`<th class="exp-th exp-corner"></th>`)
    expect(html).toContain(`<th class="exp-th">RPC</th>`)
    expect(html).toContain(`<th class="exp-th exp-row-th">Latency</th>`)
    expect(html).toContain(`<td class="exp-td">low</td>`)
  })

  it("pads short value lists and truncates long ones with a warning", () => {
    const { html, warnings } = renderExplanation({
      version: 1,
      blocks: [
        {
          type: "comparison",
          items: [{ name: "A" }, { name: "B" }],
          dimensions: [{ name: "D", values: ["x"] }, { name: "E", values: ["1", "2", "3"] }],
        },
      ],
    })
    expect(html).toContain(`<td class="exp-td"></td>`)
    expect((html.match(/exp-td/g) ?? []).length).toBe(4)
    expect(warnings.filter(w => w.includes("comparison-value-count"))).toHaveLength(2)
  })
})

describe("timeline", () => {
  it("renders events with optional details", () => {
    const { html } = renderExplanation({
      version: 1,
      blocks: [
        { type: "timeline", events: [{ when: "1928", what: "Penicillin", detail: "Fleming" }] },
      ],
    })
    expect(html).toContain(`<ol class="exp-timeline-events">`)
    expect(html).toContain(`<span class="exp-event-when">1928</span>`)
    expect(html).toContain(`<p class="exp-event-what">Penicillin</p>`)
    expect(html).toContain(`<p class="exp-event-detail">Fleming</p>`)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/comparison-timeline.test.ts`
Expected: FAIL — unknown types render fallback.

- [ ] **Step 3: Write `src/primitives/comparison.ts`**

```ts
import { registerPrimitive, type RenderContext } from "../core/registry"
import { comparisonBlockSchema, type ComparisonBlock } from "../core/schema"
import { renderInline } from "../core/inline"

export function renderComparison(block: ComparisonBlock, ctx: RenderContext): string {
  const n = block.items.length
  const headCells = block.items.map(i => `<th class="exp-th">${renderInline(i.name)}</th>`).join("")
  const rows = block.dimensions
    .map(dim => {
      let values = dim.values
      if (values.length < n) {
        ctx.addWarning(
          `[comparison-value-count] dimension "${dim.name}" has ${values.length} values for ${n} items; padded`,
        )
        values = [...values, ...Array<string>(n - values.length).fill("")]
      } else if (values.length > n) {
        ctx.addWarning(
          `[comparison-value-count] dimension "${dim.name}" has ${values.length} values for ${n} items; truncated`,
        )
        values = values.slice(0, n)
      }
      const cells = values.map(v => `<td class="exp-td">${renderInline(v)}</td>`).join("")
      return `<tr><th class="exp-th exp-row-th">${renderInline(dim.name)}</th>${cells}</tr>`
    })
    .join("")
  return (
    `<div class="exp-block exp-comparison">` +
    `<table class="exp-table">` +
    `<thead><tr><th class="exp-th exp-corner"></th>${headCells}</tr></thead>` +
    `<tbody>${rows}</tbody>` +
    `</table></div>`
  )
}

registerPrimitive("comparison", { schema: comparisonBlockSchema, render: renderComparison })
```

- [ ] **Step 4: Write `src/primitives/timeline.ts`**

```ts
import { registerPrimitive, type RenderContext } from "../core/registry"
import { timelineBlockSchema, type TimelineBlock } from "../core/schema"
import { renderInline } from "../core/inline"

export function renderTimeline(block: TimelineBlock, _ctx: RenderContext): string {
  const events = block.events
    .map(
      e =>
        `<li class="exp-event">` +
        `<span class="exp-event-when">${renderInline(e.when)}</span>` +
        `<p class="exp-event-what">${renderInline(e.what)}</p>` +
        (e.detail ? `<p class="exp-event-detail">${renderInline(e.detail)}</p>` : "") +
        `</li>`,
    )
    .join("")
  return `<div class="exp-block exp-timeline"><ol class="exp-timeline-events">${events}</ol></div>`
}

registerPrimitive("timeline", { schema: timelineBlockSchema, render: renderTimeline })
```

- [ ] **Step 5: Register both**

`src/core/registerAll.ts`:

```ts
// Side-effect imports: each primitive file self-registers.
import "../primitives/text"
import "../primitives/stack"
import "../primitives/step-list"
import "../primitives/worked-example"
import "../primitives/callout"
import "../primitives/data-callout"
import "../primitives/comparison"
import "../primitives/timeline"
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/comparison-timeline.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add src/primitives/comparison.ts src/primitives/timeline.ts src/core/registerAll.ts tests/comparison-timeline.test.ts
git commit -m "feat(primitives): comparison table and timeline blocks"
```

---

### Task 9: `concept`, `cause-effect`, and `derivation`

**Files:**
- Create: `src/primitives/concept.ts`, `src/primitives/cause-effect.ts`, `src/primitives/derivation.ts`
- Modify: `src/core/registerAll.ts` (add three imports)
- Test: `tests/concept-cause-derivation.test.ts`

**Interfaces:**
- Consumes: `conceptBlockSchema`, `causeEffectBlockSchema`, `derivationBlockSchema` and types (Task 1); `renderInline`, `escapeHtml` (Task 2). Note: derivation `expression` values are escaped but NOT inline-marked (math contains `*`/`_`).
- Produces: `renderConcept`, `renderCauseEffect`, `renderDerivation`; registered as `"concept"`, `"cause-effect"`, `"derivation"`.

- [ ] **Step 1: Write the failing test**

`tests/concept-cause-derivation.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { renderExplanation } from "../src/core/render"
import "../src/core/registerAll"

describe("concept", () => {
  it("renders term, definition, and labeled intuition/analogy when present", () => {
    const { html } = renderExplanation({
      version: 1,
      blocks: [
        {
          type: "concept",
          term: "Recursion",
          definition: "A function that calls itself",
          intuition: "Russian dolls",
        },
      ],
    })
    expect(html).toContain(`<p class="exp-concept-term">Recursion</p>`)
    expect(html).toContain(`<p class="exp-concept-definition">A function that calls itself</p>`)
    expect(html).toContain(`<p class="exp-concept-intuition"><span class="exp-label">Intuition</span> Russian dolls</p>`)
    expect(html).not.toContain("exp-concept-analogy")
  })
})

describe("cause-effect", () => {
  it("renders because/therefore pairs", () => {
    const { html } = renderExplanation({
      version: 1,
      blocks: [{ type: "cause-effect", chain: [{ because: "load doubled", therefore: "latency rose" }] }],
    })
    expect(html).toContain(`<ol class="exp-cause-chain">`)
    expect(html).toContain(`<p class="exp-cause"><span class="exp-label">Because</span> load doubled</p>`)
    expect(html).toContain(`<p class="exp-effect"><span class="exp-label">Therefore</span> latency rose</p>`)
  })
})

describe("derivation", () => {
  it("renders escaped expressions with optional notes and conclusion", () => {
    const { html } = renderExplanation({
      version: 1,
      blocks: [
        {
          type: "derivation",
          steps: [{ expression: "a**2 + b**2", note: "Pythagoras" }],
          conclusion: "c**2 = a**2 + b**2",
        },
      ],
    })
    expect(html).toContain(`<code class="exp-derivation-expr">a**2 + b**2</code>`)
    expect(html).toContain(`<p class="exp-derivation-note">Pythagoras</p>`)
    expect(html).toContain(`<p class="exp-derivation-conclusion">c**2 = a**2 + b**2</p>`)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/concept-cause-derivation.test.ts`
Expected: FAIL — unknown types render fallback.

- [ ] **Step 3: Write `src/primitives/concept.ts`**

```ts
import { registerPrimitive, type RenderContext } from "../core/registry"
import { conceptBlockSchema, type ConceptBlock } from "../core/schema"
import { renderInline } from "../core/inline"

export function renderConcept(block: ConceptBlock, _ctx: RenderContext): string {
  const intuition = block.intuition
    ? `<p class="exp-concept-intuition"><span class="exp-label">Intuition</span> ${renderInline(block.intuition)}</p>`
    : ""
  const analogy = block.analogy
    ? `<p class="exp-concept-analogy"><span class="exp-label">Analogy</span> ${renderInline(block.analogy)}</p>`
    : ""
  return (
    `<div class="exp-block exp-concept">` +
    `<p class="exp-concept-term">${renderInline(block.term)}</p>` +
    `<p class="exp-concept-definition">${renderInline(block.definition)}</p>` +
    intuition +
    analogy +
    `</div>`
  )
}

registerPrimitive("concept", { schema: conceptBlockSchema, render: renderConcept })
```

- [ ] **Step 4: Write `src/primitives/cause-effect.ts`**

```ts
import { registerPrimitive, type RenderContext } from "../core/registry"
import { causeEffectBlockSchema, type CauseEffectBlock } from "../core/schema"
import { renderInline } from "../core/inline"

export function renderCauseEffect(block: CauseEffectBlock, _ctx: RenderContext): string {
  const items = block.chain
    .map(
      c =>
        `<li class="exp-cause-item">` +
        `<p class="exp-cause"><span class="exp-label">Because</span> ${renderInline(c.because)}</p>` +
        `<p class="exp-effect"><span class="exp-label">Therefore</span> ${renderInline(c.therefore)}</p>` +
        `</li>`,
    )
    .join("")
  return `<div class="exp-block exp-cause-effect"><ol class="exp-cause-chain">${items}</ol></div>`
}

registerPrimitive("cause-effect", { schema: causeEffectBlockSchema, render: renderCauseEffect })
```

- [ ] **Step 5: Write `src/primitives/derivation.ts`**

```ts
import { registerPrimitive, type RenderContext } from "../core/registry"
import { derivationBlockSchema, type DerivationBlock } from "../core/schema"
import { escapeHtml, renderInline } from "../core/inline"

export function renderDerivation(block: DerivationBlock, _ctx: RenderContext): string {
  const steps = block.steps
    .map(
      s =>
        `<li class="exp-derivation-step">` +
        `<code class="exp-derivation-expr">${escapeHtml(s.expression)}</code>` +
        (s.note ? `<p class="exp-derivation-note">${renderInline(s.note)}</p>` : "") +
        `</li>`,
    )
    .join("")
  const conclusion = block.conclusion
    ? `<p class="exp-derivation-conclusion">${renderInline(block.conclusion)}</p>`
    : ""
  return `<div class="exp-block exp-derivation"><ol class="exp-derivation-steps">${steps}</ol>${conclusion}</div>`
}

registerPrimitive("derivation", { schema: derivationBlockSchema, render: renderDerivation })
```

- [ ] **Step 6: Register all three**

`src/core/registerAll.ts`:

```ts
// Side-effect imports: each primitive file self-registers.
import "../primitives/text"
import "../primitives/stack"
import "../primitives/step-list"
import "../primitives/worked-example"
import "../primitives/callout"
import "../primitives/data-callout"
import "../primitives/comparison"
import "../primitives/timeline"
import "../primitives/concept"
import "../primitives/cause-effect"
import "../primitives/derivation"
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run tests/concept-cause-derivation.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add src/primitives/concept.ts src/primitives/cause-effect.ts src/primitives/derivation.ts src/core/registerAll.ts tests/concept-cause-derivation.test.ts
git commit -m "feat(primitives): concept, cause-effect, and derivation blocks"
```

---

### Task 10: Themes (tokens + light/dark) and CSS coverage test

**Files:**
- Create: `src/themes/tokens.css`, `src/themes/light.css`, `src/themes/dark.css`, `tests/fixtures.ts`
- Test: `tests/themes.test.ts`

**Interfaces:**
- Consumes: `renderExplanation` (Task 4) and the full registry (Tasks 4–9).
- Produces: token-based CSS scoped to `.exp` with theme overrides on `.exp-theme-light` / `.exp-theme-dark`; `tests/fixtures.ts` exports `allPrimitivesIr` (reusable input covering every block type + fallback).

- [ ] **Step 1: Write the failing test**

`tests/fixtures.ts`:

```ts
export const allPrimitivesIr = {
  version: 1,
  title: "All primitives",
  summary: "One of each",
  blocks: [
    { type: "text", body: "Plain text" },
    {
      type: "step-list",
      steps: [{ title: "Step one", detail: "Detail" }, { title: "Step two" }],
    },
    { type: "worked-example", problem: "P", steps: [{ title: "S" }], result: "R" },
    { type: "derivation", steps: [{ expression: "x = 1", note: "n" }], conclusion: "y = 2" },
    { type: "concept", term: "T", definition: "D", intuition: "I", analogy: "A" },
    {
      type: "comparison",
      items: [{ name: "A" }, { name: "B" }],
      dimensions: [{ name: "Dim", values: ["1", "2"] }],
    },
    { type: "cause-effect", chain: [{ because: "B", therefore: "T" }] },
    { type: "data-callout", metric: "42%", label: "L", delta: "+1", trend: "up", context: "C" },
    { type: "timeline", events: [{ when: "1990", what: "W", detail: "D" }] },
    { type: "callout", variant: "note", body: "Body" },
    { type: "callout", variant: "tip", body: "Body" },
    { type: "callout", variant: "warning", body: "Body" },
    { type: "stack", blocks: [{ type: "stack", blocks: [{ type: "text", body: "Nested" }] }] },
    { type: "chart", title: "Unknown fallback" },
  ],
} as const
```

`tests/themes.test.ts`:

```ts
import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { renderExplanation } from "../src/core/render"
import "../src/core/registerAll"
import { allPrimitivesIr } from "./fixtures"

const cssFiles = ["tokens", "light", "dark"]

describe("themes", () => {
  it("defines every class the renderer emits", () => {
    const css = cssFiles.map(n => readFileSync(`src/themes/${n}.css`, "utf8")).join("\n")
    const defined = new Set([...css.matchAll(/\.exp-[a-z0-9-]+/g)].map(m => m[0].slice(1)))
    const { html } = renderExplanation(allPrimitivesIr)
    const used = new Set(
      [...html.matchAll(/class="([^"]+)"/g)]
        .flatMap(m => m[1]!.split(" "))
        .filter(c => c.startsWith("exp-")),
    )
    const missing = [...used].filter(c => !defined.has(c))
    expect(missing).toEqual([])
  })

  it("dark theme overrides surface tokens under .exp-theme-dark", () => {
    const dark = readFileSync("src/themes/dark.css", "utf8")
    expect(dark).toContain(".exp-theme-dark")
    expect(dark).toContain("--exp-surface")
  })

  it("light theme overrides tokens under .exp-theme-light", () => {
    const light = readFileSync("src/themes/light.css", "utf8")
    expect(light).toContain(".exp-theme-light")
    expect(light).toContain("--exp-accent")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/themes.test.ts`
Expected: FAIL — `src/themes/tokens.css` does not exist (readFileSync throws).

- [ ] **Step 3: Write `src/themes/tokens.css`** (tokens + shared structure)

```css
/* explanations — design tokens + base structure.
   Theme overrides live in light.css / dark.css scoped to .exp-theme-*.
   Consumers may override any token on .exp or any wrapper element. */

.exp {
  /* palette */
  --exp-text: #1a1d23;
  --exp-text-muted: #5c6470;
  --exp-accent: #2563eb;
  --exp-accent-soft: #dbeafe;
  --exp-surface: #ffffff;
  --exp-surface-muted: #f3f4f6;
  --exp-border: #e5e7eb;
  --exp-tip: #047857;
  --exp-tip-soft: #d1fae5;
  --exp-warning: #b45309;
  --exp-warning-soft: #fef3c7;
  --exp-up: #047857;
  --exp-down: #b91c1c;
  --exp-flat: #5c6470;

  /* shape & type */
  --exp-font: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --exp-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
  --exp-font-size: 15px;
  --exp-line-height: 1.55;
  --exp-radius: 8px;
  --exp-radius-sm: 4px;
  --exp-gap: 12px;
  --exp-pad: 16px;

  /* base */
  box-sizing: border-box;
  color: var(--exp-text);
  font-family: var(--exp-font);
  font-size: var(--exp-font-size);
  line-height: var(--exp-line-height);
}

.exp *,
.exp *::before,
.exp *::after {
  box-sizing: inherit;
}

.exp-title {
  margin: 0 0 6px;
  font-size: 1.15em;
  font-weight: 650;
}

.exp-summary {
  margin: 0 0 var(--exp-gap);
  color: var(--exp-text-muted);
}

.exp-block {
  background: var(--exp-surface);
  border: 1px solid var(--exp-border);
  border-radius: var(--exp-radius);
  padding: var(--exp-pad);
  margin: 0 0 var(--exp-gap);
}

.exp-block:last-child {
  margin-bottom: 0;
}

.exp-block p {
  margin: 0 0 6px;
}

.exp-block p:last-child {
  margin-bottom: 0;
}

.exp-text p {
  margin: 0;
}

.exp-stack {
  padding: 0;
  border: 0;
  background: transparent;
}

.exp-fallback {
  border-style: dashed;
  color: var(--exp-text-muted);
}

.exp-fallback-label {
  display: inline-block;
  font-family: var(--exp-mono);
  font-size: 0.85em;
  background: var(--exp-surface-muted);
  border-radius: var(--exp-radius-sm);
  padding: 1px 6px;
  margin-bottom: 6px;
}

.exp-fallback-body {
  margin: 0;
}

.exp-steps,
.exp-example-steps,
.exp-timeline-events,
.exp-cause-chain,
.exp-derivation-steps {
  list-style: none;
  margin: 0;
  padding: 0;
}

/* Container hooks: every emitted class must exist in CSS so consumers
   can target any part of the structure. Base chrome comes from .exp-block. */
.exp-text,
.exp-step-list,
.exp-worked-example,
.exp-derivation,
.exp-concept,
.exp-comparison,
.exp-cause-effect,
.exp-data-callout,
.exp-timeline,
.exp-callout {
  min-width: 0;
}

.exp-step {
  display: flex;
  gap: 10px;
  padding: 6px 0;
}

.exp-step + .exp-step {
  border-top: 1px solid var(--exp-border);
}

.exp-step-num {
  flex: none;
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--exp-accent-soft);
  color: var(--exp-accent);
  font-size: 0.8em;
  font-weight: 650;
}

.exp-step-body {
  min-width: 0;
}

.exp-step-title {
  font-weight: 600;
}

.exp-step-detail {
  color: var(--exp-text-muted);
  margin: 2px 0 0;
}

.exp-example-problem {
  font-weight: 600;
}

.exp-example-result {
  margin-top: var(--exp-gap);
  background: var(--exp-surface-muted);
  border-radius: var(--exp-radius-sm);
  padding: 8px 10px;
}

.exp-derivation-step {
  padding: 6px 0;
}

.exp-derivation-step + .exp-derivation-step {
  border-top: 1px solid var(--exp-border);
}

.exp-derivation-expr {
  font-family: var(--exp-mono);
  background: var(--exp-surface-muted);
  border-radius: var(--exp-radius-sm);
  padding: 2px 8px;
  display: inline-block;
}

.exp-derivation-note {
  color: var(--exp-text-muted);
  margin: 4px 0 0;
}

.exp-derivation-conclusion {
  margin: var(--exp-gap) 0 0;
  font-weight: 600;
}

.exp-concept-term {
  font-weight: 650;
  font-size: 1.05em;
}

.exp-label {
  display: inline-block;
  font-size: 0.75em;
  font-weight: 650;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--exp-text-muted);
  margin-right: 6px;
}

.exp-table {
  width: 100%;
  border-collapse: collapse;
}

.exp-th,
.exp-td {
  text-align: left;
  border-bottom: 1px solid var(--exp-border);
  padding: 6px 10px 6px 0;
}

.exp-th {
  font-weight: 650;
  color: var(--exp-text-muted);
  font-size: 0.9em;
}

.exp-row-th {
  color: var(--exp-text);
  font-weight: 600;
}

.exp-corner {
  width: 1%;
}

.exp-cause {
  color: var(--exp-text-muted);
}

.exp-effect {
  font-weight: 600;
}

.exp-cause-item + .exp-cause-item {
  border-top: 1px solid var(--exp-border);
  padding-top: 8px;
  margin-top: 8px;
}

.exp-metric {
  font-size: 1.9em;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  margin-right: 8px;
}

.exp-metric-label {
  color: var(--exp-text-muted);
}

.exp-delta {
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  margin-left: 8px;
}

.exp-delta-up {
  color: var(--exp-up);
}

.exp-delta-down {
  color: var(--exp-down);
}

.exp-delta-flat {
  color: var(--exp-flat);
}

.exp-context {
  margin: 6px 0 0;
  color: var(--exp-text-muted);
}

.exp-event {
  position: relative;
  padding: 6px 0 6px 14px;
  border-left: 2px solid var(--exp-border);
}

.exp-event::before {
  content: "";
  position: absolute;
  left: -5px;
  top: 14px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--exp-accent);
}

.exp-event-when {
  font-size: 0.85em;
  color: var(--exp-accent);
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}

.exp-event-what {
  font-weight: 600;
  margin: 2px 0 0;
}

.exp-event-detail {
  color: var(--exp-text-muted);
  margin: 2px 0 0;
}

.exp-callout-note {
  background: var(--exp-accent-soft);
  border-color: transparent;
}

.exp-callout-tip {
  background: var(--exp-tip-soft);
  border-color: transparent;
}

.exp-callout-warning {
  background: var(--exp-warning-soft);
  border-color: transparent;
}

.exp-callout-body {
  margin: 0;
}

.exp code {
  font-family: var(--exp-mono);
  font-size: 0.92em;
}
```

- [ ] **Step 4: Write `src/themes/light.css`**

```css
/* Light theme — explicit token values so consumers can scope themes. */
.exp-theme-light {
  --exp-text: #1a1d23;
  --exp-text-muted: #5c6470;
  --exp-accent: #2563eb;
  --exp-accent-soft: #dbeafe;
  --exp-surface: #ffffff;
  --exp-surface-muted: #f3f4f6;
  --exp-border: #e5e7eb;
  --exp-tip: #047857;
  --exp-tip-soft: #d1fae5;
  --exp-warning: #b45309;
  --exp-warning-soft: #fef3c7;
  --exp-up: #047857;
  --exp-down: #b91c1c;
  --exp-flat: #5c6470;
}
```

- [ ] **Step 5: Write `src/themes/dark.css`**

```css
/* Dark theme — token overrides scoped to .exp-theme-dark. */
.exp-theme-dark {
  --exp-text: #e6e8eb;
  --exp-text-muted: #9aa3ad;
  --exp-accent: #60a5fa;
  --exp-accent-soft: #1e3a5f;
  --exp-surface: #16181d;
  --exp-surface-muted: #22262d;
  --exp-border: #2e333b;
  --exp-tip: #34d399;
  --exp-tip-soft: #0b3b2e;
  --exp-warning: #fbbf24;
  --exp-warning-soft: #3b2f0b;
  --exp-up: #34d399;
  --exp-down: #f87171;
  --exp-flat: #9aa3ad;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/themes.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add src/themes/tokens.css src/themes/light.css src/themes/dark.css tests/fixtures.ts tests/themes.test.ts
git commit -m "feat(themes): token-based base styles with light and dark themes"
```

---

### Task 11: React adapter (RSC server component)

**Files:**
- Create: `src/react/Explanation.tsx`, `src/react/index.ts`
- Test: `tests/react.test.tsx`

**Interfaces:**
- Consumes: `salvageExplanation` (Task 3), `renderBlock`, `renderExplanation` (Task 4), `renderInline` (Task 2), `validateExplanation` (Task 3), `Block` (Task 1), theme CSS (Task 10).
- Produces: `Explanation(props: ExplanationProps): JSX.Element` with `ExplanationProps { ir: unknown; theme?: "light" | "dark" | "none"; components?: { [type: string]: ExplanationComponent | undefined }; strict?: boolean }` and `type ExplanationComponent = FC<{ block: any }>`; `src/react/index.ts` re-exports it. Adapter auto-loads all three theme CSS files via imports.

- [ ] **Step 1: Write the failing test**

`tests/react.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { Explanation } from "../src/react/Explanation"
import type { TextBlock } from "../src/core/schema"

const ir = {
  version: 1,
  title: "T",
  summary: "S",
  blocks: [{ type: "text", body: "hello **world**" }],
}

describe("Explanation", () => {
  it("renders server-side with the default light theme", () => {
    const html = renderToStaticMarkup(<Explanation ir={ir} />)
    expect(html).toContain(`class="exp exp-theme-light"`)
    expect(html).toContain("exp-title")
    expect(html).toContain("<strong>world</strong>")
  })

  it("renders leniently by default and throws in strict mode", () => {
    const bad = { version: 2, blocks: [] }
    expect(renderToStaticMarkup(<Explanation ir={bad} />)).toContain(`class="exp exp-theme-light"`)
    expect(() => renderToStaticMarkup(<Explanation ir={bad} strict />)).toThrow()
  })

  it("lets consumers override a primitive with a custom component", () => {
    const MyText = ({ block }: { block: TextBlock }) => <em data-test="my-text">{block.body}</em>
    const html = renderToStaticMarkup(
      <Explanation ir={ir} theme="none" components={{ text: MyText }} />,
    )
    expect(html).toContain(`data-test="my-text"`)
    expect(html).not.toContain("exp-text")
  })

  it("renders unknown types through the core fallback", () => {
    const html = renderToStaticMarkup(
      <Explanation ir={{ version: 1, blocks: [{ type: "chart", title: "Sales" }] }} theme="none" />,
    )
    expect(html).toContain("exp-fallback")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/react.test.tsx`
Expected: FAIL — cannot resolve `../src/react/Explanation`.

- [ ] **Step 3: Write `src/react/Explanation.tsx`**

```tsx
import type { FC } from "react"
import { salvageExplanation } from "../core/salvage"
import { renderBlock, renderExplanation } from "../core/render"
import { renderInline } from "../core/inline"
import { validateExplanation } from "../core/validate"
import type { Block } from "../core/schema"
import "../themes/tokens.css"
import "../themes/light.css"
import "../themes/dark.css"

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
export type ExplanationComponent = FC<{ block: any }>

export interface ExplanationProps {
  ir: unknown
  theme?: "light" | "dark" | "none"
  /** Swap in a custom React renderer for any registered block type. */
  components?: { [type: string]: ExplanationComponent | undefined }
  /** Throw when the top level is invalid instead of rendering leniently. */
  strict?: boolean
}

function themeClassName(theme: "light" | "dark" | "none"): string {
  return theme === "none" ? "exp" : `exp exp-theme-${theme}`
}

/**
 * Server component (no hooks, no client JS). Safe in Next.js RSC.
 * Custom components receive the parsed block payload.
 */
export function Explanation({ ir, theme = "light", components, strict }: ExplanationProps) {
  if (strict) {
    const v = validateExplanation(ir)
    if (!v.ok) {
      throw new Error(`invalid explanation: ${v.diagnostics.map(d => d.message).join("; ")}`)
    }
  }
  const salvaged = salvageExplanation(ir)
  return (
    <div className={themeClassName(theme)}>
      {salvaged.title && (
        <h3 className="exp-title" dangerouslySetInnerHTML={{ __html: renderInline(salvaged.title) }} />
      )}
      {salvaged.summary && (
        <p className="exp-summary" dangerouslySetInnerHTML={{ __html: renderInline(salvaged.summary) }} />
      )}
      {salvaged.blocks.map(b => {
        if (b.kind === "invalid") return null
        const Custom = components?.[b.type]
        if (Custom && b.kind === "valid") {
          return <Custom key={b.index} block={b.data as Block} />
        }
        return <div key={b.index} dangerouslySetInnerHTML={{ __html: renderBlock(b.type, b.data) }} />
      })}
    </div>
  )
}
```

- [ ] **Step 4: Write `src/react/index.ts`**

```ts
export * from "./Explanation"
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/react.test.tsx`
Expected: PASS (4 tests). (vitest stubs the CSS imports automatically.)

- [ ] **Step 6: Commit**

```bash
git add src/react/Explanation.tsx src/react/index.ts tests/react.test.tsx
git commit -m "feat(react): RSC-compatible Explanation adapter with component overrides"
```

---

### Task 12: LLM contract (JSON Schema + system prompt snippet) and root exports

**Files:**
- Create: `src/core/llm.ts`, `src/index.ts`
- Test: `tests/llm.test.ts`

**Interfaces:**
- Consumes: `explanationSchema` (Task 1), `registry` + `registerAll` (Tasks 3–4).
- Produces: `explanationJsonSchema` (JSON Schema object from `z.toJSONSchema(explanationSchema, { io: "input" })`), `systemPromptSnippet` (string), and the public root API re-exporting everything from `./core/*`.

- [ ] **Step 1: Write the failing test**

`tests/llm.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { explanationJsonSchema, systemPromptSnippet } from "../src/core/llm"
import { registry } from "../src/core/registry"
import "../src/core/registerAll"

describe("explanationJsonSchema", () => {
  it("pins version to 1", () => {
    const schema = explanationJsonSchema as Record<string, any>
    expect(schema.properties.version.const).toBe(1)
  })

  it("mentions every registered block type", () => {
    const s = JSON.stringify(explanationJsonSchema)
    for (const type of Object.keys(registry)) {
      expect(s).toContain(`"${type}"`)
    }
  })
})

describe("systemPromptSnippet", () => {
  it("mentions every registered block type", () => {
    for (const type of Object.keys(registry)) {
      expect(systemPromptSnippet).toContain(type)
    }
  })

  it("forbids HTML and requires JSON-only output", () => {
    expect(systemPromptSnippet).toContain("no HTML")
    expect(systemPromptSnippet).toContain("ONLY the JSON object")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/llm.test.ts`
Expected: FAIL — cannot resolve `../src/core/llm`.

- [ ] **Step 3: Write `src/core/llm.ts`**

```ts
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
- Never put HTML in any field. Inline emphasis only: **bold**, *italic*, \`code\`.
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
- stack: { blocks: Block[] } — group of blocks.
- text: { body } — plain paragraph.
`.trim()
```

- [ ] **Step 4: Write `src/index.ts`**

```ts
export * from "./core/schema"
export * from "./core/inline"
export * from "./core/registry"
export * from "./core/salvage"
export * from "./core/validate"
export * from "./core/render"
export * from "./core/llm"
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/llm.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/core/llm.ts src/index.ts tests/llm.test.ts
git commit -m "feat(llm): export JSON Schema and system prompt snippet for LLM integration"
```

---

### Task 13: Build config, package exports, final verification

**Files:**
- Create: `tsup.config.ts`
- Modify: `package.json` (build script, exports, files, peerDependencies, sideEffects)

**Interfaces:**
- Consumes: everything above.
- Produces: published package shape — subpath exports `.`, `./react`, `./themes/{tokens,light,dark}.css`; dual ESM/CJS builds with `.d.ts`.

- [ ] **Step 1: Write `tsup.config.ts`**

```ts
import { defineConfig } from "tsup"

export default defineConfig([
  {
    entry: ["src/index.ts"],
    dts: true,
    format: ["esm", "cjs"],
    sourcemap: true,
    clean: true,
  },
  {
    entry: ["src/react/index.ts"],
    dts: true,
    format: ["esm", "cjs"],
    sourcemap: true,
  },
])
```

- [ ] **Step 2: Replace `package.json`**

```json
{
  "name": "explanations",
  "version": "0.1.0",
  "description": "LLM-generated visual explanations as styleable HTML",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    },
    "./react": {
      "types": "./dist/react/index.d.ts",
      "import": "./dist/react/index.js",
      "require": "./dist/react/index.cjs"
    },
    "./themes/tokens.css": "./dist/themes/tokens.css",
    "./themes/light.css": "./dist/themes/light.css",
    "./themes/dark.css": "./dist/themes/dark.css"
  },
  "files": ["dist"],
  "sideEffects": ["*.css"],
  "scripts": {
    "build": "tsup && mkdir -p dist/themes && cp src/themes/*.css dist/themes/",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": {
    "react": ">=18.0.0"
  },
  "dependencies": {
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "tsup": "^8.0.0",
    "typescript": "^5.6.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 3: Run the full verification suite**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck clean; all tests pass (schema 5, inline 6, salvage 8, validate 2, render 6, stack 3, steps 2, callouts 3, comparison-timeline 3, concept-cause-derivation 3, themes 3, react 4, llm 4 = 52 tests); build emits `dist/index.js`, `dist/index.cjs`, `dist/react/index.js`, `dist/react/index.cjs`, matching `.d.ts` files, and `dist/themes/*.css`.

- [ ] **Step 4: Verify the export map resolves**

Run: `node -e "import('./dist/index.js').then(m => console.log(Object.keys(m).sort().join(',')))"`
Expected: prints exported names including `renderExplanation`, `explanationJsonSchema`, `systemPromptSnippet`.

- [ ] **Step 5: Commit**

```bash
git add tsup.config.ts package.json
git commit -m "build: dual-format build with subpath exports for core, react, and themes"
```

---

## Verification (whole plan)

- `npm run typecheck` — clean.
- `npm test` — all suites green (~50 tests).
- `npm run build` — emits dist artifacts; export map verified via node import.
- Spec coverage check: IR schema (§4) → Task 1; lenient validation (§5) → Task 3; render/fallback/strict (§5) → Task 4; all 11 block types (§4) → Tasks 3, 5–9; themes/tokens (§6) → Task 10; React adapter (§7) → Task 11; LLM contract (§8) → Task 12; packaging/exports (§9) → Task 13; escaping/security (§5) → Tasks 2, 4.
