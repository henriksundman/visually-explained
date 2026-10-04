# Open threads

Judgement calls and known-rough edges that a future session should know about
before changing the code they touch. Everything here is shipped and working;
these are the things that were **deliberately left open**, not bugs in progress.

Last updated: 2026-10-04, after the degradation-policy and /editorial-fix cycles.

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

---

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