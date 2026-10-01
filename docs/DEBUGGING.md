# Debugging Playbook

Lessons from real debugging sessions in this repo, recorded so future sessions
don't pay for them twice. Two parts: a **check-first triage list** of this
codebase's recurring failure modes, and **dated entries** (newest first) in the
format *symptom → root cause → fix → rule*.

**Convention** (see `AGENTS.md`): a debugging session that surfaces a reusable
lesson appends an entry here before the branch finishes. Keep entries tight —
four lines, one rule each. The progress ledger (`.superpowers/sdd/progress.md`,
git-ignored) is the raw feed; this file is the distilled, versioned record.

## Part 1 — Check first

Before deep-diving, test the failure against these recurring patterns:

- **Stale `dist/`.** The demo server serves the *built* package and holds it
  from process start: rebuild without restart → old behavior; `EADDRINUSE` on
  4173 → a stale server from an earlier session (`lsof -ti tcp:4173`, kill,
  resubmit). See AGENTS.md "Running the demo server".
- **Browser module-graph holes.** Demo route 200s but the page is blank:
  bare specifiers reachable from `dist/` (`zod`, `roughjs`) must be in the
  page's importmap. Read the console, not just the status code.
- **zod object schemas strip unknown keys.** If a render ignores a field the
  host or LLM attached, check the field is *declared in the schema* before
  debugging the renderer. "Parses fine but the field is gone" is the signature.
- **Salvage is all-or-nothing per block.** A block failing its own schema is
  skipped whole (`[invalid-block]`, empty render). There is no partial payload
  for a field to "survive" on.
- **Degenerate clamp intervals.** `min(max(x, lo), hi)` misbehaves when
  `lo > hi` (narrow containers): the wrong bound wins. Clamp the lower bound
  last, and test the narrow case explicitly.
- **Prototype pollution on externally-keyed records.** Any record keyed by
  host/LLM strings (`registry[type]`, `datasets[key]`) needs a null prototype
  (`Object.create(null)`) and `Object.hasOwn` lookups, or `"constructor"` /
  `"__proto__"` resolve to inherited values.
- **Smoke greps must target rendered output.** Block `id`s never appear in
  HTML; `data-el-id`s, labels, values, and emitted attributes do.
- **Entry-point families.** Threading an option through render paths? Grep
  every call site of the shared helpers (`renderSalvagedBlock`, `renderBlock`)
  — plan file lists have missed call sites before.
- **The test may be the bug.** If the implementation matches the spec and the
  test still fails, re-derive the test's expected contract from the spec
  before touching code.
- **Verify helper assumptions.** Read the helper; don't trust its name or the
  plan's claim about it (`compileFigure` does not parse figures).

## Part 2 — Entries

### 2026-10-01 — Popover pinned past the left edge on narrow stages
- **Symptom:** unit RED — expected `4`, got `-64`, for a 200px-wide stage.
- **Root cause:** `placePopover` clamped `min(max(left, stage.left+4), stage.right-MAX_W-4)`; when the stage is narrower than the popover the clamp interval degenerates and the negative upper bound wins.
- **Fix:** clamp the lower bound last — `max(min(left, hi), lo)`. Provably identical output whenever `lo < hi`.
- **Rule:** every clamp gets a narrow/extreme-case test; the two clamp orderings differ exactly on degenerate intervals.

### 2026-10-01 — Host `dataset` key silently ignored
- **Symptom:** dataset tests RED with literal fields rendered and *no warnings*.
- **Root cause:** non-strict zod object schemas strip unknown keys — `dataset` wasn't declared on the block schemas, so salvage discarded it before render ever saw it.
- **Fix:** declared `dataset?: string` on `chart`/`data-callout`/`timeline` schemas; the resolver then worked unchanged.
- **Rule:** extend schema surfaces before tests can observe new fields; a silently-stripped key mimics "renderer bug".

