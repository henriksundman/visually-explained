# Mind map — Design

Status: **draft, awaiting review**
Date: 2026-10-04
Branch: `feat/mind-map`, off `199c6a6` (main).
Baseline for the rendered-output diff: **`199c6a6`**.

## 1. Problem & Goal

The library has seventeen primitives and three layout families, and none of
them draws a **hierarchy**. `stack` nests blocks vertically and `concept`
renders a term with its definition — both are prose. `comparison` puts N items
in a grid and shows their *values* side by side. `diagram` ranks a flow.

None of them can answer "five kinds of cache, and which of those split further."
That is containment, and it is a real gap: a nested `<ul>` conveys it, but
not *at a glance*, which is the entire thesis of a library called
visually-explained.

Goal: a `mind-map` primitive whose IR is a nested tree and whose figure is a
horizontal dendrogram, so containment is visible before it is read.

## 2. Scope

**In.** A `mind-map` block type. A new `layoutTree` module. `presentation?:`
following `cause-effect`/`timeline`/`data-callout`. Theming from existing
tokens. One demo fixture. Docs.

**Out — and deliberately so:**

- **Any interactivity.** No collapse/expand, no hover-reveal, no keyboard tree
  semantics. Open thread 9 already records that focus restoration in this
  library is browser-verified only, and adding the first keyboard-navigable
  block to a library with no keyboard-navigation story is how you get one.
- **Per-node `note`/description** (see §3.4).
- **Non-tree graphs.** Cross-links between branches make this a different
  primitive with a different collision story.
- **Auto-generated maps of a document's own structure.** That would make the
  *renderer* author structure, breaking "the model authors, the renderer owns
  geometry."

## 3. Decisions

Four questions, answered in order, each because the obvious answer was wrong.

### 3.1 The job is containment, not "a concept map"

The alternatives considered: a learning-path graph (a tree, but directional —
you traverse it in an order, which is a different reading), a cross-linked
concept map (honest for the subject, but not a tree, so it becomes a general
graph layout and inherits every collision problem that implies), and a
derived map of the document's own sections (breaks the authoring contract).

Containment wins because it is the one gap that is real *and* expressible as a
tree. `comparison` shows values in a grid; a map shows what nests inside what.

### 3.2 Horizontal, left-to-right — measured, not aesthetic

Radial is the classic mind-map look and the wrong answer here. Three
independent reasons:

1. The entire diagram vocabulary in this library is `lr`. Consistency is not
   a tiebreaker when the alternative is free.
2. **Radial is the worst possible arrangement for long labels**, and most
   labels are long. Every label bug in this library's history
   (figure-label-overflow, the `tb` edge-label collision, the cubic-extent
   trap) was a label problem. Choosing the layout that maximises label
   difficulty, for a look, is the wrong trade.
3. A tree's width is `Σ columnWidth`, and width is the axis that triggers
   `max-width: 100%` scale-down. Radial hides width; `lr` exposes it. Exposing
   it is what lets §6 measure it.

`tb` was rejected because it inherits two bugs and two open rough edges from
the cycle that just shipped it.

### 3.3 Not `diagram` with `layout: "tree"` — measured

The cheap path is real: a tree is a node set plus parent→child edges, and
`layoutFlow` already accepts both. It was tested rather than assumed. On an
8-node containment tree ("kinds of cache"), `layoutFlow` produced a 471×292
scene in which **every parent sits far from the centre of its own children**:

| parent | its centre | its children's centre | offset |
|---|---|---|---|
| Cache | 61px | 223px | **−162px** |
| Shared cache | 227px | 401.5px | **−174.5px** |

A dendrogram centres each parent over its subtree. `layoutFlow` packs children
into ranks and left-aligns them, so on a 471px scene each branch leans by a
third of the figure's width. What it draws is a *process flow with a tree's
node set* — which is exactly not the containment job.

So: a new `layoutTree` module beside `layoutFlow`/`layoutChart`/
`layoutTimeline`, and the parent-centring property is the assertion that keeps
them honestly different (§5.2, asserted in §7.1).

### 3.4 Labels only — no per-node `note`

The obvious gap: a map of bare labels can be the "impressive-looking figure
carrying no information" failure this repo has a DEBUGGING entry for.

