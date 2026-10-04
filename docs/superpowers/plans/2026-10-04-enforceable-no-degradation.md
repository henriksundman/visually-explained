# Enforceable No-Degradation Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give hosts two new render options — `onWarning` (observe every degradation) and `failOnWarning` (throw on any) — on all four render entry points, and make React hosts able to observe warnings at all.

**Architecture:** Warnings already accumulate correctly into one `string[]` threaded through `renderSalvagedBlock`; the plumbing exists and works. Two things are missing. First, nothing *acts* on the array — so the new options collect it at the entry point and throw there, once, after rendering completes (so the message carries every warning, not just the first). Second, `renderBlock` hardcodes a throwaway `[]` sink, which is the entire reason React hosts cannot see a degradation; it grows an optional `warnings` parameter that the two server components thread through.

**Tech Stack:** TypeScript, zod, React 18 (`react-dom/server` `renderToStaticMarkup` in tests), vitest, tsup.

## Global Constraints

- **`strict` must not change.** It gates *validation* (input malformed). `failOnWarning` gates *output* (input fine, renderer degraded). Widening `strict` would change behavior for every existing caller. Never merge the two, never make one imply the other.
- **No new primitives, no schema change, no new dependency.** `registerAll.ts` is untouched, so the README's primitive count and block-type list must not change.
- **No structured warning type.** Warnings stay `[code] message` strings. A typed warning would touch 30+ call sites.
- **`Explanation` and `Document` stay server components.** No hooks, no `useState`, no `useRef`, no client JS, RSC-safe. The per-pass collection array is an ordinary local.
- **Message bounds are 120 chars per fragment, 10 fragments max**, reusing the bound already in `src/primitives/derivation.ts`. Truncation applies to the **thrown message only** — the array returned to the host and passed to `onWarning` is always complete and untruncated.
- **`failOnWarning` fires on every warning in the array**, including lenient-validation diagnostics (`[invalid-section]`, `[invalid-block]`), not only render-time ones. A dropped section is a degradation.
- **Render output must not change.** This feature adds no markup. Every demo fixture must render byte-identically before and after.

---

## Verified fixtures

These were probed against the current `main` with `renderDocument` and produce exactly the warnings claimed. **Use them verbatim** — a fixture that does not actually degrade makes a negative assertion pass vacuously.

| Fixture | Warnings emitted |
| --- | --- |
| `{ type: "image", image: "chart" }` | `[image] image chart: no image named "chart"` |
| `{ type: "data-callout", metric: "Revenue", label: "Q3", dataset: "sales" }` | `[dataset] data-callout sales: no dataset named "sales"` |
| `{ type: "derivation", steps: [{ expression: "\\frac{1" }] }` | `[math] not TeX — rendered as literal text: …` (126 chars) |
| section `{ title: "", blocks: [] }` | `[invalid-section] section 0: dropped — …` |
| `{ version: 2, title: "", sections: [] }` | 3 warnings (`[wrong-version]` + 2 × `[invalid-document]`) |
| `{ type: "text", body: "hi" }` in a titled section | **none** — the clean control |

**Trap, already hit once:** `{ type: "chart", dataset: "sales", series: [] }` does **not** produce a `[dataset]` warning. `series: []` fails `chartBlockSchema`, so the block is dropped as `[invalid-block]` before the resolver ever runs. Use `data-callout` for dataset-miss tests.

---

### Task 1: `onWarning` + `failOnWarning` on the string renderers

**Files:**
- Modify: `src/core/render.ts` (options interface, `renderBlock` sink, `renderExplanation` wiring)
- Modify: `src/core/renderDocument.ts` (options interface, throw placement)
- Test: `tests/degradation-policy.test.ts` (create)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `RenderOptions.onWarning?: (warnings: string[]) => void`
  - `RenderOptions.failOnWarning?: boolean`
  - `RenderDocumentOptions.onWarning?: (warnings: string[]) => void`
  - `RenderDocumentOptions.failOnWarning?: boolean`
  - `formatDegradationError(warnings: string[]): string` — exported from `src/core/render.ts`, used by Task 2 and re-exported publicly.
  - `renderBlock(type, data, depth?, opts?: { sketch?; datasets?; images?; warnings?: string[] }): string` — new optional `warnings` sink.

