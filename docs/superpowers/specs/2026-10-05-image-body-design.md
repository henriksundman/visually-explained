# Image `body` — prose that belongs to the picture

Date: 2026-10-05
Status: proposed
Supersedes nothing. Amends `docs/superpowers/specs/2026-10-03-image-block-design.md`
(shape (a), shipped) and retires roadmap shape (c) `analogy`.

## 1. The problem, measured

The `image` block gives text exactly one home: `caption`, capped at 300
characters (`src/core/schema.ts:213`). That is two or three sentences. Any
longer explanation of a picture must be a sibling `text` block, which renders
full-width — so the reader gets a full-width image, then a full-width
paragraph, then whatever comes next. The picture and the thing it is
explaining are two separate objects on the page.

That is the whole gap, and it is a *layout* gap rather than a modelling one.

### Why the roadmap's shape (c) was the wrong answer

The roadmap proposed an `analogy` composite block: one image plus an
`[{ imagePart, conceptPart }]` mapping rendered as a caption-side table. It was
described as "the novel differentiator". Two measurements dissolve that:

1. **It is not a differentiator, it is one instance.** A part-mapping table is
   a presentation for "prose that belongs to this image". A procedure with
   three generated pictures is the same need. So is a concept explained by a
   picture. Naming one of them produces a block type the other two cannot use.
2. **Its central field had no honest author.** `analogy` required the model to
   name *parts of an image it has never seen* — the compiler's `LlmClient` is
   text-in/text-out, and the prompt menu (`src/compiler/prompts.ts:10`)
   deliberately shows only `key: subject`. The host had the same problem: a
   host running an image model has the **prompt**, not the picture.

So shape (c) was solving a problem the host could not solve, for a flow the
existing block type already represents. It stays retired.

### What already works, and must not be disturbed

A host that generates text and images, then hands both over, needs **no new
block type today**. A document is a `blocks[]` array; interleaving `text` and
`image` blocks places pictures anywhere in the flow. A step-by-step with three
pictures is `text, image, text, image, text`. Measured: `image` is one of 19
registered primitives and takes a catalog key; nothing about it assumes a
single image per section.

The corpus-diff gate therefore has a hard requirement in this cycle:
**a document containing no `body` must render byte-identically to `main`.**

## 2. Scope

One optional field on the existing block:

```ts
{ type: "image", image: "<key>", body: "prose that belongs to this picture" }
```

rendered as a two-column row — image beside prose — that collapses to one
column when the column is narrow.

Also in scope: one paragraph in the README telling hosts to withhold a block
until its image exists, and the generated-image case added to open thread 5.

## 3. Decisions

1. **Extend `image`; do not add a block type.** Two near-identical block types
   (`image` and `illustrated`) is an arbitrary fork the model has to guess at.
   One block with an optional field is the same block with more available, and
   it keeps the primitive count at 19 — so the README's stated count does not
   move and no registration pin changes.

2. **No `layout` field.** The obvious second field — `"side" | "stacked"` — is
   redundant. A host that wants the stacked form overrides
   `.exp-image-prose { flex-basis: 100% }` in its own stylesheet, which is the
   same lever it already uses for `--exp-radius` and `--exp-gap`. Presentation
   belongs in CSS in this library; an IR enum would duplicate it in a place
   only the library can read.

3. **Cap `body` at 1200 characters.** `text.body` and `callout.body` are
   uncapped, so this is a deliberate asymmetry and needs a reason. `body` here
   means *the paragraph or two that belongs to this picture* — not an article.
   A host that needs more prose beside a picture wants a `text` block, and the
   1200 cap is what keeps a runaway generation from producing a wall of text
   that reads as belonging to the image. Compare `caption`'s 300.

4. **Responsiveness without a media query.** `tokens.css` contains exactly one
   `@media` block (`prefers-reduced-motion`, line 639) and **no layout
   breakpoint at all**. This cycle adds the first one, so it must not add a
   *convention*. The layout is `display: flex; flex-wrap: wrap` with the
   `flex-basis` values acting as the breakpoint: when the two bases no longer
   fit, the prose wraps below the image on its own. It responds to the
   **available width of the block**, not the viewport — which is what a block
   that may sit in a sidebar or a wide page actually needs, and what a
   viewport query would get wrong.