The argument for leaving it out: the *detail* is not the map's job. `stack` +
`concept` renders label-plus-definition as prose immediately below the figure,
so nothing is lost. What the figure adds is **structure at a glance** — that
shared cache has three kinds, and one of those splits two ways — which labels
alone still convey.

A `note` is a clean follow-up if the demo shows people wanting it. Adding it
now would double the height budget for content that already exists elsewhere
in the block sequence.

### 3.5 Static, no collapse

Collapse/expand is genuinely the feature that tames a large tree's width, and
it is tempting. It is also the first block in this library to need keyboard
semantics and focus management, in a library where focus restoration is
browser-verified only (open thread 9). The first cycle should answer "does
containment earn a figure at all" before spending on interaction.

## 4. IR & block contract

```ts
// Explicit to a fixed depth (MIND_MAP_SCHEMA_DEPTH = 12) — NOT self-referential.
// See §4.3: a recursive z.lazy() schema lets a deep tree throw a RangeError
// that safeParse does not catch.
const leaf = z.object({ label: z.string().min(1) })

const d1 = z.object({ label: z.string().min(1), children: z.array(leaf).optional() })
const d2 = z.object({ label: z.string().min(1), children: z.array(d1).optional() })
// ... through d12, whose children are d11[] and which is the exported type.
export const mindMapNodeSchema = d12

const mindMapBlockSchema = z.object({
  id: idSchema,
  type: z.literal("mind-map"),
  root: mindMapNodeSchema,
  presentation: presentationSchema.optional(), // "auto" | "text" | "figure"
})
```

**Constants.** Exact values, not approximate ones:

| constant | value | basis |
|---|---|---|
| `MIND_MAP_SCHEMA_DEPTH` | `12` | crash guard only — the smallest round number that is far above any readable tree |
| `MIND_MAP_MAX_DEPTH` | `5` | legibility policy — tuned, not derived |
| `MIND_MAP_MAX_NODES` | `24` | crude first guard, subordinate to the measured width check |
| `MIND_MAP_MAX_CHILDREN` | `8` | per-level breadth |

The three policy numbers are the spec's proposals, not derived results. Task 1
should render the demo fixture and confirm them against the real scene before
they are treated as settled — a cap that is wrong in either direction is a
degradation the library would be making on the author's behalf.

### 4.1 Why the IR is nested, not `nodes` + `edges`

Two reasons, and the second is the important one.

A model authors nested structure far more reliably than it invents ids and
parent→child edges. `diagram`'s edge list let the flow-cycle cycle spend a
session on back-edge classification, because a model *can* express a cycle
there. **A nested tree cannot express a cycle, an orphan, or a node with two
parents.** Those invalid shapes are unrepresentable rather than detected —
resolved structurally instead of defensively.

Containment *is* nesting. Encoding it as edges would be a lossy step the model
has to get right on every call.

### 4.2 `children` is `.min(1)`

An empty `children: []` is meaningless — it renders as a leaf with extra
syntax. Failing validation is clearer than silently treating it as a leaf.

### 4.3 No `z.lazy()` — and the finding that forced it

A recursive `z.lazy()` schema is the obvious way to write a self-referential
type. Tested before committing to it:

```
20,000-deep tree + recursive zod schema
  → RangeError: Maximum call stack size exceeded
```

and **`safeParse` does not catch it.** `salvage.ts:53` calls
`entry.schema.safeParse(raw)` with no try/catch, so this is not a validation
failure — it is an uncaught exception that escapes the render pass entirely.

This is the same failure shape as the Temml `TypeError` fixed earlier the same
day: a degrade-only boundary whose error assumption was narrower than reality.

**Two different depth numbers, doing two different jobs.** Conflating them is
the trap:

| | value | job | on breach |
|---|---|---|---|
| `MIND_MAP_SCHEMA_DEPTH` | 12 | **crash guard** — 12 explicit object types, zero recursion, so `RangeError` is unrepresentable | `[invalid-block]`, block dropped |
| `MIND_MAP_MAX_DEPTH` | 5 | **legibility policy** — how deep a readable tree is | `auto` → text + `[mind-map]` warning |

A 12-deep tree is pathological and is dropped loudly. A 6-deep tree is
*legitimate but unreadable*, so it degrades to text and says so — dropping a
valid authored block would be harsher than this library's usual leniency toward
merely-large input.