- [ ] **Step 1: Write the failing tests**

Create `tests/degradation-policy.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { renderDocument } from "../src/core/renderDocument"
import { renderExplanation, formatDegradationError } from "../src/core/render"

const img = { type: "image", image: "chart" }
const math = { type: "derivation", steps: [{ expression: "\\frac{1" }] }
const clean = { type: "text", body: "hi" }

const doc = (...blocks: unknown[]) => ({
  version: 1, title: "T", summary: undefined,
  sections: [{ title: "S", blocks }],
})

describe("degradation policy — string renderers", () => {
  it("onWarning fires once with the full set, in document order", () => {
    const onWarning = vi.fn()
    renderDocument(doc(img, math), { onWarning })
    expect(onWarning).toHaveBeenCalledTimes(1)
    expect(onWarning.mock.calls[0][0]).toEqual([
      '[image] image chart: no image named "chart"',
      expect.stringContaining("[math] not TeX"),
    ])
  })

  it("onWarning fires with an empty array when nothing degrades", () => {
    const onWarning = vi.fn()
    renderDocument(doc(clean), { onWarning })
    expect(onWarning).toHaveBeenCalledTimes(1)
    expect(onWarning).toHaveBeenCalledWith([])
  })

  it("failOnWarning throws carrying EVERY warning, not just the first", () => {
    let err: unknown
    try { renderDocument(doc(img, math), { failOnWarning: true }) } catch (e) { err = e }
    expect(err).toBeInstanceOf(Error)
    const msg = (err as Error).message
    expect(msg).toContain("Degradation policy: 2 warning(s)")
    expect(msg).toContain("[image]")
    expect(msg).toContain("[math]")
  })

  it("does not throw when nothing degrades", () => {
    expect(() => renderDocument(doc(clean), { failOnWarning: true })).not.toThrow()
  })

  it("a broken top level throws under failOnWarning, before the empty-shell early return", () => {
    expect(() =>
      renderDocument({ version: 2, title: "", sections: [] }, { failOnWarning: true }),
    ).toThrow(/Degradation policy/)
    // lenient mode still returns the silent empty shell — the regression this guards
    const lenient = renderDocument({ version: 2, title: "", sections: [] })
    expect(lenient.html).toBe('<article class="exp exp-doc"></article>')
  })

  it("strict still throws the VALIDATION error when both options are set", () => {
    let err: unknown
    try {
      renderDocument({ version: 1, title: "T", sections: [{ title: "", blocks: [] }] },
        { strict: true, failOnWarning: true })
    } catch (e) { err = e }
    expect((err as Error).message).toMatch(/^invalid document:/)
  })

  it("strict alone is unchanged: a validation failure throws the same message", () => {
    expect(() =>
      renderDocument({ version: 1, title: "T", sections: [{ title: "", blocks: [] }] }, { strict: true }),
    ).toThrow(/^invalid document:/)
  })

  it("counts lenient-validation diagnostics as degradations", () => {
    expect(() =>
      renderDocument({ version: 1, title: "T", sections: [{ title: "", blocks: [] }] }, { failOnWarning: true }),
    ).toThrow(/Degradation policy/)
  })

  it("truncates the message but not the array", () => {
    const long = { type: "image", image: "x".repeat(300) }
    const seen: string[][] = []
    renderDocument(doc(long), { onWarning: w => seen.push(w), failOnWarning: false })
    expect(seen[0][0].length).toBeGreaterThan(120)
    let msg = ""
    try { renderDocument(doc(long), { failOnWarning: true }) } catch (e) { msg = (e as Error).message }
    expect(msg).not.toContain("x".repeat(200))
  })

  it("renders identical HTML with and without the options", () => {
    const a = renderDocument(doc(img, math)).html
    const b = renderDocument(doc(img, math), { onWarning: () => {}, failOnWarning: false }).html
    expect(a).toBe(b)
  })

  it("renderExplanation honors both options", () => {
    const ir = { title: "T", summary: "s", blocks: [img] }
    const onWarning = vi.fn()
    renderExplanation(ir, { onWarning })
    expect(onWarning).toHaveBeenCalledTimes(1)
    expect(() => renderExplanation(ir, { failOnWarning: true })).toThrow(/Degradation policy/)
    expect(() => renderExplanation({ title: "T", blocks: [clean] }, { failOnWarning: true })).not.toThrow()
  })

  it("formatDegradationError bounds fragments at 120 chars and 10 fragments", () => {
    const msg = formatDegradationError(Array.from({ length: 12 }, (_, i) => `[x] ${"y".repeat(300)} #${i}`))
    expect(msg).toContain("12 warning(s)")
    expect(msg).toContain("and 2 more")
    expect(msg).not.toContain("y".repeat(200))
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/degradation-policy.test.ts`
Expected: FAIL — `formatDegradationError` is not exported, and `onWarning`/`failOnWarning` are ignored. The "broken top level" test fails by *not throwing*; "failOnWarning throws" fails for the same reason.

- [ ] **Step 3: Implement `formatDegradationError` and the `renderBlock` sink**

In `src/core/render.ts`, add above `renderExplanation`:

```ts
/** Per-fragment bound on the thrown message, matching the MathML parse-error
 *  bound already applied in src/primitives/derivation.ts. Message-only: the
 *  array a host receives is always complete. */
