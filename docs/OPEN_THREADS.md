# Open threads

Judgement calls and known-rough edges that a future session should know about
before changing the code they touch. Everything here is shipped and working;
these are the things that were **deliberately left open**, not bugs in progress.

Last updated: 2026-10-07, after the first real-LLM compile run — that run
added **thread 21** (the compiler validates section shape, not blocks; the
prompt fix was chosen over a compile-time safety net). Before that: 2026-10-05,
after the figure-hover-surfaces,
react-warning-surface, and image-body cycles, and again after the
external-adoption assessment. Thread 13 is CLOSED. Thread 18 records the
image/prose split as human-judged rather than guessed. **Threads 19 and 20 are
the ones to read before answering "can another app depend on this yet"** — they
record what is and is not guaranteed about upgrades.

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

**Update 2026-10-05 — the original wording assumed a host that had seen the
image, and that assumption is false for a whole class of hosts.** A host whose
images are generated (an LLM suggests a prompt, an image model renders it) holds
the **prompt**, never the picture. Nobody in that pipeline has seen the output,
so `alt` becomes a restatement of the prompt: "A diagram of the Krebs cycle
showing…", describing an image that may not match what came back.

**The schema deliberately does not change.** It cannot: the library has no way
to know whether a catalog entry came from a human who looked at the image or a
prompt it never saw, and an `imageRefSchema.generated: true` flag would let the
library assert something it cannot verify while giving a host a way to *claim*
provenance. So the requirement stands and the honest position is documented in
the README instead. A prompt-derived `alt` is a legitimate host choice, with an
accuracy risk the library cannot see.

**Revisit if** an image-captioning check ever becomes affordable — that would
help both cases, and is the only thing that would actually close this. Until
then this is a host-side quality bar, documented in the README rather than
enforced.

**Related, from the same cycle:** rendering has no lifecycle, so there is no
"pending" state (see the image-body spec §6). A host generating images
asynchronously must withhold the block until its key resolves; rendering
mid-flight produces an `[image]` warning and trips `failOnWarning` for what is
an expected transient rather than a defect. A placeholder box was rejected —
it would need a re-render when the image lands, and `renderExplanation` is a
synchronous function returning a string.

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

**CLOSED 2026-10-05.** All three now report, and the thread is worth keeping
because the fix is **not** the obvious one — the first implementation was
correct, type-checked, and did nothing.

What the gap cost, measured: an unparseable formula in a quiz question
rendered **byte-identical** HTML with and without a warnings sink. So the
degradation was invisible in the DOM, invisible to diffing, and invisible to
`onWarning` — and `failOnWarning: true` did **not** throw. The enforceable
no-degradation policy was silently defeated on these surfaces.

**Why threading the array did not work, which is the part to remember.** The
obvious fix is to pass `Explanation`'s shared `warnings` array into `Quiz` as a
prop. Measured: a child component's side effects land **after** the parent's
body has run. The parent's own read sees `[]`; the child's push arrives
afterwards. So the array was right and the *timing* was wrong, and the
component reported correctly in isolation while the host still received
nothing.

This is why `Document` never had the bug: it calls `renderInline` and
`renderBlock` **directly**, as plain function calls inside its own body, and
never delegates to a child. Its "build the JSX before the policy check"
comment is about a *different* hazard — `renderBlock` mutating the array
mid-map — not this one.

**The fix is a synchronous pre-pass**, not a prop and not an effect:

```ts
if (interactive && b.kind === "valid" && (b.type === "figure" || b.type === "quiz")) {
  renderBlock(b.type, b.data, 1, blockOpts) // HTML discarded, warnings kept
  return <InteractiveFigure … /> // or <Quiz … />
}
```

`renderBlock` populates the array as it runs, so the ordering is right by
construction. Measured: identical warning sets against the string renderer for
quiz (3) and figure (2), ~0.13ms per block, once, on the SSR path. **No effect
is involved**, which is what makes it SSR-safe — effects do not run under
`renderToStaticMarkup`, so reporting from one would have stopped `onWarning`
firing under SSR altogether. That option was considered and rejected on those
grounds, not on taste.

Two consequences worth recording:

