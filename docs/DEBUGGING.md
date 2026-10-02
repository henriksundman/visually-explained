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
- **Figures scale, they do not overflow.** `sceneToSvg` emits a `viewBox` with
  no `width`, and `.exp-figure` is `width: 100%; height: auto` — so a wide scene
  is *shrunk* to its column, not allowed to stick out. An 11px label in a
  2,472px scene renders at ~3px in a 700px column. Before adding a horizontal
  scrollbar or a wider figure, check what the width budget costs at render time.
- **Entry-point families.** Threading an option through render paths? Grep
  every call site of the shared helpers (`renderSalvagedBlock`, `renderBlock`)
  — plan file lists have missed call sites before.
- **The test may be the bug.** If the implementation matches the spec and the
  test still fails, re-derive the test's expected contract from the spec
  before touching code.
- **Verify helper assumptions.** Read the helper; don't trust its name or the
  plan's claim about it (`compileFigure` does not parse figures).

## Part 2 — Entries

### 2026-10-02 — Timeline labels overlapped; the figure was the wrong answer
- **Symptom:** timeline event labels were placed at even offsets and never measured, so a long `what` overlapped its same-side neighbour (124px of shortfall per pair at 8 events) and the end labels were clipped by the viewBox. The demo's 3 short events fit by accident.
- **Root cause:** `layoutTimeline` spaced events with `step = (width - PAD*2) / n` and centred each label on its tick, never comparing the label to the space it occupied. Two failed fixes followed, both because I treated "make it fit" as the only axis: capping the step at 320px and *dropping* over-long labels produced a 2,472px figure, and wrapping produced 4-line shreds that tripped the line cap and dropped the label anyway — all while the suite stayed green, because the spacing assertions pass vacuously when labels are absent.
- **Fix:** the auto presentation rule now *measures* (`timelineFigureFits`) and degrades to the existing text list when the scene would exceed ~825px — the width at which `width: 100%` scaling shrinks the 11px labels below ~8px. `layoutTimeline` itself never drops a label; an explicit `presentation` is always honoured. Also fixed: `renderTimeline` discarded `layoutTimeline`'s `warnings`, so a host could not see a degrade.
- **Rule:** when a figure can't hold its content legibly, degrading to the *other* rendering of the same block beats distorting the figure — and the degrade must be visible (`ctx.addWarning`), never a silent omission. Measure before predicting: my "3 × 40-char labels don't fit" claim was wrong (712px, ~9px, genuinely fine), and my "no dead space" fix was wrong until a byte-diff against `main` caught 107px of empty spine. Compare rendered output against `main` in a worktree; eyeballing arithmetic is not verification.

### 2026-10-02 — Figure labels overlapped whatever they were centred in
- **Symptom:** reported with screenshots from `/editorial`: a diagram edge label was eclipsed by the node boxes beside it; chart value labels collided with their neighbours and the last one clipped past the SVG edge.
- **Root cause:** two layouts placed label text at fixed coordinates without ever measuring it. `layoutFlow` centred `labelX` on a fixed 64px gutter — a 231px label overhung ~90px each side, and nodes (emitted after edges, with an opaque fill) painted over it. `layoutChart.fmtValue` concatenated the unit onto every value (`0.62relative intensity`) and placed labels with no check against the band or the scene bounds. Only node labels were ever measured, via `wrapLabel` ("pre-wrapped lines (layout-owned)").
- **Fix:** wrap edge labels to the gutter they are routed through, widening that gutter to fit the label up to a 140px cap — wrapping *to the gutter* is what makes the overlap structurally impossible, so no collision pass is needed. Print the chart unit once on its own row above the plot, and omit any value label wider than its mark's slot.
- **Rule:** every piece of text a layout emits must be measured against the space it will occupy, and the layout — not the CSS — owns fitting it. If a label can be positioned but never sized, it is a bug waiting for longer content. Watch for the same shape in TOC entries and axis ticks. Two follow-ups: a fixed-width gutter *fixed the overlap but read as damaged text* ("back-scatt" / "ered"), so a wrap target should be wide enough to break on word boundaries; and the tests asserting `">240ms</text>"` were pinning the defect, not a contract — re-derive them from the spec rather than bending the fix to match.

### 2026-10-01 — SAST flagged the whole output pipeline; four rule groups, one real action
- **Symptom:** `rafter run` on the sources-block cycle reported 35 findings: "XSS" in the demo server, `dangerouslySetInnerHTML` ×13, "unsafe regex" ×2.
- **Root cause:** the scanner inferred flows, not paths: demo responses are static constants (no `req.*` in any body); React sinks are fed exclusively by the library's escape-then-render pipeline (the library *is* the sanitizer — that's the architecture, per the link-inline security walk); the flagged regexes are linear-shaped, but `highlightCode` did run an unbounded attacker-controlled string.
- **Fix:** three false-positive verdicts with traced dataflow (recorded, not suppressed); one real hardening — `code` payload capped at 20k in the schema + render-time truncation warning, closing the ReDoS-input class regardless of regex internals.
- **Rule:** triage SAST output by tracing input→sink in *this* codebase — scanners flag families, not exploits; but treat "unbounded input to a regex pass" as a real finding even when the regex itself is safe.
- **Corollary (suppression mechanics):** the remote scanner applies `.rafter.yml` from the *pushed* repo, not the working tree; rule ids must be the canonical identifiers from the scan JSON (`rafter get <id> --format json` → `vulnerabilities[].rule_id`) — the markdown report's short `R-xxxx` hashes and truncated dotted names don't match. List both id forms; verify with a fresh scan's JSON, not the report header.

### 2026-10-01 — Emphasis markup leaked into link hrefs
- **Symptom:** GREEN run failed one test — `[x](https://e.com/a*b*c)` rendered as `<a href="https://e.com/a<em>b</em>c">x</a>`: a paired `*…*` inside the URL was emphasized *before* the link pass matched, so the href candidate carried `<em>` into the attribute.
- **Root cause:** two passes over the same escaped string (emphasis, then links) — ordering prevents markup pairing *into* an already-emitted href, but not markup *inside a future* href. The link pass sees post-emphasis text, so its "literal fallback" is also post-emphasis (original stars unrecoverable at that layer).
- **Fix:** the href gate rejects any candidate containing a raw `<` — only the library's own emphasis markup can produce one (real `<` arrives escaped as `&lt;`) — degrading the link instead of emitting a corrupted attribute.
- **Rule:** when consecutive passes transform overlapping text, test their interaction (paired markers spanning a boundary), not just each pass in isolation; a structural tell like "only our own pass emits `<`" is a cheap, complete guard.

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
