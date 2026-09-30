# Document IR + Sections — Design

**Date:** 2026-09-30
**Status:** Approved (brainstorm 2026-09-30)
**Predecessor:** Figure interactivity events (`2026-09-29-figure-interactivity-events-design.md`)
**Backlog origin:** ROADMAP arc step 2, "Document IR + sections" (agreed 2026-09-28)

## 1. Problem & Goal

The library renders one explanation as a flat block list with an optional
title/summary. The Curio destination — "editorial explanation pages" — needs
page structure: chapters with headings, a table of contents, and long-form
composition. The compiler (arc step 3) orchestrates exactly this shape, so the
format it will fill must exist and be finished before that step.

Goal: a **document IR** that composes the existing block system into ordered
sections with headings and a derived, data-only TOC; a `renderDocument()`
composer in the HTML renderer; a static React `<Document>` for parity; the
demo rebuilt around a real multi-section page; and the LLM contract
(JSON schema + tested prompt snippet) shipped now so step 3 consumes a done
deal. No new block types; sections are purely structural.

## 2. Decisions (from brainstorm)

1. **One document tree** — the LLM/host artifact is a single JSON document
   `{ version, title, sections: [...] }`, not per-section trees or a loose
   bag. Matches the `stack` precedent: a section is one more nesting level,
   not a new concept.
2. **TOC only** — navigation is a heading-derived outline with anchor links,
   zero JS, SSR-only. Scroll-spy, cross-references, and prev/next are
   explicitly out; all of them can be added later without an IR change
   because nav is derived, not authored.
3. **Flat sections** — no sub-sections. Section titles render at h2 (the
   document title is h1). Ordering of sections **is content**: it carries the
   compiler's outline, so the IR is an array, never a map, and has no
   `position` fields to keep consistent.
4. **Sibling schema + composer** — `documentSchema` is a new schema beside
   `explanationSchema`, not an extension of it. One format per artifact keeps
   salvage semantics unambiguous; `renderDocument()` composes the existing
   `renderBlock` pipeline rather than reimplementing it.
5. **Full vertical slice** — HTML renderer + React component + demo page,
   like every shipped feature; LLM contract lands in the same cycle.

## 3. Data Model (`src/core/documentSchema.ts`)

```ts
documentSchema = {
  version: 1,                  // literal
  title: string,               // page title, required, min 1
  summary?: string,            // min 1
  sections: [                  // min 1
    {
      id?: string,             // lenient, see anchors below
      title: string,           // section heading, min 1
      blocks: unknown[],       // existing Block union, lenient here
    },
  ],
}
```

- **No new block types.** `blocks` reuse the existing block union. Per the
  `stack`/`chart`/`figure` precedent they are `z.unknown()` at parse time;
  per-block salvage happens at render time via `renderBlock`'s existing
  leniency, so one malformed block drops alone instead of failing the
  document. (`explanationSchema` keeps its strict `blockUnionSchema`; the
  document schema is a separate object and chooses leniency deliberately —
  long multi-section output is exactly where one bad block should not
  invalidate a section.)
- **No nesting.** `sectionSchema` has no `sections` field; a model that emits
  one gets it stripped by zod and its inner blocks lost. The compiler guards
  against this upstream via the exported JSON schema (strict), which is the
  documented contract path.
- **Section identity & anchors.** A section's anchor id is `sec-` + slug,
  where the slug comes from the authored `id` if valid, else from the
  section `title`. Slug: lowercase, whitespace → `-`, strip to
  `[a-z0-9-]`, collapse repeats, trim, cap 100 chars. Uniqueness: first wins;
  later collisions append `-2`, `-3`, … (same rule as figure emit). A slug
  that comes out empty falls back to `section-<index>`. Derivation lives in
  one exported helper from `documentSchema.ts` so HTML, React, and tests
  share it.
- Section titles are content, not "Untitled" placeholders; the schema's
  `min(1)` is the floor, the prompt sets the bar.

## 4. Render Layer (`src/core/renderDocument.ts`)

`renderDocument(input: unknown, opts?: RenderDocumentOptions): { html, warnings }`

- Parses leniently: broken top level (bad `version`, empty `title`, non-array
  `sections`, zero sections) → renders an empty page shell + warning, never
  throws. A section with a bad `title` or non-array `blocks` drops **alone**
  with a warning. `strict: true` throws instead, as everywhere.
- Options mirror `renderExplanation`'s theme handling (`light` | `dark` |
  `none` on the document root) plus `toc?: boolean` (default `true`) for
  hosts composing single-section pages. `sketch` and block-level options
  pass through to `renderBlock`.
- Emitted skeleton (class names final at plan time, `exp-doc` family):

