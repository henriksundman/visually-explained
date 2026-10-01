# Streaming Compile — Design

**Date:** 2026-10-01
**Status:** Approved (brainstorm 2026-10-01)
**Predecessor:** Curio compiler (`2026-09-30-curio-compiler-design.md`), §9 deferral
**Backlog origin:** ROADMAP backlog "Streaming compile — async-generator API at
the compiler's existing seams (compiler spec §9)"; flagged there as "the
highest-leverage host UX win left on the table."

## 1. Problem & Goal

`compileDocument` resolves only at the end: a host building progress UI gets
`events` after the fact, and the user stares at a spinner while the outline and
every section generate. The orchestration loop is already sequential and
event-annotated — each `events.push` sits exactly where a `yield` could go — so
the win is to expose the loop as an async generator without changing what the
compiler does.

Goal: `compileDocumentStream(topic, opts)` — a bare async generator yielding
the existing event vocabulary live, with a terminal `compile-done` event
carrying the assembled result; `compileDocument` becomes a thin drain of that
stream so there is one code path. `LlmClient` stays single-shot
text-in/text-out; token-level streaming remains deferred (§9).

## 2. Decisions (from brainstorm)

1. **CompileEvent vocabulary, grown additively** — the stream yields the same
   event kinds hosts already know; no second vocabulary to document or keep in
   sync. Payload growth is additive and covered in §5.
2. **Bare generator + wrapper** — `compileDocumentStream` is a bare async
   generator consumed with `for await`; a terminal `compile-done` event carries
   `{ document, warnings }` so iteration needs no second handle.
   `compileDocument` is reimplemented as a drain of the stream — the existing
   contract tests then lock both APIs simultaneously.
3. **`compile-done` terminal, throws stay throws** — the stream ends with
   `compile-done` on success; outline exhaustion still **throws** through both
   APIs (`for await` propagates it). v1's failure contract is unchanged.
4. **Abandonment is fire-and-forget, documented not built** — breaking out of
   `for await` stops event delivery immediately; the in-flight LLM call still
   completes in the background and its result is discarded (a generator cannot
   interrupt an `await` it is suspended inside). True cancellation stays
   host-side via their own client wrapper; abort signals remain a §9 deferral.
   No API surface is added.
5. **Demo proves the win** — `/compile` switches to consuming the stream:
   header/TOC render on `outline-done`, sections append as `section-done`
   events land, `section-failed` shows an inline notice, `compile-done` swaps
   in the warnings footer. The stub client paces its replies so the
   progression is visible.

## 3. Public Surface

```ts
export type StreamCompileEvent =
  | CompileEvent
  | { kind: "compile-done"; document: unknown; warnings: string[] }

export function compileDocumentStream(
  topic: string,
  opts: CompileOptions,
): AsyncGenerator<StreamCompileEvent>
```

- Lives in `src/compiler/stream.ts`, exported from the package root. The type
  discriminates cleanly: `CompileEvent.kind` does not include `"compile-done"`.
- `CompileOptions`, `LlmClient`, and `CompileResult` are unchanged.
- `compileDocument` keeps its exact signature and return shape
  (`{ document, events, warnings }`); only its implementation changes.

## 4. Internals — one code path

The current private `stage()` helper mixes mechanics (call → parse → re-ask)
with policy (throw vs. drop). Streaming needs the mechanics without the
policy, since a re-ask must surface its `repair-attempt` event the moment it
happens:

- **`runStage<T>()`** (private to `stream.ts`): an async generator that yields
  `repair-attempt` events live and *returns* an outcome —
  `{ ok: true, value } | { ok: false, issues }` — consumed via `yield*`. It is
  purely mechanical: no throwing, no warnings, no dropping.
- **Orchestration** (`compileDocumentStream`): owns all policy — outline
  exhaustion throws; a failed section pushes the drop warning, emits
  `section-failed`, and continues; canonical outline titles; `maxSections`
  clamp (applied **before** `outline-done` so the shell always matches the
  final document); assembly; final `compile-done` yield.
- **`compile.ts`**: reduced to a drain —

  ```ts
  export async function compileDocument(topic: string, opts: CompileOptions): Promise<CompileResult> {
    let document: unknown
    const events: CompileEvent[] = []
    let warnings: string[] = []
    for await (const e of compileDocumentStream(topic, opts)) {
      if (e.kind === "compile-done") { document = e.document; warnings = e.warnings }
      else events.push(e)
    }
    return { document, events, warnings }
  }
  ```

  No circular import: `stream.ts` never imports `compile.ts`. Prompts,
  extraction, and repair prompts are untouched.

