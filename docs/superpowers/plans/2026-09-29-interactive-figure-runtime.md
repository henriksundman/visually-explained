# Interactive Figure Runtime — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Environment note:** this session has no subagent-dispatch tool; execute inline with the same gates (task brief → failing tests → implement → verify → commit → review diff → ledger at `.superpowers/sdd/progress.md`).

**Goal:** Ship `<InteractiveFigure>` — themed param sliders plus a play sweep over an author-chosen param — consuming the shipped figure format unchanged, with a memoized expression parser making per-tick recompiles cheap.

**Architecture:** A bounded AST cache inside `expr.ts` (parse once per unique string, evaluate many times) removes the per-tick parse cost; the runtime component clones the authored figure with current param values and calls the existing pure `compileFigure` → `sceneToSvg` (identical SVG emitter, sketch included). `Explanation` routes figure blocks to the component only when `interactive` is set (default off → RSC-safe). One additive IR field, `sweep`, lets the LLM name the param play should animate.

**Tech Stack:** React 19 (existing peer dep), vitest + `renderToStaticMarkup`, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-29-interactive-figure-runtime-design.md`

**Test-location deviation (deliberate):** the spec names `tests/react/*` files; the repo convention is a flat `tests/` dir with one React file (`tests/react.test.tsx`). This plan extends that file with new `describe` blocks instead — coverage is identical.

## Global Constraints

- Dependency-free: no new packages; `package.json` untouched. (`react`, `react-dom` devDeps + peer already present.)
- Lenient salvage everywhere: bad elements drop individually; all-drop renders the empty state; a render never throws.
- Deterministic SSR: component initial render is synchronous from `block` alone; server HTML = client hydration.
- `interactive` defaults to false; without it, `<Explanation>` output is byte-identical to today.
- `sweep` is schema-validated as an identifier (`^[A-Za-z_][A-Za-z0-9_]*$`) — model text can only reach `aria-label` if it is a bare identifier; unknown names fall back to `params[0]` silently at runtime.
- No public core API changes; `explanations/react` gains `InteractiveFigure` (+ `nextSweepValue`).
- AST cache is bounded (clear at 1000 entries) — never unbounded on adversarial input.
- Commands: `npx vitest run <file>`, `npm test`, `npm run typecheck`, `npm run build`; ledger `.superpowers/sdd/progress.md`.

---

### Task 1: Memoized expression parser

**Files:**
- Modify: `src/figures/expr.ts` (`parseExpr` only)
- Test: `tests/figures/expr.test.ts` (append a `describe` block)

**Interfaces:**
- Consumes: existing `parseExpr`/`evalExpr`/`evaluate` (signatures unchanged).
- Produces: memoized `parseExpr` — same `ExprAst` object for the same string; transparent to all callers.

- [ ] **Step 1: Write the failing tests**

Append to `tests/figures/expr.test.ts`:

```ts
describe("AST memoization", () => {
  it("returns the same AST object for repeated parses of the same string", () => {
    expect(parseExpr("1 + 2 * t")).toBe(parseExpr("1 + 2 * t"))
  })

  it("parses distinct strings to distinct ASTs", () => {
    expect(parseExpr("1 + 2")).not.toBe(parseExpr("1 + 3"))
  })

  it("clears the cache at the cap instead of growing unbounded", () => {
    const first = parseExpr("7 * 7")
    for (let i = 0; i < 1000; i++) parseExpr(`${i} + t${i}`)
    const second = parseExpr("7 * 7")
    expect(second).not.toBe(first) // cache was cleared; re-parsed
    expect(evalExpr(second, {})).toBe(49) // still correct
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/figures/expr.test.ts`
Expected: FAIL — first assertion (`toBe`) fails because `parseExpr` parses fresh each call.

- [ ] **Step 3: Implement the cache**

In `src/figures/expr.ts`, add above `parseExpr` and wrap its body:

```ts
/** Memoized parse: expression strings are immutable keys → immutable ASTs.
 *  Bounded (cleared at the cap) so adversarial input cannot grow it forever.
 *  This is what makes per-tick interactive recompiles cheap (spec §1). */