- **`InteractiveFigure` needed no change at all.** `renderFigure` — the string
  path — already sinks the title and caption through `renderInline(…, ctx)`. The
  React component was duplicating that prose purely to make it interactive, and
  the duplication is exactly where the sink was lost. Neither `Quiz` nor
  `InteractiveFigure` was modified; the fix is in `Explanation`.
- **`PopoverDiv` keeps its own sink**, via an `onWarning` prop on
  `PopoverDiv`/`FigureEvents`. A tip has no static render pass — it appears at
  hover time — so no pre-pass can reach it. It reports at the moment of its own
  render, which is safe precisely because nobody reads the array afterwards.
  It deliberately has **no `failOnWarning` counterpart**: it mounts from a
  hover or a focus, so throwing during its render would tear down the figure
  the reader is looking at.

A test now asserts React's reported set **equals** the string renderer's across
a delegated quiz, a delegated figure, a plain block and the document
title/summary — comparing sorted sets, not counts. Count-only comparison is
what passed in the 2026-10-04 math cycle while React reported 1 where the
string renderer reported 4.

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

**Two corrections to the record, from the 2026-10-05 hover-surfaces cycle.**
Both concern probing this path, and both cost real time:

- **A scripted `el.focus()` cannot test the keyboard path.** It fires **no**
  `focusin` at all on an injected SVG element — measured with a *native*
  listener on the stage div, which recorded zero events — so the popover never
  opens and it looks exactly like a dead keyboard path. Two probe runs
  concluded "focus is broken" before a real dispatched Tab keypress reached the
  node and opened the popover. Use a keypress, not `.focus()`.
- **Focus opens the popover but reports no event.** `onFocusCapture` calls
  `show()` only; it never calls `onEvent`, and `FigureElementEvent` has no
  `"focus"` kind (`figureEvents.ts:5-7` — `hover` and `click` only). So a host
  that logs element events sees nothing on focus even though the popover
  appears. That is the type's shape rather than an oversight, but it is easy to
  misread as "focus does nothing".

The popover is now reachable from a demo route (`/interactive` passes
`onElementEvent`), so neither claim has to be taken on trust any more.

**Escape now closes a hover-opened popover, and the note that recorded this
was wrong.** The ROADMAP entry claimed Escape failed "when focus is outside the
stage", which reads as a broken keyboard path. Measured, it is one narrow case:

| case | before | after |
|---|---|---|
| hover, nothing focused | Escape did **nothing** | closes |
| focus via Tab | closed | closed |
| focus then Tab away | closed via blur | closed via blur |

The cause is that a hover leaves focus on `<body>`, so a keydown bound to the
stage `div` never fires. A keyboard user could always dismiss it by tabbing,
which is exactly why this read as a working feature — and it only became visible
once the hover-surfaces cycle made the popover reachable from a demo route.

The listener now lives on the **document**, bound to `pop` rather than mounted
once. That binding is the load-bearing part: a permanent document listener would
swallow every Escape on the page, including the host's own dialogs and the quiz.
Verified both directions in a browser — Escape closes the popover when open, and
still reaches a host listener when none is open.

**This behaviour is browser-verified only, and deliberately so.** The whole React
suite is SSR (`renderToStaticMarkup`) with no DOM test environment, and hover,
focus and keydown have no SSR analogue; adding jsdom for one assertion would cost
more than it pins. The corpus diff is byte-identical, so this change is
client-side by construction.

**How a figure's hover surfaces are split, settled 2026-10-05.** A figure
`<svg>` used to carry its accessible name twice — `aria-label` and a `<title>`
element from the same variable on the adjacent line. `<title>` is a user-agent
tooltip, so it fired once per *figure* and identically over every node, which on
a mind map meant the whole tree linearised into one sentence. It is suppressed
now. **Suppression is free, and the argument is structural rather than
sampled**: `ariaLabel` is a required `SceneSvgOptions` field and the two
attributes were emitted with no conditional between them, so no input reached
the `<title>` without the `aria-label` beside it; and for `role="img"` the
accessible name is computed from `aria-label`, with `<title>` only a fallback.
The two surfaces are **complementary, not redundant** — whole-figure summary
vs per-element detail — so this was a decision about which one the *pointer*
shows, and never a candidate for merging. See the shipped ROADMAP entry and
`docs/superpowers/specs/2026-10-05-figure-hover-surfaces-design.md`.

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

