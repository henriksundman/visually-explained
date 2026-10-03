# Open threads

Judgement calls and known-rough edges that a future session should know about
before changing the code they touch. Everything here is shipped and working;
these are the things that were **deliberately left open**, not bugs in progress.

Last updated: 2026-10-03, after `feature/image-block` was built.

---

## 1. The image catalog key transits the model, and nothing stops it being a prompt-injection vector

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

## 2. Alt text quality is the host's responsibility

`imageRefSchema` **requires** `alt`, which is what makes an inaccessible image
unrepresentable rather than merely discouraged. It guarantees an alt *exists*,
not that it is **accurate** — and a confidently wrong alt is worse for a screen
reader than a generic one.

Nothing in the library can check this: the host ran the image model and knows
what the picture shows, but it may equally have guessed. Nothing in the render
path can detect a mismatch.

**Revisit if** an image-captioning check ever becomes affordable. Until then
this is a host-side quality bar, documented in the README rather than enforced.

## 3. `src` deliberately has no scheme allowlist

`imageRefSchema` validates `src` as a non-empty string and nothing more. Hosts
legitimately serve from relative paths, CDNs, and signed URLs, so gating to
`https:` would break real deployments; `safeHref` is not applied.

This is safe in the `<img src>` position it occupies — browsers do not execute
`javascript:` or `data:text/html` in an image context, and the value is escaped
before emit, so it cannot break out of the attribute. **Revisit if** an
untrusted catalog ever enters, or if `src` is ever reused in a position that
*does* execute (an `<a href>`, a CSS `url()`, a redirect).

## 4. A dragged value can fall between slider increments

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

## 5. The timeline's 825px legibility budget is unvalidated by eye

`MAX_FIGURE_WIDTH` in `src/figures/layoutTimeline.ts` was derived
arithmetically (the width at which `width: 100%` scaling shrinks the 11px
labels to ~8px in a ~600px column), and is now *visible* on `/` as a timeline
that renders as a text list beside one that renders as a figure.

It has still never been checked against a human judgement of "too small to
read". The demo shows the boundary; nobody has confirmed it sits in the right
place. If timelines in real content look wrong at the boundary, this constant
is the first thing to move.

## 6. Focus restoration is browser-verified only

`FocusPreservingSvg` preserves keyboard focus across the `innerHTML` subtree
swap that re-renders a figure. There is no jsdom in this repo, so this is
**not unit-tested** — it was verified by driving real key events through Chrome
DevTools Protocol (`tests/react.test.tsx` only pins that the component changes
no markup).

If the repo ever gains a DOM test environment, this is the first thing worth
covering: the failure mode is silent and severe (a control that works exactly
once).

## 7. Groups still cannot be dragged

`group` deliberately carries no identity (`figure-id-unsupported` in
`authored.ts`), so a nested group cannot be grabbed — arguably the most
natural thing to drag in a multi-element figure. This was scoped out
deliberately (spec §3) and giving groups identity is its own decision, not a
drag feature.

## 8. No multi-touch, snapping, or undo

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