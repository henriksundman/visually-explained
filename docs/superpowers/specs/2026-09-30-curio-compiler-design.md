# Curio Compiler / Orchestrator — Design

**Date:** 2026-09-30
**Status:** Approved (brainstorm 2026-09-30)
**Predecessor:** Document IR + sections (`2026-09-30-document-ir-sections-design.md`)
**Backlog origin:** ROADMAP arc step 3, "Curio compiler / orchestrator" (agreed 2026-09-28)

## 1. Problem & Goal

The library renders and validates but does not *generate*: every explanation and
document so far was authored by hand or ad-hoc prompting. The arc's final step
is the orchestrator the whole design was pointed at — a **compiler** that takes
a topic and produces a render-ready `DocumentIR` by driving an LLM through the
finished contracts (`BLOCK_TYPE_DOCS`, `documentSectionSchema`,
`documentSchema`) in multiple disciplined steps with repair loops.

Goal: `compileDocument(topic, opts)` — provider-agnostic (the host injects the
LLM client), bounded in cost (repair caps), lenient at the edges (one bad
section never fails a compile), fully auditable (structured events + warnings),
and zero new dependencies.

## 2. Decisions (from brainstorm)

1. **Outline → per-section calls** — call 1 produces the outline (titles,
   goals, visual hints); then one call per section constrained to the section
   schema; assemble into a `DocumentIR`. Matches the roadmap's "multi-step
   generation" and gives hosts natural parallelism later.
2. **Minimal client boundary** — `type LlmClient = (req: { system: string;
   user: string }) => Promise<string>`. The compiler builds prompts, extracts
   JSON from raw text, validates against zod, and repairs itself. Works with
   every provider (including no-JSON-mode ones); no deps; no provider
   vocabulary leaks into the library.
3. **Bounded repair, then salvage** — on validation failure, re-ask with the
   zod issue summary, the offending fragment of the previous output, and the
   relevant rule reminder, at most `maxRepairs` (default 2) times. Still
   failing → lenient salvage path (§6). Cost per call is capped by
   construction.
4. **Outline hints, no guaranteed visuals** — each outline entry may carry
   `visual?: "figure" | "diagram" | "chart"`; the hint flows into that
   section's user prompt and the shipped figure prompt rules do the rest. No
   follow-up calls, no forced quota; interactivity remains the host's
   render-time opt-in (`interactive` prop).
5. **Single public entry point** — `compileDocument(topic, opts)` returns
   `{ document, events, warnings }`. Stages stay private; the events list
   covers progress-UI needs; an async-generator streaming API can be added
   later at the same seams without breaking this one.

## 3. Module Layout (`src/compiler/`, exported from the package root)

| File | Responsibility |
| --- | --- |
| `client.ts` | `LlmClient` type; `CompileOptions` (`client`, `maxRepairs? = 2`, `guidance?`, `maxSections? = 12`); `CompileResult`/`CompileEvent`/warning types |
| `extract.ts` | Robust JSON extraction from model text: strip markdown fences, locate the first balanced `{…}` object, `JSON.parse`; on failure return a short raw-snippet diagnostic for the repair prompt |
| `repair.ts` | Parse-with-issues helper: `safeParse` → compact issue list (path + message) → repair user prompt; an extraction failure counts as a validation failure and consumes a repair attempt |
| `prompts.ts` | Outline + per-section system prompts, interpolating the shared `BLOCK_TYPE_DOCS`; exported for transparency and tests |
| `compile.ts` | Orchestration: outline → sections (sequenced in v1) → assemble → result |

The compiler adds zero dependencies, so it exports from the package root
(`src/index.ts`) rather than a new subpath (`./react` exists only because of
its peer dependency). Core never imports the compiler.

## 4. Contracts

- **`outlineSchema`** (compiler-internal, exported): `{ version: 1, title,
  summary?, sections: [{ title, goal, visual? }] }` — 1–`maxSections` entries,
  `goal` is one or two sentences saying what the section must accomplish,
  `visual` is the optional hint from §2.4.
- **Section calls** target the existing `documentSectionSchema` shape
  (`{ title, blocks }`). The section prompt explicitly forbids a `sections`
  key and a `version` key — the assembler owns both.