```html
<article class="exp exp-doc exp-theme-light">
  <header class="exp-doc-header">
    <h1 class="exp-doc-title">…</h1>        <!-- summary? as lede -->
  </header>
  <nav class="exp-doc-toc" aria-label="On this page">
    <ol class="exp-doc-toc-list">
      <li><a href="#sec-intro">Introduction</a></li>
      …
    </ol>
  </nav>
  <section class="exp-doc-section" id="sec-intro">
    <h2 class="exp-doc-section-title">Introduction</h2>
    …existing block markup…
  </section>
  …
</article>
```

- TOC entries derive from section titles + computed anchor ids; the anchor id
  lives on the `<section>`. Text goes through the existing escaped inline
  renderer — no raw HTML anywhere (house rule).
- **Zero scripts** in static output; deterministic, SSR-stable bytes for
  identical input.

## 5. React Layer (`src/react/Document.tsx`)

- Static, RSC-safe component rendering the same skeleton as §4 from the same
  IR: header, TOC, sections; blocks reuse the existing React block
  components. Takes the document IR + the same theme/toc options.
- No client JS, no scroll-spy, no event layer. Interactivity keeps its
  existing opt-in path: a `figure` block inside a section renders through the
  same React components used today (`InteractiveFigure` where the host opts
  in), so `<Document>` adds no interactivity machinery of its own.
- Parity contract, test-enforced: React SSR output and HTML renderer output
  agree on section ids, TOC anchors, and section count.

## 6. LLM Contract (`src/core/llm.ts`)

- `documentJsonSchema = z.toJSONSchema(documentSchema, { io: "input" })`,
  mirroring `explanationJsonSchema`.
- `documentSystemPromptSnippet` — tested, covering: version 1; `title` is the
  page title; **section order is the document outline**; each section gets a
  heading-style title (no trailing punctuation) and blocks chosen by the same
  rules as the explanation prompt; `id` only when stable anchors matter;
  no HTML, inline emphasis only.
- The block-type descriptions are shared with `systemPromptSnippet` by
  extracting them into one constant both snippets interpolate — the
  explanation snippet's rendered text must not change (regression-guarded by
  its existing test), so the two contracts cannot drift.

## 7. Demo & Rollout

- `demo/examples.js` gains `demoDocIr`: a multi-section page assembled from
  the existing fixtures (education, data, figures, how-to) — schema-checked
  by tests. The interactive epicycles figure lives inside a section,
  proving sections compose everything shipped so far.
- `demo/server.mjs` gains a route serving the document page via
  `renderDocument(demoDocIr, { theme: "none" })` with the standard demo
  chrome, alongside the existing per-explanation pages.
- ROADMAP: arc step 2 marked Shipped with the spec link. Zero breaking
  changes: new schema, new exports, existing exports untouched.

## 8. Testing

- **Schema** (`tests/document-schema.test.ts`): valid parse; rejects
  `version ≠ 1`, empty `title`, empty/missing `sections`; section `blocks`
  accept unknown entries (lenient by design); nested `sections` key is
  stripped, not rendered.
- **Anchors**: authored id slugified; title-derived slug; collision →
  `-2`/`-3`; empty slug → `section-<index>`; ids shared by HTML/React paths
  via the one helper.
- **Render** (`tests/document-render.test.ts`): skeleton order (header →
  nav → sections); TOC entries match section count/titles/hrefs; h1/h2
  levels; malformed section drops alone + warning; broken top level → shell +
  warning; `strict: true` throws; theme/sketch/toc options; determinism
  (same input → byte-identical output); no `<script>` in output.
- **React** (`tests/document-react.test.tsx`): SSR parity with the HTML
  renderer (ids, anchors, section count); RSC-safe (no client-only APIs).
- **LLM** (`tests/document-llm.test.ts`): `documentJsonSchema` is valid JSON
  Schema with optional fields optional (`io: "input"`); snippet asserts key
  rules; shared block-type text unchanged for the explanation snippet.
- **Demo** (`tests/demo-examples.test.ts`): `demoDocIr` parses against
  `documentSchema`; renders a page with TOC and all sections present.

## 9. Out of Scope (v1)

- Sub-sections / arbitrary heading trees (flat h2 sections only).
- Scroll-spy, active-section highlighting, any client JS in the document.
- LLM-authored cross-references and prev/next links (host/routing concerns).
- Collections, multiple documents, routing — host territory.
- Compiler orchestration (arc step 3 consumes this finished contract).
- Documents as blocks (category error; see §2.4).

## 10. Plan Sizing (input to writing-plans)

Estimated 6 tasks: schema + anchor/slug helper → `renderDocument` + salvage →
React `<Document>` + parity tests → LLM contract (shared block-type
extraction, JSON schema, snippet) → demo route + `demoDocIr` → docs/ROADMAP +
full verification.