5. **`<figcaption>` stays a direct child of `<figure>`.** HTML allows it only as
   the first or last child of its `figure` parent, so the prose column is a
   `<div class="exp-image-prose">` sibling and the caption goes last, where CSS
   places it on its own full-width line beneath both columns. Nesting the
   caption inside the prose column would have been tidier to style and invalid.

6. **A missed image with a `body` does not get the dashed box.** Today a miss
   renders the caption inside `.exp-image-missing` — a dashed border, which
   signals "this is a degraded slot". With real prose present that border would
   wrap the reader's own legitimate text, which is noise: the reader lost a
   picture, and the host is told by the warning. The prose renders as an
   ordinary paragraph. This is the case that **improves** rather than merely
   degrades — before this field the same failure left an orphan caption
   marooned between two paragraphs.

7. **Alt stays required and stays the host's.** See §6.

## 4. Public surface

### 4.1 Block schema (`src/core/schema.ts`)

```ts
export const imageBlockSchema = z.object({
  id: idSchema,
  type: z.literal("image"),
  // Host catalog key, resolved at render time (image spec §4.1).
  image: z.string().min(1),
  caption: z.string().min(1).max(300).optional(),
  // Prose that belongs to this picture, rendered beside it (this spec §3.1).
  body: z.string().min(1).max(1200).optional(),
})
```

No change to `blockUnionSchema` or the `Block` type — the type already exists.

### 4.2 Markup

**With `body`, image resolves** — identical to today's output plus the new
wrapper class and the prose column:

```html
<figure class="exp-block exp-image exp-image-body">
  <img class="exp-image-img" src="…" alt="…" width="…" height="…"
       loading="lazy" decoding="async">
  <div class="exp-image-prose"><p>…renderInline(body)…</p></div>
  <figcaption class="exp-fig-caption">…</figcaption>  <!-- only when caption -->
</figure>
```

**Without `body`** — byte-identical to `main`, including class order:

```html
<figure class="exp-block exp-image">
  <img class="exp-image-img" …>
  <figcaption class="exp-fig-caption">…</figcaption>
</figure>
```

**With `body`, image misses** — prose and caption survive, no dashed border,
warning still fires:

```html
<figure class="exp-block exp-image exp-image-body">
  <div class="exp-image-prose"><p>…</p></div>
  <figcaption class="exp-fig-caption">…</figcaption>
</figure>
```

**With neither `body` nor a resolving image** — unchanged from `main`: nothing
visible, warning alone. A `body` is a reason to render; its absence must not
change today's behaviour.

### 4.3 Theme (`src/themes/tokens.css`)

```css
.exp-image-body {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: var(--exp-gap);
}

.exp-image-body .exp-image-img {
  flex: 1 1 14rem;
  min-width: 0;
}

.exp-image-body .exp-image-prose {
  flex: 3 1 18rem;
  min-width: 0;
}

.exp-image-body .exp-fig-caption {
  flex: 1 1 100%;
  margin: 0;
}
```

`flex: 1 1 14rem` / `3 1 18rem` gives a ≈42/58 split above the wrap point and
a full-width stack below it. The bases sum to 32rem (512px), so a column
narrower than that stacks — which is the same arithmetic the timeline's 825px
budget rests on, applied here as a flex basis instead of a JS constant.
`min-width: 0` on both is load-bearing: without it a flex item's automatic
minimum size refuses to shrink below its content, and a long unbroken word in
the prose would force the row wider than its column.

New classes `exp-image-body` and `exp-image-prose` must be defined — verified
by `tests/themes.test.ts`, which fails on any `exp-*` class the CSS does not
define. `.exp-image-missing` keeps its current rules; this cycle only stops
emitting it in the `body` case.

### 4.4 Compiler contract

`BLOCK_TYPE_DOCS` (`src/core/blockTypes.ts:21`) — the `image` line gains
`body?` and one clause on when to use it. **This changes the section system
prompt for every host, catalog or not**, because `BLOCK_TYPE_DOCS` is
interpolated into `sectionSystemPrompt()` unconditionally and `tests/llm.test.ts`
pins every registered type into the snippet. That cost is the same class as the
one the image spec recorded when it registered the block: unavoidable, not
feature-scoped, and called out in the README rather than left for a host to
discover. The **user** prompts stay byte-identical without a catalog.

