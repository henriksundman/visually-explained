# Document IR + Sections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a document IR (multi-section pages composing the existing block system), a `renderDocument()` HTML composer, a static React `<Document>`, the LLM contract (JSON schema + prompt snippet), and a demo page — per spec `docs/superpowers/specs/2026-09-30-document-ir-sections-design.md`.

**Architecture:** `documentSchema` is a sibling of `explanationSchema` (never extends it). `renderDocument()` salvages the top level leniently, salvages sections individually, and composes the existing `renderBlock` pipeline per block inside an `exp-doc` skeleton with a derived TOC. The React component renders the same skeleton via `renderBlock` + `renderInline`, so HTML and React share one anchor helper and stay parity-tested. The LLM contract shares the block-type prompt text with the existing snippet by extraction.

**Tech Stack:** TypeScript, zod (v4-style API already in use), vitest, React 18 (`renderToStaticMarkup` in tests), zero new runtime deps.

## Global Constraints

- **Dependency-free:** no new packages, runtime or dev (spec §2, ROADMAP "Decisions That Bind Future Work").
- **Lenient salvage everywhere:** invalid model output degrades gracefully — never throws unless `strict: true`; one malformed section drops alone (spec §3, §4).
- **No raw HTML:** all IR text goes through `escapeHtml`/`renderInline` (spec §4; ROADMAP decision).
- **Determinism / SSR-safe:** same input → byte-identical output; no client-only APIs in `<Document>` (spec §4, §5).
- **No new block types:** sections reuse the existing block union; `blocks` are `z.unknown()` at parse time (spec §3).
- **Flat sections:** `sectionSchema` has no `sections` field; sections never nest (spec §3).
- **Class naming:** `exp-doc*` family, exact names in spec §4. Container-hook rule from `tokens.css`: every emitted class must exist in CSS.
- **Escape `{` and `}` in all bash heredocs** in Task 6's CSS (they are inside a `${page}` template literal) — the trap flagged in both predecessor plans.
- **Commits:** conventional prefixes, repo style is lowercase scoped subjects (e.g. `feat(core): …`).

## File Structure

- Create `src/core/documentSchema.ts` — document/section schemas + slug/anchor helpers. One responsibility: the document IR contract and its anchor math.
- Create `src/core/renderDocument.ts` — salvage + skeleton composition. Consumes `renderBlock` per block; owns the TOC/nav/section markup.
- Create `src/core/documentValidate.ts` — `validateDocument` for the React strict path (mirrors `validate.ts`, which is explanation-scoped).
- Create `src/react/Document.tsx` — static RSC-safe component; reuses the skeleton markup as JSX.
- Create `src/core/blockTypes.ts` — shared block-type prompt text extracted from `llm.ts`.
- Modify `src/core/llm.ts` — interpolate the shared text; add `documentJsonSchema` + `documentSystemPromptSnippet`.
- Modify `src/index.ts` (add `./core/documentSchema`, `./core/documentValidate`, `./core/renderDocument` exports), `src/react/index.ts` (add `./Document`), `src/core/render.ts` (only if folding `renderDocument` there — this plan keeps it a separate file, so no change).
- Modify `demo/examples.js` (add `demoDocIr`), `demo/server.mjs` (add `/document` route).
- Modify `src/themes/tokens.css` (append `exp-doc*` styles), `docs/ROADMAP.md` (mark step 2 shipped).
- Tests: `tests/document-schema.test.ts`, `tests/document-render.test.ts`, `tests/document-react.test.tsx`, `tests/document-llm.test.ts`, plus extensions to `tests/llm.test.ts`, `tests/demo-examples.test.ts`.

---

### Task 1: Document schema, section schema, and anchor/slug helpers

**Files:**
- Create: `src/core/documentSchema.ts`
- Test: `tests/document-schema.test.ts`

**Interfaces:**
- Consumes: `blockUnionSchema` is NOT used (blocks are `z.unknown()` per spec §3). Nothing from the existing core.
- Produces:
  - `documentSchema` — zod object `{ version: 1, title: string.min(1), summary?: string.min(1), sections: array(sectionSchema).min(1) }`
  - `sectionSchema` — zod object `{ id?: string.min(1), title: string.min(1), blocks: z.array(z.unknown()) }`
  - `type DocumentIR`, `type DocumentSection` — inferred types
  - `sectionAnchor(section: { id?: string; title: string }, index: number, taken: Set<string>): string` — pure; returns the final unique anchor id

- [ ] **Step 1: Write the failing tests**

Create `tests/document-schema.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { documentSchema, sectionAnchor } from "../src/core/documentSchema"

describe("documentSchema", () => {
  it("parses a document whose sections carry unknown blocks (lenient by design)", () => {
    const doc = {
      version: 1,
      title: "A Page",
      summary: "S",
      sections: [
        { id: "intro", title: "Introduction", blocks: [{ type: "text", body: "hi" }] },
        { title: "No id here", blocks: [{ type: "garbage" }, 42] },
      ],
    }
    expect(documentSchema.safeParse(doc).success).toBe(true)
  })

  it("rejects a wrong version, empty title, and empty/missing sections", () => {
    expect(documentSchema.safeParse({ version: 2, title: "T", sections: [{ title: "S", blocks: [] }] }).success).toBe(false)
    expect(documentSchema.safeParse({ version: 1, title: "", sections: [{ title: "S", blocks: [] }] }).success).toBe(false)
    expect(documentSchema.safeParse({ version: 1, title: "T", sections: [] }).success).toBe(false)
    expect(documentSchema.safeParse({ version: 1, title: "T" }).success).toBe(false)
  })

  it("strips a nested sections key instead of rejecting (flat by design)", () => {
    const doc = {
      version: 1,
      title: "T",
      sections: [{ title: "S", blocks: [], sections: [{ title: "inner" }] }],
    }
    const parsed = documentSchema.safeParse(doc)
    expect(parsed.success).toBe(true)
    expect("sections" in (parsed as any).data!.sections[0]).toBe(false)
  })

  it("rejects an empty section title", () => {
    expect(documentSchema.safeParse({ version: 1, title: "T", sections: [{ title: "", blocks: [] }] }).success).toBe(false)
  })
})

describe("sectionAnchor", () => {
  it("slugifies a valid authored id", () => {
    expect(sectionAnchor({ id: "My Cool_ID" }, 0, new Set())).toBe("sec-my-cool_id")
  })

  it("derives the slug from the title when no id", () => {
    expect(sectionAnchor({ title: "How It Works!" }, 0, new Set())).toBe("sec-how-it-works")
  })

  it("caps the slug at 100 chars", () => {
    expect(sectionAnchor({ title: "a".repeat(300) }, 0, new Set()).length).toBeLessThanOrEqual(104) // "sec-" + 100
  })

  it("falls back to section-<index> for an empty slug", () => {
    expect(sectionAnchor({ title: "!!!" }, 0, new Set())).toBe("section-0")
    expect(sectionAnchor({ id: "///" }, 2, new Set())).toBe("section-2")
  })

  it("resolves collisions with -2, -3 suffixes (first wins)", () => {
    const taken = new Set(["sec-intro"])
    expect(sectionAnchor({ id: "intro" }, 1, taken)).toBe("sec-intro-2")
    expect(sectionAnchor({ id: "intro" }, 2, new Set(["sec-intro", "sec-intro-2"]))).toBe("sec-intro-3")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/document-schema.test.ts`