const AST_CACHE = new Map<string, ExprAst>()
const AST_CACHE_MAX = 1000

export function parseExpr(src: string): ExprAst {
  const cached = AST_CACHE.get(src)
  if (cached) return cached
  const toks = tokenize(src)
  // ... existing parsing body unchanged ...
  const out = additive()
  if (pos < toks.length) throw new ExprError(`unexpected "${String(toks[pos]!.v)}"`)
  if (AST_CACHE.size >= AST_CACHE_MAX) AST_CACHE.clear()
  AST_CACHE.set(src, out)
  return out
}
```

(Only the two lines before `const toks` and the two lines before `return out` are new; the recursive-descent body is untouched. Failed parses throw before caching.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/figures/expr.test.ts && npx vitest run tests/figures/authored.test.ts`
Expected: PASS — all expression tests plus slot tests (they exercise `evaluate` → `parseExpr`).

- [ ] **Step 5: Typecheck, full suite, commit**

Run: `npm run typecheck && npm test` → green.

```bash
git add src/figures/expr.ts tests/figures/expr.test.ts
git commit -m "$(cat <<'EOF'
perf(figures): memoize parsed expression ASTs per unique string

Bounded module-level cache (clear at 1000) — parse once, evaluate many.
Makes per-tick interactive figure recompiles cheap and benefits SSR.

🤖 Generated with Codebuff
Co-Authored-By: Codebuff <noreply@codebuff.com>
EOF
)"
```

---

### Task 2: `sweep` IR field + prompt + demo fixture

**Files:**
- Modify: `src/core/schema.ts` (`figureBlockSchema`), `src/core/llm.ts` (figure line), `demo/examples.js` (epicycles block)
- Test: `tests/figure.test.ts`, `tests/presentation.test.ts`

**Interfaces:**
- Produces: `FigureBlock.sweep?: string` (identifier-validated); prompt documents it; demo epicycles declares `sweep: "t"`.

- [ ] **Step 1: Write the failing tests**

In `tests/figure.test.ts`, inside `describe("figure primitive", ...)` append:

```ts
  it("accepts sweep as an identifier and rejects non-identifiers", () => {
    const withSweep = { ...base, blocks: [{ ...base.blocks[0], sweep: "t" }] }
    expect(explanationSchema.safeParse(withSweep).success).toBe(true)
    const badSweep = { ...base, blocks: [{ ...base.blocks[0], sweep: "not a name!" }] }
    expect(explanationSchema.safeParse(badSweep).success).toBe(false)
  })
```

In `tests/presentation.test.ts`, inside `describe("systemPromptSnippet: figure guidance", ...)` append:

```ts
  it("documents the sweep field", () => {
    expect(systemPromptSnippet).toContain("sweep")
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/figure.test.ts tests/presentation.test.ts`
Expected: FAIL — schema has no `sweep`; snippet doesn't mention it.

- [ ] **Step 3: Implement**

`src/core/schema.ts` — inside `figureBlockSchema`, after `height`:

```ts
  // Identifer-validated on purpose: sweep names reach aria-labels, so only a
  // bare identifier may pass. Unknown names fall back to params[0] at runtime.
  sweep: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).optional(),
```

`src/core/llm.ts` — in the `figure:` line, after the group element description (before `Numbers may be`):

```
sweep?: param name for play to animate (pick the one that makes the figure move meaningfully),
```

`demo/examples.js` — epicycles block, after `height: 260,`:

```js
      sweep: "t",
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/figure.test.ts tests/presentation.test.ts tests/demo-examples.test.ts`
Expected: PASS — the epicycles fixture is schema-valid with `sweep: "t"` (existing test).

- [ ] **Step 5: Commit**

