# Inline math in prose — Design

Status: **draft, awaiting review**
Date: 2026-10-04
Closes: `docs/ROADMAP.md` "Next up" item 1 — the last item in the backlog.

## 1. Problem & Goal

`renderMath` exists and is safe, but only `derivation` blocks reach it. Everywhere
else — `text`, `concept`, `worked-example`, `callout`, `step-list`, `quiz`,
`comparison`, `cause-effect`, `timeline`, chart captions, figure titles and
captions, document titles and summaries — a formula can only be written as prose
or as a code span. That is exactly where an explanation actually needs one:
"the **learning rate** $\eta$ controls the step size" is the sentence a reader
needs typeset, and today it renders as literal dollar signs.

Goal: a formula can live inside any prose field, typeset by the same engine and
under the same security argument as `derivation`.

## 2. Scope

**In.** `\(…\)` and gated `$…$` in `renderInline`. Warnings on unparseable TeX.
Theming. LLM prompt + README. Demo coverage.

**Out.** Display-mode (`$$…$$`) centering — the other gap the math cycle named,
still parked. A host-facing switch to disable inline math (noted in §11). Any
new block type: this adds no primitives, so the README `## Block types` list and
the `N primitives` count do not change.

## 3. Where it goes, and the one hard problem

`renderInline` is the chokepoint for all model prose — 40 call sites across 22
primitives, `render.ts`, `renderDocument.ts` and 5 React components. That is a
feature: one implementation, no per-primitive opt-in, no drift.

Its current pipeline is:

```
split code spans → escapeHtml → **bold** → *italic* → [label](href)
```

Math cannot simply be another regex in that chain. Math content must **not** be
HTML-escaped (Temml output is HTML), and emphasis/link regexes must not run
inside it. The naive fix — extract math spans, then escape each remaining
fragment — breaks any emphasis or link that spans a math boundary:

```
**bold $x$ term**     →  fragments "**bold " and " term**" pair with nothing
[the $x$ term](url)   →  the <math> gets escaped into visible tag soup
```

**Decision: placeholder substitution.** Replace each math span in the raw text
with a sentinel *before* escaping; run the existing pipeline untouched over the
text containing sentinels; substitute the rendered MathML back at the end.
Emphasis and links then pair across math boundaries correctly, and math inside a
link *label* works.

The sentinel is `\u0000` + `EXP_MATH_<n>` + `\u0000`. To make the sentinel space
provably disjoint from input, `renderInline` strips `\u0000` from its argument
first. This is a deliberate, tiny behaviour change beyond math: NUL is not
representable in XML and browsers mangle it, so removing it from emitted markup
is a hardening win on its own. `safeHref` already strips `\u0000-\u0020` from
URLs, so this is consistent with existing posture rather than new policy.

## 4. Delimiters — the part that actually needed measuring

`$…$` appears literally in prose. I probed what a naive scanner does with real
sentences by running the candidate content through Temml:

| prose | naive `$…$` capture | Temml result |
|---|---|---|
| `It costs $5 and returns $10.` | ` and returns` | `<math>` of variables — **silently wrong** |
| `Set $HOME and $PATH` | `OME and` | silently wrong |
| `Revenue was $5M, up from $4M.` | `M, up from` | silently wrong |

This is the worst failure class available: no warning, no degradation, output
that looks intentional. Worse, open thread 2 already records that **prose is
valid TeX** — a run of letters parses as variables with zero warnings — so the
existing `mathOrLiteral` degradation structurally cannot catch it. Any dollar
scanner is a silent-corruption engine unless it is gated.

So two delimiters, with different rules.

### `\(…\)` — honored unconditionally

Backslash-paren does not occur in English prose, so there is no collision to
design against. Matched non-greedily with `(?:\\[\s\S]|[^\\])*?` so TeX
commands containing backslashes are captured — the naive `[^\\]*?` silently
fails on `\(\frac{a}{b}\)`, which is a bug I hit while probing this.

Rejected only when empty (`\(\)`). Otherwise passed to `renderMath`.

### `$…$` — honored only when it plausibly is math

Four gates, all of which must pass:

1. non-empty;
2. no whitespace adjacent to either delimiter (Pandoc);
3. the closing `$` is not followed by a digit (Pandoc) — kills `$5 and $10`;
4. **plausibility**, which is the load-bearing one:
   - contains a **strong** TeX signal — one of `\ ^ _ { } = < >`; **or**
   - is a *tight symbolic expression*: no whitespace **and** at least one
     letter or backslash — this is what admits `f(x)` and `a+b`.

