# Open threads

Judgement calls and known-rough edges that a future session should know about
before changing the code they touch. Everything here is shipped and working;
these are the things that were **deliberately left open**, not bugs in progress.

Last updated: 2026-10-04, after the degradation-policy, /editorial-fix,
flow-cycle, and mind-map cycles.

---

## 1. `strict` gates the input; `failOnWarning` gates the output — keep them apart

**CLOSED 2026-10-04.** This thread recorded that `strict: true` could never fire
on a render-time degradation, leaving hosts no enforceable no-degradation
policy. That gap is now filled by two new options on all four render entry
points:

- `onWarning(warnings)` — observation, called once per render pass.
- `failOnWarning: true` — throws after rendering, carrying every warning.

Reading the code during that cycle also found the gap was **two-sided**: the
string renderers already returned `warnings`, but `renderBlock` hardcoded a
throwaway sink, so `<Explanation>` and `<Document>` discarded warnings
entirely. A React host had no way to observe a degradation at all. That is
fixed; both components now thread a per-pass array and report the same set the
string renderers do (test-locked).

`strict` was deliberately **not** widened, and that remains the load-bearing
decision here:

**Consequence for the next session:** do not write a test asserting that a
render-time warning throws under `strict`, and do not "simplify" by making
`strict` imply `failOnWarning`. The validation gate runs on a *different* array,
populated before rendering starts — that is why the original math-cycle claim
was wrong, and it is still true. Widening `strict` would silently change
behavior for every existing caller. When both options are set, `strict` throws
first: a malformed input is a host bug, a degraded output is a content problem,
and they should not be conflated in one stack trace.

Two follow-ons the closed thread leaves in place:

- **`failOnWarning` fires on lenient-validation diagnostics too** (a dropped
  `[invalid-section]`, a dropped `[invalid-block]`), not only render-time
  warnings. A silently dropped section *is* a degradation. Filter the `[code]`
  prefix if you want render-time failures only.
- **In React, `onWarning` may fire twice for the same set** under StrictMode's
  dev-only double-invoke. This is accepted, not fixed: `Explanation` and
  `Document` are server components with no render-scoped instance to dedupe
  against, and module-level state would leak across requests. Treat
  `failOnWarning` as authoritative and dedupe by set membership if you
  aggregate. Spec: `docs/superpowers/specs/2026-10-04-enforceable-no-degradation-design.md`.

## 2. Prose in a TeX field parses cleanly, so the `not TeX` degradation never fires

`derivation.expression` and `conclusion` are TeX. **Prose is valid TeX** — a run
of letters is a run of variables — so an English sentence written into one
parses without error and renders as one `<mi>` per letter with every space
collapsed, on a single line that overflows its box.

This shipped and was invisible: the editorial demo's `conclusion` held a full
sentence and produced **47 single-letter identifiers and zero warnings**. The
`not TeX` degradation path cannot catch it, because there is no parse error to
catch. Neither can the test suite, because the render technically succeeds.

**Consequence for the next session:** the safety net is narrower than it reads.
`BLOCK_TYPE_DOCS` is the only thing telling an author to put prose in `note`, and
a model will get this wrong the same way a human does — a TeX field is the
natural place to conclude in words.

**Revisit if** inline math in prose (the next roadmap item) lands: `$…$` inside
a `text` field moves the mistake to the *other* side of the boundary, where
prose is correct and a formula is the interloper. A `\text{…}`-aware heuristic
is the only cheap detector, and it would be a heuristic, not validation.

Pinned by `tests/math.test.ts` ("accepts prose silently — a known blind spot")
and swept across every demo fixture by `tests/derivation-tex-hygiene.test.ts`.
The escape hatch is `\text{…}`, which Temml emits as `<mtext>` with U+00A0
no-break spaces — correct MathML, and worth knowing before writing a substring
assertion against it.

## 3. Math size is 1.2em because a human looked at it

`--exp-math-size` and the `math-style: normal` rule on `.exp math` were both
picked by eye on the demo's `/math` and `/document` pages, not derived. The
starting point of 1em was visibly too small — MathML shrinks a fraction at
every level, so a formula landed at roughly body-size glyphs for something that
reads as a display object. 1.3em fixed that but outgrew its line in prose; 1.2em
is where it settled.

Two things this thread exists to protect. First, Temml output was measured to
carry **no** `font-family` and no external references, so "math themes like
everything else" is a verified property of the engine output, not an
assumption — but that is measured once, and a Temml upgrade could change it.
Second, `math-style` is MathML Core; browsers without support silently keep the
compact layout, which is a legibility difference, not breakage. If math ever
looks wrong in a browser this suite has never run in, check `math-style`
support before assuming the theme is at fault.

