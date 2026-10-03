# Math typesetting — Design

**Date:** 2026-10-03
**Status:** approved in brainstorm; implementation pending
**Supersedes:** nothing. **Related:** `docs/ROADMAP.md` backlog ("Math
typesetting subset"), `docs/OPEN_THREADS.md` #2 (host-owned quality bars)

---

## 1. Problem & Goal

The library explains things visually, and half of `derivation`'s natural
content is mathematical. Today `src/core/inline.ts` renders exactly four
constructs — `**bold**`, `*italic*`, `` `code` ``, `[label](href)` — and
`derivation` renders its `expression` and `conclusion` through `escapeHtml`
alone. There is no sup, sub, or fraction anywhere in `src/`.

The consequence is that a `derivation` block cannot show a fraction. An author
who wants one writes `a/b` in prose, which is a strictly worse explanation and
the reason the figure layer exists at all. This is a **capability gap in an
already-shipped primitive**, not a refinement.

**Goal:** derivation formulas render as real math, and the renderer is a
complete TeX engine rather than a bespoke subset.

### The goal that changed the design

The stated destination is *"render any math or science notation properly."*
This was decided in brainstorm, after I had already recommended a hand-rolled
`^{}`/`_{}`/`\frac{}{}` parser. **That recommendation was wrong for this goal
and was withdrawn.** A hand-rolled subset is extensible only in the trivial
sense — a fourth construct is easy — but it never reaches "any math," and
shipping it is worse than shipping nothing: it creates a second math language
inside a codebase whose premise is one contract, and every derivation document
then needs migrating off it later. "Any math" means a real engine.

## 2. Scope

**In:**

- Real TeX rendering for `derivation.steps[].expression` and
  `derivation.conclusion`.
- One engine boundary (`renderMath`) with two adapters, so the engine is
  swappable without touching call sites.
- A demo comparison route rendering the same expressions through both engines.
- Prompt-contract, theme, README, and ROADMAP updates.

**Out (YAGNI, each its own cycle):**

- **Math in prose fields** (`note`, text bodies, captions, quiz stems). The
  `renderMath` boundary makes this a later `$-delimiter` pass in
  `renderInline`; it must not be built speculatively inside this cycle.
- **Display math and `\begin{align}`.** Wrong shape for a single-line step
  list.
- **Engine selection as a public option.** Hosts do not choose in v1.
- **Caching rendered math.** Deterministic output makes it a pure function;
  memoization is premature.
- **A new `math` block type.** `derivation` already has the right shape.
- **Fixing the strict-mode inconsistency in §7.** Documented, not fixed here.

## 3. Decisions (from brainstorm, 2026-10-03)

| # | Decision | Rationale |
| --- | --- | --- |
| 1 | Real TeX engine, not a hand-rolled subset | Only an engine reaches "any math"; a subset becomes a migration |
| 2 | Temml default, KaTeX available behind the same boundary | Temml emits MathML: no font packaging, and it themes via tokens for free |
| 3 | Both engines ship, demoed side by side | MathML fidelity is only answerable in a browser; the user decides, not the docs |
| 4 | `expression` + `conclusion` are TeX; `note` stays prose | One coherent rule. Two fields sharing a path must not mean different things |
| 5 | Extend `derivation`; no new block type | Avoids making the model choose a surface, and duplicates nothing |
| 6 | Failure → escaped literal + warning, never engine error markup | Repo convention: degrade loudly, never silently wrong |

### Engine choice: measured facts

Verified 2026-10-03 from vendor docs and npm:

| | KaTeX | Temml |
| --- | --- | --- |
| Latest version | 0.19.0 (Aug 2026) | 0.13.5 (~Sept 2026) |
| Maintained | Yes | Yes |
| Own dependencies | none | none |
| SSR | `renderToString`, identical output server or browser | Node, pure conversion |
| Fonts | **Required** — "the fonts/ directory must stay alongside the CSS file" | **None** — native MathML |
| Lineage | reference implementation | fork of KaTeX, HTML renderer removed |

**Why Temml is the default, specific to this library:**

1. **Theming.** KaTeX bakes colors into its own CSS, so formulas must be
   overridden to obey `--exp-*` tokens. MathML inherits the surrounding font and
   color natively. A library whose pitch is "styleable HTML" gets themed math
   for free.
2. **No font packaging.** Otherwise ~60 font files must be shipped or CDN'd,
   and the fonts-must-sit-next-to-the-CSS constraint is exactly the kind of trap
   that breaks a self-contained theme package.
3. **Coverage.** Temml is a KaTeX fork that kept the parser and dropped the HTML
   renderer, so construct coverage is close to KaTeX's by lineage.

**KaTeX's honest advantage:** it is more battle-tested. MathML Core rendering
fidelity varies by browser, and Safari's MathML history is the weak spot. That
is precisely why decision 3 puts both engines in the demo.

**This changes a binding project decision.** ROADMAP's "Decisions That Bind
Future Work" says dependency-free, "new deps need a strong case." This *is* the
strong case, so the rule is satisfied rather than broken — but README's
"Dependency-minimal: `zod` and `roughjs`" becomes three, and ROADMAP's wording
should become "dependency-minimal" for accuracy. Both are updated in this cycle.

## 4. Public Surface

```ts
// src/core/math.ts — NOT re-exported from src/index.ts in v1
export function renderMath(tex: string): string
```

Pure, synchronous, no `RenderContext`, no options. Returns HTML, or the escaped
literal source when the input does not parse (§7).

**Deliberately not exported.** Hosts get no engine switch in v1; the seam is an
internal detail that exists to keep a future swap contained. `renderMath` is
internal to the library rather than a supported host API, and the export list
is deliberately unchanged.

**No new block type, no schema change, no `RenderContext` field.** The
`derivation` block schema is untouched — `expression` and `conclusion` are
already `z.string()`.

## 5. Engine boundary

```
renderMath(tex)
  └─ engine adapter (internal)
       ├─ temml adapter  — default, runtime dep
       └─ katex adapter  — devDep, demo comparison only
```

The adapter contract: input TeX string in, HTML string out, throw on parse
failure (the caller in §7 owns degradation). No shared state, no async.

**Dependencies:** `temml` moves to `dependencies`. `katex` is added as a
**devDependency** — it is not on any shipped code path, which keeps the runtime
promise honest.

**Reversibility is the point.** If Temml's output disappoints, swapping to
KaTeX is one module and one dependency line, because no call site knows which
engine ran.

## 6. Security — the load-bearing requirement

Model-authored TeX is **untrusted input**, and this feature is the first place
the library stops being escape-only and starts *parsing a language* before
rendering. The invariant "model text never becomes markup" still holds — the
output is the engine's own, not the model's — but the mechanism changes from
"escape everything" to "parse under a vetted engine, then constrain." That is a
meaningful change to the security posture and must be earned, not assumed.

**Requirement:** the boundary must not be able to emit a link, URL, image, or
script from TeX. Model text must never be able to produce a navigable or
executable artifact.

- KaTeX's reference behaviour is `trust: false`, which disables `\href`,
  `\url`, `\includegraphics`, `\htmlClass` and friends. Equivalent must be
  verified for Temml.
- **This is unverified for Temml and is the first implementation task.** If
  Temml will render `\href` — including a `javascript:` href — then that
  construct is disabled or its output rejected before it can reach the DOM.
- Corpus for the hostile check must include `\href`, `\url`, `\includegraphics`,
  `\htmlClass`, `\htmlId`, `\def`/`\let` macro abuse, and a raw `<script>` and
  `onerror=` payload embedded in TeX.

**`rafter-secure-design` is required before implementation**, per its trigger
list (untrusted input). Its answers are recorded in this document and the PR
description, not left implicit.

Related, unchanged: the no-scheme-allowlist judgement call on `src`
(`docs/OPEN_THREADS.md` #3) applies to images and is unaffected here. Math
emits no `src`.

## 7. Degradation & errors

| Input | Behavior |
| --- | --- |
| Valid TeX | Engine HTML, inline |
| Parse failure | **Escaped literal source** + `ctx.addWarning("[math] …")` |
| Host `strict: true` | No effect — see below |

Never the engine's own error rendering: KaTeX's red-on-pink error markup would
leak engine-specific DOM into a themed document, and Temml has no equivalent,
so the two engines would degrade differently. The literal-plus-warning path is
identical for both.

**`strict` does not gate this, and an earlier draft of this spec said it did.**
That claim was wrong. Verified during implementation:

- `src/core/render.ts` throws on top-level validation **diagnostics**.
- `src/core/renderDocument.ts` throws on **document- and section-level**
  diagnostics — and its gate runs *before* any block renders, so block
  rendering (which is what collects `ctx.addWarning`) happens after it.

So a render-time warning — a `[math]` failure, or any primitive's — never
trips `strict` in either entry point. Both degrade and report in `warnings`.
The two entry points are consistent here; the earlier "asymmetry" was an
inference from seeing two different arrays checked, not an observable
difference.

Whether `strict` *should* gate render-time degradation is a real open question
— a host asking for strict may reasonably expect "no degradation at all" —
but changing it is a library-wide semantic change, out of scope for math
typesetting. It is recorded in `docs/OPEN_THREADS.md`.

## 8. Theming, CSS & the `<code>` wrapper

No font files ship; that is the reason for decision 2.

- `tokens.css` gains `--exp-math-font`, defaulting to the body font stack, so a
  host can point formulas at a math-capable face without forking the theme.
- A `math` element rule sets `font-size: 1em` and inherits color. Styling the
  element directly avoids inventing new `exp-*` classes, which
  `tests/themes.test.ts` requires to have rules.
- Both engines must be legible in the light and dark themes; the demo is where
  that is checked, by eye.

**The `<code>` wrapper must change.** `expression` currently renders as
`<code class="exp-derivation-expr">`, and `<code>` is semantically *source
text*. Once the field is rendered mathematics it is output, not source, so
wrapping rendered math in `<code>` is wrong — it tells assistive tech the
formula is code to be read literally, and invites a monospace font that renders
math badly.

The `exp-derivation-expr` class is kept (the existing rule at
`src/themes/tokens.css:204` still applies); the element changes to a
non-semantic wrapper appropriate to rendered output. Consequences:

- `tests/concept-cause-derivation.test.ts:49` pins the exact
  `<code class="exp-derivation-expr">` markup and **must be updated in the
  same commit** as the primitive — the same one-commit rule that applies to
  schema + `BLOCK_TYPE_DOCS` + registration for a new block type.
- The same test's fixture expression is `a**2 + b**2`, which is literal text
  today. In TeX, `*` is a binary operator, so it renders as `a * * 2 + b * * 2`.
  That is the clearest single illustration of why the rendered-output diff
  against `main` (§11) is mandatory rather than a formality: an existing
  fixture changes appearance without any test failing.

## 9. Model contract & upgrade cost

The `derivation` line in `BLOCK_TYPE_DOCS` becomes explicit, because the model
cannot infer it:

```
- derivation: { steps: [{ expression, note? }], conclusion? } — equation/argument
  steps. `expression` and `conclusion` are TeX; `note` is prose. TeX spans the
  whole field — no $ delimiters. Keep each expression on one line.
```

**This changes the section system prompt for every host on upgrade, catalog or
not.** `BLOCK_TYPE_DOCS` is interpolated unconditionally, so no flag can
prevent the cost — exactly as the `image` block's upgrade note recorded. The
README carries the same upgrade note. Verified: `tests/llm.test.ts` asserts
block types are *present* in the contract, not its wording, so editing an
existing line breaks no pinned string.

## 10. Demo

A `/math` route rendering one shared corpus through both engines, side by side,
so the MathML-fidelity question is answered by looking rather than by reading
vendor docs. Plus a `derivation` block in `demoDocIr` using real TeX, and the
comparison must be legible in both themes.

## 11. Testing & Verification

- **Both engines**, one shared corpus: fractions, sub/superscript, greek,
  `\sqrt`, limits, a matrix, and a multi-term expression.
- **Degradation:** malformed TeX → escaped literal + warning; the literal
  contains no unescaped `<`.
- **Strict:** `renderDocument` + `strict` throws on a math warning (§7).
- **Determinism:** identical input twice → byte-identical output.
- **Security (§6):** no `href`, `url(`, `<script`, or `on*=` across the hostile
  corpus, for both engines.
- **No packaging:** output contains no font declarations and no external
  references — this is what proves the no-fonts claim rather than asserting it.
- **Both engines are exercised in the shipped test suite**, so a future engine
  swap cannot silently drop coverage for the one that is no longer default.
- **Diff rendered output against `main`:** existing derivation fixtures change
  by design. The diff is inspected, not assumed.

## 12. Risks

| Risk | Mitigation |
| --- | --- |
| MathML fidelity is worse than KaTeX in real browsers | Both engines in the demo; the boundary makes the swap one module |
| Temml is a much smaller project than KaTeX and may stall | Same seam; KaTeX adapter already written by decision 3 |
| TeX in `conclusion` mangles prose (space collapsing, `_`/`^`/`&` special) | Explicit contract line; failure degrades loudly rather than rendering wrong |
| Engine emits links from model TeX | §6 is a blocking requirement, verified empirically first |
| Prompt change for every host | Documented upgrade note, as with `image` |
| A second math syntax arrives later (e.g. AsciiMath) | The boundary is syntax-agnostic; adapters are per-engine |

## 13. To verify empirically, before the rest of the work

1. **Does Temml render `\href`?** Blocking — see §6.
2. **Does Temml's construct coverage meet the corpus in §11?** If it fails
   badly, revisit decision 2 before building on it.
3. **Side-by-side visual fidelity in light and dark themes.** The demo's
   purpose; resolved by the user looking, not by assertion.