const MAX_WARNING_FRAGMENT = 120
/** Cap on fragments rendered before summarizing. Mirrors the compiler's habit
 *  of bounding warning payloads (MAX_SOURCES, MAX_IMAGES). */
const MAX_WARNING_FRAGMENTS = 10

/**
 * Render a degradation-policy throw message. Bounded because warnings embed
 * model- and host-supplied text (a MathML parse error, an image catalog key),
 * and an unbounded join is a log hazard in exactly the CI context this option
 * targets. Plain text in an Error — never markup.
 */
export function formatDegradationError(warnings: string[]): string {
  const shown = warnings.slice(0, MAX_WARNING_FRAGMENTS)
  const parts = shown.map(w => (w.length > MAX_WARNING_FRAGMENT ? w.slice(0, MAX_WARNING_FRAGMENT) + "…" : w))
  const rest = warnings.length - shown.length
  const tail = rest > 0 ? `; … and ${rest} more` : ""
  return `Degradation policy: ${warnings.length} warning(s) — ${parts.join("; ")}${tail}`
}
```

Change `renderBlock`'s options type and sink. It must keep discarding when no array is supplied:

```ts
/** Renders a single block by type; used by the React adapter. Warnings are
 *  discarded unless the caller supplies `opts.warnings` — Task 2 relies on that
 *  default, and standalone callers keep the original behavior. */
export function renderBlock(
  type: string,
  data: unknown,
  depth = 1,
  opts: { sketch?: boolean; datasets?: Record<string, unknown>; images?: Record<string, unknown>; warnings?: string[] } = {},
): string {
  const raw = typeof data === "object" && data !== null ? { ...(data as object), type } : { type }
  const diagnostics: Diagnostic[] = []
  const b = salvageBlock(raw, -1, diagnostics)
  const sink = opts.warnings ?? []
  return renderSalvagedBlock(b, depth, sink, opts.sketch ?? false, opts.datasets, opts.images)
}
```

- [ ] **Step 4: Wire `renderExplanation`**

Add to `RenderOptions`:

```ts
  /** Called once at the end of the render with every warning emitted during
   *  the pass (empty array when nothing degraded). Observation only — never
   *  throws on the host's behalf. */
  onWarning?: (warnings: string[]) => void
  /** Throw when the pass emitted any warning, instead of returning. Gates the
   *  OUTPUT (a degraded render), which `strict` does not: `strict` gates the
   *  INPUT and runs before any block renders. */
  failOnWarning?: boolean
```

In `renderExplanation`, `inner` is built by the `.map(...)` that renders the
blocks, so every block warning is already in `warnings` by the time the next
line runs. Insert both hooks **after the `const inner = ...` statement and
before the `if (opts.root === false)` return**, so both return paths are
covered:

```ts
  if (opts.onWarning) opts.onWarning([...warnings])
  if (opts.failOnWarning && warnings.length > 0) {
    throw new Error(formatDegradationError(warnings))
  }
  if (opts.root === false) return { html: inner, warnings }