Gate 4's two arms are both necessary. Strong signals alone reject `f(x)`.
The tight-expression arm alone accepts `5-` from `costs $5-$3`, because `-`
looks like an operator — requiring a letter is what rejects arithmetic
accidents while keeping symbolic ones.

Everything that fails a gate is **left as literal text**, byte-identical to
today's output. A false negative is therefore not a degradation: it is the
status quo. The gate is tuned deliberately toward false negatives because prose
is the ambient case here, while math is opt-in.

**Known false negatives, accepted:** `$a + b$` (whitespace, no strong signal),
`$5$`, `$42$`. The escape hatch is `\(…\)`, which has no gate. This is stated
in the README and in the LLM prompt so models prefer `\(…\)` for anything
non-trivial.

**No `\$` escape.** Gates make it unnecessary, and a backslash escape in prose
would collide with Windows paths and TeX's own `\$`. Rejected on the evidence,
not overlooked.

### Measured before designing

- 27/27 hand-built scanner cases behave as specified, including all eight
  currency/shell/regex sentences above.
- **410 strings** across `demo/examples.js`, `README.md` and `docs/ROADMAP.md`:
  2 contain `$` (both are HTML shell fragments in the demo template, not prose
  fields), and **0 become math**. The real corpus is unaffected.

## 5. Interaction with the existing pipeline

Three orderings are load-bearing:

1. **Code spans first, as today.** `` `$x$` `` inside backticks never reaches
   the math scanner. Already true; pinned by a test because it is the cheapest
   possible escape hatch and the most likely thing to break.
2. **Math before links, with an explicit guard.** A math candidate whose span
   falls inside a `LINK_RE` match is skipped. Without this,
   `[x](http://a/$y$)` puts a sentinel in an href; `safeHref` strips the
   sentinel's `\u0000` and emits a silently corrupted `http://a/EXP_MATH_0`.
   The guard is three lines and turns a silent corruption into a literal `$`.
   Math inside a link *label* still works — that path is the point of §3.
3. **Escape → emphasis → links → substitute.** Unchanged from today except for
   the final substitution step.

## 6. Security — re-derived, not carried over

The math spec's argument was "safe by construction: Temml implements none of
`\href`, `\url`, `\includegraphics`, `\htmlClass`, `\htmlId`". Inline parsing is
a **second context**, so I re-ran the probes rather than citing them.

Re-confirmed by direct probe: `\href`, `\url`, `\includegraphics`, `\htmlClass`,
`\htmlId`, `\class`, `\cssId`, `\style`, `\raw`, and `\annotation-xml` all
**throw** `ParseError`. `\text{<script>alert(1)</script>}` parses and emits
`&lt;script&gt;` inside `<mtext>`. So the construction argument holds in the
inline context.

But it holds *too easily*, which is the problem. Every dangerous construct
throws, so a test that only feeds dangerous constructs asserts nothing: a
boundary that returned its input unchanged would pass. That is not hypothetical —
this repo's existing security test was written after it passed vacuously against
three broken stubs. So the inline boundary gets **positive** assertions:

- **Attribute-value whitelist.** For a hostile corpus, every attribute value in
  Temml output must match `/^[-#\w\s:.,%()]*$/`. Probing showed Temml emits only
  *computed* values (`style="padding-left:5.9776pt"`, `fence="true"`,
  `lspace="0em"`) and fixed class names; hostile content lands in `<mtext>`/`<mi>`
  and is escaped. This assertion would catch any future engine change that moves
  text into an attribute — the one leak route the construction argument does
  not cover.
- **Tags-are-MathML-only.** The tag set of any rendered span must be a subset of
  the MathML element names plus the `span` wrapper.
- **Injection corpus that parses.** Payloads smuggled via `\text{}`, so the
  assertions actually execute.
- **End-to-end.** Hostile math inside a full `renderInline` sentence must produce
  no `<script`, `<img`, `<a href="javascript:`, or `on…=` handler anywhere in
  the output — checked against the real sink, not the engine.

Two residual notes, both judged acceptable:

- `\text{$}` **throws** (Temml treats a bare `$` as a math delimiter). Inside
  inline math, a bare `$` therefore degrades to literal + warning rather than
  rendering. `\$` works inside math.
- TeX in prose may still be *semantically* wrong while parsing cleanly — that
  is open thread 2, unchanged, and not made worse.

## 7. Degradation

An unparseable math span renders as **the source text, literally**, plus a
warning `[math] not TeX — left as literal: <detail>`:

- Matches `renderInline`'s existing philosophy: unmatched `*` and `[` already
  render literally.
- Reads better mid-sentence than the derivation path's monospace warning chip,
  which suits a formula on its own line but looks broken inside a paragraph.