- **Canonical titles:** the rendered section title is the **outline's** title,
  never the section call's own — prevents title drift and duplicate-title
  anchor collisions.
- **Assembly** produces plain `documentSchema` data (`version: 1`, outline
  title/summary, sections in outline order with the outline title + the call's
  blocks). Tests re-parse the result against `documentSchema` as a contract
  lock; section `id`s stay unset (the renderer derives anchors, per the
  document spec).

## 5. Flow & Events

```
topic ──▶ outline call ──▶ outlineSchema parse ──▶ (repair ≤ maxRepairs)
      ──▶ per section: [section call ──▶ section parse ──▶ (repair ≤ maxRepairs)]
      ──▶ assemble DocumentIR ──▶ { document, events, warnings }
```

`events` is a structured array, one entry per notable step — `*-start` fires
when a stage begins, `*-done`/`*-failed` when it concludes (after any repairs
settle), `repair-attempt` once per failed attempt:

| `kind` | Carries |
| --- | --- |
| `outline-start` | `{ topic }` |
| `outline-done` | `{ title, sections: n, visualHints: n }` |
| `section-start` | `{ index, title }` |
| `section-done` | `{ index, title, blocks: n }` |
| `section-failed` | `{ index, title }` |
| `repair-attempt` | `{ stage: "outline" \| "section", index?, attempt, issues }` |

Hosts render progress from `events` after the fact; nothing streams live in
v1 (§9).

## 6. Errors & Warnings

- **Outline irrecoverably invalid** (still failing after repairs) → **throw**
  with the collected issues. There is nothing to salvage from — a document
  without an outline does not exist. Hosts catch and degrade.
- **Section irrecoverably invalid** → warning (`[compile] section N dropped —
  …`), section omitted; the document assembles from survivors. House rule:
  never fail a render for one bad part.
- Extraction failures (no JSON found) count as validation failures: they
  consume a repair attempt and their raw-snippet diagnostic goes into the
  repair prompt.
- Every LLM round-trip is visible in `events`; every drop in `warnings`. A
  compile is fully auditable after the fact.
- **Determinism:** with a deterministic stub client, compilation is
  deterministic (test-enforced); with a real LLM it is not, and nothing
  claims otherwise. No seeds, no caching in v1.

## 7. Testing (no network — all fakes)

- **Fake `LlmClient`s** scripted per test: happy path (outline + 3 sections);
  fence-wrapped and prose-wrapped JSON; repair-then-succeed; repair-exhausted
  → section dropped + warning; outline repair-exhausted → throw; section
  count clamped to `maxSections`.
- **Extraction units:** fenced JSON, JSON with leading commentary, nested
  braces inside strings, garbage → failure with snippet.
- **Repair units:** issue list is compact and names the offending path; the
  repair prompt contains the previous output's offending fragment.
- **Contract locks:** assembled document parses against `documentSchema`;
  canonical outline titles appear as section titles; `events` sequence
  matches §5 exactly for a scripted compile.
- **Prompt snapshots:** outline/section prompts interpolate `BLOCK_TYPE_DOCS`
  verbatim, forbid `sections`/`version` keys in section output, and carry the
  topic, host `guidance`, and the section's visual hint.

## 8. Demo (stub client)

A `/compile` demo page wired to a **stub `LlmClient`** (canned outline + canned
section replies, exercising one repair for show) — proves the orchestration
end-to-end in the browser without an API key, rendered via `renderDocument`.
A real-key demo is host-land: no provider packages in the library.

## 9. Out of Scope (v1)

- Parallel section calls (sequenced in v1; the loop shape leaves room).
- Streaming / async-generator API; live progress.
- Client surface growth: tokens/usage, abort signals, retries, model params.
- Caching, memoization, human-in-the-loop outline approval.
- Collections, multi-document routing (host territory).
- Curio Editorial Learning theme tokens (separate theme effort off
  `docs/design/stitch/*/DESIGN.md`).

## 10. Plan Sizing (input to writing-plans)

Estimated 5 tasks: extract + repair utils → prompts + outline schema →
compile orchestration + events/warnings → stage/contract/prompt tests →
demo stub page + docs/ROADMAP.