Expected: FAIL — "Cannot find module '../src/core/documentSchema'"

- [ ] **Step 3: Write the implementation**

Create `src/core/documentSchema.ts`:

```ts
import { z } from "zod"

export const documentSectionSchema = z.object({
  id: z.string().min(1).optional(),
  title: z.string().min(1),
  // Lenient like stack children / chart points: per-block salvage happens at
  // render time, so one malformed block drops alone instead of failing the
  // section (spec §3).
  blocks: z.array(z.unknown()),
})
export type DocumentSection = z.infer<typeof documentSectionSchema>

export const documentSchema = z.object({
  version: z.literal(1),
  title: z.string().min(1),
  summary: z.string().min(1).optional(),
  sections: z.array(documentSectionSchema).min(1),
})
export type DocumentIR = z.infer<typeof documentSchema>

/** Turn free text into a URL-safe slug: lowercase, whitespace → -, strip to
 *  [a-z0-9-], collapse repeats, trim, cap at 100 chars. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100)
}

/** Final anchor id for a section: `sec-` + slug(authored id ?? title), first
 *  wins; later collisions get -2, -3 …; empty slug → section-<index>.
 *  Pure over (section, index, taken) so HTML, React, and tests share it. */
export function sectionAnchor(
  section: { id?: string; title: string },
  index: number,
  taken: Set<string>,
): string {
  const slug = slugify(section.id ?? section.title)
  let id = slug.length > 0 ? `sec-${slug}` : `section-${index}`
  let n = 2
  while (taken.has(id)) {
    id = (slug.length > 0 ? `sec-${slug}` : `section-${index}`) + (n === 2 ? "-2" : `-${n}`)
    n++
  }
  return id
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/document-schema.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/core/documentSchema.ts tests/document-schema.test.ts
git commit -m "feat(core): document IR schema with anchor/slug helpers"
```

---

### Task 2: `renderDocument()` — salvage, skeleton, TOC, sections

**Files:**
- Create: `src/core/renderDocument.ts`
- Test: `tests/document-render.test.ts`

**Interfaces:**
- Consumes: `sectionAnchor` from Task 1; `salvageBlock`/`Diagnostic` from `src/core/salvage.ts` (existing, exact signatures: `salvageBlock(raw: unknown, index: number, diagnostics: Diagnostic[])`, `Diagnostic.code: "invalid-explanation" | "wrong-version" | "invalid-block" | "unknown-type"`); `renderSalvagedBlock` is NOT exported — instead reuse `renderExplanation`'s exact block-loop approach: salvage each raw block with `salvageBlock`, render valid/unknown ones through the registry via a local `renderOne` copied structurally from `render.ts`'s private `renderSalvagedBlock` (invalid → `""`, unknown → fallback div, valid → `registry[type].render(b.data, ctx)`); `escapeHtml`, `renderInline` from `src/core/inline.ts`; registry context shape `{ depth, sketch, addWarning, renderChildren }` from `src/core/registry.ts`.
- Produces: `renderDocument(input: unknown, opts: RenderDocumentOptions = {}): { html: string; warnings: string[] }` where `RenderDocumentOptions = { strict?: boolean; theme?: "light" | "dark" | "none"; sketch?: boolean; toc?: boolean }` (defaults: theme `"none"`, toc `true`). Also `validateDocument` lives in Task 4 — Task 2 does NOT create it.

- [ ] **Step 1: Write the failing tests**

