# Math Typesetting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Note for this repo:** `AGENTS.md` forbids dispatching subagents via external CLIs. Execute inline in-session, keeping the quality gates: per-task commits, the verification commands below with their expected output, and a fresh-eyes review pass against the spec before calling the cycle done.

**Goal:** `derivation` expressions and conclusions render as real TeX, via a swappable engine whose default emits MathML so formulas theme through existing tokens and ship no font files.

**Architecture:** One boundary, `renderMath(tex)` in `src/core/math.ts`, wrapping Temml (TeX→MathML Core). It throws on invalid TeX and the caller owns degradation, so engine error markup never reaches the DOM. KaTeX is a devDependency used only by the demo's comparison route and the parity tests, keeping it off every shipped code path. The seam exists so a future engine swap is one module.

**Tech Stack:** TypeScript, zod, vitest, tsup. New: `temml` (runtime), `katex` (dev only).

**Spec:** `docs/superpowers/specs/2026-10-03-math-typesetting-design.md`

## Global Constraints

- `expression` and `conclusion` are TeX. `note` stays prose (`renderInline`). No `$` delimiters — the whole field is already TeX.
- `renderMath` is **internal**: not re-exported from `src/index.ts`. No public engine switch.
- Invalid TeX → escaped literal source + `ctx.addWarning`. **Never** engine error markup. Under `renderDocument` + `strict: true` the warning throws (spec §7); do not change `strict` semantics.
- Runtime deps become `zod`, `roughjs`, `temml`. `katex` is a devDependency and must never appear in `src/`.
- Editing the `derivation` line in `BLOCK_TYPE_DOCS` changes the section system prompt for every host. README carries the upgrade note.
- Every new `exp-*` class needs a rule in `src/themes/tokens.css` (`tests/themes.test.ts` fails otherwise).
- No new `exp-*` class without a CSS rule; no raw HTML from model text; no unescaped user text anywhere.

### Verified engine facts (probed 2026-10-03 — do not re-derive)

| Fact | Consequence |
| --- | --- |
| `temml` exports **only a default object**; `renderToString` is on it | `import temml from "temml"` — there are **no named exports** |
| `temml.ParseError` reachable only as `temml.ParseError`; has `.position` | `e instanceof temml.ParseError` |
| Temml throws `ParseError` on `\href`, `\url`, `\includegraphics`, `\htmlClass`, `\htmlId`, `\def`-abuse | These constructs cannot exist in output at all |
| `\text{<script>…}` yields `&lt;script&gt;` — escaped **text** | A test asserting "output has no `onerror`" would be **wrong**; the invariant is tag/attribute-shaped |
| `displayMode: true` changes output | Pass `displayMode: false` explicitly |
| Temml output has no `font-family`, no external refs | The no-fonts claim is measured, not assumed |
| KaTeX with `trust: false` renders `\href`/`\url` **inertly** rather than throwing | Parity tests must assert "no navigable/executable output", not "throws" |
| KaTeX `throwOnError: false` emits `<span class="katex-error">` | Confirms spec §7's ban on engine error markup |
| KaTeX ships **60 font files** + `katex.min.css` in `dist/` | The demo must serve both or the KaTeX column renders wrong |

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/core/math.ts` | **Create.** The engine boundary. Owns the Temml adapter, `renderMath`, `MathParseError`. |
| `src/primitives/derivation.ts` | **Modify.** Routes `expression`/`conclusion` through `renderMath`; owns degradation. |
| `src/core/blockTypes.ts` | **Modify.** `derivation` line in `BLOCK_TYPE_DOCS` states the TeX rule. |
| `src/themes/tokens.css` | **Modify.** `--exp-math-font` token, `math` element rule, `.exp-math-literal`. |
| `demo/mathEngines.js` | **Create.** KaTeX adapter for the comparison route (dev-only dep lives here, not `src/`). |
| `demo/mathCorpus.js` | **Create.** The shared expression corpus both engines render. |
| `demo/server.mjs` | **Modify.** `/math` route; serves `katex.min.css` + the fonts directory. |
| `demo/examples.js` | **Modify.** A derivation block with real TeX. |
| `README.md` | **Modify.** TeX surface, upgrade note, dependency line. |
| `docs/ROADMAP.md` | **Modify.** Backlog item → shipped; "dependency-free" → "dependency-minimal". |
| `docs/OPEN_THREADS.md` | **Modify.** Record the inherited `strict` asymmetry (spec §7). |
| `tests/math.test.ts` | **Create.** Security, coverage, determinism, packaging. |
| `tests/math-parity.test.ts` | **Create.** Both engines over the shared corpus. |
| `tests/concept-cause-derivation.test.ts` | **Modify.** Pins the old `<code>` markup — must land with Task 2. |

---

### Task 1: The engine boundary and its security suite

**Files:**
- Create: `src/core/math.ts`
- Create: `tests/math.test.ts`
- Modify: `package.json` (dependencies + devDependencies)

**Interfaces:**
- Consumes: nothing.
- Produces: `renderMath(tex: string): string` and `const MathParseError: typeof temml.ParseError` from `src/core/math.ts`. Task 2 consumes both.

- [ ] **Step 1: Declare the dependencies**

Run:

```bash
npm install temml@^0.13.5 && npm install --save-dev katex@^0.19.0
```

Expected: `package.json` shows `temml` under `dependencies`, `katex` under `devDependencies`, install exits 0.

- [ ] **Step 2: Write the failing test**

Create `tests/math.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { renderMath, MathParseError } from "../src/core/math"

