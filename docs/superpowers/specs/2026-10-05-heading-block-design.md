# The `heading` block

Date: 2026-10-05
Status: proposed
Relates to: the Luma integration thread in `docs/ROADMAP.md`

## 1. The problem, measured

This library emits **no heading element of its own**. Measured across the whole
render surface, exactly two headings exist:

| element | source | level |
|---|---|---|
| `<h1 class="exp-doc-title">` | document title (`renderDocument.ts:167`) | h1 |
| `<h2 class="exp-doc-section-title">` | section title (`renderDocument.ts:168`) | h2 |
| `<h3 class="exp-title">` | the *fragment* title in `renderExplanation` | h3 |
| `<h4 class="exp-fig-title">` | a figure's own title (`primitives/figure.ts:69`) | h4 |

So in a document the outline runs **h1 → h2 → _nothing_ → h4**. There is a gap
at h3, and no way for an author or a compiler to put a subheading inside a
section's block flow.

This surfaced from surveying a learning app whose IR leads with a `heading`
block type — the first of its nine. It was initially measured as *the* blocker
for that integration, then demoted to a nice-to-have when the integration turned
out to be greenfield rather than a rewrite (a new mode can use
`sections[].title`). It is still worth having: a long visual explanation needs
to break itself into parts, and today the only way to do that is to invent more
sections, which drags in the TOC and section anchors.

## 2. Scope

One block type:

```ts
{ type: "heading", text: "Why it matters" }
```

rendering `<h3 class="exp-heading">`. Nothing else changes.

## 3. Decisions

1. **Fixed `h3`, and no `level` field.** The obvious alternative — `level:
   2 | 3 | 4` — was rejected for two reasons. It lets a model emit an `h1` in
   the middle of a document and break its title, and it makes a *skipped* level
   expressible, which is the actual accessibility failure (a jump from h2 to h4
   leaves assistive technology with no owner for h3). A fixed h3 fills the one
   empty slot in the document outline and cannot skip.

   In `renderExplanation` a block heading sits at the same level as that
   fragment's own `<h3 class="exp-title">`. That is a *flat* outline rather than
   a correct one, but flat is not skipped, and the flatness is **pre-existing**:
   a fragment embedded under a host's `h1` with no `h2` already skips today,
   before this block exists. The host owns the surrounding outline.

2. **Reuses `.exp-title`'s type scale rather than inventing one.** `.exp-title`
   is already `1.15em / 650` — which is what an h3 *is* in this library. So the
   new class takes the same values, and the heading is visually identical to a
   fragment title at the same outline level. No bottom rule either: that belongs
   to `.exp-doc-section-title`, which marks a real structural break, and an
   in-flow heading is not one.

3. **Anchor only when the block carries an `id`**, emitted as `id="h-<id>"`.
   Auto-slugging the text was rejected: two identically-worded headings in one
   document are entirely normal in generated content, and duplicate DOM ids are
   invalid HTML that silently breaks the second anchor. There is no per-document
   `taken` set available to a primitive — `collectAnchors` threads one for
   sections, but `renderSalvagedBlock` is stateless per block — so deduplication
   would mean new context plumbing to solve a problem the author can avoid by
   supplying an id. The `h-` prefix makes a heading/section id collision
   structurally impossible (`sec-` is the section prefix), which is why it is
   not the raw id.

   This is also the **first consumer of the block `id` field**, which every
   block schema already accepts and which nothing currently renders — measured:
   `id: "my-stack"` produces no DOM attribute anywhere in this library.

4. **Headings stay out of the table of contents.** `renderToc` is built from
   sections alone (`renderDocument.ts:161`). Putting headings in it means a
   *nested* table of contents — a real feature with its own decisions about
   depth, ordering and collapse. Out of scope. Headings still get anchors, so a
   host can deep-link to one itself.

5. **`text`, not `title`.** In this IR `title` means "an optional caption or
   label for some *other* thing" — `figure.title`, `sources.title`. A heading
   block has no other thing; its text *is* the content. `title` on a block that
   is nothing but a title would read as a mis-typed figure field.