Create `tests/document-render.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { renderDocument } from "../src/core/renderDocument"
import "../src/core/registerAll"

const doc = {
  version: 1,
  title: "A Curio Page",
  summary: "One page, many sections.",
  sections: [
    { id: "Intro", title: "Introduction", blocks: [{ type: "text", body: "hello" }] },
    { title: "Numbers", blocks: [{ type: "callout", variant: "note", body: "n" }] },
  ],
}

describe("renderDocument", () => {
  it("emits the exp-doc skeleton with header, TOC, and sections", () => {
    const { html, warnings } = renderDocument(doc)
    expect(warnings).toEqual([])
    expect(html).toContain(`<article class="exp exp-doc">`)
    expect(html).toContain(`<h1 class="exp-doc-title">A Curio Page</h1>`)
    expect(html).toContain(`<p class="exp-doc-summary">One page, many sections.</p>`)
    expect(html).toContain(`<nav class="exp-doc-toc" aria-label="On this page">`)
    expect(html).toContain(`<a href="#sec-intro">Introduction</a>`)
    expect(html).toContain(`<a href="#sec-numbers">Numbers</a>`)
    expect(html).toContain(`<section class="exp-doc-section" id="sec-intro">`)
    expect(html).toContain(`<h2 class="exp-doc-section-title">Introduction</h2>`)
    expect(html).toContain(`<h2 class="exp-doc-section-title">Numbers</h2>`)
    expect(html).toContain(`<div class="exp-block exp-text"><p>hello</p></div>`)
  })

  it("order is header → nav → sections", () => {
    const { html } = renderDocument(doc)
    expect(html.indexOf("exp-doc-header")).toBeLessThan(html.indexOf("exp-doc-toc"))
    expect(html.indexOf("exp-doc-toc")).toBeLessThan(html.indexOf("exp-doc-section"))
  })

  it("omits TOC when toc: false", () => {
    const { html } = renderDocument(doc, { toc: false })
    expect(html).not.toContain("exp-doc-toc")
  })

  it("theme and sketch options land on the root", () => {
    const { html } = renderDocument(doc, { theme: "dark", sketch: true })
    expect(html).toContain(`<article class="exp exp-doc exp-theme-dark exp-sketch">`)
  })

  it("renders section titles through the inline renderer and escapes IR text", () => {
    const { html } = renderDocument({
      version: 1,
      title: "<b>T</b>",
      sections: [{ title: "A *real* <em>section</em>", blocks: [] }],
    })
    expect(html).toContain("&lt;b&gt;T&lt;/b&gt;")
    expect(html).toContain("A <em>real</em> &lt;em&gt;section&lt;/em&gt;")
    expect(html).not.toContain("<b>T</b>")
  })

  it("drops one malformed section alone and keeps the rest", () => {
    const { html, warnings } = renderDocument({
      version: 1,
      title: "T",
      sections: [{ title: "ok", blocks: [] }, { title: "", blocks: [] }, { title: "also ok", blocks: [] }],
    })
    expect((html.match(/exp-doc-section/g) ?? []).length).toBe(2)
    expect(html).toContain("ok")
    expect(warnings.some(w => w.includes("section 1"))).toBe(true)
  })

  it("renders an empty shell with a warning when the top level is broken", () => {
    const { html, warnings } = renderDocument({ version: 2, sections: "nope" })
    expect(html).toBe(`<article class="exp exp-doc"></article>`)
    expect(warnings.length).toBeGreaterThan(0)
    const { html: nonArray } = renderDocument({ version: 1, title: "T", sections: [null] })
    expect((nonArray.match(/exp-doc-section/g) ?? []).length).toBe(0)
  })

  it("strict mode throws on any diagnostic", () => {
    expect(() => renderDocument({ version: 2, title: "T", sections: [{ title: "S", blocks: [] }] }, { strict: true })).toThrow(/version/)
    expect(() => renderDocument(doc, { strict: true })).not.toThrow()
  })

  it("is deterministic and script-free", () => {
    expect(renderDocument(doc).html).toBe(renderDocument(doc).html)
    expect(renderDocument(doc).html).not.toContain("<script")
  })

  it("blocks render with block-level leniency and sketch passthrough", () => {
    const { html, warnings } = renderDocument({
      version: 1,
      title: "T",
      sections: [{ title: "S", blocks: [{ type: "text" }, { type: "text", body: "fine" }] }],
    })
    expect((html.match(/exp-block exp-text/g) ?? []).length).toBe(1)
    expect(warnings.some(w => w.includes("skipped"))).toBe(true)
    const sketched = renderDocument(
      { version: 1, title: "T", sections: [{ title: "S", blocks: [{ type: "diagram", nodes: [{ id: "a", label: "A" }], edges: [] }] }] },
      { sketch: true },
    )
    expect(sketched.html).toContain("rough") // sketch pass reached the block layer
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/document-render.test.ts`
Expected: FAIL — "Cannot find module '../src/core/renderDocument'"

- [ ] **Step 3: Write the implementation**

Create `src/core/renderDocument.ts`:

