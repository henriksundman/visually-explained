# Inline Math in Prose — Implementation Plan

Spec: `docs/superpowers/specs/2026-10-04-inline-math-in-prose-design.md`
Branch: `feat/inline-math`, off `73e5ad9` (main).
Baseline for the rendered-output diff: **`73e5ad9`**.

## Global Constraints

- Execute inline, in-session. No CLI subagents.
- One commit per task. `npx tsc --noEmit` and `npm test` green at every task
  boundary.
- The rendered-output diff (§ Task 6) is a **gate**, not a report.
- Every new test must be verified to **bite**: run it against the pre-change
  code and confirm RED. A test that passes before the change is either
  mis-specified or pinning nothing.
- Do not widen scope when a rough edge appears. Record it in ROADMAP Backlog
  and move on — that is what the tb cycle did.

### Verified engine facts (probed 2026-10-04 — do not re-derive)

`displayMode: false` already emits a bare `<math>`; **no wrapper element is
needed** for an inline context.

All of `\href`, `\url`, `\includegraphics`, `\htmlClass`, `\htmlId`, `\class`,
`\cssId`, `\style`, `\raw`, `\annotation-xml` **throw** `ParseError`.
`\text{<script>…</script>}` parses and emits `&lt;script&gt;` in `<mtext>`.

Temml emits only **computed** attribute values (`style="padding-left:5.9776pt"`,
`fence="true"`, `lspace="0em"`) and fixed class names. Hostile text lands in
`<mtext>`/`<mi>` and is escaped. This is the basis of the attribute-value
whitelist assertion in Task 4.

`\text{$}` **throws** — Temml treats a bare `$` as a delimiter. `\$` is the
in-math escape.

Prose parses as valid TeX with zero warnings (`"5 and "` → 4 `<mi>`). This is
open thread 2 and is why `$…$` needs a gate rather than a parse check.

---

## Task 1 — The boundary: scanner, gate, placeholder, degradation

All in `src/core/inline.ts`. This is the whole feature; later tasks are
plumbing, theming and proof.

**1. `renderInline(text: string, ctx?: { addWarning(m: string): void })`.**

**2. Strip `\u0000` from `text` first.** The placeholder sentinel is
`\u0000` + `EXP_MATH_<n>` + `\u0000`; stripping NUL from input makes the
sentinel space provably disjoint from anything the caller can supply.

**3. The scanner.** One alternation, run on the raw text of each non-code part
(after the existing code-span split, so `` `$x$` `` is already safe):

```
/\\\((?:\\[\s\S]|[^\\])*?\\\)|\$([^$\n]*?)\$/g
```

The `(?:\\[\s\S]|[^\\])*?` arm is **required** — `[^\\]*?` silently fails on
`\(\frac{a}{b}\)`. I hit this while probing; do not "simplify" it back.

Group 1 `undefined` ⇒ `\(…\)` match; otherwise a `$…$` candidate.

**4. `$…$` gates** — all four, else left literal:
- non-empty;
- no whitespace adjacent to either delimiter;
- closing `$` not followed by a digit;
- plausibility: contains `\ ^ _ { } = < >` **OR** (no whitespace AND at least
  one letter or backslash).

**5. Skip any candidate inside a `LINK_RE` match.** Otherwise
`[x](http://a/$y$)` puts a sentinel in an href and `safeHref` — which strips
`\u0000-\u0020` — silently emits `http://a/EXP_MATH_0`. Math inside a link
*label* must still work.

**6. Substitute placeholders**, then run the **existing** pipeline unchanged
(escape → `**` → `*` → links), then substitute the rendered MathML back wrapped
as `<span class="exp-math-inline">…</span>`.

**7. Degradation** (`spec §7`): unparseable TeX ⇒ the **original source text**,
escaped and in place, plus `ctx?.addWarning("[math] not TeX — left as
literal: " + detail)`. Non-`MathParseError` rethrows, mirroring
`mathOrLiteral`. No `<code class="exp-math-literal">` here — see spec §7.