The catalog menu's editorial line gains one clause telling the model to put the
explanation of a picture in `body` rather than in a separate `text` block. This
line is flag-gated — it only appears when a catalog is supplied — and the
existing substring pins in `tests/image-compiler.test.ts` ("anchor an analogy or
set a scene", "Put no text in the image itself") must survive unchanged, so the
addition is appended rather than reworded.

## 5. Out of scope

- Any new block type, including `analogy` (retired, §1).
- Inline images inside a `text` paragraph. `renderInline` is a mini-parser over
  a fixed inline vocabulary; an image is block-level by design and putting one
  mid-sentence makes responsive layout markedly worse.
- Multi-image blocks, `image-sequence`, lightbox, `imageStyle`.
- A placeholder or pending state (see §6).

## 6. The two questions this cycle answers without changing code

**Alt text for generated images.** `imageRefSchema` requires `alt`, and the
shipped rule is "the host owns `alt`, not the model". In a host pipeline that
generates images, **nobody has seen the picture** — the host holds the prompt.
So `alt` becomes a restatement of the prompt, describing an image that may not
match what was generated.

The schema does not change. It cannot: the library has no way to know whether a
given catalog entry came from a human who looked at the image or a prompt it
never saw, and inventing a `generated: true` flag would let the library assert
something it cannot verify. What ships is documentation — open thread 5 gains
the generated-image case, and the README states that a prompt-derived `alt` is a
legitimate host choice whose accuracy the library cannot check. This is the
correct place for it: thread 5 was written assuming a host that *had* seen the
image, and that assumption is now known to be false for a whole class of hosts.

**Pending images.** The host generates images before handing anything to the
library, so "pending" is not a state this library can be in — it is a pure
function of IR plus catalog, with nothing to wait on. Today's miss behaviour
(caption-only plus an `[image]` warning) is already correct for a genuinely
failed generation and is already tested.

A placeholder box was considered and **rejected**: it would require
re-rendering when the image lands, and this library has no lifecycle to hang
that on — `renderExplanation` is synchronous and returns a string. Instead the
README tells hosts to withhold the block until the image exists. The one real
hazard this addresses: a host that renders mid-flight gets an `[image]` warning
and trips `failOnWarning` for what is an expected transient rather than a
defect. That is a documentation fix, not a schema fix.

## 7. Testing

**Schema** — `body` parses; blank rejected; 1201 rejected; 1200 accepted;
absent is fine; the no-`body` block still parses.

**Render** — `body` reaches the DOM through `renderInline` (`<strong>`
assertion); `.exp-image-prose` wrapper present; `figcaption` is the **last**
child when both are present; no `body` produces today's exact markup
(`toBe`-level, so the corpus pin has a unit-level counterpart); `body` + caption
emits both.

**Degradation** — miss with `body` keeps the prose, omits `<img>`, omits
`exp-image-missing`, and still warns; miss with `body` and no caption still
renders the prose; miss with neither is still invisible; miss with `body` does
not throw under `strict`; the catalog key still never leaks into visible markup
in any of these.

**Security** — `body` reaches HTML only via `renderInline`; a script tag in
`body` is escaped.

**Themes** — `exp-image-body` and `exp-image-prose` are defined;
`tests/fixtures.ts`'s image fixture gains a `body` so the coverage gate sees
them, and therefore lands in the same commit as the CSS.

**Compiler** — the byte-identical no-catalog prompt pins still pass; the
existing menu substring pins still pass; `BLOCK_TYPE_DOCS` mentions `body`.

**Corpus** — `node .superpowers/render-fixtures.mjs dist <out>` byte-identical
to the `main` baseline. This is the load-bearing check for decision 1 and the
reason a `body`-less block must not move a byte.

## 8. Risks

- **`1200` is a guess.** It is reasoned from the 300 cap and the "a paragraph
  or two" intent, not measured against real course content. If a host reports
  truncation, the cap is the dial — and unlike a layout constant it can be
  raised without touching the CSS.
- **The ≈42/58 split and the 14/18rem bases are picked by eye**, like the
  timeline's 825px and math's 1.2em. No human has judged them yet; both are
  override-able in host CSS and via `flex-basis`, which is the mitigation.
- **A model may now write a `body` on every image**, doubling document length.
  The prompt clause is the only guard. Worth measuring on the first real
  compile; if it misbehaves the fix is prompt wording, not a schema change.