## 18. The image/prose split is 38/62 because a human looked at it

`.exp-image-body` lays a picture and its `body` prose out as a flex row with
`flex: 1 1 14rem` on the image and `3 1 18rem` on the prose. The nominal bases
are 43.75/56.25; the **measured** result in Chrome is a **0.376 image share**
(37.6/62.4) once flex-grow distributes the leftover, against a 736px block
column. Wrap point: the two bases plus the 12px gap sum to 524px, so a column
wider than that gets two columns and a narrower one stacks — measured at 1280
and 900 (side by side) and 700 and 420 (stacked).

**As of 2026-10-05 a human has judged this and it reads correctly**, closing the
risk the image-body spec recorded as unvalidated. Same status as thread 3 (math
size at 1.2em) and the mirror of thread 8 (the timeline's 825px budget, which
nobody has looked at).

Both numbers are host-overridable without touching the library —
`.exp-image-prose { flex-basis: 100% }` stacks it permanently, and the bases
are two literals in `tokens.css`.

One behaviour worth not re-deriving: `.exp-image-body { flex-direction:
row-reverse }` puts the image on the right, and it is a **no-op below the wrap
point**. Reversing the direction reverses the *main axis* only, so once each
item owns its own line, line order still follows DOM order and the image stays
on top. That is the right default — the picture precedes the prose that
explains it — but it means "image right" is a wide-column statement, not a
global one. Measured in Chrome at both widths. A reversal also leaves DOM order
(`img` → `prose` → `caption`) disagreeing with visual order, which is the
WCAG 1.3.2 shape; benign for an image-and-caption pair, worth a thought before
reversing a prose-heavy row.

## 19. Adding a block TYPE is a breaking change, and nothing in the repo said so

Recorded 2026-10-05, after someone asked whether the library was stable enough
to build other apps on. The honest answer was "yes for field additions, no for
type additions, and there is no mechanism that would tell a consumer either
way" — and none of that was written down anywhere. It is now, in the README's
`## Compatibility` section and pinned by `tests/compat.test.ts`.

**What was measured** (probes against the built `dist/`, not the schemas):

| Change | Result |
|---|---|
| Optional field added to a known block | OK, 0 warnings — **even under `failOnWarning` and `strict`** |
| New block type | `[unknown-type]` warning, fallback chip, no throw — **throws under `failOnWarning`** |
| IR `version: 2` | `[wrong-version]` + `[invalid-document]` — **throws under `failOnWarning`** |

The first row is the good news and it is structural, not lucky: non-strict zod
object schemas **strip** unknown keys, so a future field never even reaches the
renderer. The second row is the bad news and it is also structural: the same
leniency that makes unknown *fields* harmless makes unknown *types* produce a
warning, and a warning is exactly what `failOnWarning` converts into an
exception.

**The judgement call, which is not visible in the code.** A new block type could
be made non-breaking by having the fallback be silent, or by excluding
`[unknown-type]` from `failOnWarning`. Neither was done, deliberately. An
unrecognised block rendering as a plausible-looking wrong thing is the failure
mode the warning system exists to prevent — silently dropping a block the host
believed it rendered would be worse than throwing. So the cost is pushed onto
the version bump, where it belongs.

**Consequence for the next session:** adding a primitive is not a minor
release. It needs a version bump or an explicit host-side allowlist, and the
`## Compatibility` table plus `tests/compat.test.ts` must be updated in the same
commit. If a future change makes any row in that table stop being true, fix the
table deliberately — do not relax the test to match new behaviour.

**Two rows the policy does not cover, and cannot.** *Rendered markup of an
existing block changed* fires no warning at all, so `failOnWarning` will not
catch a purely visual break — a host that pins markup expectations (snapshot
tests, CSS relying on an exact structure) has no signal. And the prompt
contract moves whenever the block-type list does: adding a type changes the
system prompt for **every** host on upgrade, catalog or not, which is already
recorded in the README's image `> **Upgrade note:**` but is a *behavioural*
break that no version number governs.