```ts
import { sectionAnchor, type DocumentSection } from "./documentSchema"
import { registry, type RenderContext } from "./registry"
import { salvageBlock, type Diagnostic, type SalvagedBlock } from "./salvage"
import { renderInline } from "./inline"
import type { Block } from "./schema"

export interface RenderDocumentOptions {
  /** Throw instead of degrading when any document-level or section-level diagnostic exists. */
  strict?: boolean
  /** Theme class on the article root. Default "none". */
  theme?: "light" | "dark" | "none"
  /** Hand-drawn (rough.js) stroke pass, passed through to every block. */
  sketch?: boolean
  /** Render the table of contents. Default true. */
  toc?: boolean
}

export interface RenderDocumentResult {
  html: string
  warnings: string[]
}

/** Anchor ids already claimed, in document order. Shared by the React layer. */
export function collectAnchors(sections: DocumentSection[]): { anchors: string[]; taken: Set<string> } {
  const taken = new Set<string>()
  const anchors = sections.map((s, i) => {
    const id = sectionAnchor(s, i, taken)
    taken.add(id)
    return id
  })
  return { anchors, taken }
}

function blockWarning(d: Diagnostic): string {
  return `[${d.code}] ${d.message}`
}

/** Renders one already-salvaged block. Structurally identical to
 *  render.ts's private renderSalvagedBlock; kept local because that one is
 *  private and duplicating its 15 lines beats changing render.ts's surface. */
function renderOne(b: SalvagedBlock, warnings: string[], sketch: boolean): string {
  if (b.kind === "invalid") return ""
  const entry = registry[b.type]
  if (b.kind === "unknown" || !entry) {
    const d = typeof b.data === "object" && b.data !== null ? (b.data as Record<string, unknown>) : {}
    const label = typeof d.title === "string" ? d.title : typeof d.body === "string" ? d.body : null
    return (
      `<div class="exp-block exp-fallback">` +
      `<span class="exp-fallback-label">${b.type}</span>` +
      (label ? `<p class="exp-fallback-body">${renderInline(label)}</p>` : "") +
      `</div>`
    )
  }
  const ctx: RenderContext = {
    depth: 1,
    sketch,
    addWarning: m => warnings.push(m),
    renderChildren: (children, d) => {
      const diagnostics: Diagnostic[] = []
      const blocks = children.map((raw, i) => salvageBlock(raw, i, diagnostics))
      for (const diag of diagnostics) warnings.push(blockWarning(diag))
      return blocks.map(child => renderOne(child, warnings, sketch)).join("")
    },
  }
  return entry.render(b.data as Block, ctx)
}

function renderSectionBlocks(rawBlocks: unknown[], warnings: string[], sketch: boolean): string {
  const diagnostics: Diagnostic[] = []
  const blocks = rawBlocks.map((raw, i) => salvageBlock(raw, i, diagnostics))
  for (const d of diagnostics) warnings.push(blockWarning(d))
  return blocks.map(b => renderOne(b, warnings, sketch)).join("")
}

function renderToc(sections: { title: string; anchor: string }[]): string {
  const items = sections
    .map(s => `<li><a href="#${s.anchor}">${renderInline(s.title)}</a></li>`)
    .join("")
  return `<nav class="exp-doc-toc" aria-label="On this page"><ol class="exp-doc-toc-list">${items}</ol></nav>`
}

export function renderDocument(input: unknown, opts: RenderDocumentOptions = {}): RenderDocumentResult {
  const warnings: string[] = []
  const theme = opts.theme ?? "none"
  const themeClass = theme === "none" ? "" : ` exp-theme-${theme}`
  const root = (extra = "") => `<article class="exp exp-doc${themeClass}${opts.sketch ? " exp-sketch" : ""}${extra}">`

  const rec = typeof input === "object" && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : null
  if (!rec || rec.version !== 1) {
    warnings.push("[wrong-version] expected version 1, got " + JSON.stringify(rec?.version ?? null))
    if (!opts.strict) return { html: root() + `</article>`, warnings }
  }
  if (!rec || typeof rec.title !== "string" || rec.title.length === 0) {
    warnings.push("[invalid-document] title must be a non-empty string")
    if (!opts.strict) return { html: root() + `</article>`, warnings }
  }
  if (!rec || !Array.isArray(rec.sections) || rec.sections.length === 0) {
    warnings.push("[invalid-document] sections must be a non-empty array")
    if (!opts.strict) return { html: root() + `</article>`, warnings }
  }
  if (opts.strict && warnings.length > 0) {
    throw new Error(`invalid document: ${warnings.join("; ")}`)
  }

  const rawSections = (rec!.sections as unknown[]).map((raw, i) => {
    const bad =
      typeof raw !== "object" || raw === null || Array.isArray(raw) ||
      typeof (raw as Record<string, unknown>).title !== "string" ||
      ((raw as Record<string, unknown>).title as string).length === 0 ||
      !Array.isArray((raw as Record<string, unknown>).blocks)
    return { raw: raw as Record<string, unknown> | null, bad }
  })

  // Skip malformed sections; compute anchors over the survivors so a dropped
  // section never leaves a hole in the numbering.
  const good = rawSections.filter(s => !s.bad).map(s => s.raw!) as DocumentSection[]
  for (let i = 0; i < rawSections.length; i++) {
    if (rawSections[i].bad) warnings.push(`[invalid-section] section ${i}: dropped — title must be a non-empty string and blocks an array`)
  }
  const { anchors } = collectAnchors(good)

  const toc = opts.toc !== false && good.length > 0
    ? renderToc(good.map((s, i) => ({ title: s.title, anchor: anchors[i] })))
    : ""
  const body = good
    .map((s, i) => {
      const blocksHtml = renderSectionBlocks(s.blocks, warnings, opts.sketch ?? false)
      return (
        `<section class="exp-doc-section" id="${anchors[i]}">` +
        `<h2 class="exp-doc-section-title">${renderInline(s.title)}</h2>` +
        blocksHtml +
        `</section>`
      )
    })
    .join("")

  const title = rec!.title as string
  const summary = typeof rec!.summary === "string" && rec!.summary.length > 0 ? rec!.summary : null
  const header =
    `<header class="exp-doc-header">` +
    `<h1 class="exp-doc-title">${renderInline(title)}</h1>` +
    (summary ? `<p class="exp-doc-summary">${renderInline(summary)}</p>` : "") +
    `</header>`

  return { html: root() + header + toc + body + `</article>`, warnings }
}
```

Note on `<section>` rendering: when `sections` is not an array, `good` is `[]` → empty body; the shell test above (`{ version: 2, sections: "nope" }`) hits the early return and never reaches here.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/document-render.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Typecheck and full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: typecheck clean; all tests pass (existing suites unaffected — no existing file was modified)

- [ ] **Step 6: Commit**

```bash
git add src/core/renderDocument.ts tests/document-render.test.ts
git commit -m "feat(core): renderDocument composer with TOC and lenient sections"
```

---

### Task 3: Export document modules from the package root

**Files:**
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: the modules from Tasks 1–2.
- Produces: public exports `documentSchema`, `documentSectionSchema`, `DocumentIR`, `DocumentSection`, `slugify`, `sectionAnchor`, `renderDocument`, `RenderDocumentOptions`, `RenderDocumentResult`, `collectAnchors` — importable from the package root exactly like `explanationSchema`/`renderExplanation`.

- [ ] **Step 1: Add the exports**

In `src/index.ts`, add after the `export * from "./core/llm"` line:

```ts
export * from "./core/documentSchema"
export * from "./core/renderDocument"
```

(Alphabetical placement next to the other core exports is fine; what matters is that both lines exist and no name collides — `render.ts` does not export `collectAnchors`, `renderDocument`, or any `Document*` names, verified against its current exports.)

- [ ] **Step 2: Verify the public surface**

Run: `npx tsc --noEmit && node -e "import('./src/index.ts').then(m => console.log(typeof m.renderDocument, typeof m.documentSchema, typeof m.sectionAnchor))"` — if the direct-TS import fails in plain node, instead run the build: `npm run build` and then `node -e "import('./dist/index.js').then(m => console.log(typeof m.renderDocument, typeof m.documentSchema, typeof m.sectionAnchor))"`.
Expected: `function object function` (either path)

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat(core): export document IR and renderer from package root"
```

---

### Task 4: `validateDocument` + React `<Document>`

**Files:**
- Create: `src/core/documentValidate.ts`, `src/react/Document.tsx`
- Test: `tests/document-react.test.tsx`

**Interfaces:**
- Consumes: `collectAnchors` (Task 2 — import from `../core/renderDocument`, NOT a local re-implementation: anchors must be computed over survivors in survivor order for parity) and `DocumentSection` (Task 1); `renderBlock(type: string, data: unknown, depth?: number, opts?: { sketch?: boolean })` from `src/core/render.ts` (existing — note the argument ORDER is `(type, data, …)`); `renderInline` from `src/core/inline.ts`; section validity is re-derived here as `validateDocument` (Task 2's checks are inline in `renderDocument`, so this file produces the same diagnostics for the React strict path).
- Produces:
  - `validateDocument(input: unknown): { ok: boolean; diagnostics: { code: string; message: string }[] }` — mirrors `validateExplanation`'s shape, document-scoped (version, title, sections array, per-section title/blocks).
  - `Document` — `FC<DocumentProps>` with `DocumentProps = { ir: unknown; theme?: "light" | "dark" | "none"; sketch?: boolean; toc?: boolean; strict?: boolean }`. RSC-safe (no hooks, no client directives).

- [ ] **Step 1: Write the failing tests**

Create `tests/document-react.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { Document } from "../src/react/Document"

