# Enforceable no-degradation policy

Roadmap backlog item 1 ("Next up, in order"). Closes the gap recorded as open
thread 1 in `docs/OPEN_THREADS.md` and makes the README's principle 1 honest.

## 1. The problem, stated precisely

Open thread 1 says `strict: true` "never gates a render-time degradation
warning". That is true, and it is only part of the gap. Reading the four render
entry points shows the hole is two-sided and asymmetric:

| Entry point | Warnings observable by the host? |
| --- | --- |
| `renderExplanation` | Yes — returns `{ html, warnings }` |
| `renderDocument` | Yes — returns `{ html, warnings }` |
| `<Explanation>` (React) | **No — discarded** |
| `<Document>` (React) | **No — discarded** |

`renderBlock` in `src/core/render.ts` is the single block renderer both React
components use, and it hardcodes a throwaway sink:

```ts
/** Renders a single block by type; used by the React adapter. Warnings are discarded. */
export function renderBlock(type, data, depth = 1, opts = {}): string {
  ...
  return renderSalvagedBlock(b, depth, [], opts.sketch ?? false, ...)
}
```

So the `[]` literal is the entire reason a React host cannot see a dropped
timeline label, a missing dataset key, an unresolvable image catalog entry, or
unparseable TeX. The primitives already call `ctx.addWarning` correctly and the
string renderers already thread one array correctly — the plumbing exists and
works. What is missing is (a) a way to *act* on the warnings, and (b) any path
for them to reach a React host at all.

Consequences:

- **The promise is overstated.** README principle 1 (line 15) tells hosts "a
  render never fails on bad data unless you opt into `strict: true`" and line 73
  says "surface or log them" — but a React host has nothing to surface.
- **"No silent degradation" is not enforceable anywhere.** Even where warnings
  are returned, nothing turns a non-empty array into a failure. A host must
  remember to write the aggregation loop, in every call site, forever.
- **CI cannot assert content health.** A content pipeline can validate its IR
  and pass, then ship a document where three images silently fell back to their
  captions.

This is a **feature, not a reinterpretation of `strict`**, and §5 is explicit
about why `strict` must not absorb it.

## 2. What ships

Two new options on all four render entry points. Both default off; no existing
behavior changes.

- **`onWarning?: (warnings: string[]) => void`** — observation. Called once at
  the end of a render pass with the full set for that pass. Never throws on the
  host's behalf; the host decides what to do.
- **`failOnWarning?: boolean`** — policy. When the pass emitted any warning,
  throw instead of returning.

Both are additive. `strict` keeps its exact current meaning and its exact
current throw.

### Why two options rather than one

They answer different questions and hosts want either/or:

- `onWarning` is *"tell me what happened"* — production telemetry, a log line, a
  bug-report attachment. Throwing there would take down a page over a cosmetic
  degradation.
- `failOnWarning` is *"this must never happen"* — CI, tests, content pipelines
  where a degraded block is a defect rather than a presentation detail.

Collapsing them into a single field with two shapes (`'throw'` vs a function)
would force every host through a type-switch to express a genuine either/or,
and would make the throw harder to discover from the type signature — the
property that matters most for an option whose entire job is to be opted into.

## 3. Mechanics

### 3.1 Accumulation is unchanged

`ctx.addWarning` keeps appending to a plain `string[]` threaded through
`renderSalvagedBlock`, exactly as today. No primitive changes. No new warning
codes, no structured warning type — see §5.

### 3.2 Where the throw happens

**Once, at the entry point, after rendering completes.** Not inside
`renderSalvagedBlock`, not inside a primitive.

Two reasons. First, a primitive cannot throw host-independently: it would break
`renderBlock`'s standalone contract and any host currently relying on lenient
salvage. Second, and more importantly, throwing at the end lets the error
message carry **every** warning rather than only the first. A host debugging a
CI failure gets the full list in one message instead of iterating one throw per
warning.

### 3.3 Ordering relative to `strict`

`strict` throws first and is unchanged. `failOnWarning` throws only for a
document that *validated cleanly* but *degraded at render time*.

The two failures are genuinely different and must not be conflated in a stack
trace: `strict` means the input was malformed (a host bug or a model failure
caught upstream); `failOnWarning` means the input was fine and the renderer
could not honor it (a missing host asset, unparseable model TeX). A host
alerting on the former should not be paged for the latter, and the messages say
so.

Concretely in `renderDocument` the check sits in exactly one place: immediately
after the existing `strict` throw and **before** the `if (docBroken) return`
early return. Both orderings matter.