```

`renderExplanation` has no early return for a broken top level — salvage always
produces a `title`/`blocks` shape — so a single check at the end is correct here.
That asymmetry with `renderDocument` is deliberate; do not add an early guard.

- [ ] **Step 5: Wire `renderDocument`**

Add the same two fields to `RenderDocumentOptions`.

**The trap here:** document/section-level warnings are pushed *before* the body
renders, but block-level warnings are pushed *during* it. A single check placed
at the end would miss a broken top level (which returns early), and a single
check placed early would miss every block degradation. So the two hooks go in
two different places, for two different reasons.

Replace the existing `strict` block near the top of `renderDocument` with this —
note the `docBroken &&` guard, which keeps the early return honest:

```ts
  if (opts.strict && warnings.length > 0) {
    throw new Error(`invalid document: ${warnings.join("; ")}`)
  }
  // Degradation policy, early phase. Guarded on docBroken because the full
  // check runs at the end of the function; without this a broken top level
  // would hit the early return below and hand back a silent empty shell. After
  // `strict` so a malformed document reports validation, not degradation.
  if (docBroken && opts.failOnWarning && warnings.length > 0) {
    throw new Error(formatDegradationError(warnings))
  }
  if (docBroken) {
    return { html: `${root}</article>`, warnings }
  }
```

Then, immediately before the final `return { html: root + header + toc + body + ..., warnings }` at the bottom of the function, add the full check — by which point every block has rendered and pushed its warnings:

```ts
  // Degradation policy, final phase: every block has now rendered.
  if (opts.onWarning) opts.onWarning([...warnings])
  if (opts.failOnWarning && warnings.length > 0) {
    throw new Error(formatDegradationError(warnings))
  }
```

Both arrays passed to `onWarning` are copies, so a host that mutates what it
receives cannot corrupt the array still being returned.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/degradation-policy.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 7: Run the full suite and typecheck**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; 513 + 12 = 525 passing, no failures. If any existing test fails, the render output or a `strict` message changed — that is a bug, not a test to update.

- [ ] **Step 8: Commit**

```bash
git add src/core/render.ts src/core/renderDocument.ts tests/degradation-policy.test.ts
git commit -m "Add onWarning and failOnWarning to the string renderers

strict gates validation and runs before any block renders, so it can
never fire on a render-time degradation. The warnings array already
existed and was returned; nothing acted on it.

The throw lands at the entry point after rendering completes so the
message carries every warning, not just the first, and before
renderDocument's docBroken early return so a broken top level cannot
return a silent empty shell. strict is untouched."
```

---

### Task 2: Make warnings observable from React

**Files:**
- Modify: `src/react/Explanation.tsx`
- Modify: `src/react/Document.tsx`
- Test: `tests/degradation-policy-react.test.tsx` (create)

**Interfaces:**
- Consumes: `formatDegradationError(warnings)` and the `warnings` sink on `renderBlock` from Task 1.
- Produces: `ExplanationProps.onWarning?`, `ExplanationProps.failOnWarning?`, `DocumentProps.onWarning?`, `DocumentProps.failOnWarning?`.

- [ ] **Step 1: Write the failing tests**

Create `tests/degradation-policy-react.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { Explanation } from "../src/react/Explanation"
import { Document } from "../src/react/Document"
import { renderDocument } from "../src/core/renderDocument"

const img = { type: "image", image: "chart" }
const math = { type: "derivation", steps: [{ expression: "\\frac{1" }] }
const clean = { type: "text", body: "hi" }
const doc = (...blocks: unknown[]) => ({ version: 1, title: "T", sections: [{ title: "S", blocks }] })