const doc = {
  version: 1,
  title: "A Curio Page",
  summary: "One page, many sections.",
  sections: [
    { id: "Intro", title: "Introduction", blocks: [{ type: "text", body: "hello **world**" }] },
    { title: "Numbers", blocks: [{ type: "callout", variant: "note", body: "n" }] },
  ],
}

describe("Document (React)", () => {
  it("renders the same skeleton as the HTML renderer", () => {
    const html = renderToStaticMarkup(<Document ir={doc} theme="none" />)
    expect(html).toContain(`class="exp exp-doc"`)
    expect(html).toContain(`id="sec-intro"`)
    expect(html).toContain(`href="#sec-intro"`)
    expect(html).toContain(`id="sec-numbers"`)
    expect(html).toContain(`<h2 class="exp-doc-section-title">Introduction</h2>`)
    expect(html).toContain("<strong>world</strong>")
  })

  it("agrees with the HTML renderer on ids, anchors, and section count", () => {
    const reactHtml = renderToStaticMarkup(<Document ir={doc} theme="none" />)
    const { html } = renderDocumentRef(doc)
    const ids = (s: string) => (s.match(/id="sec-[^"]+"/g) ?? []).sort()
    expect(ids(reactHtml)).toEqual(ids(html))
    expect((reactHtml.match(/exp-doc-section-title/g) ?? []).length).toBe(
      (html.match(/exp-doc-section-title/g) ?? []).length,
    )
  })

  it("drops malformed sections and renders leniently by default", () => {
    const html = renderToStaticMarkup(
      <Document ir={{ version: 1, title: "T", sections: [{ title: "", blocks: [] }, { title: "ok", blocks: [] }] }} />,
    )
    expect((html.match(/exp-doc-section-title/g) ?? []).length).toBe(1)
  })

  it("strict mode throws; toc: false omits the nav", () => {
    expect(() => renderToStaticMarkup(<Document ir={{ version: 2, title: "T", sections: [{ title: "S", blocks: [] }] }} strict />)).toThrow()
    const noToc = renderToStaticMarkup(<Document ir={doc} theme="none" toc={false} />)
    expect(noToc).not.toContain("exp-doc-toc")
  })
})

// Parity helper: core renderer is imported lazily so the test file stays
// React-only at top level, matching the house style of splitting suites.
import { renderDocument as renderDocumentRef } from "../src/core/renderDocument"
```

Wait — remove that awkward trailing import. Move it to the top with the others:

```tsx
import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { Document } from "../src/react/Document"
import { renderDocument } from "../src/core/renderDocument"

const doc = {
  version: 1,
  title: "A Curio Page",
  summary: "One page, many sections.",
  sections: [
    { id: "Intro", title: "Introduction", blocks: [{ type: "text", body: "hello **world**" }] },
    { title: "Numbers", blocks: [{ type: "callout", variant: "note", body: "n" }] },
  ],
}

describe("Document (React)", () => {
  it("renders the same skeleton as the HTML renderer", () => {
    const html = renderToStaticMarkup(<Document ir={doc} theme="none" />)
    expect(html).toContain(`class="exp exp-doc"`)
    expect(html).toContain(`id="sec-intro"`)
    expect(html).toContain(`href="#sec-intro"`)
    expect(html).toContain(`id="sec-numbers"`)
    expect(html).toContain(`<h2 class="exp-doc-section-title">Introduction</h2>`)
    expect(html).toContain("<strong>world</strong>")
  })

  it("agrees with the HTML renderer on ids, anchors, and section count", () => {
    const reactHtml = renderToStaticMarkup(<Document ir={doc} theme="none" />)
    const { html } = renderDocument(doc)
    const ids = (s: string) => (s.match(/id="sec-[^"]+"/g) ?? []).sort()
    expect(ids(reactHtml)).toEqual(ids(html))
    expect((reactHtml.match(/exp-doc-section-title/g) ?? []).length).toBe(
      (html.match(/exp-doc-section-title/g) ?? []).length,
    )
  })

  it("drops malformed sections and renders leniently by default", () => {
    const html = renderToStaticMarkup(
      <Document ir={{ version: 1, title: "T", sections: [{ title: "", blocks: [] }, { title: "ok", blocks: [] }] }} />,
    )
    expect((html.match(/exp-doc-section-title/g) ?? []).length).toBe(1)
  })

  it("strict mode throws; toc: false omits the nav", () => {
    expect(() =>
      renderToStaticMarkup(<Document ir={{ version: 2, title: "T", sections: [{ title: "S", blocks: [] }] }} strict />),
    ).toThrow()
    const noToc = renderToStaticMarkup(<Document ir={doc} theme="none" toc={false} />)
    expect(noToc).not.toContain("exp-doc-toc")
  })
})
```

Use this second version as the file's content (the first block above is shown only to make the edit obvious; the file must contain exactly one import of `renderDocument` from the core renderer, at the top).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/document-react.test.tsx`
Expected: FAIL — "Cannot find module '../src/react/Document'"

- [ ] **Step 3: Write `validateDocument`**

Create `src/core/documentValidate.ts`:

```ts
export interface DocumentDiagnostic {
  code: "invalid-document" | "wrong-version" | "invalid-section"
  message: string
}

export interface DocumentValidationResult {
  ok: boolean
  diagnostics: DocumentDiagnostic[]
}

/** Document-scoped validation for dev tooling and the React strict path.
 *  Mirrors validateExplanation: collects every diagnostic, ok = none. */
export function validateDocument(input: unknown): DocumentValidationResult {
  const diagnostics: DocumentDiagnostic[] = []
  const rec = typeof input === "object" && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : null
  if (!rec) {
    diagnostics.push({ code: "invalid-document", message: "document must be an object" })
    return { ok: false, diagnostics }
  }
  if (rec.version !== 1) {
    diagnostics.push({ code: "wrong-version", message: `expected version 1, got ${JSON.stringify(rec.version ?? null)}` })
  }
  if (typeof rec.title !== "string" || rec.title.length === 0) {
    diagnostics.push({ code: "invalid-document", message: "title must be a non-empty string" })
  }
  if (!Array.isArray(rec.sections) || rec.sections.length === 0) {
    diagnostics.push({ code: "invalid-document", message: "sections must be a non-empty array" })
    return { ok: false, diagnostics }
  }
  for (let i = 0; i < rec.sections.length; i++) {
    const raw = rec.sections[i]
    const bad =
      typeof raw !== "object" || raw === null || Array.isArray(raw) ||
      typeof (raw as Record<string, unknown>).title !== "string" ||
      ((raw as Record<string, unknown>).title as string).length === 0 ||
      !Array.isArray((raw as Record<string, unknown>).blocks)
    if (bad) diagnostics.push({ code: "invalid-section", message: `section ${i}: dropped — title must be a non-empty string and blocks an array` })
  }
  return { ok: diagnostics.length === 0, diagnostics }
}
```

- [ ] **Step 4: Write the React component**

Create `src/react/Document.tsx`:

```tsx
import type { FC } from "react"
import { renderBlock } from "../core/render"
import { renderInline } from "../core/inline"
import { collectAnchors } from "../core/renderDocument"
import { validateDocument } from "../core/documentValidate"
import type { DocumentSection } from "../core/documentSchema"

export interface DocumentProps {
  ir: unknown
  theme?: "light" | "dark" | "none"
  /** Throw when the top level or any section is invalid instead of degrading. */
  strict?: boolean
  /** Render the table of contents. Default true. */
  toc?: boolean
  /** Hand-drawn (rough.js) stroke pass, matching renderDocument's option. */
  sketch?: boolean
}

/**
 * Server component (no hooks, no client JS). Renders the same skeleton as
 * renderDocument: header, derived TOC, flat h2 sections whose blocks reuse
 * the existing block pipeline.
 */
export const Document: FC<DocumentProps> = ({ ir, theme = "light", strict, toc = true, sketch = false }) => {
  if (strict) {
    const v = validateDocument(ir)
    if (!v.ok) throw new Error(`invalid document: ${v.diagnostics.map(d => d.message).join("; ")}`)
  }
  const rec = typeof ir === "object" && ir !== null && !Array.isArray(ir) ? (ir as Record<string, unknown>) : null
  const title = typeof rec?.title === "string" && rec.title.length > 0 ? rec.title : null
  const summary = typeof rec?.summary === "string" && rec.summary.length > 0 ? rec.summary : null
  const rawSections = Array.isArray(rec?.sections) ? (rec!.sections as unknown[]) : []
  const sections = rawSections.filter(
    (raw): raw is DocumentSection =>
      typeof raw === "object" && raw !== null && !Array.isArray(raw) &&
      typeof (raw as Record<string, unknown>).title === "string" &&
      ((raw as Record<string, unknown>).title as string).length > 0 &&
      Array.isArray((raw as Record<string, unknown>).blocks),
  )

  // Anchor assignment mirrors renderDocument exactly: collectAnchors runs
  // over the SURVIVORS in survivor order (a dropped section never shifts a
  // later section's fallback index), using the shared helper so HTML and
  // React cannot drift (parity is test-enforced in document-react.test.tsx).
  const { anchors } = collectAnchors(sections.map(s => s.raw))

  const rootClass = `exp exp-doc${theme === "none" ? "" : ` exp-theme-${theme}`}${sketch ? " exp-sketch" : ""}`
  return (
    <article className={rootClass}>
      {title && (
        <header className="exp-doc-header">
          <h1 className="exp-doc-title" dangerouslySetInnerHTML={{ __html: renderInline(title) }} />
          {summary && <p className="exp-doc-summary" dangerouslySetInnerHTML={{ __html: renderInline(summary) }} />}
        </header>
      )}
      {toc && sections.length > 0 && (
        <nav className="exp-doc-toc" aria-label="On this page">
          <ol className="exp-doc-toc-list">
            {sections.map((s, i) => (
              <li key={anchors[i]}>
                <a href={`#${anchors[i]}`} dangerouslySetInnerHTML={{ __html: renderInline(s.title) }} />
              </li>
            ))}
          </ol>
        </nav>
      )}
      {sections.map((s, i) => (
        <section key={anchors[i]} className="exp-doc-section" id={anchors[i]}>
          <h2 className="exp-doc-section-title" dangerouslySetInnerHTML={{ __html: renderInline(s.title) }} />
          {(s.blocks as unknown[]).map((raw, bi) => {
            const type = typeof (raw as Record<string, unknown>)?.type === "string" ? (raw as Record<string, unknown>).type as string : ""
            return <div key={bi} dangerouslySetInnerHTML={{ __html: renderBlock(type, raw, 1, { sketch }) }} />
          })}
        </section>
      ))}
    </article>
  )
}
```

Note: `Explanation.tsx` calls `renderBlock(b.type, b.data, 1, { sketch })` with the type already extracted by salvage; here we extract the type the same lenient way and let `renderBlock`'s internal salvage handle garbage (it returns `""` for invalid blocks — same as `Explanation`'s invalid → `null`).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/document-react.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 6: Export from the React barrel and typecheck**

In `src/react/index.ts`, add:

```ts
export * from "./Document"
```

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src/core/documentValidate.ts src/react/Document.tsx src/react/index.ts tests/document-react.test.tsx
git commit -m "feat(react): static Document component with HTML parity"
```