/** Tags the engine may emit. Anything else means model text escaped into
 *  markup. Text content is entity-escaped by the engine (`<` → `&lt;`), so a
 *  `<` inside model text cannot match the tag regexes below — which is the
 *  whole reason these assertions are tag-shaped rather than substring-shaped. */
const ALLOWED_TAGS = new Set([
  "math", "mrow", "mi", "mn", "mo", "mtext", "mspace", "mfrac", "msqrt", "mroot",
  "msup", "msub", "msubsup", "munder", "mover", "munderover", "mtable", "mtr",
  "mtd", "mlabeledtr", "mstyle", "mpadded", "mphantom", "menclose", "merror",
  "mstyle", "semantics", "annotation",
])

/** Attributes that could navigate, fetch, or execute. */
const FORBIDDEN_ATTRS = new Set(["href", "src", "xlink:href", "style", "srcdoc", "formaction"])

const HOSTILE_TEX: ReadonlyArray<readonly [string, string]> = [
  ["href-js", String.raw`\href{javascript:alert(1)}{click}`],
  ["href-https", String.raw`\href{https://evil.example}{click}`],
  ["url", String.raw`\url{https://evil.example}`],
  ["includegraphics", String.raw`\includegraphics{https://evil.example/x.png}`],
  ["htmlClass", String.raw`\htmlClass{evil}{x}`],
  ["htmlId", String.raw`\htmlId{evil}{x}`],
  ["def-abuse", String.raw`\def\evil{\href{javascript:alert(1)}{x}}\evil`],
]

const COVERAGE_TEX: ReadonlyArray<readonly [string, string, string]> = [
  ["frac", String.raw`\frac{a+b}{c}`, "mfrac"],
  ["sup", String.raw`x^{2n}`, "msup"],
  ["sub", String.raw`a_{ij}`, "msub"],
  ["subsup", String.raw`x_i^2`, "msubsup"],
  ["sqrt", String.raw`\sqrt{x^2+y^2}`, "msqrt"],
  ["greek", String.raw`\theta = \pi/4`, "mi"],
  ["sum", String.raw`\sum_{i=1}^{n} i`, "msubsup"],
  ["int", String.raw`\int_0^1 f(x)\,dx`, "msubsup"],
  ["matrix", String.raw`\begin{pmatrix} a & b \\ c & d \end{pmatrix}`, "mtable"],
  ["accent", String.raw`\hat{x} + \bar{y}`, "mover"],
]

function tagsIn(html: string): string[] {
  return [...html.matchAll(/<\/?\s*([a-zA-Z][a-zA-Z0-9-]*)/g)].map((m) => m[1].toLowerCase())
}

/** Attribute names, read from inside real tags only — never from text nodes. */
function attrsInTags(html: string): string[] {
  const attrs: string[] = []
  for (const m of html.matchAll(/<([a-zA-Z][a-zA-Z0-9-]*)((?:\s[^<>]*?)?)\/?>/g)) {
    for (const a of m[2].matchAll(/\s([a-zA-Z-]+)\s*=/g)) attrs.push(a[1].toLowerCase())
  }
  return attrs
}

describe("renderMath security", () => {
  it("emits no navigable or executable artifact from hostile TeX", () => {
    for (const [name, tex] of HOSTILE_TEX) {
      let out: string
      try {
        out = renderMath(tex)
      } catch {
        continue // rejected outright — nothing reaches the DOM
      }
      // If it rendered at all, it must still be inert MathML.
      for (const tag of tagsIn(out)) {
        expect(ALLOWED_TAGS.has(tag), `${name}: disallowed <${tag}> in output`).toBe(true)
      }
      for (const attr of attrsInTags(out)) {
        const isHandler = attr.startsWith("on")
        expect(
          isHandler || FORBIDDEN_ATTRS.has(attr),
          `${name}: forbidden attribute "${attr}"`,
        ).toBe(false)
      }
    }
  })

  it("escapes angle brackets in model text rather than emitting elements", () => {
    const out = renderMath(String.raw`\text{<script>alert(1)</script>}`)
    expect(out).not.toContain("<script")
    expect(out).toContain("&lt;script&gt;")
    // The payload survives as readable text, which is correct — it is content.
    expect(tagsIn(out).every((t) => ALLOWED_TAGS.has(t))).toBe(true)
  })
})

describe("renderMath coverage", () => {
  it.each(COVERAGE_TEX)("renders %s", (_name, tex, element) => {
    expect(renderMath(tex)).toContain(`<${element}`)
  })
})