```bash
git add src/core/schema.ts src/core/llm.ts demo/examples.js tests/figure.test.ts tests/presentation.test.ts
git commit -m "$(cat <<'EOF'
feat(figures): sweep field names the param play should animate

Identifier-validated additive IR field; runtime falls back to params[0]
when absent or unknown. Epicycles demo declares sweep: "t".

🤖 Generated with Codebuff
Co-Authored-By: Codebuff <noreply@codebuff.com>
EOF
)"
```

---

### Task 3: `<InteractiveFigure>` component

**Files:**
- Create: `src/react/InteractiveFigure.tsx`
- Modify: `src/primitives/figure.ts` (export `buildAuthored`), `src/themes/tokens.css` (append control styles)
- Test: `tests/react.test.tsx` (new `describe` blocks)

**Interfaces:**
- Consumes: `buildAuthored(block, warnings)` (newly exported), `compileFigure(authored)`, `sceneToSvg(scene, opts)`, `n2`, `hashSeed`, `renderInline`.
- Produces: `InteractiveFigure: FC<{ block: unknown; sketch?: boolean }>`, `nextSweepValue(current: number, spec: { min; max; step }, dtMs: number): number`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/react.test.tsx`:

```tsx
import { InteractiveFigure, nextSweepValue } from "../src/react/InteractiveFigure"

const figureBlock = {
  type: "figure",
  title: "Orbit",
  caption: "A circle-ish thing.",
  params: [{ name: "r", min: 5, max: 50, step: 1, initial: 20 }],
  elements: [{ kind: "arc", cx: 100, cy: 80, rx: "r", ry: "r", start: 0, end: 270 }],
}

describe("InteractiveFigure", () => {
  it("renders static-identical initial SVG with markup parity", () => {
    const html = renderToStaticMarkup(<InteractiveFigure block={figureBlock} />)
    expect(html).toContain(`class="exp-block exp-figure"`)
    expect(html).toContain(`class="exp-fig-title"`)
    expect(html).toContain(`class="exp-fig-caption"`)
    expect(html).toContain(`class="exp-figure"`)
    expect(html).toContain("A 20 20 0 1 1") // same geometry as the static render
    expect(html).toContain(`type="range"`)
    expect(html).toContain(`aria-label="r"`)
    expect(html).toContain(`aria-label="Play r"`) // sweep falls back to params[0]
  })

  it("renders no controls for a zero-param figure", () => {
    const html = renderToStaticMarkup(
      <InteractiveFigure block={{ type: "figure", elements: [{ kind: "dot", cx: 5, cy: 5 }] }} />,
    )
    expect(html).toContain(`class="exp-fig-dot"`)
    expect(html).not.toContain(`type="range"`)
    expect(html).not.toContain(`exp-fig-play`)
  })

  it("honors a known sweep name and survives garbage blocks", () => {
    const html = renderToStaticMarkup(<InteractiveFigure block={{ ...figureBlock, sweep: "r" }} />)
    expect(html).toContain(`aria-label="Play r"`)
    const empty = renderToStaticMarkup(<InteractiveFigure block={{ type: "figure", elements: [{ kind: "wedge" }] }} />)
    expect(empty).toContain(`class="exp-fig-empty"`)
  })
})