---

### Task 5: LLM contract — shared block text, JSON schema, prompt snippet

**Files:**
- Create: `src/core/blockTypes.ts`
- Modify: `src/core/llm.ts`
- Test: `tests/document-llm.test.ts` (new), extend `tests/llm.test.ts` (regression)

**Interfaces:**
- Consumes: `documentSchema` (Task 1); existing `explanationJsonSchema`, `systemPromptSnippet` (unchanged behavior).
- Produces:
  - `BLOCK_TYPE_DOCS` — the block-type description lines (from `- step-list:` to the end of `- stack: …`), one shared string constant.
  - `documentJsonSchema` — `z.toJSONSchema(documentSchema, { io: "input" })`
  - `documentSystemPromptSnippet` — a tested instruction block covering the document shape and section rules, interpolating `BLOCK_TYPE_DOCS`.

- [ ] **Step 1: Write the failing tests**

Create `tests/document-llm.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { documentJsonSchema, documentSystemPromptSnippet, BLOCK_TYPE_DOCS } from "../src/core/llm"
import { documentSchema } from "../src/core/documentSchema"

describe("documentJsonSchema", () => {
  it("pins version to 1 and keeps optionals optional", () => {
    const schema = documentJsonSchema as Record<string, any>
    expect(schema.properties.version.const).toBe(1)
    const sectionProps = schema.properties.sections.items.properties
    expect(sectionProps.id.required).toBeUndefined() // io: "input" — optional stays optional
  })
})

describe("documentSystemPromptSnippet", () => {
  it("describes the document shape and section ordering rule", () => {
    expect(documentSystemPromptSnippet).toContain('"version"')
    expect(documentSystemPromptSnippet).toContain("section order is the document outline")
    expect(documentSystemPromptSnippet).toContain("ONLY the JSON object")
    expect(documentSystemPromptSnippet).toContain("no HTML")
  })

  it("carries the shared block-type text verbatim", () => {
    expect(documentSystemPromptSnippet).toContain(BLOCK_TYPE_DOCS)
  })
})

describe("documentSchema (LLM path)", () => {
  it("round-trips through the exported JSON schema", () => {
    expect(documentSchema.safeParse({
      version: 1,
      title: "T",
      sections: [{ title: "S", blocks: [{ type: "text", body: "x" }] }],
    }).success).toBe(true)
  })
})
```