## 5. Flow & Events

Event order is exactly v1's (`outline-start` → `outline-done` → per section:
`section-start` → `repair-attempt*` → `section-done` | `section-failed`), now
delivered live, plus one terminal event:

| `kind` | Carries | Change |
| --- | --- | --- |
| `outline-start` | `{ topic }` | — |
| `outline-done` | `{ title, summary?, sections: n, visualHints: n, sectionTitles }` | + `summary?`, + `sectionTitles: string[]` (clamped titles, so a host can render header + TOC immediately) |
| `section-start` | `{ index, title }` | — |
| `section-done` | `{ index, title, blocks }` | `blocks` is now the section's block **array** (was a count; `blocks.length` replaces the count, and the payload enables live append) |
| `section-failed` | `{ index, title }` | — |
| `repair-attempt` | `{ stage: "outline" \| "section", index?, attempt, issues }` | — |
| `compile-done` | `{ document, warnings }` | **new**, terminal, stream API only |

The two payload changes are deliberate and shared by both APIs (they emit from
one code path): `compile-done` needs the document, the demo shell needs titles
and summary at `outline-done`, and live append needs the blocks themselves.
The event payload contract is documentation-plus-tests, not a wire format —
the README table is updated in the same cycle, and pre-1.0 hosts on the old
shapes are the demo and tests.

## 6. Errors & Abandonment

- **Outline exhaustion → throw**, unchanged (message includes the collected
  issues). Propagates through `for await` on both APIs.
- **Section exhaustion → drop**, unchanged: `[compile] section N dropped — …`
  warning, `section-failed` event, assembly continues.
- **Abandonment:** `break`/`return` out of `for await` calls the generator's
  `.return()`, so no further events are delivered and no further LLM calls are
  *started*. The in-flight call still resolves in the background and its
  result is discarded — the compiler cannot cancel a `Promise<string>` it
  already awaited. Documented in the README; hosts needing true cancellation
  wrap their own `LlmClient` with an abort signal.

## 7. Testing (no network — all fakes)

- **Wrapper parity (the contract lock):** for a scripted client (happy path
  and repair-then-succeed), the drained stream — all yields except
  `compile-done` — deep-equals `compileDocument`'s `events`; `warnings` and
  `document` deep-equal too. Both run against the same fixture client.
- **`compile-done` payload:** `document` re-parses against `documentSchema`
  (contract lock); `warnings` matches the drained warnings.
- **Event order:** `compile-done` is strictly last; section events stay in
  outline order with canonical titles.
- **Incremental delivery:** a deferred-reply client proves a consumer reaches
  `section-done` of section 1 before section 2's call has resolved.
- **Abandonment:** `break` after the first yielded event issues no LLM calls
  (the generator is suspended at `yield` before the first client call);
  breaking later caps call growth at the in-flight one.
- **Outline throw:** exhaustion rejects through `for await` on the stream and
  through `compileDocument` identically.
- **Existing suite green unchanged** — the compiler tests keep passing with
  only payload-shape updates where §5 changed them.

## 8. Demo (`/compile`)

The page consumes the stream: header + TOC render on `outline-done`, each
`section-done` appends its rendered section, `section-failed` renders an
inline dropped-section notice, and `compile-done` swaps in the warnings
footer. The stub `LlmClient` gains paced replies (~300–600 ms per call,
including one repair for show) so the progression is visible to a human.
Smoke-checked to 200 like every demo route; no library surface beyond §3.

## 9. Out of Scope

- Token-level streaming / any `LlmClient` growth (usage, abort signals,
  retries, model params) — compiler-deferral list.
- Parallel section calls — the sequenced loop is what makes the event order
  stable; parallelism remains a §9 deferral.
- Caching, memoization, human-in-the-loop outline approval — deferrals.
- React-side helpers for consuming the stream — the demo shows the pattern;
  anything richer is host-land until asked for.

## 10. Plan Sizing (input to writing-plans)

Estimated 5 tasks: `stream.ts` (types + `runStage` + orchestration +
`compile-done`) → `compile.ts` drain rewrite + parity/contract tests →
incremental/abandonment/throw tests → demo `/compile` stream consumption with
paced stub → README + ROADMAP flip + full verification.