**Update 2026-10-04:** the value is now demonstrably context-dependent, which is
useful evidence rather than a contradiction. The `/editorial` showcase sets
`--exp-math-size: 1em` from its host stylesheet and the user judged that
*correct* — 1.2em overpowers 17px serif prose at a ~62ch measure, where 1em was
visibly too small on the sans-serif `/math` and `/document` pages. Both were
picked by eye; the lesson is that the right value depends on the measure and the
surrounding type, not that 1.2em was wrong. No `src/` change — the token exists
precisely so a host can decide.

## 4. The image catalog key transits the model, and nothing stops it being a prompt-injection vector

A host catalog is a `Record<string, ImageRef>`, and the compiler's menu
(`src/compiler/prompts.ts`) emits the **record key** to the model, because the
key is exactly what the model must write into `image` and what `resolveImage`
looks up. Keeping one identifier end to end is what stops the prompt and the
renderer from drifting — but it also means a host key crosses to the model
provider.

Two consequences, both currently accepted:

- **Host identifiers leave the process.** A key like `acme-internal-logo` is a
  slug, not a secret, and the host already sends the document's own text to the
  model — so this is a small marginal disclosure. `src` and `alt` deliberately
  do **not** cross, which keeps CDN URLs and internal descriptions out.
- **A hostile key is prompt injection.** A host that puts instructions in a key
  can steer the model. The host is trusted by definition and can already do the
  same through `guidance` or `sources`, so this grants no new capability. It is
  recorded because "host-supplied catalog" reads as inert data and is not.

**Revisit if** catalogs ever become multi-tenant or otherwise less trusted than
the host itself. The fix is to make the menu opaque — emit `- [1]: <subject>`
and have the compiler map the placeholder back to the real key after the
section parses. That keeps every host identifier out of the prompt, at the cost
of a rewrite step and a transiently-unresolvable IR if a compile fails midway.

## 5. Alt text quality is the host's responsibility

`imageRefSchema` **requires** `alt`, which is what makes an inaccessible image
unrepresentable rather than merely discouraged. It guarantees an alt *exists*,
not that it is **accurate** — and a confidently wrong alt is worse for a screen
reader than a generic one.

Nothing in the library can check this: the host ran the image model and knows
what the picture shows, but it may equally have guessed. Nothing in the render
path can detect a mismatch.

**Revisit if** an image-captioning check ever becomes affordable. Until then
this is a host-side quality bar, documented in the README rather than enforced.

## 6. `src` deliberately has no scheme allowlist

`imageRefSchema` validates `src` as a non-empty string and nothing more. Hosts
legitimately serve from relative paths, CDNs, and signed URLs, so gating to
`https:` would break real deployments; `safeHref` is not applied.

This is safe in the `<img src>` position it occupies — browsers do not execute
`javascript:` or `data:text/html` in an image context, and the value is escaped
before emit, so it cannot break out of the attribute. **Revisit if** an
untrusted catalog ever enters, or if `src` is ever reused in a position that
*does* execute (an `<a href>`, a CSS `url()`, a redirect).

## 7. A dragged value can fall between slider increments

`dragValueFor` (`src/react/dragGeometry.ts`) **ignores the param's `step`**.
That is intentional — `step` exists so a *slider* lands on round numbers, and
honouring it makes a dragged point visibly stick and jump between increments.
`min`/`max` still bound the drag, since an author writing `0..360` is
describing the canvas, not the slider.

The consequence: after a drag, the value may sit somewhere the slider's own
grid cannot represent. Today this is harmless — the slider thumb simply rests
between detents and the shared `values` state is the single source of truth.

**Revisit if** figures ever round-trip their values through storage, are
compared for equality, or a host serialises param state. Any of those makes
"a value the slider cannot represent" a real problem rather than a cosmetic
one. Fixing it would mean rounding on *write-back* rather than on drag.

## 8. The timeline's 825px legibility budget is unvalidated by eye

`MAX_FIGURE_WIDTH` in `src/figures/layoutTimeline.ts` was derived
arithmetically (the width at which `width: 100%` scaling shrinks the 11px
labels to ~8px in a ~600px column), and is now *visible* on `/` as a timeline
that renders as a text list beside one that renders as a figure.

It has still never been checked against a human judgement of "too small to
read". The demo shows the boundary; nobody has confirmed it sits in the right
place. If timelines in real content look wrong at the boundary, this constant
is the first thing to move.

## 9. Focus restoration is browser-verified only

