# Host README — Design

**Date:** 2026-09-30
**Status:** Approved (brainstorm 2026-09-30)

## 1. Problem & Goal

The repository has no README. A host — the person or coding agent embedding the
`explanations` library — has to reverse-engineer the public surface from source
and specs. Goal: one authoritative `README.md` at the repo root whose primary
audience is a coding agent pointed at the repo, which should come away knowing
what the library does and how to use it without reading the source.

## 2. Decisions (from brainstorm)

1. **Audience = coding agent (plus its human).** Dense, factual, no marketing.
   Every exported name appearing in a snippet must exist in source; the writer
   verifies each against `src/` while drafting. Not written for npm-pitch
   landing-page purposes.
2. **Single README (approach A).** One file, ~250–300 lines. Agents prefer one
   authoritative file and there is nothing to keep in sync. Rejected: a slim
   README + `docs/INTEGRATION.md` (link-chasing, two places to drift), and
   generated API docs (new machinery; can't produce the orienting narrative).
3. **Capability-led, not alphabetically listed.** Ordered by how a consumer
   encounters the library: understand → install → render → generate → extend.
4. **Host responsibilities made explicit.** The library deliberately leaves
   things to hosts (LLM client + keys, scroll-spy script, progress UI,
   collections/routing); the README states this plainly so agents don't hunt
   for features that don't exist.

## 3. Document Outline

The README contains, in order:

1. **What this is** — short pitch plus the principles that bind the codebase:
   LLM output → zod-validated IR → styleable HTML/React; lenient salvage
   (a render never fails on bad data); SSR-safe and deterministic; LLM text
   never becomes markup (block data and Scene IR only); dependency-minimal
   (zod, roughjs).
2. **Install & package exports** — root (`explanations`), `explanations/react`
   (peer: React ≥ 18), `explanations/themes/{tokens,light,dark}.css`.
3. **Pipeline 1 — render** — `renderExplanation(input, opts)` /
   `renderDocument(input, opts)` with options (`theme`, `sketch`, `strict`,
   `toc`, `tocSticky`), `{ html, warnings }` result semantics, and the React
   equivalents `<Explanation>` / `<Document>` (including the `interactive`
   figure opt-in).
4. **Blocks** — the primitive set grouped by purpose: text/code; structure
   (`stack`, `step-list`); pedagogy (`concept`, `worked-example`, `derivation`,
   `comparison`, `cause-effect`, `callout`, `data-callout`); visuals
   (`figure`, `diagram`, `chart`, `timeline`); inline-emphasis rules
   (`**bold**`, `*italic*`, `` `code` ``, no HTML).
5. **Figures** — authored Scene format (params, derived, `{{expr}}` path
   slots); static SSR by default; `interactive` for the slider/play runtime;
   element events via `data-el-id`/`data-tip` and `onElementEvent` with the
   built-in popover.
6. **Themes & host styling** — import `tokens.css` (or a full theme); sticky
   document TOC is the theme default, `tocSticky: false` opts out per
   instance; scroll-spy is host-side and keys off `aria-current="true"`.
7. **Pipeline 2 — compile** — `compileDocument(topic, { client, ... })` →
   `{ document, events, warnings }`; `LlmClient` type shown verbatim;
   options (`maxRepairs` default 2, `maxSections` default 12, `guidance`);
   the event `kind` table; failure semantics (outline exhausted after repairs
   → throw; a bad section → dropped with a warning, never failing the
   compile).
8. **LLM authoring contract** — for hosts doing their own prompting:
   `systemPromptSnippet`, `documentSystemPromptSnippet`,
   `explanationJsonSchema`, `documentJsonSchema`, `BLOCK_TYPE_DOCS`.
9. **Host responsibilities** — explicit list of what the host supplies.
10. **Codebase map & development** — `src/` layout table (`core`,
    `primitives`, `figures`, `react`, `compiler`); pointers to
    `docs/ROADMAP.md` and `docs/superpowers/specs/`; test conventions
    (vitest, fake LLM clients, no network); `npm run build`, `npm test`,
    `npm run typecheck`; demo server (build first; port 4173 via launchd per
    AGENTS.md).

## 4. Companion Change

One `Shipped` line in `docs/ROADMAP.md` recording the README, per the file's
existing convention.

## 5. Out of Scope

- CI checks validating README snippets against source.
- Generated API reference docs.
- A separate integration guide (`docs/INTEGRATION.md`).
- Curio Editorial Learning theme tokens (separate effort).

## 6. Plan Sizing (input to writing-plans)

Estimated 1–2 tasks: draft README (with per-snippet source verification) →
ROADMAP line + build/typecheck sanity pass.
