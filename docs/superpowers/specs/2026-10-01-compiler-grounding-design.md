# Compiler Grounding — Design (Grounded Authoring, Part 2)

**Date:** 2026-10-01
**Status:** Approved (brainstorm 2026-10-01 — all decisions locked in the
part-1 brainstorm; this spec records them)
**Predecessor:** Sources block (`2026-10-01-sources-block-design.md`, shipped
`25369a4`) and Link inline element (`2026-10-01-link-inline-element-design.md`)
**Backlog origin:** ROADMAP "Grounded authoring — hosts supply source material
… constrains outline/section prompts; output carries provenance via inline
citations and the sources block (shipped 2026-10-01). Part 2: compiler
wiring — SourceExcerpt prompts, citation teaching, audit warnings."

## 1. Problem & Goal

The `sources` block gives provenance somewhere to land, and `renderInline`
can emit citation anchors — but the compiler knows nothing about source
material: hosts would have to fold excerpts into `guidance` strings by hand
and teach citation conventions themselves. Goal: `compileDocument(topic, {
client, sources })` interpolates host-supplied excerpts into outline/section
prompts, teaches the citation contract, auto-appends the `sources` block, and
audits the output so grounding drift is visible instead of silent.

## 2. Decisions (from brainstorm, locked 2026-10-01)

1. **Identified excerpts** — host material arrives as
   `{ id, title, text, url? }[]`. Chunking/sizing stays host-side; the
   compiler interpolates what it is given.
2. **Inline anchor citations + sources block** — the section prompt teaches
   `[label](#source-<id>)` (in-page anchor to the auto-appended block) or
   `[label](url)` when the source has one. A hallucinated anchor is a dead
   link — lenient by construction; the audit makes drift visible.
3. **`sources` in `CompileOptions`** — one additive option; both
   `compileDocument` and `compileDocumentStream` get it free (one code
   path). Absent sources → byte-identical behavior to today.
4. **Constrain + audit-warn** — prompts constrain (ground claims, omit what
   sources don't cover, never invent); no hard enforcement. The compiler
   scans section output and warns; nothing is dropped or thrown for
   grounding.
5. **Two sub-cycles** — part 1 (the block) shipped; this spec is part 2.

## 3. Public Surface

```ts
export interface SourceExcerpt {
  id: string      // 1–64 chars, the citation target (source-<id>)
  title: string   // 1–200 chars
  text: string    // 1–2000 chars — host-pre-chunked excerpt, interpolated into section prompts
  url?: string    // ≤500 chars, http(s) — cited directly when present
}

// CompileOptions gains:
sources?: SourceExcerpt[]
```

- `SourceExcerpt` lives in `src/compiler/client.ts` (the options/types home),
  exported from the package root.
- Per-call validation: excerpts are **compiler-validated leniently** — an
  excerpt failing the shape is dropped with
  `[grounding] source N dropped — <issue>` before any prompting (bad ids
  would poison anchors). Duplicated ids: first wins,
  `[grounding] duplicate source id "x" dropped`.
- No JSON-schema export changes (excerpts are a host→compiler input, not
  model output).

## 4. Prompt Flow (`src/compiler/prompts.ts`)

- **Outline user prompt** gains (when sources survive validation):

  ```
  Sources available (cite by id; sections must stay groundable in these):
  - <id>: <title>[ — <url>]
  ```

  Titles + ids + urls only — the outline plans structure, it does not read
  excerpts. No sources → prompt byte-identical to today.
- **Section user prompt** gains the excerpt list **with text** (the writer
  grounds on it), then the citation rules:

  ```
  Sources for this document (ground claims in these):
  [<id>] <title>: <text>
  [url: <url>]

  Citation rules: cite the source a claim comes from as
  [label](#source-<id>) (or [label](url) when the source has one). Ground
  claims in these sources; if the sources don't cover something, leave it
  out rather than inventing facts or citations.
  ```

- The sources block is appended to the **last surviving section's blocks**
  (no new section; `maxSections` semantics intact), built from the validated
  excerpts: `{ type: "sources", id: "compile-sources", title: "Sources",
  items: [{ id, title, url?, detail }] }` where `detail` is the excerpt
  text truncated to the schema's 400-char cap (part-1 spec anticipated this
  derivation). If no section survived, skip the append with
  `[grounding] sources block not appended — no surviving section`.
- Prompts stay deterministic: excerpt order is host order, no sorting.

## 5. Audit (`src/compiler/stream.ts` orchestrator)

After each section's blocks are accepted (post-repair), scan the JSON-escaped
*render intent*, not rendered HTML: walk string fields of the section's blocks
(text/callout/step bodies, captions — the `renderInline` surfaces) for
`(#source-<id>)` anchor references:

- Citation to an id not in the validated excerpt set →
  `[grounding] section N cites unknown source "<id>"`.
- At `compile-done`, any validated excerpt never cited anywhere →
  `[grounding] source "<id>" never cited`.

Warnings ride the existing channel (block-level leniency; strict does not
escalate them — same rule as `[dataset]`). Implementation: one small helper
(`collectCitationIds(blocks)` + set difference) in `stream.ts`; the sources
block itself is excluded from "never cited" accounting (it lists, not cites).

## 6. Testing (scripted clients, no network)

- **Happy grounded compile:** 2 excerpts, both cited → citations present in
  section output, sources block appended to last section, zero warnings.
- **Hallucinated anchor:** model emits `#source-nope` →
  `[grounding] section 1 cites unknown source "nope"`.
- **Unused source:** excerpt never cited →
  `[grounding] source "s2" never cited`.
- **Invalid + duplicate excerpts** dropped with warnings before prompting
  (assert the section prompt never contains them).
- **No-sources path:** existing suite green unchanged (byte-identical
  contract, both APIs).
- **Parity:** `compileDocument` and drained `compileDocumentStream` carry the
  same warnings + appended block (extends the existing drain-parity test).
- **Prompt snapshots:** outline prompt carries ids/titles; section prompt
  carries excerpt text + citation rules; absent-sources prompts unchanged.
- **Demo:** `/compile` stub gains two canned sources (one cited, one
  hallucinated-then-repaired? — no: one cited, one unused, so both audit
  warnings are visible in the demo audit log).

## 7. Demo

`demo/compileClient.js` stub: `stubClient(paced, sources?)` — when sources
are supplied, outline/section replies cite them (one `[...](#source-…)`
citation in a section body) and `server.mjs` passes two canned excerpts (one
with a URL, one without). The `/compile` audit `<pre>` then shows the
grounding warnings live; the appended sources block renders at the document
tail. Route smoke to 200 as usual.

## 8. Out of Scope

- Chunking, retrieval, embedding, per-claim verification.
- Reference-style citation syntax; citation blocks (rejected in part 1).
- Sources in `explanationJsonSchema`/`documentJsonSchema` (host input, not
  model output).
- Host-configurable citation format (anchors are the contract; revisit on
  evidence).
- Streaming of the audit (warnings land with `section-done` /
  `compile-done` naturally; no new event kinds).

## 9. Plan Sizing (input to writing-plans)

Estimated 4 tasks: `SourceExcerpt` + validation + CompileOptions → prompt
interpolation (outline + section) + snapshot tests → sources-block append +
audit warnings (+ parity tests) → demo stub sources + README grounding
paragraph + ROADMAP flip + full verification.