**A third row, measured after the first draft of the policy table.** *A required
field added to a known block* is worse than the table originally claimed. The
first version said such IR "fails validation", which is true but undersells it:
measured, the block is **dropped from the page entirely** — no placeholder, no
partial render. Under `failOnWarning` that throws, which is recoverable; under
the **default lenient options** it is a silent hole in the rendered document,
with the only signal a warning array a host may not be reading. That is the
worst failure mode in the whole table, and it is the one row where the README
now spells out both halves rather than just the throwing half.

**The lesson, which is the reusable part of this thread.** Four of the five
rows came straight out of the probe and needed no correction. The one that did
was the row filled in by **inference** — reasoned from the schema rather than
run. That is now the standing expectation for any stability claim: measure every
row, because the row that sounds obviously true is the row that understates its
own severity.

## 20. The package root re-exports internals, and the package is unpublished

Recorded 2026-10-05, same session as thread 19. Two facts about distribution,
neither of which is a bug in the code — but both of which change what a
consumer can rely on, and neither of which was discoverable without asking npm.

- **Not published.** `npm view explanations` is a 404; `package.json` is
  `0.1.0`, and there is **no CHANGELOG and no git tag**. There is no published
  artifact to diff a breaking change against, so "which upgrade broke me" is
  not answerable from the registry. `0.1.0` + no changelog + no tags is
  self-consistent only for a package nothing depends on yet.
- **`src/index.ts` re-exports 18 internal modules** via `export * from` —
  including `./core/inline`, `./core/schema`, `./compiler/prompts` and
  `./core/registry`. Everything in those modules is reachable public surface by
  accident rather than by decision.

**The judgement call.** `export *` was not narrowed as part of documenting the
policy, and that is a decision rather than an oversight. Narrowing it is
behaviour-preserving for every documented entry point and **breaking for
anyone already deep-importing** — a change to make deliberately, with a version
bump, not as a drive-by. The README now warns hosts off the deep paths.

**Consequence for the next session:** before publishing, decide whether
`explanations` should take the unscoped name or a scope (`@…/explanations`) —
the unscoped name is very likely taken by an unrelated package — and treat the
`exports` map as the place to make the public surface explicit. Adding a
CHANGELOG and cutting `0.x` tags is what gives thread 19's policy any teeth;
without them it is prose a consumer has no way to check.

## 21. The compiler validates section SHAPE, not blocks — and the prompt fix was chosen over a compile-time safety net

**Decided 2026-10-07**, on the first real-LLM compile run.

`documentSectionSchema.blocks` is `z.array(z.unknown())` by design (per-block
salvage happens at render time, so one malformed block drops alone instead of
failing its section). The cost showed up the first time a real model ran:
no prompt ever stated the block discriminator, the model returned three
wrong envelopes in one document, and section validation passed **everything**
— 0 repairs, 0 dropped, a "clean" run — while `renderDocument` reported 52 and
88 `[invalid-block]` warnings for the blocks it would drop. The repair loop
cannot fix what it structurally cannot observe.

Two options were on the table: **(a)** fix the prompt — state the
`{ "type": ... }` envelope once in `BLOCK_TYPE_DOCS`, which all three prompt
surfaces embed (shipped, `eb59f75` + `6e6059d`), or **(b)** a compile-time
safety net — validate blocks in the section stage and warn, or fire a repair.
**(b) was declined for now**: it changes deliberately-lenient semantics, and
the re-run after (a) produced 156/156 valid blocks with zero warnings, so for
this model the prompt fix was sufficient.

**Revisit if:** a run of the scratch experiment (`.superpowers/real-compile.mjs`,
~90 seconds) shows wrong envelopes again, or a host reports compiled documents
rendering with heavy `[invalid-block]` warnings. Then the options are strict
block validation in the section stage (repair-triggering — note the repair
`rules` string would also need the block contract, since only the outline stage
passes the whole system prompt back), or a lighter
`[compile] section N has X malformed blocks` warning that constrains without
dropping. One indirect symptom already works: the checks audit reads `.type`,
so a `kind`-keyed quiz surfaces as "declared a check but placed no quiz" —
usable as a tripwire, not as a fix.

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