- Rides the existing `onWarning` / `failOnWarning` channel, so a strict host
  gets the signal with no extra wiring.

Non-`MathParseError` exceptions still propagate — the same narrow the
`mathOrLiteral` code already uses.

## 8. Plumbing warnings

`renderInline(text: string, ctx?: { addWarning(m: string): void })`. `ctx` is
optional because `RenderContext` is a full interface that the React adapter does
not have at these call sites.

- **22 primitives + `render.ts`** — `ctx` is already in scope as the
  `BlockRenderer` second parameter. Mechanical.
- **`renderDocument.ts`** — `warnings` is in scope at the title/summary/section
  sites; `renderToc` needs it threaded in as a parameter.
- **React `Explanation.tsx` / `Document.tsx`** — a `warnings` array is in scope;
  pass it.
- **React `Quiz.tsx`, `InteractiveFigure.tsx`, `ElementPopover.tsx`** — no
  warnings sink exists at these sites (`Quiz.tsx` already discards block
  warnings wholesale). They pass no `ctx` and degrade silently. Recorded as an
  open thread rather than fixed here: widening the React warning surface is a
  separate change from adding inline math.

## 9. Theming

`.exp math` today is `font-size: 1.2em; math-style: normal` — correct for a
derivation step, wrong for prose. Inline math at 1.2em would render `$x$` at
19.2px inside 16px body text and bump every line box; `math-style: normal` gives
full-size fractions where compact inline layout is the convention.

So inline math is wrapped in `<span class="exp-math-inline">` and gets:

```css
.exp-math-inline math { font-size: 1em; math-style: compact; }
```

The wrapper is explicit rather than a positional selector (`.exp p math`) so it
works in headings, table cells, list items and captions alike, and gives hosts a
hook. This **resolves open thread 3** (`--exp-math-size` being
context-dependent): the token stays for display math, inline gets its own rule.

## 10. Model contract

`prompts.ts:86` currently instructs "no LaTeX delimiters" — that line becomes
wrong the moment this ships and must change in the same commit. New text: inline
math uses `\(…\)`, or `$…$` for simple expressions; prose dollar amounts need no
escaping.

`renderMath` stays unexported from `src/index.ts`. `renderInline` is already
public, and it now degrades rather than throwing — so the host gets the feature
without an unguarded TeX emitter or a Temml dependency in their upgrade path.

## 11. Risks & parked

- **Gate false negatives** — measured, listed in §4, mitigated by `\(…\)`.
- **No host switch to disable inline math.** `renderInline` is public, and a
  host whose prose is full of `$` may want the old behaviour. Deliberately not
  added: it would be a third parameter on a function with 40 call sites, and no
  one has asked for it. Revisit if it is asked for.
- **React warning gaps** — §8.
- **Regex complexity.** The scanner is one alternation plus two small gates.
  Kept in `inline.ts` with the rest of the inline grammar rather than a new
  module, since it is the same grammar.

## 12. Testing & verification

- Scanner table: the 27 cases from §4 as data, including every currency, shell
  and regex sentence.
- Corpus regression: assert the demo fixtures render **byte-identical** before
  and after, except for strings deliberately given math.
- Code-span: `` `$x$` `` and `` `a $ b $ c` `` stay literal.
- Emphasis/link spanning math: `**bold $x$ term**`, `[the $x$ term](url)`.
- Link-target guard: `[x](http://a/$y$)` keeps a literal `$` in the href.
- Security: §6's positive assertions, including the attribute-value whitelist
  and the end-to-end sink check.
- Determinism: identical input, byte-identical output.
- Degradation: unparseable TeX → literal + exactly one warning;
  `failOnWarning` throws.
- Rendered-output diff against the baseline, per the standard gate.
- `npx tsc --noEmit` and `npm test` green.

## 13. Docs & demo, in the feature commit

- README: a short "Inline math" note next to the existing inline-grammar
  description — delimiters, the gate, and that no escape is needed for dollar
  amounts. No change to `## Block types` or the primitives count.
- ROADMAP: "Next up" item 1 → SHIPPED, with the gate summarized.
- `docs/OPEN_THREADS.md`: React sites with no warnings sink.
- `docs/DEBUGGING.md`: a Part 1 triage bullet for "a `$…$` scanner without a
  plausibility gate silently corrupts prose", since the symptom — correct-looking
  output with a formula where a price should be — is very hard to spot.
- Demo: a worked example or concept whose prose carries real inline math,
  including at least one sentence with a literal `$` next to one with math, so
  the gate is visible on the page rather than only in tests.