`FocusPreservingSvg` preserves keyboard focus across the `innerHTML` subtree
swap that re-renders a figure. There is no jsdom in this repo, so this is
**not unit-tested** — it was verified by driving real key events through Chrome
DevTools Protocol (`tests/react.test.tsx` only pins that the component changes
no markup).

If the repo ever gains a DOM test environment, this is the first thing worth
covering: the failure mode is silent and severe (a control that works exactly
once).

## 10. Groups still cannot be dragged

`group` deliberately carries no identity (`figure-id-unsupported` in
`authored.ts`), so a nested group cannot be grabbed — arguably the most
natural thing to drag in a multi-element figure. This was scoped out
deliberately (spec §3) and giving groups identity is its own decision, not a
drag feature.

## 11. No multi-touch, snapping, or undo

Scoped out with the rest of §3. A drag is one pointer at a time, with no grid
snapping and no undo history.

## 12. A cubic's control line is not its extent

`cubicDepth` in `src/figures/layoutFlow.ts` exists because sizing a scene from
a Bezier control point is wrong. When both control points sit at `ly` with
endpoints at `y0`/`y3`, the curve's true extremum is **not** `ly` — for equal
endpoints it reaches only `y0 + 0.75·(ly - y0)`. The first draft of the
back-edge routing sized the scene from the control line and would have clipped
the return path by ~26px.

This is not specific to return paths. Any future curve geometry that has to
stay inside a `viewBox` must be sized from the sampled or analytic extremum,
never from a control coordinate. The tests sample the path rather than reading
control points for exactly this reason — reading them would encode the bug back
in as an assertion.

Related: the cycle itself. Longest-path layering was originally capped rather
than cycle-aware, on the belief that a pass limit made cyclic layers
"stabilize". They did not; a 5-node cycle reached layer 16. That comment was
the bug's cover story, and it is now deleted. If a layout ever needs to rank a
model-authored graph again, break cycles for ranking purposes explicitly —
`findBackEdges` does this — and never let a cap stand in for termination.

---

## 13. Three React sites render prose with no warnings sink

`renderInline` takes an optional warnings sink so a degradation in prose
reaches the host. Every string-renderer call site passes one, and React's
`Document` and `Explanation` do too. Three components do not:

- `src/react/Quiz.tsx` — no `warnings` array exists; `renderBlock("quiz", …)`
  is called without `opts.warnings`, so block warnings are **already**
  discarded wholesale. This predates inline math.
- `src/react/InteractiveFigure.tsx` — a `warnings` array exists but is scoped
  inside a `useMemo`, while the title and caption render outside it.
- `src/react/ElementPopover.tsx` — `PopoverDiv` is purely presentational.

So an unparseable inline formula in a quiz question, a figure caption or a
popover tip degrades to literal text with **no warning**, even under
`failOnWarning`. Accepted for now: widening the React warning surface is a
separate change from adding inline math, and `Quiz`'s pre-existing discard is
its own bug.

Revisit if a host reports silent degradations in those three surfaces. The
fix is mechanical once the sinks exist — thread it the way `Document` does.

---

## 14. Inline math's `$…$` gate has accepted false negatives

The gate in `src/core/inline.ts` rejects `$a + b$` and `$5$` and leaves them
literal, because both arms it needs are load-bearing: a strong-signal-only rule
rejects `f(x)`, and a tight-expression rule alone accepts `5-` out of
"costs $5-$3". Chosen deliberately — a false negative is the pre-math output
byte-for-byte, while a false positive is the silent corruption the gate
exists to prevent.

`\(…\)` has no gate, so the escape is to use it. This is stated in the README
and the LLM prompt. Revisit only if a host reports the model writing
`$a + b$` and expecting typesetting; the fix is a third arm, not a looser
first arm.

---

## 15. An over-deep mind-map reports "Unrecognized key" and a 13-level path

The explicit depth ladder needs `.strict()` on its leaf, and that choice is
visible in the diagnostic: a 13-deep tree is rejected as
`root.children.0.children.0.… Unrecognized key: "children"` rather than
anything mentioning depth. It is truthful — the offending key really is
unrecognized at that rung, and the path does locate it — and the block is
dropped with `[invalid-block]`, which is the spec'd outcome. But a host
debugging a rejected model response has to count path segments to learn
what happened, and "Unrecognized key" reads like a schema bug rather than a
depth limit.

Revisit if a model is ever seen emitting trees this deep. The fix would be a
`.superRefine` on the root that reports `depth exceeds 12` once, at the top,
before the ladder descends — at the cost of reintroducing a recursive walk
into the parse path, which is exactly what the ladder exists to avoid. That
trade is why it was not done pre-emptively.