**Tests** — new `tests/inline-math.test.ts`:
- the 27-case scanner table from spec §4 as data;
- code span: `` `$x$` ``, `` `a $ b $ c` `` stay literal;
- emphasis spanning math: `**bold $x$ term**` is one `<strong>`;
- link label: `[the $x$ term](https://ex.com)` keeps the math;
- link target: `[x](https://ex.com/$y$)` keeps a literal `$` in the href;
- degradation: literal output + exactly one warning; `failOnWarning` throws;
- determinism: identical input ⇒ byte-identical output.

**Verification**
```bash
npx tsc --noEmit && npm test
git stash                       # NOT valid on a clean tree — see below
```
Bite check: run the new suite against `73e5ad9` in a detached worktree; the 27
cases and the degradation tests must be RED or missing there.

> **Trap, hit twice already:** `git stash` on a clean tree is a no-op and
> silently measures HEAD twice. Use
> `git checkout 73e5ad9 -- src/core/inline.ts` or a detached worktree.

---

## Task 2 — Plumbing warnings to the boundary

Mechanical, but it is the task most likely to be done *inconsistently*, so it
gets its own commit and its own completeness check.

- **22 primitives + `src/core/render.ts`** — `ctx` is already in scope as the
  `BlockRenderer` second parameter. Pass it as `renderInline(x, ctx)`.
- **`src/core/renderDocument.ts`** — `warnings` is in scope at the title /
  summary / section-title sites; `renderToc` needs it threaded in as a
  parameter.
- **React `Explanation.tsx` / `Document.tsx`** — a `warnings` array is in
  scope; pass `{ addWarning: m => warnings.push(m) }`.
- **React `Quiz.tsx` / `InteractiveFigure.tsx` / `ElementPopover.tsx`** — pass
  nothing. There is no warnings sink at these sites (`Quiz.tsx` already
  discards block warnings wholesale). Recorded as an open thread in Task 5,
  **not** fixed here.

**Tests**: assert the plumbing by sweeping the demo fixtures — every block
whose prose contains unparseable TeX must contribute a warning, and the
count must match between the string renderer and React where React has a sink.
A silent miss here is invisible otherwise.

**Verification**
```bash
npx tsc --noEmit && npm test
grep -rn "renderInline(" src/ | grep -v "ctx" | grep -v "^src/core/inline.ts"
```
The remaining hits must be **only** the three React components named above.

---

## Task 3 — Theming

`src/themes/tokens.css`, after the existing `.exp math` rule:

```css
/* Inline math is prose, not a display formula: 1.2em would bump every line
   box, and math-style: normal gives full-size fractions where compact is the
   inline convention. The wrapper is explicit rather than positional so it
   works in headings, table cells, list items and captions alike. */
.exp-math-inline math {
  font-size: 1em;
  math-style: compact;
}
```

This resolves open thread 3. `--exp-math-size` stays for display math.

**Tests**: assert the rule exists and targets `.exp-math-inline math` — plus a
`tokens.test.ts`-style presence check if that file has a convention for it.
Rendering correctness is Task 6's job.

**Verification**
```bash
npx tsc --noEmit && npm test
```

---

## Task 4 — The security suite gets positive assertions

`tests/math.test.ts`. The existing construction argument is true but tests too
easily: every dangerous construct throws, so a boundary that returned its
input unchanged would pass. That is not hypothetical — this file was written
after it passed vacuously against three broken stubs.

Add, over a hostile corpus:

- **Attribute-value whitelist** — every attribute value must match
  `/^[-#\w\s:.,%()]*$/`. Catches any future engine change that moves text into
  an attribute: the one leak route "Temml implements no `\href`" does not cover.
- **Tags are MathML-only** — the tag set of any rendered inline span is a
  subset of the MathML element names plus `span`.
- **End-to-end at the real sink** — hostile math inside a full `renderInline`
  sentence produces no `<script`, `<img`, `<a href="javascript:`, or `on…=`
  anywhere in the output.

Keep the existing negative-only cases; they are cheap and they pin the
construction argument.

**Verification**
```bash
npx tsc --noEmit && npm test
```
Bite check: the attribute whitelist must go RED if fed a hand-written
`<mi style="background:url(javascript:alert(1))">`.