Extend `tests/llm.test.ts` — add inside the existing `describe("systemPromptSnippet")`:

```ts
  it("still mentions the shared block-type text after the extraction", () => {
    expect(systemPromptSnippet).toContain(BLOCK_TYPE_DOCS)
  })
```

and update its import line to:

```ts
import { explanationJsonSchema, systemPromptSnippet, BLOCK_TYPE_DOCS } from "../src/core/llm"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/document-llm.test.ts tests/llm.test.ts`
Expected: FAIL — `documentJsonSchema`/`BLOCK_TYPE_DOCS` not exported; llm.test.ts fails on the missing export too.

- [ ] **Step 3: Extract the shared text and add the document contract**

Create `src/core/blockTypes.ts`:

```ts
/** Block-type description lines shared by the explanation and document prompt
 *  snippets. Extracted verbatim from the original systemPromptSnippet so both
 *  contracts stay in lockstep (spec §6); the explanation snippet's rendered
 *  text is regression-guarded by tests/llm.test.ts. */
export const BLOCK_TYPE_DOCS = `
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
`.trim()
```

Modify `src/core/llm.ts`:

```ts
import { z } from "zod"
import { explanationSchema } from "./schema"
import { documentSchema } from "./documentSchema"
import { BLOCK_TYPE_DOCS } from "./blockTypes"

/** JSON Schema for structured outputs / tool calling. `io: "input"` keeps optional fields optional for the model. */
export const explanationJsonSchema = z.toJSONSchema(explanationSchema, { io: "input" })
export const documentJsonSchema = z.toJSONSchema(documentSchema, { io: "input" })

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
```

Then rewrite the existing `systemPromptSnippet` so its block-type section is interpolated from the shared constant, keeping every other character identical. The header part (everything above `Block types:`) stays exactly as it is today; replace the literal block-type lines with:

```ts
Block types:
${BLOCK_TYPE_DOCS}
- text: { body } — plain paragraph.
- code: { language?, code } — a verbatim source snippet for how-tos; never contains HTML or markdown (rendered exactly as written).
`.trim()
```

IMPORTANT for the executor: `BLOCK_TYPE_DOCS` must contain exactly the 13 block lines listed above (step-list through stack), and the explanation snippet appends `- text:` and `- code:` after it. That reproduces today's snippet byte-for-byte except that its lines are now sourced from the shared constant. The extraction is mechanical: copy the current lines from `- step-list:` through `- stack: …` into `BLOCK_TYPE_DOCS`, delete them from the template literal, insert `${BLOCK_TYPE_DOCS}`, and keep `- text`/`- code` as literal lines (the document snippet deliberately omits them — a bare paragraph has a home in sections too, but the document rules above tell the model to use block types; keeping the document list to the 13 typed blocks matches the spec §6 wording "block-type list by reference"). If `tests/llm.test.ts` "mentions every registered block type" fails after this change because `text` or `code` no longer appear — they do appear, as literal lines.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/document-llm.test.ts tests/llm.test.ts`
Expected: PASS (5 document-llm tests + existing llm tests)

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors

```bash
git add src/core/blockTypes.ts src/core/llm.ts tests/document-llm.test.ts tests/llm.test.ts
git commit -m "feat(llm): document JSON schema + prompt snippet sharing block-type text"
```

---

### Task 6: Demo — `demoDocIr`, `/document` route, document CSS

**Files:**
- Modify: `demo/examples.js` (append `demoDocIr` + export), `demo/server.mjs` (import + `/document` route), `src/themes/tokens.css` (append `exp-doc*` styles)
- Test: `tests/demo-examples.test.ts` (extend)

**Interfaces:**
- Consumes: `documentSchema` (Task 1) for the test assertion; `renderDocument` (Task 2) via `dist/index.js` in the server; existing fixtures `educationIr`, `dataIr`, `figuresIr`, `howToIr` from `demo/examples.js` (exported today — the server imports them by name already).
- Produces: exported `demoDocIr` in `demo/examples.js`; `GET /document` route serving the composed page; `exp-doc*` CSS in `tokens.css`.

- [ ] **Step 1: Extend the demo tests**