describe("nextSweepValue", () => {
  const spec = { min: 20, max: 60, step: 5 }
  it.each([
    [40, 16.67, 45], // one step per frame
    [60, 16.67, 20], // wraps at max
    [40, 8.335, 42.5], // frame-rate scaled sub-step
    [40, 0, 40], // zero dt is a no-op
    [40, -5, 40], // negative dt is a no-op
  ])("value %i + dt %p → %p", (current, dt, expected) => {
    expect(nextSweepValue(current, spec, dt)).toBeCloseTo(expected as number)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/react.test.tsx`
Expected: FAIL — module `../src/react/InteractiveFigure` does not exist.

- [ ] **Step 3: Export `buildAuthored`**

In `src/primitives/figure.ts`, change `function buildAuthored(` to `export function buildAuthored(`.

- [ ] **Step 4: Create the component**

`src/react/InteractiveFigure.tsx`:

```tsx
"use client"
import { useEffect, useMemo, useRef, useState, type FC } from "react"
import { buildAuthored } from "../primitives/figure"
import { compileFigure } from "../figures/authored"
import { hashSeed } from "../figures/seed"
import { n2, sceneToSvg } from "../figures/svg"
import { renderInline } from "../core/inline"
import type { FigureBlock } from "../core/schema"

export interface InteractiveFigureProps {
  /** Raw block payload (schema-parsed or unknown); parsed leniently. */
  block: unknown
  /** Hand-drawn (rough.js) stroke pass, matching the static option. */
  sketch?: boolean
}

/** Pure sweep step: advances by step scaled to frame time, wrapping at max.
 *  Frame-rate independent; zero/negative dt is a no-op. Exported for tests. */
export function nextSweepValue(
  current: number,
  spec: { min: number; max: number; step: number },
  dtMs: number,
): number {
  if (dtMs <= 0) return current
  const next = current + spec.step * (dtMs / 16.67)
  return next > spec.max ? spec.min : next
}

interface ParamSpec {
  name: string
  min: number
  max: number
  step: number
  initial: number
}

export const InteractiveFigure: FC<InteractiveFigureProps> = ({ block, sketch = false }) => {
  const { authored, raw } = useMemo(() => {
    const b = (block ?? {}) as Partial<FigureBlock>
    const warnings: string[] = []
    // Reuse the static path's salvage verbatim; a malformed block degrades
    // to an empty elements list (→ empty state), never a throw.
    const a = buildAuthored(
      { ...(b as FigureBlock), elements: Array.isArray(b.elements) ? b.elements : [] },
      warnings,
    )
    if (warnings.length > 0) console.debug("interactive figure warnings:", warnings)
    return { authored: a, raw: b }
  }, [block])

  const params = (authored.params ?? []) as ParamSpec[]
  const [values, setValues] = useState<Record<string, number>>(() =>
    Object.fromEntries(params.map(p => [p.name, p.initial])),
  )
  const [playing, setPlaying] = useState(false)

  const sweepName = useMemo(() => {
    const declared = raw.sweep
    if (typeof declared === "string" && params.some(p => p.name === declared)) return declared
    return params[0]?.name
  }, [raw.sweep, params])
  const sweepSpec = params.find(p => p.name === sweepName)

  // Initial render depends only on `block` → deterministic SSR = hydration.
  const svg = useMemo(() => {
    if (authored.elements.length === 0) return null
    const figure = {
      ...authored,
      params: params.map(p => ({ ...p, initial: values[p.name] ?? p.initial })),
    }
    const { scene } = compileFigure(figure)
    if (scene.elements.length === 0) return null
    return sceneToSvg(scene, {
      ariaLabel: authored.title ?? authored.caption ?? "Interactive figure",
      sketch,
      seed:
        raw.id ??
        hashSeed(`${authored.title ?? ""}|${authored.caption ?? ""}|${authored.elements.length}`),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authored, raw.id, sketch, values])

  // Play loop: rAF sweep of one param; paused/unmounted cleanup cancels it.
  const rafRef = useRef<number | null>(null)
  useEffect(() => {
    if (!playing || !sweepSpec) return
    let last = performance.now()
    const tick = (now: number) => {
      const dt = now - last
      last = now
      setValues(v => ({ ...v, [sweepSpec.name]: nextSweepValue(v[sweepSpec.name]!, sweepSpec, dt) }))
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [playing, sweepSpec])

  const setParam = (name: string, value: number) => {
    const p = params.find(q => q.name === name)
    if (!p) return
    setValues(v => ({ ...v, [name]: Math.min(p.max, Math.max(p.min, value)) }))
  }

  const header = authored.title ? (
    <h4 className="exp-fig-title" dangerouslySetInnerHTML={{ __html: renderInline(authored.title) }} />
  ) : null
  const caption = authored.caption ? (
    <p className="exp-fig-caption" dangerouslySetInnerHTML={{ __html: renderInline(authored.caption) }} />
  ) : null
  const body = svg ? (
    <div className="exp-fig-stage" dangerouslySetInnerHTML={{ __html: svg }} />
  ) : (
    <p className="exp-fig-empty">Figure could not be drawn.</p>
  )
  const controls =
    params.length > 0 ? (
      <div className="exp-fig-controls">
        {params.map(p => (
          <label key={p.name} className="exp-fig-param">
            <span className="exp-fig-param-name">{p.name}</span>
            <input
              type="range"
              min={p.min}
              max={p.max}
              step={p.step}
              value={values[p.name] ?? p.initial}
              aria-label={p.name}
              onChange={e => setParam(p.name, Number(e.target.value))}
            />
            <span className="exp-fig-param-value">{n2(values[p.name] ?? p.initial)}</span>
          </label>
        ))}
        {sweepSpec && (
          <button
            type="button"
            className="exp-fig-play"
            aria-label={playing ? "Pause" : `Play ${sweepName}`}
            onClick={() => setPlaying(p => !p)}
          >
            {playing ? "Pause" : "Play"}
          </button>
        )}
      </div>
    ) : null

  return (
    <div className="exp-block exp-figure">
      {header}
      {body}
      {controls}
      {caption}
    </div>
  )
}
```

- [ ] **Step 5: Append control styles to tokens.css via bash**

Large-file writes corrupted CSS once before (see ledger); append with a heredoc:

```bash
cat >> src/themes/tokens.css <<'EOF'

/* Interactive figure controls (React runtime only) */
.exp-fig-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
  margin: 0.5rem 0;
}
.exp-fig-param {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.85em;
}
.exp-fig-param input[type="range"] {
  accent-color: var(--exp-accent);
}
.exp-fig-param-name {
  color: var(--exp-text-muted);
}
.exp-fig-param-value {
  min-width: 3ch;
  font-variant-numeric: tabular-nums;
}
.exp-fig-play {
  font: inherit;
  font-size: 0.85em;
  padding: 0.15rem 0.7rem;
  border: 1px solid var(--exp-node-stroke);
  border-radius: var(--exp-radius);
  background: transparent;
  color: var(--exp-ink);
  cursor: pointer;
}
EOF
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/react.test.tsx`
Expected: PASS — all new tests plus the four pre-existing `Explanation` tests.

- [ ] **Step 7: Typecheck + commit**

Run: `npm run typecheck`

```bash
git add src/react/InteractiveFigure.tsx src/primitives/figure.ts src/themes/tokens.css tests/react.test.tsx
git commit -m "$(cat <<'EOF'
feat(react): InteractiveFigure — sliders + play sweep over figure params

Client component reusing buildAuthored/compileFigure/sceneToSvg for
static-identical initial render; rAF sweep of an author-chosen param
with wrap-at-max; zero-param figures render SVG only.

🤖 Generated with Codebuff
Co-Authored-By: Codebuff <noreply@codebuff.com>
EOF
)"
```

---

### Task 4: Wire `interactive` into `<Explanation>` + re-export

**Files:**
- Modify: `src/react/Explanation.tsx`, `src/react/index.ts`
- Test: `tests/react.test.tsx` (extend)

**Interfaces:**
- Consumes: `InteractiveFigure` (Task 3).
- Produces: `Explanation` prop `interactive?: boolean`; `explanations/react` re-exports `InteractiveFigure`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/react.test.tsx` inside `describe("Explanation", ...)`:

```tsx
  it("routes figure blocks to the interactive runtime only when asked", () => {
    const ir = { version: 1, blocks: [figureBlock] }
    const on = renderToStaticMarkup(<Explanation ir={ir} theme="none" interactive />)
    expect(on).toContain(`type="range"`)
    const off = renderToStaticMarkup(<Explanation ir={ir} theme="none" />)
    expect(off).not.toContain(`type="range"`)
    expect(off).toContain(`class="exp-figure"`) // static path unchanged
  })

  it("lets a components override win over interactive routing", () => {
    const MyFigure = () => <em data-test="my-figure">mine</em>
    const ir = { version: 1, blocks: [figureBlock] }
    const html = renderToStaticMarkup(
      <Explanation ir={ir} theme="none" interactive components={{ figure: MyFigure }} />,
    )
    expect(html).toContain(`data-test="my-figure"`)
    expect(html).not.toContain(`type="range"`)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/react.test.tsx`
Expected: FAIL — `interactive` prop not accepted/routed.

- [ ] **Step 3: Implement the wiring**

`src/react/Explanation.tsx`:

- Add import: `import { InteractiveFigure } from "./InteractiveFigure"`.
- Props interface gains: `/** Route figure blocks to the interactive runtime (sliders + play). Default false — keeps this component RSC-safe. */ interactive?: boolean`.
- Signature: `export function Explanation({ ir, theme = "light", components, strict, sketch, interactive }: ExplanationProps)`.
- Inside the `blocks.map`, replace the block-rendering tail:

```tsx
        const Custom = components?.[b.type]
        if (Custom && b.kind === "valid") {
          return <Custom key={b.index} block={b.data as Block} />
        }
        if (interactive && b.kind === "valid" && b.type === "figure") {
          return <InteractiveFigure key={b.index} block={b.data} sketch={sketch} />
        }
        return <div key={b.index} dangerouslySetInnerHTML={{ __html: renderBlock(b.type, b.data, 1, { sketch }) }} />
```

`src/react/index.ts` becomes:

```ts
export * from "./Explanation"
export * from "./InteractiveFigure"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/react.test.tsx && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/react/Explanation.tsx src/react/index.ts tests/react.test.tsx
git commit -m "$(cat <<'EOF'
feat(react): interactive prop routes figure blocks to the runtime

Default off (RSC-safe); components overrides still win. explanations/react
re-exports InteractiveFigure.

🤖 Generated with Codebuff
Co-Authored-By: Codebuff <noreply@codebuff.com>
EOF
)"
```

---

### Task 5: Demo page + ROADMAP + full verification

**Files:**
- Create: `demo/interactive.html`
- Modify: `demo/server.mjs` (routes + link), `docs/ROADMAP.md`
- Test: demo smoke via curl (server routes aren't unit-tested; behavior is verified in the browser)

**Interfaces:** none new — consumes Task 4's export surface.

- [ ] **Step 1: Create `demo/interactive.html`**

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>explanations — interactive figures</title>
<script type="importmap">
{
  "imports": {
    "react": "https://esm.sh/react@19?external=react",
    "react/jsx-runtime": "https://esm.sh/react@19/jsx-runtime?external=react",
    "react-dom/client": "https://esm.sh/react-dom@19/client?external=react",
    "explanations/react": "/react/index.js"
  }
}
</script>
<link rel="stylesheet" href="/themes/tokens.css">
<link rel="stylesheet" href="/themes/light.css">
<link rel="stylesheet" href="/themes/dark.css">
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 46rem; padding: 0 1rem; }
</style>
</head>
<body class="exp exp-theme-light">
<h1>explanations — interactive figures</h1>
<p>The same <code>figuresIr</code> as the main demo, rendered by the React runtime: drag the sliders, press play to sweep <code>t</code>.</p>
<div id="root"></div>
<script type="module">
  import { createElement } from "react"
  import { createRoot } from "react-dom/client"
  import { Explanation } from "explanations/react"
  import { figuresIr } from "/examples.js"
  createRoot(document.getElementById("root")).render(createElement(Explanation, { ir: figuresIr, interactive: true }))
</script>
</body>
</html>
```

- [ ] **Step 2: Add server routes + link**

In `demo/server.mjs`:

- Add to the Figures `<h2>` paragraph: `<p><a href="/interactive">Interactive figures →</a></p>` (after the existing `<p>`).
- In the request handler, before the 404, add:

```js
  if (url.pathname === "/interactive") {
    try {
      const html = await readFile(new URL("./interactive.html", import.meta.url))
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
      res.end(html)
    } catch {
      res.writeHead(404, { "content-type": "text/plain" })
      res.end("not found")
    }
    return
  }
  if (url.pathname === "/examples.js") {
    const js = await readFile(new URL("./examples.js", import.meta.url))
    res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" })
    res.end(js)
    return
  }
  if (url.pathname.startsWith("/react/")) {
    try {
      const js = await readFile(new URL(`../dist${url.pathname}`, import.meta.url))
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" })
      res.end(js)
    } catch {
      res.writeHead(404, { "content-type": "text/plain" })
      res.end("not found")
    }
    return
  }
```

- [ ] **Step 3: Build + smoke**

Run: `npm run build`, then restart the demo server, then:

```bash
curl -s -o /dev/null -w "/interactive: %{http_code}\n" http://localhost:4173/interactive
curl -s -o /dev/null -w "/react/index.js: %{http_code}\n" http://localhost:4173/react/index.js
curl -s http://localhost:4173/interactive | grep -c importmap
```

Expected: `200`, `200`, `1`. Then open `http://localhost:4173/interactive` in a browser: epicycles renders with `t`/`r` sliders; dragging `r` rescales the stack live; Play sweeps `t` and the wave + pen move; Pause stops. (Browser check is the rAF verification — rAF is not unit-tested.)

- [ ] **Step 4: ROADMAP**

In `docs/ROADMAP.md`: delete the backlog line beginning `- **Interactive figure runtime** (next up)`; append to `## Shipped`:

```markdown
- **Interactive figure runtime** (2026-09-29) — React client component
  consuming the bespoke-figure format unchanged: sliders bound to `params`,
  play sweep over an author-declared `sweep` param, re-render via
  `compileFigure`/`sceneToSvg` with memoized expression ASTs. `interactive`
  opt-in on `<Explanation>`; static render remains the SSR path. Spec:
  `docs/superpowers/specs/2026-09-29-interactive-figure-runtime-design.md`.
```

- [ ] **Step 5: Full verification + commit**

Run: `npm test && npm run typecheck && npm run build` → green.

```bash
git add demo/interactive.html demo/server.mjs docs/ROADMAP.md
git commit -m "$(cat <<'EOF'
demo: /interactive page with live epicycles; runtime recorded as shipped

Import-map demo (esm.sh React 19) — demo-only external, library stays
dependency-free. ROADMAP backlog item fulfilled.

🤖 Generated with Codebuff
Co-Authored-By: Codebuff <noreply@codebuff.com>
EOF
)"
```

---

## Self-Review (done at plan-writing time)

- **Spec coverage:** AST memoization (Task 1 = spec §1); sweep IR + prompt + fixture (Task 2 = spec §4); component with markup parity, controls, rAF, nextSweepValue, console.debug warnings, empty state (Task 3 = spec §2 + §Error Handling); interactive prop + override precedence + re-export (Task 4 = spec §3); demo page with `sweep: "t"` epicycles, ROADMAP flip (Task 5 = spec §5 + §Roadmap Position). Reserved-param-name guard: **not in this spec** — it stays backlog (only sweep touches the schema here); noted so it isn't silently dropped.
- **Placeholders:** none — Task 1 Step 3's "existing body unchanged" refers to code present verbatim in `src/figures/expr.ts` (read in-session), not to unwritten code.
- **Type consistency:** `buildAuthored(block, warnings)` matches the primitive's existing signature; `nextSweepValue(current, spec, dtMs)` identical between Task 3 tests and implementation; `interactive?: boolean` naming consistent across Tasks 3–5; class names (`exp-fig-controls`, `exp-fig-param`, `exp-fig-play`) match between component and CSS.