---

## Task 5 — Model contract, demo, docs

All in one commit — the README travels with the feature.

- **`src/compiler/prompts.ts:86`** — "no LaTeX delimiters" becomes **wrong** the
  moment this ships. Replace with: inline math uses `\(…\)`, or `$…$` for
  simple expressions; a dollar amount in prose needs no escaping.
- **`demo/examples.js`** — a `worked-example` or `concept` whose prose carries
  real inline math, **including a sentence with a literal `$` next to one with
  math**, so the gate is visible on the page and not only in tests. Add a
  comment saying the fixture is shaped on purpose.
- **`README.md`** — an "Inline math" note beside the existing inline-grammar
  description: both delimiters, the gate, no escape needed for dollar amounts,
  and that a rejected `$…$` is left literal by design. **No change to
  `## Block types` or the `N primitives` count** — this adds no primitives.
  `tests/readme.test.ts` must stay green, which is the proof of both.
- **`docs/ROADMAP.md`** — "Next up" item 1 → SHIPPED, gate summarized.
- **`docs/OPEN_THREADS.md`** — React sites with no warnings sink.
- **`docs/DEBUGGING.md`** — Part 1 triage bullet ("a `$…$` scanner without a
  plausibility gate silently corrupts prose") plus a dated Part 2 entry
  (symptom → root cause → fix → rule).

**Verification**
```bash
npx tsc --noEmit && npm test
npm run build && launchctl remove explanations-demo 2>/dev/null; launchctl submit -l explanations-demo -- "$(command -v node)" "$PWD/demo/server.mjs"
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4173/
```

---

## Task 6 — Full verification gate

1. `npx tsc --noEmit`
2. `npm test`
3. `npm run build`
4. **Rendered-output diff vs `73e5ad9`** — the gate:
   ```bash
   npm run build
   git worktree remove --force /tmp/vn-base 2>/dev/null || true
   git worktree add --detach /tmp/vn-base 73e5ad9
   ln -s "$PWD/node_modules" /tmp/vn-base/node_modules
   (cd /tmp/vn-base && npm run build)
   node .superpowers/render-fixtures.mjs "$PWD/dist" /tmp/after.txt
   (cd /tmp/vn-base && node "$OLDPWD/.superpowers/render-fixtures.mjs" "$PWD/dist" /tmp/before.txt)
   diff /tmp/before.txt /tmp/after.txt
   ```
   **Expected:** every difference is inside a block this cycle deliberately
   gave math, or inside a `<span class="exp-math-inline">`. No other block
   moves a byte. Note that this cycle legitimately changes existing fixtures
   (unlike the last two) because the LLM prompt changed — so the diff is
   checked block by block, not waved through.

   Normalisation warning: the tb cycle's regex was over-broad and also stripped
   `<rect>` attributes present on *both* sides. Target only the new
   `<span class="exp-math-inline">` when normalising.
5. **Real Chrome, via CDP** — the only reliable measurement; a 200 says
   nothing about rendering:
   - inline math at **1em** beside 16px body prose (not 1.2em — that is the
     whole point of Task 3);
   - a `\(\frac{a}{b}\)` sits compact, not display-sized;
   - the literal-`$` sentence in the demo shows literal `$`;
   - **0 uncaught exceptions**, **0 elements overflowing** their container.
6. 6/6 demo routes 200 on the rebuilt dist.

---

## Task 7 — Fresh-eyes review, then the merge gate

Re-read the implementation against the spec with no memory of writing it.
Specifically: is any gate arm redundant; does any new regex have a
backtracking blowup on adversarial input (`((((((`, `$a$a$a$a$`, a 10k-char
sentence); is the NUL strip load-bearing or superstition; does the link-target
guard cover `](` with no `)`, and nested brackets.

Then **stop and present** — demo URL, what to look at, diff stat — and merge to
`main` only on explicit go-ahead. Keep the branch until then.

---

## Branch finish

Ledger line to `.superpowers/sdd/progress.md` recording: the silent-corruption
finding and why the gate exists, the measured corpus result, the false
negatives accepted, the React warnings gap, and push state.