## 16. `MIND_MAP_SCHEMA_DEPTH` costs ~2.2 KB of every model prompt

`llm.ts` runs the whole ladder through `z.toJSONSchema`, and each level is
inlined in full: 12 levels is ~2.2 KB against an 8.3 KB
`explanationJsonSchema` before this block, so the prompt grew ~27%. Measured,
recorded in `schema.ts`, and accepted because 12 is roughly the deepest tree
the layout can usefully draw anyway — past 5 the renderer degrades to a list
regardless. If prompt budget ever matters more than crash-safety headroom,
lowering the constant is the dial, and the layout already degrades gracefully
at a lower value. The real fix, if it is ever needed, is to publish a
shallower hand-written JSON schema to the model while validating against the
deep ladder — two schemas, which is a maintenance cost nobody has asked for.

## 17. Mind-map interactivity: tips shipped, collapse still deferred

**PARTIALLY SHIPPED 2026-10-04.** An optional per-node `tip` now exists, and
`mind-map` is routed through `onElementEvent`. That is the whole of tier 1;
collapse/expand (tier 3) is still not built, for the reason below.

**What a tip bought, and why it was not the spec's rejected `note`.** Every
node already carried a `data-el-id`, so wiring the block into the events layer
was one line — and on its own would have been pointer-only, because
`wrapIdentity` emits `tabindex="0"` only where there is a tip. Spec §3.4
declined a per-node `note`; that decision was about *inline prose* and its
"double the height budget" cost, and a popover costs no layout at all. `tip` is
the field `diagram` nodes, `chart` points and `figure` leaves already carry,
with the same 200-char sanitizer, so the block is no longer the odd one out in
the events layer.

**The asymmetry is deliberate and pinned.** All nodes are identified, so
pointer events reach the host for every one; only tipped nodes are focusable
and popover-bearing. A test asserts exactly that, because otherwise "wired
into the events layer" reads as "keyboard accessible", which is false.
Browser-verified 2026-10-04 against a real React host passing
`onElementEvent`: hovering the tipped node opens the popover with the right
text and placement and fires `{kind:"hover", elId:"n2"}`; focusing it does the
same; hovering an untipped node opens **nothing** but still fires
`{kind:"hover", elId:"n0"}`. Both halves of the asymmetry are measured, not
inferred.

That check was worth doing, because `FocusPreservingSvg` carries a comment
claiming React's synthetic focus events do not fire at all for
`dangerouslySetInnerHTML` content — which, if true, would mean
`useElementPopover`'s `onFocusCapture` never fires and the keyboard path is
dead. It does fire. The capture-phase handler on the React-created stage div
receives the focusin from injected descendants. So the two components'
comments do not actually agree, and **the one in `FocusPreservingSvg` is the
overbroad claim** — its native listeners are still the right call for
re-focusing after a subtree swap, but "React never sees focus here" is not a
general truth. Worth revisiting if anyone relies on that comment as a reason
not to use a synthetic focus handler.

**Why collapse is still deferred.** `layoutTree` assigns ids by **pre-order
position** (`n0`, `n1`, …), measured: collapsing a node renumbers every
subsequent sibling, so `In-memory` moved from `n5` to `n3` in a probe. Since
`FocusPreservingSvg` restores keyboard focus by `data-el-id`, a keyboard user
who collapses one node has focus silently teleported to whichever node
inherited the old id. Tiers 2 and 3 together are therefore one change, not
two: derive ids from the tree's **path** (`n0.1.0`), which is stable across
collapses of unrelated subtrees, then build the UI on top. Tier 2 is
prerequisites-only and ships no interactivity, so it is worth doing on its own
merits for hosts keying state off ids.

**Still an open design question, not just an unbuilt feature.** Collapse hides
the node count, which is often the information the reader came for, and it buys
depth on trees that already degrade to an accessible nested list. So the
question is whether the degradation target is the right design for deep trees
at all — which is a spec, not a patch.

## Conventions worth knowing before the next session

- **Verify by measurement, and diff rendered output against `main`.** Three
  defects this cycle were invisible to the suite: overlapping labels, dropped
  labels, and an inverted control. In each case a byte-diff or a real browser
  interaction caught what assertions could not.
- **A degraded path must be loud.** Every fallback here calls
  `ctx.addWarning`. The bug that started this thread was a dropped label that
  no host could observe.
- **When a test result is inconvenient, suspect the product before the tool.**
  A failing keyboard test was written off as a Chrome DevTools artifact for a
  full task before it turned out to be a real focus bug in the page.