### 4.4 `auto` needs a count cap AND a measured fits-predicate

Counts alone are a known failure here. `layoutTimeline`'s comment records it:

> *Event count alone let a 3-event timeline with 40-character milestone names
> through, and the figure silently overlapped its own labels (the labels were
> never measured — the root cause of every figure-label bug in this library).*

So `auto` degrades on two independent conditions: `MIND_MAP_MAX_NODES` (24)
and `mindMapFigureFits(tree)`, which lays the tree out and compares the scene
width against the same **825px** ceiling timeline uses. That number is derived,
not chosen: a scene of width *W* scales to the column, so an 11px label
renders at `11 × (column / W)`; holding that at a readable 8px in a ~600px
column puts the ceiling at 825.

(The figure-intrinsic-size cycle did not invalidate that arithmetic:
`max-width: 100%` still shrinks an over-wide scene exactly as `width: 100%`
did.)

An author who sets `presentation` explicitly always gets what they asked for.
Silently ignoring an explicit override would be its own lie.

### 4.5 The text form is a nested `<ul>`

Not a consolation prize. It is simultaneously the degradation target, the
accessible path, and the no-SVG fallback — so those three cannot drift apart,
because they are the same markup.

## 5. Layout algorithm

A horizontal dendrogram, two passes.

### 5.1 Pass 1, post-order — subtree extent

```
subtreeH(leaf)        = nodeH
subtreeH(internal)    = Σ subtreeH(child) + (children.length - 1) * V_GAP
```

### 5.2 Pass 2, pre-order — placement

**Horizontal.** `colWidth[d]` = widest node at depth `d`.

```
x(node) = PAD + Σ (colWidth[d'] + H_GAP)   for d' < depth(node)
```

Columns hug their own widest label, so a tree of short names stays narrow
instead of inheriting the width of one long name.

**Vertical.** The root is centred; each child subtree is seated inside the
parent's band with the parent centred over it:

```
child.y = parent.y + parent.h/2 - child.subtreeH/2
```

then children stack downward with `V_GAP` between them.

**The invariant this exists to establish:** for every node,
`parent.y + parent.h/2` equals the centre of its children's subtree span. That
is the property `layoutFlow` violates by 162px (§3.3), and it is asserted
directly in §7.1 rather than left to inspection.

### 5.3 Connectors: one trunk, not N edges

An elbow from the parent's centre to each child's centre would stack every
child's vertical segment on the same `x`, so they overlap — the standard
mistake in hand-rolled tree drawing.

Instead: a single vertical **trunk** just right of the parent, spanning its
children's centres, plus a short horizontal **stub** from the trunk into each
child's left edge. Children are contiguous in `y` by construction (§5.1), so
the trunk is one vertical segment and cannot self-overlap.

Drawn as a plain `path` element with a multi-segment `d`, using the existing
`Scene` IR. **No arrowhead** — containment is not directed, and an arrowhead
would assert a direction the IR does not have.

A quiet bonus: orthogonal polylines have *exactly known* extent. Open thread 12
records that a cubic's control line is not its extent, which is what made the
flow cycle's viewBox clip its arrows. That trap cannot occur here, and §6.2
still asserts containment so the property is pinned rather than assumed.

### 5.4 Labels and sizing

Reuse the existing wrap-to-`lines` mechanism with a capped node width: one
very long label widens its column and wraps, rather than stretching the scene.

`width = PAD * 2 + Σ colWidth + H_GAP * (depths - 1)`
`height = PAD * 2 + subtreeH(root)`

Height is unconstrained — figures are allowed to be tall, and the `tb` demo
is 897px. Width is the axis that matters, because it is the one that triggers
scale-down, and §7.5 measures it.

## 6. Theming, a11y, degradation

### 6.1 Node shape carries depth

Root `pill`, depth-1 `box`, deeper `note` — the same vocabulary `diagram`
already uses. Hierarchy is legible without reading the connectors, and it
introduces no new colour or shape vocabulary. Everything else comes from the
existing tokens.

### 6.2 Scene contains its elements

Every element lies within `0..width` × `0..height`, trunk included.

### 6.3 a11y

The SVG carries an `aria-label` linearising the tree into prose: *"Cache
contains Browser cache, CDN edge, Shared cache; Shared cache contains
In-memory, On-disk."* Same approach `cause-effect` and `timeline` take, with
the same honest caveat they carry: the figure form drops detail the text form
keeps. That is the argument for `presentation: "text"` being a real accessible
path rather than a fallback.