describe("renderMath errors", () => {
  it("throws MathParseError on unterminated input", () => {
    expect(() => renderMath(String.raw`\frac{1`)).toThrow(MathParseError)
  })

  it("throws on an unknown control sequence", () => {
    expect(() => renderMath(String.raw`\unknowncmd{x}`)).toThrow(MathParseError)
  })

  it("throws on display-only constructs used inline", () => {
    expect(() => renderMath(String.raw`\begin{align} a &= b \end{align}`)).toThrow(MathParseError)
  })

  it("reports a parse position for the warning message", () => {
    try {
      renderMath(String.raw`\frac{1`)
      expect.unreachable("should have thrown")
    } catch (e) {
      expect(e).toBeInstanceOf(MathParseError)
      expect(typeof (e as { position?: unknown }).position).toBe("number")
    }
  })
})

describe("renderMath determinism", () => {
  it("returns byte-identical output for identical input", () => {
    const tex = String.raw`\sum_{i=1}^{n} \frac{1}{i^2} = \frac{\pi^2}{6}`
    expect(renderMath(tex)).toBe(renderMath(tex))
  })
})

describe("renderMath packaging", () => {
  it("emits no font declaration and no external reference", () => {
    const out = renderMath(String.raw`\frac{a}{b}`)
    expect(out).not.toMatch(/font-family/i)
    expect(out).not.toMatch(/url\s*\(/i)
    expect(out).not.toMatch(/https?:\/\//i)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/math.test.ts`

Expected: FAIL — `Failed to resolve import "../src/core/math"`.

- [ ] **Step 4: Write the boundary**

Create `src/core/math.ts`:

```ts
import temml from "temml"

/**
 * Render TeX to inline HTML for `derivation` expressions and conclusions
 * (math spec §4).
 *
 * Internal by design: not re-exported from `src/index.ts`. An exported raw TeX
 * renderer would hand hosts a throwing, unguarded HTML emitter outside the
 * leniency wrapper, and would export our engine choice into their upgrade path
 * (MathML needs no assets; KaTeX needs 60 font files).
 *
 * Throws `MathParseError` on invalid TeX. Degradation belongs to the caller
 * (spec §7) — never return engine error markup, because the two engines
 * degrade differently and that difference would leak into themed output.
 *
 * Safe by construction: Temml implements none of `\href`, `\url`,
 * `\includegraphics`, `\htmlClass` or `\htmlId`, so model-authored TeX cannot
 * produce a link, URL, image, or script. Pinned per construct in
 * `tests/math.test.ts` — re-run that suite before trusting any engine upgrade.
 */
export function renderMath(tex: string): string {
  return temml.renderToString(tex, { throwOnError: true, displayMode: false })
}

/** The parse failure `renderMath` throws, re-exported so callers can narrow
 *  without importing temml themselves. */
export const MathParseError = temml.ParseError
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/math.test.ts`

Expected: PASS, 20 tests (security 2, coverage 10 via `it.each`, errors 4, determinism 1, packaging 1).

- [ ] **Step 6: Verify the security suite can actually fail**

A green security test proves nothing until it is shown to catch a leak. Temporarily replace the body of `renderMath` with `return temml.renderToString(tex, { throwOnError: false })` — `throwOnError: false` renders errors inline instead of throwing — and additionally stub the boundary to return raw input:

```ts
export function renderMath(tex: string): string {
  return tex // deliberately unsafe
}
```

Run: `npx vitest run tests/math.test.ts`

Expected: FAIL on `emits no navigable or executable artifact from hostile TeX` and on `escapes angle brackets…`. Then restore the real implementation and confirm PASS. **Do not commit the stub.**

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/core/math.ts tests/math.test.ts
git commit -m "add the math engine boundary and pin what model TeX cannot emit

TeX is the first place this library parses a language rather than only
escaping, so the boundary is specified by what it refuses: Temml
implements no \href, \url, \includegraphics, \htmlClass or \htmlId, so
model-authored TeX cannot become a link, URL, image or script.

The security assertions are tag- and attribute-shaped, not substring
checks, because the engine escapes angle brackets in \text{...} — a test
asserting the output lacks 'onerror' would fail on inert escaped text and
teach the next engineer the wrong invariant.

katex is a devDependency only, so it never reaches a shipped path."
```

---

### Task 2: Render derivation through the boundary

**Files:**
- Modify: `src/primitives/derivation.ts`
- Modify: `src/themes/tokens.css` (`--exp-math-font`, `math` rule, `.exp-math-literal`)
- Modify: `tests/concept-cause-derivation.test.ts`

**Interfaces:**
- Consumes: `renderMath`, `MathParseError` from `src/core/math.ts` (Task 1).
- Produces: `renderDerivation` now takes a **used** `ctx` (was `_ctx`). No exported signature changes.

- [ ] **Step 1: Write the failing test**

In `tests/concept-cause-derivation.test.ts`, replace the two pinned assertions at lines 49 and 51 and add a degradation case:

```ts
  it("renders expression and conclusion as TeX", () => {
    const html = renderExplanation({
      version: 1,
      blocks: [
        {
          type: "derivation",
          steps: [{ expression: String.raw`\frac{a}{b}`, note: "Pythagoras" }],
          conclusion: String.raw`c^2 = a^2 + b^2`,
        },
      ],
    }).html
    expect(html).toContain("<mfrac>")
    expect(html).not.toContain("<code class=\"exp-derivation-expr\">")
    expect(html).toContain('class="exp-derivation-note">Pythagoras')
  })

  it("degrades malformed TeX to the escaped literal plus a warning", () => {
    const { html, warnings } = renderExplanation({
      version: 1,
      blocks: [{ type: "derivation", steps: [{ expression: String.raw`\frac{1` }] }],
    })
    expect(html).toContain("<code class=\"exp-math-literal\">\\frac{1</code>")
    expect(warnings.some((w) => w.startsWith("[math]"))).toBe(true)
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/concept-cause-derivation.test.ts`

Expected: FAIL — no `<mfrac>` in output (expression is still escaped text).

- [ ] **Step 3: Wire the primitive**

Replace the body of `src/primitives/derivation.ts`:

```ts
import { registerPrimitive, type RenderContext } from "../core/registry"
import { derivationBlockSchema, type DerivationBlock } from "../core/schema"
import { escapeHtml, renderInline } from "../core/inline"
import { renderMath, MathParseError } from "../core/math"

/** Render one TeX field. A parse failure degrades to the escaped literal
 *  source plus a warning (spec §7) — never the engine's own error markup,
 *  which differs per engine and would leak into themed output. The fallback
 *  keeps `<code>` because at that point the text genuinely IS source. */
function mathOrLiteral(tex: string, ctx: RenderContext): string {
  try {
    return renderMath(tex)
  } catch (e) {
    if (!(e instanceof MathParseError)) throw e
    const detail = String((e as { message?: string }).message ?? e).slice(0, 120)
    ctx.addWarning(`[math] not TeX — rendered as literal text: ${detail}`)
    return `<code class="exp-math-literal">${escapeHtml(tex)}</code>`
  }
}

export function renderDerivation(block: DerivationBlock, ctx: RenderContext): string {
  const steps = block.steps
    .map((s) => {
      const expression = mathOrLiteral(s.expression, ctx)
      return (
        `<li class="exp-derivation-step">` +
        // Rendered math is output, not source: <code> told assistive tech the
        // formula was literal code and pulled in a monospace face that renders
        // math badly. The class is kept so existing theme rules still apply.
        `<span class="exp-derivation-expr">${expression}</span>` +
        (s.note ? `<p class="exp-derivation-note">${renderInline(s.note)}</p>` : "") +
        `</li>`
      )
    })
    .join("")
  const conclusion = block.conclusion
    ? `<p class="exp-derivation-conclusion">${mathOrLiteral(block.conclusion, ctx)}</p>`
    : ""
  return `<div class="exp-block exp-derivation"><ol class="exp-derivation-steps">${steps}</ol>${conclusion}</div>`
}

registerPrimitive("derivation", { schema: derivationBlockSchema, render: renderDerivation })
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/concept-cause-derivation.test.ts`

Expected: PASS, including the two pre-existing tests whose pinned markup you replaced in Step 1.

- [ ] **Step 5: Confirm strict-mode behaviour matches spec §7**

Add to `tests/concept-cause-derivation.test.ts`:

```ts
  it("throws under renderDocument + strict when TeX fails to parse", () => {
    expect(() =>
      renderDocument(
        {
          version: 1,
          title: "D",
          sections: [
            { title: "S", blocks: [{ type: "derivation", steps: [{ expression: String.raw`\frac{1` }] }] },
          ],
        },
        { strict: true },
      ),
    ).toThrow(/\[math\]/)
  })
```

Run: `npx vitest run tests/concept-cause-derivation.test.ts`

Expected: PASS. If it does **not** throw, stop: `renderDocument`'s strict branch (`src/core/renderDocument.ts:100`) has changed and spec §7 needs revisiting before continuing.

- [ ] **Step 6: Add the theme tokens and rules**

In `src/themes/tokens.css`, add to the `/* shape & type */` block inside `.exp`, after `--exp-mono`:

```css
  /* Math formulas render as MathML, so they need no shipped font files — this
     is only a preference order for faces a host may already have. */
  --exp-math-font: "Cambria Math", "STIX Two Math", "Latin Modern Math", var(--exp-font);
```

Replace the `.exp-derivation-expr` rule with:

```css
.exp-derivation-expr {
  font-family: var(--exp-math-font);
  background: var(--exp-surface-muted);
  border-radius: var(--exp-radius-sm);
  padding: 2px 8px;
  display: inline-block;
}

/* MathML inherits the surrounding font and color, which is why Temml is the
   default engine — a formula themes through the token above with no override. */
.exp-derivation-expr math,
.exp-derivation-conclusion math {
  font-size: 1.05em;
}

/* The degraded path: unparseable TeX shown as the literal source it is. */
.exp-math-literal {
  font-family: var(--exp-mono);
  font-size: 0.92em;
  color: var(--exp-warning);
}
```

- [ ] **Step 7: Run the theme gate**

Run: `npx vitest run tests/themes.test.ts`

Expected: PASS — `.exp-math-literal` has a rule, so the "every `exp-*` class is styled" check is satisfied.

- [ ] **Step 8: Commit**

```bash
git add src/primitives/derivation.ts src/themes/tokens.css tests/concept-cause-derivation.test.ts
git commit -m "render derivation expressions and conclusions as TeX

Malformed TeX degrades to the escaped literal plus a [math] warning,
never the engine's error markup: KaTeX emits span.katex-error and Temml
has no equivalent, so sharing the path would make degradation
engine-dependent. The fallback keeps <code> because at that point the
text genuinely is source.

Drops <code> around the rendered expression. Rendered math is output, not
source, and <code> both told assistive tech the formula was literal and
pulled in a monospace face that renders math badly. The class is kept so
existing theme rules still apply.

Adds --exp-math-font: MathML needs no shipped font files, so this is only
a preference order for faces a host already has."
```

---

### Task 3: Tell the model the rule

**Files:**
- Modify: `src/core/blockTypes.ts`
- Test: `tests/math-contract.test.ts` (create)

**Interfaces:**
- Consumes: nothing from Tasks 1–2 (contract text is independent).
- Produces: the `derivation` line in `BLOCK_TYPE_DOCS`.

- [ ] **Step 1: Write the failing test**

Create `tests/math-contract.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { BLOCK_TYPE_DOCS, systemPromptSnippet } from "../src/core/llm"

describe("derivation contract", () => {
  const line = BLOCK_TYPE_DOCS.split("\n").find((l) => l.startsWith("- derivation:"))

  it("exists", () => {
    expect(line).toBeDefined()
  })

  it("states that expression and conclusion are TeX and note is prose", () => {
    expect(line).toMatch(/expression/)
    expect(line).toMatch(/conclusion/)
    expect(line).toMatch(/TeX/)
    expect(line).toMatch(/note/)
    expect(line).toMatch(/prose|no \$/i)
  })

  it("warns against $ delimiters, since the whole field is already TeX", () => {
    expect(line).toMatch(/delimiter/i)
  })

  it("reaches the section system prompt", () => {
    // toContain, not toBe: systemPromptSnippet (5439 chars) wraps the block-type
    // docs (4309 chars) with additional instruction text.
    expect(systemPromptSnippet).toContain(BLOCK_TYPE_DOCS)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/math-contract.test.ts`

Expected: FAIL on `states that expression and conclusion are TeX…` — the current line says only `{ steps: [{ expression, note? }], conclusion? } — equation/argument steps.`

- [ ] **Step 3: Rewrite the contract line**

In `src/core/blockTypes.ts`, replace the `- derivation:` line with:

```
- derivation: { steps: [{ expression, note? }], conclusion? } — equation/argument steps. `expression` and `conclusion` are TeX and span the whole field — no $ delimiters, no wrapping; `note` is prose.
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/math-contract.test.ts`

Expected: PASS, 4 tests.

- [ ] **Step 5: Run the prompt suites**

Run: `npx vitest run tests/llm.test.ts tests/compiler-prompts.test.ts tests/image-compiler.test.ts`

Expected: PASS. These assert block types are *present* in the contract, not its wording, so editing an existing line breaks nothing. If any fail on an exact-string assertion, that assertion is pinned to the old wording — update it in this commit rather than reverting the contract.

- [ ] **Step 6: Commit**

```bash
git add src/core/blockTypes.ts tests/math-contract.test.ts
git commit -m "state the TeX rule in the derivation block contract

The model cannot infer that two fields sharing a rendering path mean
different things, and an unstated rule is an unusable one. This edits a
line that is interpolated into the section system prompt unconditionally,
so it changes that prompt for every host on upgrade — the same
unconditional cost the image block's upgrade note recorded."
```

---

### Task 4: The two-engine comparison, and a real formula in the demo

**Files:**
- Create: `demo/mathCorpus.js`
- Create: `demo/mathEngines.js`
- Create: `tests/math-parity.test.ts`
- Modify: `demo/server.mjs`
- Modify: `demo/examples.js`

**Interfaces:**
- Consumes: `renderMath` (Task 1) for the Temml column; `katex` directly for the KaTeX column.
- Produces: `demo/mathCorpus.js` exporting `MATH_CORPUS`; `demo/mathEngines.js` exporting `renderWithKaTeX(tex)` and `safeRender(fn, tex)`.

- [ ] **Step 1: Create the shared corpus**

Create `demo/mathCorpus.js`:

```js
/** One corpus, both engines. These are the constructs a derivation actually
 *  needs; the parity test and the /math route both read this list, so the demo
 *  can never drift from what the tests cover. */
export const MATH_CORPUS = [
  { tex: String.raw`\frac{a+b}{c}`, note: "fraction" },
  { tex: String.raw`\frac{\pi^2}{6} = \sum_{i=1}^{\infty} \frac{1}{i^2}`, note: "sum + limits" },
  { tex: String.raw`x^{2n} = (x^2)^n`, note: "superscript" },
  { tex: String.raw`a_{ij} + b_{ij}`, note: "subscript" },
  { tex: String.raw`\sqrt{x^2 + y^2}`, note: "radical" },
  { tex: String.raw`\theta = \pi/4`, note: "greek" },
  { tex: String.raw`\int_0^1 x^2\,dx = \frac{1}{3}`, note: "integral" },
  { tex: String.raw`\hat{y} = \beta_0 + \beta_1 x`, note: "accent" },
  { tex: String.raw`\begin{pmatrix} a & b \\ c & d \end{pmatrix}`, note: "matrix" },
  { tex: String.raw`\frac{1}{`, note: "malformed — degrades" },
]
```

- [ ] **Step 2: Create the KaTeX adapter (dev-only dependency stays out of src/)**

Create `demo/mathEngines.js`:

```js
// The comparison engine. `katex` is a devDependency and this file lives in the
// demo, so it is never reachable from a shipped path — see spec §5.
import katex from "katex"
import temml from "temml"

/** KaTeX with trust disabled. Note the divergence from Temml: KaTeX renders
 *  \href and \url *inertly* rather than rejecting them, so "safe" here means
 *  "produced no navigable output", not "threw". */
export function renderWithKaTeX(tex) {
  try {
    return katex.renderToString(tex, { throwOnError: true, trust: false, displayMode: false })
  } catch (e) {
    return { error: String(e.message).split("\n")[0].slice(0, 120) }
  }
}

export function renderWithTemml(tex) {
  try {
    return temml.renderToString(tex, { throwOnError: true, displayMode: false })
  } catch (e) {
    return { error: String(e.message).split("\n")[0].slice(0, 120) }
  }
}
```

- [ ] **Step 3: Write the parity test**

Create `tests/math-parity.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { renderMath, MathParseError } from "../src/core/math"
import { renderWithKaTeX } from "../demo/mathEngines"
// @ts-expect-error — demo/ is plain JS, not part of the tsc program
import { MATH_CORPUS } from "../demo/mathCorpus"

/** Runs the shipped boundary and the comparison engine over one corpus and
 *  returns both outcomes, so a test can assert about either. */
function both(tex: string): { temml?: string; temmlError?: string; katex?: string; katexError?: string } {
  const out: ReturnType<typeof both> = {}
  try {
    out.temml = renderMath(tex)
  } catch (e) {
    expect(e).toBeInstanceOf(MathParseError)
    out.temmlError = "parse-error"
  }
  const k = renderWithKaTeX(tex)
  if (typeof k === "string") out.katex = k
  else out.katexError = k.error
  return out
}

describe("engine parity over the shared corpus", () => {
  it.each(MATH_CORPUS.filter((c) => !c.note.startsWith("malformed")))(
    "renders $note with both engines",
    ({ tex }) => {
      const r = both(tex)
      expect(r.temmlError, `temml failed on ${tex}`).toBeUndefined()
      expect(r.katexError, `katex failed on ${tex}`).toBeUndefined()
      expect(r.temml).toContain("<math")
      expect(r.katex).toContain("katex")
    },
  )

  it("agrees that malformed TeX fails on both engines", () => {
    const bad = MATH_CORPUS.find((c) => c.note.startsWith("malformed"))!
    const r = both(bad.tex)
    expect(r.temmlError).toBe("parse-error")
    expect(r.katexError).toBeDefined()
  })

  it("keeps KaTeX output free of navigable attributes on hostile TeX", () => {
    // KaTeX neutralises rather than rejects, so assert the invariant, not a throw.
    for (const tex of [String.raw`\href{javascript:alert(1)}{x}`, String.raw`\url{https://evil.example}`]) {
      const out = renderWithKaTeX(tex)
      if (typeof out !== "string") continue
      expect(out).not.toMatch(/href\s*=/i)
      expect(out).not.toMatch(/javascript:/i)
    }
  })
})
```

- [ ] **Step 4: Run the parity test**

Run: `npx vitest run tests/math-parity.test.ts`

Expected: PASS — 9 constructs, 1 malformed-agreement, 1 hostile-KaTeX.

- [ ] **Step 5: Add the `/math` route**

In `demo/server.mjs`, add the import at the top:

```js
import { MATH_CORPUS } from "./mathCorpus.js"
import { renderWithKaTeX, renderWithTemml } from "./mathEngines.js"
```

Add this route before the final 404 fallback:

```js
  if (url.pathname === "/math") {
    // The comparison the spec exists for: MathML fidelity is only answerable
    // in a browser, so both engines render the same corpus side by side and the
    // user picks. KaTeX needs its stylesheet AND its 60 font files served, or
    // its column silently renders unstyled — hence the routes below.
    const rows = MATH_CORPUS.map(({ tex, note }) => {
      const cell = (r) =>
        typeof r === "string"
          ? `<td class="exp">${r}</td>`
          : `<td class="exp"><code class="exp-math-literal">degraded: ${escapeForPage(r.error)}</code></td>`
      return `<tr><th>${escapeForPage(note)}<br><code>${escapeForPage(tex)}</code></th>${cell(renderWithTemml(tex))}${cell(renderWithKaTeX(tex))}</tr>`
    }).join("")
    const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>explanations — math engines</title>
<link rel="stylesheet" href="/themes/tokens.css">
<link rel="stylesheet" href="/themes/light.css">
<link rel="stylesheet" href="/katex/katex.min.css">
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 60rem; padding: 0 1rem; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; vertical-align: top; padding: 8px 10px; border-top: 1px solid #e5e7eb; }
  th { width: 22%; font-weight: 500; }
  code { font-size: 0.85em; color: #5c6470; }
</style>
</head>
<body>
<p><a href="/">← all examples</a> · <a href="/document">Document page →</a></p>
<h1>Math engines, side by side</h1>
<p>Left column: Temml (TeX→MathML, the shipped default — no fonts, themes by token).
Right column: KaTeX (<code>trust: false</code> — needs its CSS and 60 font files, both served here).
Same corpus, same expressions. The malformed row degrades identically in both.</p>
<table>
<thead><tr><th>Expression</th><th>Temml (MathML)</th><th>KaTeX (HTML+CSS)</th></tr></thead>
<tbody>${rows}</tbody>
</table>
</body>
</html>`
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end(page)
    return
  }
  if (url.pathname.startsWith("/katex/")) {
    try {
      const rel = url.pathname.slice("/katex/".length)
      const body = await readFile(new URL(`../node_modules/katex/dist/${rel}`, import.meta.url))
      // katex.min.css references woff2, woff and ttf; the content type has to
      // follow the extension or the browser rejects the font.
      const ext = rel.slice(rel.lastIndexOf(".") + 1)
      const type = { css: "text/css", woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf" }[ext]
      if (!type) {
        res.writeHead(404, { "content-type": "text/plain" })
        res.end("not found")
        return
      }
      res.writeHead(200, { "content-type": type })
      res.end(body)
    } catch {
      res.writeHead(404, { "content-type": "text/plain" })
      res.end("not found")
    }
    return
  }
```

And add this helper near the top of the file, after `section`:

```js
function escapeForPage(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}
```

- [ ] **Step 6: Put real TeX in the document demo**

In `demo/examples.js`, find the derivation block in `educationIr` and replace its expression and conclusion with real TeX. Keep the note as prose so both paths are visible in one block:

```js
      {
        type: "derivation",
        steps: [
          { expression: String.raw`a^2 + b^2 = c^2`, note: "Pythagoras, restated in symbols." },
          { expression: String.raw`\frac{a}{b} = \frac{ca}{cb}`, note: "Scaling both sides leaves the ratio." },
        ],
        conclusion: String.raw`\therefore\ c = \sqrt{a^2 + b^2}`,
      },
```

- [ ] **Step 7: Rebuild and verify the demo in a real browser**

```bash
npm run build
launchctl submit -l explanations-demo -- "$(command -v node)" "$PWD/demo/server.mjs"
```

Then, from a **separate** tool call:

```bash
curl -s -o /dev/null -w "math:%{http_code}\n" http://localhost:4173/math
curl -s -o /dev/null -w "katexcss:%{http_code} %{content_type}\n" http://localhost:4173/katex/katex.min.css
curl -s -o /dev/null -w "font:%{http_code} %{content_type}\n" http://localhost:4173/katex/fonts/KaTeX_Main-Regular.woff2
curl -s -o /dev/null -w "document:%{http_code}\n" http://localhost:4173/document
```

Expected: `math:200`, `katexcss:200 text/css`, `font:200 font/woff2`, `document:200`. A 404 on the font means the KaTeX column is rendering unstyled — fix the route before continuing.

**Open `http://localhost:4173/math` and look at both columns.** This is the spec's §13 item 3 and it cannot be asserted in a test. Record in the PR description which engine you prefer for the default.

- [ ] **Step 8: Commit**

```bash
git add demo/mathCorpus.js demo/mathEngines.js demo/server.mjs demo/examples.js tests/math-parity.test.ts
git commit -m "demo both math engines over one shared corpus

MathML fidelity is only answerable in a browser, so the comparison ships
as a route rather than as a claim in a spec. Both columns read the same
corpus the parity test reads, so the demo cannot drift from coverage.

katex stays a devDependency and its adapter lives in demo/, so it is
unreachable from any shipped path. Its column needs katex.min.css plus 60
font files served; without them it renders unstyled and looks like a
math bug rather than a missing asset."
```

---

### Task 5: Docs and full verification

**Files:**
- Modify: `README.md`, `docs/ROADMAP.md`, `docs/OPEN_THREADS.md`

**Interfaces:** none consumed; produces the host-facing record.

- [ ] **Step 1: Update the README**

Four edits, all in the same commit as the code per the AGENTS.md docs rule:

1. In the Principles list, change the dependency bullet to:
   `**Dependency-minimal.** Runtime deps are \`zod\`, \`roughjs\`, and \`temml\` (math only). React ≥ 18 is a peer dependency of \`explanations/react\` only.`
2. In the `## Block types` list, extend the Pedagogy entry's description of `derivation` — it currently has none — with `(TeX expressions; see below)`.
3. Add a `### Math` subsection after `### Images`, containing: which fields are TeX and which are prose, that `alt`-style pre-validation has no analogue here, that malformed TeX degrades to the literal source plus a `[math]` warning, that `strict` makes that warning throw under `renderDocument`, and that no font files ship because the default engine emits MathML.
4. Add the upgrade note:

```markdown
> **Upgrade note:** `derivation`'s `expression` and `conclusion` are now TeX,
> and its `BLOCK_TYPE_DOCS` line changed — so the compile *system* prompt
> changes for every host on upgrade, catalog or not. Documents authored before
> this release keep rendering: unparseable TeX degrades to the literal source
> with a `[math]` warning rather than failing. But prose that happens to sit in
> `conclusion` (a bare `&`, an unpaired `_`) will now be read as TeX and degrade
> visibly. Audit `conclusion` values before upgrading.
```

- [ ] **Step 2: Update the ROADMAP**

Move the backlog item to Shipped with today's date, and in "Decisions That Bind Future Work" replace `**Dependency-free.**` with `**Dependency-minimal.**` plus one line: `One runtime dep beyond zod/roughjs: temml, for TeX. The rule is a strong case, not a blanket ban — a hand-rolled math subset would have needed migrating off later.`

- [ ] **Step 3: Record the inherited strict asymmetry**

Append to `docs/OPEN_THREADS.md` as a new numbered thread (renumber the rest):

```markdown
## N. `strict` means different things in the two entry points

`src/core/render.ts` throws on **diagnostics**; `src/core/renderDocument.ts`
throws on **warnings**. So any warning-emitting degradation — including a
malformed-TeX `[math]` warning — throws under `renderDocument` + `strict` but
not under `renderExplanation` + `strict`. This predates math typesetting, which
merely made it observable.

**Revisit if** `strict` is next touched. The question is whether a host asking
for `strict` wants "no diagnostics" or "no degradation at all"; the two
entry points currently answer differently.
```

- [ ] **Step 4: Run the full gate**

```bash
npx tsc --noEmit && npm test 2>&1 | tail -6 && npm run build 2>&1 | tail -4
```

Expected: tsc clean; **all** tests pass (472 before this cycle, plus the new
`math`, `math-parity`, and `math-contract` files — 3 new files, ~26 new tests);
build reports success for both entries.

- [ ] **Step 5: Diff rendered output against `main`**

This step is mandatory and is the reason the existing fixture is a liability —
`a**2 + b**2` renders as `a ∗ ∗ 2` in TeX with no test failing. Inspect, do not assume:

```bash
node -e '
const { renderExplanation } = require("./dist/index.cjs");
const ir = { version: 1, blocks: [{ type: "derivation", steps: [{ expression: "a**2 + b**2", note: "n" }], conclusion: "c**2 = a**2 + b**2" }] };
console.log(renderExplanation(ir).html);
'
```

Expected: `<span class="exp-derivation-expr">` with `<math>` inside, and a
literal `<` absent from the expression position. Read the output and confirm
the change is the intended one. If any fixture's prose now lands in a TeX
field, fix the fixture in this cycle — not later.

- [ ] **Step 6: Verify the README drift tests still pass**

Run: `npx vitest run tests/readme.test.ts`

Expected: PASS. The primitive count stays **18** — no block type was added — so
no count bump is needed. If it fails, the README is what is wrong.

- [ ] **Step 7: Commit**

```bash
git add README.md docs/ROADMAP.md docs/OPEN_THREADS.md
git commit -m "document the TeX surfaces, the dependency, and the upgrade cost

The upgrade note is the honest part: derivation's conclusion field was
free text and is now TeX, so a document whose conclusion contains a bare
& or an unpaired _ will degrade visibly after upgrade. Hosts need to know
that before they bump, not after.

Also records the strict asymmetry this feature inherited rather than
quietly inheriting it."
```

---

## Branch finish

- [ ] Full gate green (Task 5 Step 4) and the rendered-output diff read, not assumed (Step 5).
- [ ] `/math` inspected in a real browser and an engine preference recorded (Task 4 Step 7).
- [ ] Append the "Branch finished" line to `.superpowers/sdd/progress.md` — it is gitignored, so `git add` will reject it; that is expected.
- [ ] Present to the user. **Merge to `main` only on explicit go-ahead** (AGENTS.md merge gate). Keep the branch until then.
- [ ] If debugging surfaced a reusable lesson, append a dated entry to `docs/DEBUGGING.md`.