6. **No new degradation path.** Empty or over-long text fails
   `headingBlockSchema`, which the existing salvage reports as
   `[invalid-block]` and drops. Nothing to add.

## 4. Public surface

### 4.1 Schema (`src/core/schema.ts`)

```ts
export const headingBlockSchema = z.object({
  id: idSchema,
  type: z.literal("heading"),
  text: z.string().min(1).max(200),
})
export type HeadingBlock = z.infer<typeof headingBlockSchema>
```

Added to `blockUnionSchema` and the `Block` union. 200 chars is a bound, not a
suggestion — a heading longer than that is an authoring error, and it matches
`sources.items.title`'s cap.

### 4.2 Render

```html
<h3 class="exp-heading" id="h-why-it-matters">Why it <em>matters</em></h3>
```

`id` omitted entirely when the block has none. Text goes through `renderInline`,
matching section titles in both the `<h2>` and the TOC.

### 4.3 Theme (`src/themes/tokens.css`)

```css
.exp-heading {
  margin: var(--exp-gap) 0 6px;
  font-size: 1.15em;
  font-weight: 650;
}
```

`tests/themes.test.ts` requires `.exp-heading` to be defined, and its fixture
must carry a heading block for that gate to see the class.

### 4.4 Model contract (`src/core/blockTypes.ts`)

```
- heading: { text } — a subheading inside a section. Use it to break a long
  explanation into parts; use sections for a document's top-level split. Never
  repeat a heading, and keep it to a few words.
```

This adds a line to the block-type contract, which `sectionSystemPrompt()`
interpolates **unconditionally** — so it is a system-prompt diff for every host,
catalog or not. Same cost the image block's registration carried, and the same
reason it cannot be gated: `tests/llm.test.ts` pins every registered type into
the snippet.

## 5. Out of scope

- **A `level` field** (§3.1).
- **Headings in the table of contents** (§3.4).
- **Auto-slugged anchors** (§3.3).
- **Changing `.exp-title` to a different level.** It is h3 today and stays h3;
  a fragment's title and an in-flow heading sharing a level is accepted.
- Any `data-block-id` emission for every block. That is a separate, more general
  question raised in the Luma thread and still unmeasured here.

## 6. Testing

**Schema** — parses; missing `text` rejected; empty rejected; 200 accepted, 201
rejected; `Block` union pins `HeadingBlock`; registered type appears in the
`BLOCK_TYPE_DOCS` snippet and in `sectionSystemPrompt`.

**Render** — `<h3 class="exp-heading">` with `renderInline` markup; `id="h-<id>"`
when the block has an `id`; **no `id` attribute at all** when it does not (an
empty `id=""` is a different thing and must not ship); text escaped.

**Placing** — renders inside a `stack` at any depth; inside a document section
alongside other blocks.

**Degradation** — an invalid heading is dropped with `[invalid-block]` and does
not take its neighbours with it; `strict: true` behaves as it does for any
other invalid block.

**Themes** — `.exp-heading` is defined; the fixture carries a heading so the
coverage gate sees it.

**Corpus** — a new primitive necessarily changes the corpus, so the gate here is
the same one the image-body cycle settled on: **hold the fixtures constant and
vary only the build**, then confirm the diff is confined to the heading
primitive's own output. `.superpowers/render-fixtures.mjs` calls
`renderDocument(ir)` with no options, so a naive whole-corpus diff also moves
on any fixture that gains a heading — do not read that as a regression.

## 7. Risks

- **`renderExplanation` puts a heading level with the fragment title** (§3.1).
  Accepted; the alternative is outline soup. Revisit if a host reports a
  flattened outline being read badly by a screen reader.
- **`h3` under `h2` in documents but level-with-title in fragments** is a
  context dependence a future reader may find surprising. It is recorded here
  rather than left to be rediscovered.
- **The 200-char cap** is a judgement call, like `body`'s 1200 in the image-body
  spec. It is the cheap dial if real content overflows it.
- **A model may now over-produce headings.** The contract line's "keep it to a
  few words" and the 200-char cap are the only guards. Worth watching on the
  first real compile — and that watch is the same one the image-body cycle
  recorded for `body`.