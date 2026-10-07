# Figure scene quality: teach the scene contract, stop losing content silently

Date: 2026-10-07
Status: proposed
Relates to: ROADMAP "Compile a real document and read it" (answered 2026-10-07);
the recorded skip-rank backlog item; open thread 21

## 1. The problem, measured

The first real-LLM compile produced three figures a human called "squished
together, unreadable." All three were measured via CDP (screenshot + geometry,
`.superpowers/shoot-mrna-figures.mjs`); the numbers locate each defect:

| figure | defect | measurement |
|---|---|---|
| Lipid Nanoparticle Structure (`figure`) | nested boxes + 3 dots all authored at one center; labels stack | `"Lipid Shell" × "mRNA Cargo"` overlap 1000px²; dots at the same point |
| Lipid Nanoparticle Structure | model named the dots (`label` on `dot`), but `dot` has no `label` field | schema strips it **silently** — dots render unnamed, zero warnings |
| MHC Class I Antigen Presentation (`figure`) | model content outside the 360×240 canvas | caption at y=239 clipped to nothing; two labels run past x=360 (`MHC I-peptide…` ends at x=514.9) — all clipped, zero warnings |
| MHC Class I Antigen Presentation | box labels don't wrap | `"Proteasome (degrades proteins)"` is 195.7px wide in a 100px box → spills into the neighbour; worst label×label overlap 1496px² |
| (Antigen Recognition diagram) | skip-rank edge routes through the intermediate node, label lands on the node | **excluded** — already a recorded backlog item; the model's graph was *valid*, so this is a renderer fix, and it gets its own cycle |

Three distinct failures, three different owners:

- **A. The model was never taught the scene rules.** The figure contract says
  "Label everything; ≤60 elements" — it never says the canvas is 360×240, that
  elements must not stack, or that a dot is labeled with a separate `label`
  element (there is no `label` field on a dot, and nothing says so).
- **B. The renderer loses model intent silently.** Out-of-canvas content is
  clipped with no diagnostic; unknown element fields are stripped with no
  diagnostic. Both losses are invisible unless a human looks.
- **C. Figure box labels don't wrap.** Diagram node labels wrap; figure box
  labels emit one line at any width. Any realistic label in a small box
  overflows into its neighbours.

## 2. Scope

**In:** out-of-canvas handling in `src/figures/svg.ts` (grow vs clip);
`label` sugar on leaf figure elements; box-label wrapping; the figure contract
line in `BLOCK_TYPE_DOCS`; a re-run of the real-compile experiment as the
acceptance test.

**Out:** the skip-rank diagram fix (its own spec/plan cycle — no prompt change
can address it); warnings for stripped unknown fields (would break the
compatibility contract — "optional field added is safe" *requires* silent
stripping, see `tests/compat.test.ts`); compile-time block validation
(thread 21, declined).

## 3. Decisions

1. **Grow the viewBox; stop clipping.** Out-of-canvas content is a model
   error, but the lenient-salvage principle says render what is there —
   clipping is the actual defect: the content is *lost*, invisibly. The
   diagram renderer already grows its scene to contain labels ("scene grows to
   contain blocks"); bespoke figures get the same behaviour: the emitted
   `viewBox` is the union of the 360×240 canvas and every element's bbox, and
   never smaller than 360×240. A figure whose content stays in-canvas emits a
   byte-identical `<svg>` — that is the regression gate for the whole cycle.
   *No warning fires for a grown figure*: nothing was dropped, and
   `failOnWarning` semantics (thread 1) reserve warnings for loss. A grown
   figure may scale down slightly (`max-width: 100%`); legibility beats
   invisibility.

   Rejected: **warn-and-clip** — the warning fires on `failOnWarning` but the
   host cannot retroactively fix a compiled document, and the reader still
   loses the content. Rejected: **warn-and-grow** — a warning for content that
   fully renders muddies the degradation channel: warnings must mean loss.

2. **`label` sugar on leaf elements.** The model guessed a reasonable API —
   honour it. `label` on `dot` / `line` / `curve` / `arc` renders as a floating
   label beside the shape (a dot's label above it; a line's at its midpoint),
   exactly as if the author had emitted a sibling `{ kind: "label" }` element,
   subject to the same caps. `box` keeps its existing centered `label`.
   Additive and non-breaking: the field is stripped today, so no existing
   document changes. The prompt teaches the sugar directly — "leaf elements
   accept `label`" is simpler for a model than "emit a separate label
   element near your dot."

3. **Box labels wrap to the box width.** Same wrapping the diagram renderer
   uses (word boundaries, capped). If the wrapped lines exceed the box height
   the text still renders (overflowing the box) — visible and imperfect beats
   silently spilling into a neighbour's text. The corpus gate covers this:
   every hand-authored demo box label already fits, so wrapped output must be
   byte-identical there.

4. **Prompt teaching stays to two sentences.** The figure contract line gains
   roughly: keep every element inside the 360×240 canvas and spread elements
   out — labels render at ~13px and stacked elements are unreadable; give each
   box room for its label (long labels wrap). Exact wording at plan time,
   pinned like the rest of `BLOCK_TYPE_DOCS`.

## 4. Tasks (outline)

1. Grow-to-content viewBox in `svg.ts` — TDD: an out-of-canvas fixture renders
   fully visible; every in-canvas demo figure emits byte-identical SVG.
2. Box-label wrapping — TDD with the MHC fixture's own labels; corpus
   byte-identical.
3. `label` sugar on `dot`/`line`/`curve`/`arc` — TDD; `BLOCK_TYPE_DOCS` line
   updated in the same commit as the parser (the registration-pin tests
   require it).
4. Prompt teaching line + re-run `.superpowers/real-compile.mjs` — acceptance:
   re-measure the compiled page with the CDP probe; zero out-of-canvas
   elements, zero label×label overlaps in the two regenerated figures (or the
   residual is understood and recorded).
5. Docs: README figure section (wrapping, growth, `label` sugar), ROADMAP
   backlog update, DEBUGGING entry for the `getBBox()`-ignores-transform
   probe trap if it is not already recorded.

## 5. Verification

- `tsc --noEmit`, full suite, `npm run build`.
- Corpus gate: every demo figure byte-identical (in-canvas content unchanged
  by construction; verified, not assumed).
- Real-compile re-run: prompts still produce valid envelopes (thread 21 fix
  intact) and the figure-quality measurements improve.
- The CDP probe script stays in `.superpowers/` as the regression net for
  "unreadable" — it is the measurable form of a complaint that used to be
  eyeball-only.