- After `strict`, so a malformed document reports the validation failure.
- Before the early return, because a broken top level has *already* pushed
  warnings and would otherwise return a silently-empty shell. Under
  `failOnWarning` it throws instead — correct and intended, since an
  `<article>` with no header and no sections is the most total degradation the
  library can produce.

The same placement applies to `renderExplanation`, which has no early return.

### 3.3.1 What counts as a degradation

`failOnWarning` fires on **every** warning in the array, not only the
render-time ones. That array is populated by both stages: diagnostics from
lenient validation (a dropped `[invalid-section]`, a dropped invalid block) and
warnings from primitives during rendering (`[image]`, `[dataset]`, `[math]`).

This is deliberate and is the honest reading of "no degradation": a document
that silently dropped a section has degraded just as surely as one whose image
fell back to its caption. A host that wants *only* render-time failures can
filter the array it receives from `onWarning` by the `[code]` prefix — the
codes are already namespaced (`[math]`, `[image]`, `[dataset]`,
`[invalid-section]`, …), which is why no structured warning type is needed
(§5).

### 3.4 Error message shape

```
Degradation policy: 2 warning(s) — [image] image fig-1: no image named "chart"; [math] not TeX — rendered as literal text: Unexpected …
```

Bounded, because warnings embed model- and host-supplied text and an unbounded
join is a memory/log hazard in exactly the CI context this option targets. Two
bounds, both reusing existing precedent rather than inventing new limits:

- each fragment truncated to **120 chars** — the same bound
  `src/primitives/derivation.ts` already applies to a MathML parse error before
  putting it in a warning;
- at most **10 fragments** shown, then `… and N more` — matching the compiler's
  habit of bounding warning payloads (`MAX_SOURCES`, `MAX_IMAGES`).

Truncation is for the **message only**. The `warnings` array returned to the
host, and the array passed to `onWarning`, are always complete and untruncated —
a host that wants the full text has it, and only the human-readable throw is
bounded.

### 3.5 The React fix

`renderBlock` grows an optional `warnings?: string[]` sink parameter, appended
to its existing options object:

```ts
export function renderBlock(type, data, depth = 1, opts: {
  sketch?: boolean; datasets?: Record<string, unknown>
  images?: Record<string, unknown>; warnings?: string[]
} = {}): string
```

When `opts.warnings` is supplied it is used as the sink; when omitted, a
throwaway `[]` is created as today. **`renderBlock`'s standalone contract is
therefore unchanged** — an existing caller passing only `{ sketch }` still gets
discarded warnings, which is what its doc comment says.

`Explanation` and `Document` each collect into a local array per render pass and
thread it through every `renderBlock` call, then call `onWarning(warnings)`
once at the end of the pass, and throw if `failOnWarning` and the array is
non-empty.

Both remain **server components**: no hooks, no `useState`, no `useRef`, no
client JS, RSC-safe. The collection array is an ordinary local.

## 4. React StrictMode: the honest contract

Calling a host callback during a React render is a side effect, and StrictMode
double-invokes renders in development. A host that pushes into an array will
therefore **double-count warnings in dev**.

This is accepted rather than fixed, and the reason is architectural:
`Explanation` and `Document` are server components by explicit design (see
their own doc comments — "Default false — keeps this component RSC-safe").
There is no render-scoped instance available to dedupe against, and
cross-pass dedupe would require module-level mutable state — which on a server
means cross-request contamination. That is a strictly worse bug than a
double-counted diagnostic.

So the documented contract is:

> `onWarning` fires **at most once per render pass**, with the complete set for
> that pass. In React StrictMode development builds, dev-only double-invocation
> may deliver the same set twice. Hosts must either dedupe by set membership or
> treat `failOnWarning` as the authoritative signal.

`failOnWarning` is the load-bearing guarantee. `onWarning` is observation. This
asymmetry is deliberate and is stated in the README rather than left for a host
to discover.

## 5. Deliberately out of scope

- **`strict` is not widened.** Thread 1 is emphatic that this is a feature and
  not a reinterpretation, and it is right: `strict` gates *validation*, which
  runs before any block renders, on a different array. Widening it would change
  behavior for every existing `strict: true` caller without warning. The two
  options are adjacent in name-space (`strict`, `failOnWarning`) and
  non-overlapping in meaning (input invalid, output degraded). Each option's
  doc comment states which it is.
- **No structured warning type.** Warnings are `[code] message` strings
  throughout — 30+ call sites across primitives and figure layouts. A typed
  warning would touch every one of them and is a much larger refactor than this
  cycle's value.