### 2026-10-01 — Override test asserted the wrong survivor
- **Symptom:** one dataset test failed against a spec-correct implementation (`"kept"` not in HTML).
- **Root cause:** the fixture's dataset *defined* `label`, so the literal label had to be overridden; the real surviving literal was `delta` (omitted by the dataset).
- **Fix:** corrected the test to assert the actual contract — overridden label, surviving delta.
- **Rule:** when code matches the spec, the test is the suspect; re-derive expectations from the spec, not from what the fixture happens to contain.

### 2026-10-01 — `renderDocument` missed in an option pass-through
- **Symptom:** RED was 4/4 where the plan predicted 3/4 (the `renderDocument` test was expected to pass already).
- **Root cause:** the plan threaded `datasets` through `renderExplanation`/`renderBlock` but omitted `renderDocument.ts` from Task 1's file list.
- **Fix:** threaded it; plan and ledger amended.
- **Rule:** enumerate call sites of shared helpers by grep when threading an option through an entry-point family; a *wider*-than-predicted RED is information, not noise.

### 2026-10-01 — Demo smoke grep matched a non-rendering value
- **Symptom:** `grep -c "deploys-true"` on the served page returned 0 while the page demonstrably worked.
- **Root cause:** block `id`s never appear in rendered HTML; the grep targeted an IR field name, not output.
- **Fix:** grep the dataset-derived value (`4deploys`) instead.
- **Rule:** smoke assertions target what the renderer *emits* — check the HTML, not the IR.

### 2026-09-30 — Param named `PI`/`E`/`TAU` silently shadowed
- **Symptom:** a param or derived binding with a reserved constant name behaves as the constant.
- **Root cause:** the expression evaluator resolves its constants (`PI`, `E`, `TAU`) before the param/derived environment.
- **Fix:** schemas reject those names outright; prompts document them.
- **Rule:** reserved-name collisions between two namespaces get schema-level rejection, not documentation alone.

### 2026-09-29 — Plan assumed `compileFigure` parses
- **Symptom:** identity-gate tests failed against the planned compile-side placement.
- **Root cause:** the plan assumed `compileFigure` parses figures; it doesn't — parsing happens at render/emit — so the gate had to live compile-side.
- **Fix:** gate moved to where the data actually flows; deviation recorded.
- **Rule:** verify what a helper actually does before writing tests against an assumption; helper names mislead.

### 2026-09-29 — `/interactive` served 200 but blank in browser
- **Symptom:** route 200; console full of module-resolution errors.
- **Root cause:** `dist/react` imports `roughjs`/`zod`; the demo importmap didn't map them, breaking the browser module graph.
- **Fix:** importmap entries added; later demo pages copy the full set.
- **Rule:** a demo importmap must cover every bare specifier reachable from the served bundle — and a 200 says nothing about a module graph.

### 2026-09-28 — SVG path grammar edge cases
- **Symptom:** plan's path-grammar tests failed on valid inputs before implementation.
- **Root cause:** plan bugs — lowercase commands are valid SVG, and arc flags are positional with no separators (`a1 1 0 011 1` is legal).
- **Fix:** grammar implemented to the SVG spec; plan corrected pre-implementation.
- **Rule:** when hand-rolling a grammar, generate tests from the *spec's* grammar definition, not from intuition — the weird corners are where the bugs hide.

### 2026-09-27 — Prototype-pollution surface in the primitive registry
- **Symptom:** security review flagged `registry["constructor"]`-style lookups.
- **Root cause:** default-prototype objects inherit `constructor`/`__proto__`/`toString`; a type string from LLM output could hit inherited values.
- **Fix:** `Object.create(null)` registry; same pattern applied to the datasets resolver's `Object.hasOwn` guard.
- **Rule:** records keyed by external strings get a null prototype plus own-property checks — make it the default, not a retrofit.

### 2026-09-27 — tsup build exited 0 with a broken artifact
- **Symptom:** dist entry missing/wrong after a green build (entry collision, side-effect elision, missing `@types/node`).
- **Root cause:** bundler optimizations and entry naming collided in ways the build step doesn't check.
- **Fix:** `sideEffects` field, entry resolution, type deps — and a dist-exports verification step added to plan tasks.
- **Rule:** verify the built artifact's *exports* after touching entries/config; a green build is not a correct build.
