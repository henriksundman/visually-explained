# Sources Block — Design (Grounded Authoring, Part 1)

**Date:** 2026-10-01
**Status:** Approved (brainstorm 2026-10-01)
**Predecessor:** Link inline element (`2026-10-01-link-inline-element-design.md`)
**Backlog origin:** ROADMAP "Grounded authoring — hosts supply source material
… output carries provenance: citation blocks or inline references (the link
inline element shipped 2026-10-01 unblocks this)". Split into two sub-cycles
(brainstorm 2026-10-01); this is part 1 — the block-library half. Part 2
(compiler grounding: `SourceExcerpt` → prompts → citation teaching → audit
warnings) gets its own spec once this ships.

## 1. Problem & Goal

Grounded output needs a place for provenance to *land*: a rendered list of
the sources behind a document, each anchorable so inline citations
(`[label](#source-<id>)`, shipped last cycle) have a target. Goal: a `sources`
block type — a numbered, anchorable source list — usable in hand-authored IR
immediately, and auto-appendable by the compiler in part 2.

## 2. Decisions (from brainstorm)

1. **Identified excerpts** (part 2's input shape, fixed here so the render
   matches): `{ id, title, text, url? }` — chunking/sizing stays host-side.
   The block stores only the *reader-facing* projection: `id`, `title`,
   `url?`, `detail?` (part 2 derives `detail` from the excerpt text; part 1
   never touches excerpt text).
2. **Inline anchor citations + sources block** — citations are plain links to
   in-page anchors (or source URLs); the block renders the anchor targets.
   A hallucinated anchor is just a dead link — lenient by construction; part
   2's audit makes drift visible.
3. **One shared href gate** — `safeHref` is exported from `inline.ts`; the
   primitive and `renderInline` use one implementation (two link emitters,
   one policy).
4. **Anchor naming:** `source-<id>` on the item `li`, namespacing citation
   anchors away from section anchors (`sec-…`). The item id is user/LLM data,
   so the anchor id goes through `escapeHtml` exactly like other attribute
   data (same surface rules as `data-el-id`).

## 3. Schema (`src/core/schema.ts`)

```ts
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
```

- Registered in the block union (`schema.ts` union list, same pattern as
  `timelineBlockSchema`). Max 24 items matches `data-callout`'s series cap —
  a provenance list is not a bibliography dump.
- No `dataset` key: sources are the host's own material, not interpolated
  data (real-data spec §8).

## 4. Rendering (`src/primitives/sources.ts`)

- One numbered list per block:
  `<div class="exp-block exp-sources">[<p class="exp-sources-title">…</p>]<ol class="exp-sources-list">…</ol></div>`
  (`title?` on the block, not per item; omitted when absent).
- Each item: `<li id="source-<escaped id>" class="exp-source">` —
  `<a class="exp-source-link" href="…">title</a>` when the item has a URL
  that **passes the shared gate**, else the plain title text (gated-out URLs
  degrade the *link*, never the item); then
  `<p class="exp-source-detail">…</p>` when `detail` is present.
- All text fields escape via `escapeHtml`; prose fields (`title`, `detail`)
  pass through `renderInline` like other block prose.
- **No per-item salvage** — unlike chart points, an invalid *item* fails the
  block schema wholesale (house all-or-nothing salvage; the caps keep any
  single item small). Leniency lives where the model actually errs: URLs
  (gate) and absent fields (optional).
- Numbering is the `<ol>`'s job (CSS counter styling in themes); no rendered
  numbers in markup.
- Citation anchor contract: `[x](#source-<id>)` targets item `id`s verbatim —
  part 2's prompt teaches exactly this string form.

## 5. Shared Gate Export (`src/core/inline.ts`)

- `safeHref` becomes `export function safeHref(href: string): string | null`
  (behavior unchanged; its doc comment updated to note the second consumer).
- The sources primitive imports it — no policy duplication.

## 6. Surface Wiring

- `src/primitives/sources.ts` → `registerPrimitive("sources", …)`; imported
  by `src/core/registerAll` (follow the existing primitive import pattern).
- `BLOCK_TYPE_DOCS` (`src/core/blockTypes.ts`): one entry,
  `sources: { title?, items: [{ id, title, url?, detail? }] } — a numbered
  reference list; each item is anchorable as source-<id> for inline
  citations. Cite claims in body text with [label](#source-<id>) or
  [label](url); list the sources that ground the explanation.`
- Theme CSS appended to `tokens.css`, `light.css`, `dark.css`
  (`.exp-sources`, `.exp-sources-title`, `.exp-sources-list`,
  `.exp-source`, `.exp-source-link`, `.exp-source-detail` — muted detail,
  list styling consistent with `.exp-timeline-events`).
- README: block list gains `sources` under **Pedagogy**; the block count
  "15 primitives" becomes 16 (README + spec references).
- Compiler prompts are **untouched** in part 1 (`BLOCK_TYPE_DOCS` flows into
  them automatically, so the model can already emit the block; part 2 adds
  the citation teaching).

## 7. Testing

- **Schema:** valid block parses; >24 items, empty id, missing title fail;
  unknown-key stripping doesn't matter (no host keys).
- **Render:** full block (title + linked items + details); url-less item
  (plain title); gated URL (`javascript:`) → plain title, item intact;
  escaping of ids/titles/details; anchor id form `id="source-x"`.
- **Inline citation end-to-end:** a text block
  `[S1](#source-s1)` in the same explanation as a `sources` block with item
  id `s1` → rendered HTML contains both the anchor href and the target
  `id="source-s1"`.
- **Gate single-source-of-truth:** `safeHref` export used by the primitive
  (import assertion via module graph is overkill — the render tests over the
  gate matrix are the proof).
- **Prompt snapshot:** `sectionSystemPrompt()` now contains the
  `BLOCK_TYPE_DOCS` sources entry (flows in automatically — one assertion).
- **Determinism lock:** existing suite green unchanged; block count updates
  in README tested only as text.

## 8. Out of Scope

- Compiler wiring of every kind (part 2): `SourceExcerpt`, prompt
  interpolation, citation rules, auto-append, audit warnings, demo stub
  sources.
- Per-item lenient salvage (all-or-nothing by design, §4).
- Bibliography styles (APA-ish formatting), sorting, dedup.
- A `citations` inline element distinct from plain links.
- JSON-schema export changes (bodies stay strings; the block arrives as
  structured IR).

## 9. Plan Sizing (input to writing-plans)

Estimated 3 tasks: schema + gate export + primitive + registerAll →
BLOCK_TYPE_DOCS + themes CSS + README count → tests (schema/render/
end-to-end/prompt) + full verification. (Tests ride with each task per TDD;
the split is: working block → wired surface → verified whole.)