### 6.4 Degradation summary

| condition | outcome |
|---|---|
| depth > `MIND_MAP_SCHEMA_DEPTH` (12) | `[invalid-block]`, dropped — crash guard |
| nodes > `MIND_MAP_MAX_NODES` (24), under `auto` | text + `[mind-map]` warning |
| depth > `MIND_MAP_MAX_DEPTH` (5), under `auto` | text + `[mind-map]` warning |
| scene width > 825, under `auto` | text + `[mind-map]` warning |
| explicit `presentation: "figure"` | always rendered, no warning — deliberate override |

## 7. Testing & verification

### 7.1 Invariants, not golden files

A golden file is re-baselined along with the bug — which is how the 21px arrow
misalignment shipped in the flow-cycle cycle. So the load-bearing tests are
properties, asserted over every mind-map in the demo fixtures **and** over
generated trees:

1. **Parent centring** — `parent.y + parent.h/2` equals the centre of its
   children's span, tolerance 0.5px. Verified **RED against `layoutFlow`** on
   the same tree; without that, the claim "this is the thing that catches the
   162px lean" is unproven.
2. **No overlap** — no two nodes in a column overlap vertically, no two columns
   overlap horizontally. Label collision is this library's most repeated bug
   class; this generalises all of them into one assertion.
3. **Scene contains its elements** — §6.2.
4. **Determinism** — identical input, byte-identical output.

### 7.2 The crash guard gets its own test

A 20,000-deep tree must yield a validation result, never a `RangeError`. This
is the direct regression test for §4.3; without it the "no `z.lazy`" decision
silently reverts.

### 7.3 Adversarial sweep

Following the flow-cycle precedent of 8 hostile graphs: single node; 60-deep
chain; 200-node star; mixed depth/breadth; unicode labels; one very long label;
labels differing only by width; a tree with one wide child among narrow ones.
Each must be finite, deterministic and NaN-free — and the 60-deep and 200-node
cases must **degrade**, not render something illegible.

### 7.4 The rest

Degradation emits exactly one warning and `failOnWarning` throws. Text and
figure forms carry the same content. `exp-mind-map*` classes are covered by
the existing class-coverage gate in `tests/themes.test.ts`.

### 7.5 Beyond the suite

The three checks that caught defects tests could not on the day this was
designed:

- **Rendered-output diff vs `199c6a6`** — exactly the new demo block, nothing
  else. Normalise only the new block's markup; the tb cycle's regex was
  over-broad and stripped `<rect>` attributes present on *both* sides.
- **Real Chrome over CDP** — measure the demo tree's content scale via
  `getScreenCTM().a`, not merely "the route returned 200". The flow-cycle
  defect was a 0.49× scale rendering labels at 6.4px with a green suite.
- **Deliberately-shaped fixture, commented as such** — "kinds of cache", full
  tree visible, nothing parked near a cap. The `tb` cycle taught us that
  showing off a rough edge in the demo is a bad demo, not honesty; the rough
  edges get recorded in ROADMAP instead.

## 8. Risks

- **A tree that says little.** The `tb` and flow cycles both shipped figures
  that looked finished and carried little. Mitigation: the fixture is a real
  taxonomy with a genuine second level, and §7.5 measures legibility. If the
  demo renders as a pretty list of names, the honest outcome is to say so
  rather than ship it.
- **Width.** A wide tree scales down and labels shrink. Mitigation: the
  measured 825px fits-predicate, not a node count alone (§4.4).
- **Model authoring quality.** A nested tree is easy to get right, but a
  one-level tree is a valid mind-map and a useless one. Not enforced — that
  is editorial judgement, and the `comparison`/`timeline` precedent is to
  render what was asked and let the model improve.

## 9. Demo & docs

One fixture, added **additively** so the rendered-output diff is a single
insertion: a "kinds of cache" map reusing the tree from §3.3. Existing demo
strings are not edited.

`README.md` gains the block in `## Block types` and the `N primitives` count
in the same commit — `tests/readme.test.ts` enforces both against the live
registry, and this spec adds exactly one primitive (17 → 18). `docs/ROADMAP.md`
gets its `Shipped` line in that same commit.