describe("degradation policy — React", () => {
  it("Explanation surfaces warnings that were previously discarded", () => {
    const onWarning = vi.fn()
    renderToStaticMarkup(<Explanation ir={{ title: "T", blocks: [img] }} onWarning={onWarning} />)
    expect(onWarning).toHaveBeenCalledTimes(1)
    expect(onWarning).toHaveBeenCalledWith(['[image] image chart: no image named "chart"'])
  })

  it("Document surfaces warnings that were previously discarded", () => {
    const onWarning = vi.fn()
    renderToStaticMarkup(<Document ir={doc(img, math)} onWarning={onWarning} />)
    expect(onWarning).toHaveBeenCalledTimes(1)
    expect(onWarning.mock.calls[0][0]).toHaveLength(2)
  })

  it("failOnWarning throws from both components", () => {
    expect(() => renderToStaticMarkup(<Explanation ir={{ title: "T", blocks: [img] }} failOnWarning />))
      .toThrow(/Degradation policy/)
    expect(() => renderToStaticMarkup(<Document ir={doc(img)} failOnWarning />))
      .toThrow(/Degradation policy/)
  })

  it("does not throw when nothing degrades", () => {
    expect(() => renderToStaticMarkup(<Explanation ir={{ title: "T", blocks: [clean] }} failOnWarning />)).not.toThrow()
    expect(() => renderToStaticMarkup(<Document ir={doc(clean)} failOnWarning />)).not.toThrow()
  })

  it("reports the same warning set as the string renderer", () => {
    const fromReact: string[][] = []
    renderToStaticMarkup(<Document ir={doc(img, math)} onWarning={w => fromReact.push(w)} />)
    const fromHtml = renderDocument(doc(img, math)).warnings
    expect(fromReact[0]).toEqual(fromHtml)
  })

  it("Explanation and Document agree with each other", () => {
    const a: string[][] = []
    const b: string[][] = []
    renderToStaticMarkup(<Explanation ir={{ title: "T", blocks: [img, math] }} onWarning={w => a.push(w)} />)
    renderToStaticMarkup(<Document ir={doc(img, math)} onWarning={w => b.push(w)} />)
    expect(a[0]).toEqual(b[0])
  })

  it("renders identical HTML with and without the options", () => {
    const plain = renderToStaticMarkup(<Document ir={doc(img, math)} />)
    const withOpts = renderToStaticMarkup(<Document ir={doc(img, math)} onWarning={() => {}} failOnWarning={false} />)
    expect(withOpts).toBe(plain)
  })

  it("nested stack children warnings still reach the host", () => {
    const onWarning = vi.fn()
    renderToStaticMarkup(
      <Document ir={doc({ type: "stack", children: [img] })} onWarning={onWarning} />,
    )
    expect(onWarning.mock.calls[0][0].some(w => w.startsWith("[image]"))).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/degradation-policy-react.test.tsx`
Expected: FAIL — the props don't exist, so TypeScript/vitest reports unknown props and `onWarning` is never called. This is the capability that did not exist before.

- [ ] **Step 3: Wire `Explanation`**

Add to `ExplanationProps`:

```ts
  /** Called once at the end of the render pass with every warning emitted
   *  (empty array when nothing degraded). Dev-only caveat: React StrictMode
   *  double-invokes renders, so the same set may arrive twice — dedupe by set
   *  membership or treat `failOnWarning` as authoritative. Not fixable here:
   *  this is a server component, so there is no render-scoped instance to
   *  dedupe against, and module state would leak across requests. */
  onWarning?: (warnings: string[]) => void
  /** Throw when the pass emitted any warning. Gates the OUTPUT; `strict` gates
   *  the INPUT and runs first. */
  failOnWarning?: boolean
```

Destructure them in the signature. Then, inside the component body, before the `return`:

```tsx
  // Warnings are collected per render pass into a plain local and threaded
  // through renderBlock — the only reason a React host could not previously
  // see a degradation at all. Not a hook: this stays a server component.
  const warnings: string[] = []
  const blockOpts = { sketch, datasets, images, warnings }
```

Replace every `renderBlock(b.type, b.data, 1, { sketch, datasets, images })` call in the component with `renderBlock(b.type, b.data, 1, blockOpts)`.

Then, immediately before the final `return (`:

```tsx
  if (onWarning) onWarning([...warnings])
  if (failOnWarning && warnings.length > 0) {
    throw new Error(formatDegradationError(warnings))
  }
```

Add the import: `import { renderBlock, formatDegradationError } from "../core/render"`.

**Note:** the `strict` check in `Explanation` already runs first and throws before any of this — preserve that ordering.

- [ ] **Step 4: Wire `Document` identically**

Same two props on `DocumentProps`, same import, same local + `blockOpts`, same two lines before the return. The block map in `Document` currently reads:

```tsx
return <div key={bi} dangerouslySetInnerHTML={{ __html: renderBlock(type, raw, 1, { sketch, datasets, images }) }} />
```

Change its options argument to `blockOpts`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/degradation-policy-react.test.tsx`
Expected: PASS, 8 tests.

- [ ] **Step 6: Verify no hooks crept in and the full suite is green**

Run: `grep -n "useState\|useRef\|useEffect\|useMemo\|useCallback" src/react/Explanation.tsx src/react/Document.tsx`
Expected: no output. Both must remain RSC-safe server components.

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; 533 passing.

- [ ] **Step 7: Commit**

```bash
git add src/react/Explanation.tsx src/react/Document.tsx tests/degradation-policy-react.test.tsx
git commit -m "Surface render warnings from the React components

renderBlock hardcoded a throwaway warnings sink, so a React host had no
way to observe a degradation: a missing image catalog entry, an
unparseable TeX field, a dropped dataset key all rendered their fallback
with total silence. The primitives already called ctx.addWarning
correctly; only the sink was missing.

Collection is a plain local, not a hook, so both components stay
server components. StrictMode's dev-only double-invoke is documented
rather than fixed: deduping it would need module-level state, which
leaks across requests on a server."
```

---

### Task 3: Docs

**Files:**
- Modify: `README.md`
- Modify: `docs/OPEN_THREADS.md`
- Modify: `docs/ROADMAP.md`
- Test: `tests/readme.test.ts` (existing — must stay green)

**Interfaces:**
- Consumes: the two options from Tasks 1–2.
- Produces: nothing consumed by later tasks. This is the final task.

- [ ] **Step 1: Correct README principle 1**

Line 15 currently reads `degraded, warning emitted); a render never fails on bad data unless you opt into \`strict: true\`.` Replace so it distinguishes the two gates — `strict` for a malformed input, `failOnWarning` for a degraded output:

```
  degraded, warning emitted); a render never fails on bad data unless you opt
  into `strict: true` (malformed input) or `failOnWarning: true` (a render that
  degraded).
```

- [ ] **Step 2: Add the option rows**

In the `renderExplanation` options table add `onWarning` and `failOnWarning` rows; do the same in the `renderDocument` table. Each row: default `—` / `false`, one-line description. Keep the existing `strict` row text unchanged.

- [ ] **Step 3: Add a short subsection after the "Both return `{ html, warnings }`" paragraph**

```markdown
### Enforcing no degradation

`strict` gates the **input**: it throws when the IR fails validation, before any
block renders. It cannot fire on a degradation, because nearly every degradation
here happens at render time — a missing dataset key, an unresolvable image, TeX
that does not parse.

`failOnWarning` gates the **output**. It throws after rendering, carrying every
warning rather than only the first:

```ts
const { html } = renderDocument(ir, { failOnWarning: true }) // throws if anything degraded
```

It counts lenient-validation diagnostics too — a silently dropped section is a
degradation. `onWarning` is the observational counterpart, called once per
render pass with the full set, for hosts that would rather log than throw:

```ts
renderDocument(ir, { onWarning: w => report(w) })
```

The thrown message is bounded (120 chars per warning, 10 shown); the array you
receive is always complete.

**In React**, warnings reach `onWarning` too — previously they were discarded
entirely. Note that StrictMode double-invokes renders in development, so the
same set may arrive twice; dedupe by set membership or rely on `failOnWarning`.
```

- [ ] **Step 4: Verify the README test still passes**

Run: `npx vitest run tests/readme.test.ts`
Expected: PASS. This test pins the block-type list and primitive count to the live registry — **this feature adds no block type, so if it fails, the README is wrong, not the test.**

- [ ] **Step 5: Rewrite open thread 1**

Replace the body of `docs/OPEN_THREADS.md` thread 1 with a closed-thread note: the gap is filled by `onWarning`/`failOnWarning`; `strict` still gates validation only and that remains correct. **Keep the standing warning** — do not write a test asserting a render-time warning throws under `strict` — because `failOnWarning` is a different option and the distinction is the point. Renumber the remaining threads and update the "Last updated" line.

- [ ] **Step 6: Flip the roadmap item**

In `docs/ROADMAP.md`, move the no-degradation item from the "Next up, in order" backlog into `## Shipped` with a one-paragraph entry naming both options, the React fix, and the spec path. Renumber the backlog so inline math becomes item 1.

- [ ] **Step 7: Full verification**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: tsc clean, 533 passing, build green.

- [ ] **Step 8: Prove render output did not change**

This feature must add no markup. Build `main` in a detached worktree and diff the rendered fixtures:

```bash
npm run build
git worktree add --detach /tmp/vn-main main
ln -s "$PWD/node_modules" /tmp/vn-main/node_modules
(cd /tmp/vn-main && npm run build)
node .superpowers/render-fixtures.mjs > /tmp/after.txt
(cd /tmp/vn-main && node "$OLDPWD/.superpowers/render-fixtures.mjs" > /tmp/before.txt)
diff /tmp/before.txt /tmp/after.txt && echo "IDENTICAL"
```

Expected: `IDENTICAL` — zero differences. Any diff is a bug: this feature adds options, not markup.

> **Heads-up:** `.superpowers/render-fixtures.mjs` is gitignored scratch, so it
> exists on this machine but will not be in a fresh clone. If it is missing,
> write it before running this step: import `renderDocument` and
> `renderExplanation` from `../src/core/…`, and for each fixture in
> `demo/examples.js` print `renderDocument(ir, { sketch: false }).html` plus the
> full `warnings` array, joined by a separator. The point is a byte-level diff
> of every rendered fixture plus its warnings between the two builds.

- [ ] **Step 9: Verify the demo still serves**

Run: `launchctl remove explanations-demo 2>/dev/null; sleep 1; launchctl submit -l explanations-demo -- "$(command -v node)" "$PWD/demo/server.mjs"`, then from a separate call `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4173/document`
Expected: `200`.

- [ ] **Step 10: Commit**

```bash
git add README.md docs/OPEN_THREADS.md docs/ROADMAP.md
git commit -m "Document the degradation policy, and close open thread 1

Principle 1 overstated what strict does: it gates the input, and nearly
every degradation in this library is render-time, so it could never fire
on one. Name both gates and say which is which.

No new block type, so the README's primitive count is unchanged."
```

---

### Task 4: Final review gate

- [ ] **Step 1: Walk the spec against the branch**

Read `docs/superpowers/specs/2026-10-04-enforceable-no-degradation-design.md` §1–§8 and confirm each claim holds in the code. Pay attention to §3.3 (throw placement), §3.3.1 (validation diagnostics count), §4 (StrictMode contract), §5 (nothing out-of-scope crept in).

- [ ] **Step 2: Confirm the vacuous-assertion guard**

Per `docs/DEBUGGING.md`: a negative assertion passes vacuously when the input throws first. Verify test "does not throw when nothing degrades" uses the `clean` control (0 warnings, verified above) and not a fixture that throws. Confirm the same for both React equivalents.

- [ ] **Step 3: Confirm no output change**

Re-run Task 3 Step 8's fixture diff. Expected `IDENTICAL`.

- [ ] **Step 4: Security walk**

The throw message embeds model-supplied text (`[math]` parse errors) and host-supplied keys (`[image]`). Confirm: the message is plain text in an `Error`, never interpolated into markup; `onWarning` receives the same strings already returned by `render`/`renderDocument` (no new data flow); no new sink; truncation bounds the message but never the array a host receives, so truncation cannot be used to hide a warning from a host that inspects it.

- [ ] **Step 5: Full gate**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: tsc clean, 533 passing, build green.

- [ ] **Step 6: Append the ledger line**

Append to `.superpowers/sdd/progress.md` with the merge state, test count, push state, and branch deletion — per the convention recorded on 2026-10-01.