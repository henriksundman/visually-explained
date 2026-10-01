# Real Data for Visual Blocks — Design

**Date:** 2026-10-01
**Status:** Approved (brainstorm 2026-10-01)
**Predecessor:** Streaming compile (`2026-10-01-streaming-compile-design.md`)
**Backlog origin:** ROADMAP backlog "Real data for visual blocks — host-supplied
datasets (keyed, schema-validated) interpolated into `chart`/`data-callout`/
`timeline` at render time, so numbers are true instead of model-guessed.
Renderer/schema work; no LLM-surface changes."

## 1. Problem & Goal

Every number in a rendered visual is model-written. The LLM guesses weekly
deploys, p95 latencies, migration dates — plausible-looking and wrong. Hosts
have the true data but no way to hand it to the renderer, so every host
re-implements "post-process the IR before rendering" badly.

Goal: a host-supplied, per-call **dataset registry** that visual blocks
reference by key (`dataset: "weekly-deploys"`). At render time a hit
materializes the block's data fields from validated data; a miss or invalid
payload degrades to the block's literal fields with a warning — never a
failed render.

## 2. Decisions (from brainstorm)

1. **Optional `dataset` key on existing blocks** — no new block types, no
   field-level refs. `chart`, `data-callout`, `timeline` gain
   `dataset?: string`. Fully back-compatible; lenient by construction.
2. **Per-block-type datasets** — a dataset payload is shaped like the block's
   own data fields and validated by that block type's dataset schema. The
   registry stays a dumb `Record<string, unknown>`; each block type owns its
   read rule. No generic-bag conventions.
3. **Render-option registry** — `datasets` rides the existing options of
   `renderExplanation` / `renderDocument` / `<Explanation>` / `<Document>` and
   flows through `RenderContext`. Per-call and SSR-safe (no module-global
   state); diagnostics flow out the existing `{ html, warnings }` channel.
4. **Field-by-field override** — a validated dataset's fields win over the
   block's literal fields; fields the dataset omits keep the literal values.
   No half-truth per field: a field is either dataset-true or literal.
5. **No LLM-surface changes** (backlog pin) — `BLOCK_TYPE_DOCS`, compiler
   prompts, and the JSON-schema exports are untouched. Hosts attach `dataset`
   keys to IR programmatically (post-compile or hand-authored IR). A
   prompt-visible dataset menu is future work (§8).

## 3. Public Surface

- **Schema additions** (`src/core/schema.ts`):
  - `chartBlockSchema.dataset?: string` (same for `dataCalloutBlockSchema`,
    `timelineBlockSchema`). The key must live in the zod schemas or lenient
    salvage would strip host-attached keys.
- **Dataset schemas** (exported from the package root), mirroring each
  block's **data fields only** (no `id`, no `type`, no `dataset`):
  - `chartDatasetSchema` — `{ kind: "bar" | "line", points, unit?, caption? }`
  - `dataCalloutDatasetSchema` — `{ metric, label, delta?, trend?, series?, context? }`
  - `timelineDatasetSchema` — `{ events }`
  - Same field constraints as the block schemas (min/max counts, string
    limits). Hosts can pre-validate payloads with the same zod the renderer
    uses; point/event-level salvage stays with the primitives.
- **Render options**: `datasets?: Record<string, unknown>` on
  `renderExplanation`, `renderDocument`, `<Explanation>`, `<Document>` —
  all optional, default absent = today's behavior byte-for-byte.

## 4. Resolution Semantics

One rule, lenient everywhere. Per visual block with `dataset` set:

| Case | Behavior |
| --- | --- |
| Key hit, payload validates against the type's dataset schema | Payload fields **override** the block's literal fields, field by field; omitted fields keep literals; then render as today |
| Key hit, payload invalid | Warning + render literal fields exactly as today |
| Key miss | Warning + render literal fields exactly as today |
| No `dataset` key | Today's render, byte-identical (no warning) |

- Required dataset cores mirror the block schemas' required fields: chart
  `{ kind, points }`, callout `{ metric, label }`, timeline `{ events }`.
- Dataset failures are **block-level salvage**: a warning even under
  `strict: true` (strict escalates document/section-level diagnostics, not
  this). A dataset problem never fails a render.
- Dataset points flow through the chart primitive's existing per-point
  salvage (`figure-point-invalid`) — one render path, no special casing.
- Warnings identify the block: `[dataset] chart <id>: no dataset named "k"`,
  `[dataset] data-callout <id>: invalid payload — <issues>`.

## 5. Flow-Through

- `RenderContext` gains `datasets?: Record<string, unknown>`; all four entry
  points pass the option through. Compiler untouched (it carries blocks).
- One shared resolver helper, `src/core/datasets.ts`:
  `resolveDataset<T>(ctx, block, schema)` returns
  `{ ok: true, data } | { ok: false, warning }` — primitives apply the
  returned fields to their block before rendering, so each primitive's diff
  is a three-line merge at the top of its render function.
- Primitive wiring (three files): `src/primitives/chart.ts`,
  `src/primitives/data-callout.ts`, `src/primitives/timeline.ts`.

## 6. Testing

- **Schema acceptance:** blocks with `dataset` parse. (Amended during the
  fresh-eyes pass: block salvage is all-or-nothing — a block that fails its
  own schema is skipped wholesale, dataset key or not. The key only matters
  for schema-valid blocks; there is no partial payload for it to survive on.)
- **Resolver matrix:** hit / hit-invalid / miss / absent — resolved fields,
  fallback fields, and warning text for each of the three block types.
- **Override semantics:** per-field precedence (dataset field wins, omitted
  dataset field keeps literal); no literal survives where the dataset speaks.
- **Entry-point parity:** `renderExplanation`, `renderDocument`,
  `<Explanation>`, `<Document>` all honor `datasets` with identical output.
- **Determinism lock:** with no `datasets` option, output is byte-identical
  to pre-change output (existing suite proves this by passing unchanged).
- **Strict non-escalation:** `strict: true` + invalid dataset payload →
  warning + literal render, not a throw.
- **Chart point salvage still applies** to dataset-supplied points.

## 7. Demo

`/document` gains a dataset-driven section: the server passes `datasets` to
`renderDocument`; the same chart IR appears twice — once with a `dataset`
key (true numbers) and once without (model-guessed literals) — plus a
dataset-driven timeline. Route smoke-checked to 200 like every demo route.

## 8. Out of Scope

- Field-level refs (`{ $ref: "key.path" }`) and mixed true/guessed fields
  within one visual.
- Whole-block dataset-only variants (`data-chart`, …).
- Prompt-visible dataset menus / compiler awareness of datasets.
- Datasets for `figure`, `diagram`, or any non-visual block.
- A global dataset registry (rejected: global mutable state breaks SSR
  determinism).

## 9. Plan Sizing (input to writing-plans)

Estimated 5 tasks: dataset schemas + resolver + RenderContext → chart
primitive wiring + tests → data-callout + timeline wiring + tests →
entry-point pass-through (renderDocument/React) + parity tests → demo
section + README + ROADMAP + full verification.