In `tests/demo-examples.test.ts`, add a new `describe` at the end (imports at top of file — follow the file's existing import style):

```ts
import { documentSchema } from "../src/core/documentSchema"
// (add to the existing import block)

describe("demoDocIr (document fixture)", () => {
  it("parses against documentSchema", () => {
    const { demoDocIr } = demoExamples
    expect(documentSchema.safeParse(demoDocIr).success).toBe(true)
  })

  it("renders a page with a TOC and all four sections", async () => {
    const { demoDocIr } = demoExamples
    const { renderDocument } = await import("../src/core/renderDocument")
    const { html } = renderDocument(demoDocIr, { theme: "none" })
    expect((html.match(/exp-doc-section-title/g) ?? []).length).toBe(4)
    expect(html).toContain("exp-doc-toc")
    expect(html).toContain(`href="#sec-fig-epicycles"`)
  })
})
```

Note: the existing file imports the fixtures from `../../demo/examples.js`; check its exact import/destructuring style first and reuse it (`demoExamples` above stands for whatever the file already destructures — if it imports named exports directly, use `import { demoDocIr } from "../../demo/examples.js"` and drop the `demoExamples` indirection).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/demo-examples.test.ts`
Expected: FAIL — `demoDocIr` is not exported.

- [ ] **Step 3: Add `demoDocIr` to `demo/examples.js`**

Append at the end of `demo/examples.js`:

```js
// Curio-style editorial page: the four existing explanations composed as one
// multi-section document. Schema-checked by tests/demo-examples.test.ts.
export const demoDocIr = {
  version: 1,
  title: "How signals become pictures",
  summary: "Four angles on one pipeline — the concept, the data, the drawing, the rollout.",
  sections: [
    { id: "fig-concept", title: "The concept", blocks: educationIr.blocks },
    { id: "fig-data", title: "What the data says", blocks: dataIr.blocks },
    { id: "fig-figures", title: "Drawing it", blocks: figuresIr.blocks },
    { id: "fig-epicycles", title: "Epicycles", blocks: howToIr.blocks },
  ],
}
```

- [ ] **Step 4: Add the `/document` route to `demo/server.mjs`**

In `demo/server.mjs`, extend the existing import line:

```js
import { educationIr, dataIr, capabilitiesIr, figuresIr, howToIr, demoDocIr } from "./examples.js"
```

and add `renderDocument` to the dist import:

```js
import { renderExplanation, renderDocument } from "../dist/index.js"
```

Then add the route handler after the existing `if (url.pathname === "/")` block (same pattern):

```js
  if (url.pathname === "/document") {
    // The document root is the token-bearing .exp scope; theme "none" keeps
    // the demo chrome in charge of the page background.
    const { html } = renderDocument(demoDocIr, { theme: "none" })
    const docPage = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>explanations — document demo</title>
<link rel="stylesheet" href="/themes/tokens.css">
<link rel="stylesheet" href="/themes/light.css">
<link rel="stylesheet" href="/themes/dark.css">
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 46rem; padding: 0 1rem; }
  nav.exp-doc-toc { position: sticky; top: 1rem; float: right; max-width: 12rem; margin: 0 0 1rem 1.5rem; font-size: 0.85em; }
</style>
</head>
<body>
<p><a href="/">← all examples</a></p>
${html}
</body>
</html>`
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end(docPage)
    return
  }
```

- [ ] **Step 5: Append the document CSS to `src/themes/tokens.css`**

Append at the end of `src/themes/tokens.css` (AFTER the popover block — do NOT use a heredoc for this; the CSS contains no `{`/`}` trap here because you are appending with str_replace against the file's final lines, not writing through bash):

```css

/* Document layer (document spec 2026-09-30): exp-doc* classes emitted by
   renderDocument and <Document>. Token-driven like everything else. */
.exp-doc-header {
  margin-bottom: calc(var(--exp-gap) * 1.5);
}

.exp-doc-title {
  margin: 0 0 6px;
  font-size: 1.9em;
  font-weight: 700;
  line-height: 1.2;
}

.exp-doc-summary {
  margin: 0;
  color: var(--exp-text-muted);
  font-size: 1.05em;
}

.exp-doc-toc {
  background: var(--exp-surface-muted);
  border: 1px solid var(--exp-border);
  border-radius: var(--exp-radius);
  padding: 10px 14px;
  margin: 0 0 calc(var(--exp-gap) * 1.5);
}

.exp-doc-toc-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 18px;
}

.exp-doc-toc-list a {
  color: var(--exp-accent);
  text-decoration: none;
}

.exp-doc-toc-list a:hover {
  text-decoration: underline;
}

.exp-doc-section {
  margin: calc(var(--exp-gap) * 2) 0 0;
}

.exp-doc-section-title {
  margin: 0 0 var(--exp-gap);
  font-size: 1.4em;
  font-weight: 650;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--exp-border);
}
```

- [ ] **Step 6: Run the demo tests and the full suite**

Run: `npm run build && npx vitest run tests/demo-examples.test.ts && npx vitest run`
Expected: build succeeds (server imports `renderDocument` from dist); demo tests PASS; full suite PASS.

- [ ] **Step 7: Commit**

```bash
git add demo/examples.js demo/server.mjs src/themes/tokens.css tests/demo-examples.test.ts
git commit -m "demo: Curio-style document page composing existing fixtures"
```

---

### Task 7: ROADMAP update + full verification

**Files:**
- Modify: `docs/ROADMAP.md`

**Interfaces:**
- Consumes: everything above.
- Produces: ROADMAP marks arc step 2 shipped; the branch is verified end-to-end.

- [ ] **Step 1: Update the ROADMAP**

In `docs/ROADMAP.md`, add to the end of the `## Shipped` list (after the "Figure interactivity events" entry):

```markdown
- **Document IR + sections** (2026-09-30) — sibling `documentSchema` composing
  the existing block union into flat h2 sections with a derived, data-only
  TOC; `renderDocument()` HTML composer with lenient section salvage, static
  React `<Document>` with parity guarantees, LLM contract (JSON schema + prompt
  snippet sharing block-type text), demo `/document` page. Spec:
  `docs/superpowers/specs/2026-09-30-document-ir-sections-design.md`.
```

And in `## Backlog`, change:

```markdown
- Steps 2–3 specs (see arc above) — write when their turn comes.
```

to:

```markdown
- Step 3 spec (Curio compiler / orchestrator) — write when its turn comes.
```

- [ ] **Step 2: Full verification**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: typecheck clean, all tests pass (including the five new/extended suites), build succeeds.

- [ ] **Step 3: Manual demo check (browser eyes)**

Run: `npm run demo` (builds first) and visit `http://localhost:4173/document`.
Expected: page title, TOC links scroll to sections, all four sections render with their blocks (including the epicycles/figure content), no console warnings about missing classes.

- [ ] **Step 4: Commit**

```bash
git add docs/ROADMAP.md
git commit -m "docs(roadmap): mark document IR + sections shipped"
```