- **No compiler integration.** `compileDocument` / `compileDocumentStream` have
  their own warnings channel (`compile-done` carries `{ document, warnings }`),
  populated from model output rather than from rendering. Wiring render policy
  into it is a separate question with a separate answer.
- **No new warning codes.** This feature consumes existing warnings; it does
  not add or renumber any.
- **`renderExplanation` / `renderDocument` keep returning `warnings`.** The new
  options are additive to that, not a replacement. Returning the array remains
  the cheapest option for a one-off call, and removing it would break hosts.

## 6. Testing

Behavioral tests, in the existing suites (`tests/render.test.ts`,
`tests/document.test.ts`, and the React counterparts).

1. **`onWarning` fires with the full set** — string renderers. An IR with two
   independently degrading blocks yields one call carrying both warnings, in
   document order.
2. **`failOnWarning` throws, carrying every warning** — string renderers. Not
   just the first; the message lists all (subject to §3.4 bounds).
3. **React: warnings become observable at all.** The new capability. A
   degrading block under `<Explanation>` and `<Document>` reaches `onWarning`.
   This is the test that would have failed before the change — the capability
   did not exist.
4. **React parity.** For the same IR, the React components' reported warning set
   equals the string renderer's. Prevents the two surfaces drifting, which is
   the bug class the existing `document-react.test.tsx` parity tests exist to
   catch.
5. **`strict` is unchanged.** A validation failure still throws with its current
   message; `failOnWarning` does not alter it, and `strict: true` with a clean
   document still returns normally.
6. **Ordering.** `strict` + `failOnWarning` on an invalid document throws the
   *validation* error, not the degradation error.
6b. **A broken top level throws under `failOnWarning`.** Pins the early-return
   ordering in §3.3: without the check placed before `if (docBroken) return`,
   this test returns a silent empty shell and passes nothing. Lenient mode
   (neither option) still returns that shell — the regression this guards.
7. **`failOnWarning` on a clean document does not throw** — and per the handoff
   trap, this input must genuinely not degrade, or the test passes vacuously.
8. **Truncation.** A warning with a >120-char fragment is truncated in the
   message; the array handed to `onWarning` and returned to the host is not.
9. **`renderBlock` standalone is unchanged** — called without `warnings`, it
   returns identical HTML and discards as before.
10. **Lenient-mode validation diagnostics count.** A document with one dropped
    section (no other degradation) throws under `failOnWarning`, per §3.3.1.

Per `docs/DEBUGGING.md` practice, the security-adjacent property here is that
the throw message contains model- and host-supplied text (`[math]` embeds a
parse error; `[image]` embeds a catalog key). The message is plain text in an
`Error`, never markup, and no test asserts on it via substring matching in a way
that would pass on a thrown input.

## 7. Docs

- **README principle 1** — correct the overstatement: `strict` gates the input,
  `failOnWarning` gates the output. Name both.
- **README options tables** — `onWarning` and `failOnWarning` rows for
  `renderExplanation`, `renderDocument`, `<Explanation>`, `<Document>`.
- **README** — a short subsection stating the StrictMode double-invocation
  contract from §4 verbatim enough that a host cannot miss it.
- **`docs/OPEN_THREADS.md` thread 1** — replaced: the gap it describes is
  closed. Its warning ("do not write a test asserting a render-time warning
  throws under `strict`") stays valid and is restated in the new spec, because
  `failOnWarning` is a *different* option and the distinction is the whole
  point.
- **`docs/ROADMAP.md`** — the backlog item moves from "next up" to `Shipped`
  in the same commit as the code, per the README-travels-with-the-feature rule.

## 8. Files touched

| File | Change |
| --- | --- |
| `src/core/render.ts` | `onWarning` / `failOnWarning` on `RenderOptions`; `renderBlock` optional `warnings` sink |
| `src/core/renderDocument.ts` | same two options on `RenderDocumentOptions`; end-of-pass throw |
| `src/react/Explanation.tsx` | same two props; local collection, threaded sink, end-of-pass callback/throw |
| `src/react/Document.tsx` | same two props; same wiring |
| `tests/*` | the nine behaviors in §6 |
| `README.md`, `docs/OPEN_THREADS.md`, `docs/ROADMAP.md` | §7 |

No new primitives, no schema change, no new dependency, no change to any
primitive's render function. `registerAll.ts` is untouched, so the README's
primitive count and block-type list stay as they are.