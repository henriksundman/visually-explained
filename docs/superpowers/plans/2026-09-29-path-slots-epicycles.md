# Path Slots + Fourier Epicycles Showcase — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let authored `path` d strings embed `{{expr}}` slots (grammar-gated after expansion) and add a maximal Fourier-epicycles figure to the demo.

**Architecture:** A small compile-time expansion helper in `src/figures/authored.ts` splices evaluated slot expressions into the path `d` before the existing `isSafePathD` grammar gate — no changes to the grammar, evaluator, schema, svg, or sketch layers. The demo figure chains params → derived → group offsets → element expressions → path slots to draw a 3-harmonic square wave.

**Tech Stack:** TypeScript, vitest, the existing hand-rolled expression evaluator (`src/figures/expr.ts`). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-29-path-slots-epicycles-demo-design.md`

## Global Constraints

- Dependency-free: no new packages; `package.json` untouched.
- Scene JSON, never raw SVG: the expanded `d` must pass `isSafePathD`; nothing new reaches markup unvalidated.
- Lenient salvage: any bad slot drops only its element with a warning; the render never fails.
- Caps (verbatim from spec): ≤ 64 slots per path; slot expression ≤ 80 chars after trim (same cap as `parseNum`); `MAX_LEN` 4096 enforced on the **expanded** string; `MAX_ELEMENTS` 60 unchanged.
- No schema changes: `figureBlockSchema` stays as-is; `elements` stays `z.unknown()`; `path.d` stays `string`.
- Deterministic, SSR-safe: no eval/new Function; expression evaluator untouched.
- Demo fixtures stay declarative Scene IR — exactly what an LLM would emit, schema-valid per `tests/demo-examples.test.ts`.
- Commands: tests `npx vitest run <file>`, full suite `npm test`, types `npm run typecheck`, build `npm run build`.

---

### Task 1: Expression slots in authored path `d` (engine)

**Files:**
- Modify: `src/figures/authored.ts` (add helper after `resolve`; edit the `case "path":` block inside `compileEl`; extend the `FigureEl` path-kind doc)
- Test: `tests/figures/authored.test.ts` (append a new `describe` block)

**Interfaces:**
- Consumes: `resolve(v, env)` and `nf(v)` already defined in `authored.ts`; `isSafePathD` from `./pathGrammar` (unchanged).
- Produces: internal `expandPathSlots(d, env, warn): string | null` (module-private). Public API unchanged — `compileFigure` / `parseFigureElement` signatures identical. Warning codes introduced: `figure-path-slot-length`, `figure-path-slot-expr`, `figure-path-slot-count` (new), plus existing `figure-path-unsafe` fired on the expanded string.

- [ ] **Step 1: Write the failing tests**

Append to the end of `tests/figures/authored.test.ts` (after the existing `parseFigureElement` describe):

```ts
describe("path slots", () => {
  it("expands {{expr}} slots against params and derived", () => {
    const { scene, warnings } = compileFigure({
      params: [{ name: "t", min: 0, max: 10, step: 1, initial: 5 }],
      derived: [{ name: "x2", expr: "t * 2" }],
      elements: [{ kind: "path", d: "M 0 0 L {{ x2 }} {{t + 1}}" }],
    })
    expect(warnings).toEqual([])
    expect((scene.elements[0] as { d: string }).d).toBe("M 0 0 L 10 6")
  })

  it("leaves a plain d byte-for-byte untouched", () => {
    const { scene, warnings } = compileFigure({ elements: [{ kind: "path", d: "M 0 0 L 5 5" }] })
    expect(warnings).toEqual([])
    expect((scene.elements[0] as { d: string }).d).toBe("M 0 0 L 5 5")
  })

  it("drops the element when a slot does not resolve, and salvages the rest", () => {
    const { scene, warnings } = compileFigure({
      elements: [{ kind: "path", d: "M {{nope}} 0 L 5 5" }, { kind: "dot", cx: 1, cy: 1 }],
    })
    expect(scene.elements).toHaveLength(1)
    expect(warnings.some(w => w.includes("figure-path-slot-expr"))).toBe(true)
  })

  it("rejects a slot expression over 80 characters", () => {
    const long = "1+".repeat(45) + "1" // 91 chars
    const { scene, warnings } = compileFigure({ elements: [{ kind: "path", d: `M {{${long}}} 0 L 5 5` }] })
    expect(scene.elements).toEqual([])
    expect(warnings.some(w => w.includes("figure-path-slot-length"))).toBe(true)
  })

  it("rejects more than 64 slots and accepts exactly 64", () => {
    const many = "M 0 0 L " + Array.from({ length: 65 }, () => "{{1}}").join(" ")
    const over = compileFigure({ elements: [{ kind: "path", d: many }] })
    expect(over.scene.elements).toEqual([])
    expect(over.warnings.some(w => w.includes("figure-path-slot-count"))).toBe(true)
    const ok = "M 0 0 L " + Array.from({ length: 64 }, () => "{{1}}").join(" ")
    const fit = compileFigure({ elements: [{ kind: "path", d: ok }] })
    expect(fit.warnings).toEqual([])
    expect(fit.scene.elements).toHaveLength(1)
  })

  it("still applies the grammar gate to the expanded string", () => {
    const { scene, warnings } = compileFigure({
      params: [{ name: "v", min: 0, max: 9, step: 1, initial: 1 }],
      elements: [{ kind: "path", d: "M {{v}} 0 < {{v}}" }],
    })
    expect(scene.elements).toEqual([])
    expect(warnings[0]).toContain("figure-path-unsafe")
  })

  it("applies the MAX_LEN gate after expansion, not before", () => {
    const d = "M " + " ".repeat(4085) + "{{9^99}}" // 4096 chars raw; expansion pushes it over
    const { scene, warnings } = compileFigure({ elements: [{ kind: "path", d }] })
    expect(scene.elements).toEqual([])
    expect(warnings[0]).toContain("figure-path-unsafe")
  })

  it("drops unbalanced braces via the grammar gate", () => {
    const { scene, warnings } = compileFigure({ elements: [{ kind: "path", d: "M {{1 0 L 5 5" }] })
    expect(scene.elements).toEqual([])
    expect(warnings[0]).toContain("figure-path-unsafe")
  })
})
```

Note on the MAX_LEN test: `9^99` is finite (~2.95e94, prints as a 22-char exponential string), so the raw `d` is exactly 4096 chars (passes today's length check) but expands past 4096 — proving the gate runs post-expansion.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/figures/authored.test.ts`
Expected: FAIL — the 8 new tests fail (slots are not expanded: first test's `d` stays `"M 0 0 L {{ x2 }} {{t + 1}}"` and the grammar drops it, so `scene.elements` is empty).

- [ ] **Step 3: Implement the expansion helper**

In `src/figures/authored.ts`, add the two constants next to the other module constants (`DEFAULT_W`, `DEFAULT_H`, `MAX_ELEMENTS`) and the helper right after the `resolve` function:

```ts
const MAX_PATH_SLOTS = 64
const MAX_SLOT_EXPR = 80
```

```ts
/** Expands `{{expr}}` slots in an authored path d against the env (spec §1).
 *  `{` and `}` are not path-grammar characters, so slots were previously
 *  rejected and now render; plain d passes through byte-for-byte. The caller
 *  runs the grammar gate on the expanded string — slots never bypass it. */
function expandPathSlots(
  d: string,
  env: Readonly<Record<string, number>>,
  warn: (m: string) => void,
): string | null {
  let out = ""
  let slots = 0
  let i = 0
  for (;;) {
    const open = d.indexOf("{{", i)
    if (open === -1) {
      out += d.slice(i)
      return slots === 0 ? d : out
    }
    const close = d.indexOf("}}", open + 2)
    if (close === -1) {
      out += d.slice(i) // no closing braces — the grammar gate rejects the "{"
      return slots === 0 ? d : out
    }
    out += d.slice(i, open)
    const expr = d.slice(open + 2, close).trim()
    if (expr.length === 0 || expr.length > MAX_SLOT_EXPR) {
      warn(`figure-path-slot-length: slot expression must be 1-${MAX_SLOT_EXPR} characters`)
      return null
    }
    const v = resolve(expr, env)
    if (v === null) {
      warn("figure-path-slot-expr: slot expression did not resolve to a finite number")
      return null
    }
    out += nf(v)
    slots++
    if (slots > MAX_PATH_SLOTS) {
      warn(`figure-path-slot-count: more than ${MAX_PATH_SLOTS} slots in one path d`)
      return null
    }
    i = close + 2
  }
}
```

- [ ] **Step 4: Wire it into the path compile case**

In `compileEl`'s `case "path":` block, expand **before** the grammar check. Current code:

```ts
    case "path": {
      if (!isSafePathD(el.d)) {
        warn("figure-path-unsafe: path d rejected by the grammar")
        return null
      }
```

Replace with:

```ts
    case "path": {
      const expanded = expandPathSlots(el.d, env, warn)
      if (expanded === null) return null
      if (!isSafePathD(expanded)) {
        warn("figure-path-unsafe: path d rejected by the grammar")
        return null
      }
```

The rest of the case (`width` resolution and the `FigurePathEl` construction, which uses `el.d`) must now use the expanded string — change `d: el.d` to `d: expanded` in the returned object:

```ts
      const out: FigurePathEl = { kind: "figure-path", d: expanded, tone: el.tone ?? "accent", fill: el.fill ?? null, width }
```

Also extend the `FigureEl` union's path variant with a doc comment (type unchanged):

```ts
  | { kind: "path"; d: string; tone?: Tone; fill?: Tone; width?: Num } // d: path data; {{expr}} slots allowed
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/figures/authored.test.ts`
Expected: PASS — all existing tests plus the 8 new ones. (`tests/figures/path-grammar.test.ts` is untouched and must still pass: `npx vitest run tests/figures/path-grammar.test.ts`.)

- [ ] **Step 6: Typecheck and full suite**

Run: `npm run typecheck && npm test`
Expected: no type errors; every suite green.

- [ ] **Step 7: Commit**

```bash
git add src/figures/authored.ts tests/figures/authored.test.ts
git commit -m "$(cat <<'EOF'
feat(figures): expression slots in authored path d strings

{{expr}} slots in a path's d are evaluated against params/derived and
spliced in before the existing grammar gate, so parametric outlines
(sampled waveforms) are authorable as data. Plain d is untouched;
bad slots drop only their element.

🤖 Generated with Codebuff
Co-Authored-By: Codebuff <noreply@codebuff.com>
EOF
)"
```

---

### Task 2: System prompt guidance for slots

**Files:**
- Modify: `src/core/llm.ts` (two spots in the `figure:` line of `systemPromptSnippet`)
- Test: `tests/presentation.test.ts` (append one test to the existing `systemPromptSnippet: figure guidance` describe)

**Interfaces:**
- Consumes: `systemPromptSnippet` export (unchanged signature).
- Produces: prompt text documenting slot syntax; no runtime behavior change.

- [ ] **Step 1: Write the failing test**

Inside the existing `describe("systemPromptSnippet: figure guidance", ...)` block in `tests/presentation.test.ts`, append:

```ts
  it("documents path expression slots", () => {
    expect(systemPromptSnippet).toContain("{{")
    expect(systemPromptSnippet).toContain("slots")
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/presentation.test.ts`
Expected: FAIL — the snippet does not yet mention slots.

- [ ] **Step 3: Edit the prompt snippet**

In `src/core/llm.ts`, in the `figure:` line, change:

```
{ kind: "path", d } (d is plain path data: M L H V C S Q T A Z only)
```

to:

```
{ kind: "path", d } (d is path data: M L H V C S Q T A Z only, with optional {{expr}} slots)
```

and change:

```
Numbers may be expressions over params/derived (e.g. "a * 2", "sin(PI/4)"); tones are "ink"|"muted"|"accent".
```

to:

```
Numbers may be expressions over params/derived (e.g. "a * 2", "sin(PI/4)"); path d may embed {{expr}} slots evaluated the same way (e.g. "M 0 0 L {{a}} {{b * 2}}") — prefer slots for sampled parametric outlines and plain path data otherwise. Tones are "ink"|"muted"|"accent".
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/presentation.test.ts`
Expected: PASS — including the pre-existing assertions (`kind: "path"`, "tones are", "≤60 elements").

- [ ] **Step 5: Commit**

```bash
git add src/core/llm.ts tests/presentation.test.ts
git commit -m "$(cat <<'EOF'
docs(prompt): document path d expression slots for LLM authors

🤖 Generated with Codebuff
Co-Authored-By: Codebuff <noreply@codebuff.com>
EOF
)"
```

---

### Task 3: Fourier epicycles demo figure

**Files:**
- Modify: `demo/examples.js` (add the figure block to `figuresIr.blocks`, after the orbit figure and before the `cause-effect` block)
- Test: `tests/demo-examples.test.ts` (append one test)

**Interfaces:**
- Consumes: everything Task 1 shipped (slots), plus existing engine features (params, derived chains, expression group offsets, arcs, dots, labels).
- Produces: a new export-visible entry in `figuresIr` (same export, one more block). Schema validity is covered by the existing "figures fixture is schema-valid" test.

Geometry notes (why the numbers are what they are — the implementer should not "fix" them):
- Square wave via odd-harmonic synthesis: pen position = (cx, cy) − r·Σ, with amplitudes 4/(nπ) ≈ 1.2732 (n=1), 0.4244 (n=3), 0.2546 (n=5). Three circles keep every inline expression ≤ 80 chars.
- The waveform is a `path` with 16 sampled points: x are literal numbers (320 + 24j), y are slots summing `1.2732·sin(a−0.1j) + 0.4244·sin(3a−0.3j) + 0.2546·sin(5a−0.5j)`. Sample 0's slot is mathematically identical to `py`, so the pen→wave connector is always horizontal.
- Circles are drawn as two 180° arcs each (a 0°→360° arc has identical endpoints and renders nothing — same reason the orbit demo splits its arcs).
- The epicycle stack sits in a `group` with `dx: "cx"`, `dy: "cy"` (expressions in group offsets are legal — `flatten` resolves them), so children are authored relative to (0,0). The wave path stays **outside** the group: authored path `d` is never offset by groups.
- Verified bounds: at r=60 the wave spans y ≈ 64–196 on a 720×260 canvas; all labels clear it.

- [ ] **Step 1: Write the failing test**

Append inside the existing `describe("demo examples", ...)` in `tests/demo-examples.test.ts`:

```ts
  it("figures fixture includes the Fourier epicycles figure with slotted paths", () => {
    const fig = figuresIr.blocks.find(
      b => (b as { type?: string }).type === "figure" && (b as { title?: string }).title === "Fourier epicycles",
    )
    expect(fig).toBeDefined()
    const elements = (fig as { elements: { kind: string; d?: string }[] }).elements
    expect(elements.some(e => e.kind === "group")).toBe(true)
    const wave = elements.find(e => e.kind === "path")
    expect(wave?.d?.split("{{").length).toBe(17) // 16 slots + trailing text
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/demo-examples.test.ts`
Expected: FAIL — `fig` is undefined.

- [ ] **Step 3: Add the figure to `figuresIr`**

In `demo/examples.js`, inside `figuresIr.blocks`, insert this object between the orbit `figure` block and the `cause-effect` block. Note the wave `d` is one long single-line string — copy it exactly.

```js
    // The upper limit of the format: every number is an expression over two
    // params, the circle stack is one expression-offset group, and the wave
    // is 16 sampled points written as path slots summing the odd harmonics.
    {
      type: "figure",
      title: "Fourier epicycles",
      caption:
        "Three circles spinning at 1×, 3× and 5× speed sum to a square wave — the pen dot traces it on the right.",
      width: 720,
      height: 260,
      params: [
        { name: "t", min: 0, max: 360, step: 5, initial: 45 },
        { name: "r", min: 20, max: 60, step: 5, initial: 40 },
      ],
      derived: [
        { name: "a", expr: "t * PI / 180" },
        { name: "cx", expr: "150" },
        { name: "cy", expr: "130" },
        { name: "px", expr: "cx + r * (1.2732 * cos(a) + 0.4244 * cos(3 * a) + 0.2546 * cos(5 * a))" },
        { name: "py", expr: "cy - r * (1.2732 * sin(a) + 0.4244 * sin(3 * a) + 0.2546 * sin(5 * a))" },
      ],
      elements: [
        { kind: "line", x1: 300, y1: "cy", x2: 700, y2: "cy", tone: "muted", width: 1 },
        {
          kind: "group",
          dx: "cx",
          dy: "cy",
          elements: [
            { kind: "line", x1: "-r * 1.5", y1: 0, x2: "r * 1.5", y2: 0, tone: "muted", width: 1 },
            { kind: "line", x1: 0, y1: "-r * 1.5", x2: 0, y2: "r * 1.5", tone: "muted", width: 1 },
            { kind: "arc", cx: 0, cy: 0, rx: "r * 1.2732", ry: "r * 1.2732", start: 0, end: 180, tone: "accent" },
            { kind: "arc", cx: 0, cy: 0, rx: "r * 1.2732", ry: "r * 1.2732", start: 180, end: 360, tone: "accent" },
            {
              kind: "arc",
              cx: "r * 1.2732 * cos(a)",
              cy: "-r * 1.2732 * sin(a)",
              rx: "r * 0.4244",
              ry: "r * 0.4244",
              start: 0,
              end: 180,
              tone: "accent",
            },
            {
              kind: "arc",
              cx: "r * 1.2732 * cos(a)",
              cy: "-r * 1.2732 * sin(a)",
              rx: "r * 0.4244",
              ry: "r * 0.4244",
              start: 180,
              end: 360,
              tone: "accent",
            },
            {
              kind: "arc",
              cx: "r * (1.2732 * cos(a) + 0.4244 * cos(3 * a))",
              cy: "-r * (1.2732 * sin(a) + 0.4244 * sin(3 * a))",
              rx: "r * 0.2546",
              ry: "r * 0.2546",
              start: 0,
              end: 180,
              tone: "accent",
            },
            {
              kind: "arc",
              cx: "r * (1.2732 * cos(a) + 0.4244 * cos(3 * a))",
              cy: "-r * (1.2732 * sin(a) + 0.4244 * sin(3 * a))",
              rx: "r * 0.2546",
              ry: "r * 0.2546",
              start: 180,
              end: 360,
              tone: "accent",
            },
            { kind: "line", x1: 0, y1: 0, x2: "r * 1.2732 * cos(a)", y2: "-r * 1.2732 * sin(a)", tone: "muted", width: 1 },
            {
              kind: "line",
              x1: "r * 1.2732 * cos(a)",
              y1: "-r * 1.2732 * sin(a)",
              x2: "r * (1.2732 * cos(a) + 0.4244 * cos(3 * a))",
              y2: "-r * (1.2732 * sin(a) + 0.4244 * sin(3 * a))",
              tone: "muted",
              width: 1,
            },
            {
              kind: "line",
              x1: "r * (1.2732 * cos(a) + 0.4244 * cos(3 * a))",
              y1: "-r * (1.2732 * sin(a) + 0.4244 * sin(3 * a))",
              x2: "r * (1.2732 * cos(a) + 0.4244 * cos(3 * a) + 0.2546 * cos(5 * a))",
              y2: "-r * (1.2732 * sin(a) + 0.4244 * sin(3 * a) + 0.2546 * sin(5 * a))",
              tone: "muted",
              width: 1,
            },
            { kind: "dot", cx: "r * 1.2732 * cos(a)", cy: "-r * 1.2732 * sin(a)", r: 2, tone: "ink" },
            {
              kind: "dot",
              cx: "r * (1.2732 * cos(a) + 0.4244 * cos(3 * a))",
              cy: "-r * (1.2732 * sin(a) + 0.4244 * sin(3 * a))",
              r: 2,
              tone: "ink",
            },
            {
              kind: "dot",
              cx: "r * (1.2732 * cos(a) + 0.4244 * cos(3 * a) + 0.2546 * cos(5 * a))",
              cy: "-r * (1.2732 * sin(a) + 0.4244 * sin(3 * a) + 0.2546 * sin(5 * a))",
              r: 3,
              tone: "ink",
            },
          ],
        },
        { kind: "line", x1: "px", y1: "py", x2: 320, y2: "py", tone: "accent", width: 1 },
        {
          kind: "path",
          tone: "ink",
          width: 2,
          d: "M 320 {{cy - r * (1.2732 * sin(a) + 0.4244 * sin(3*a) + 0.2546 * sin(5*a))}} L 344 {{cy - r * (1.2732 * sin(a-0.1) + 0.4244 * sin(3*a-0.3) + 0.2546 * sin(5*a-0.5))}} L 368 {{cy - r * (1.2732 * sin(a-0.2) + 0.4244 * sin(3*a-0.6) + 0.2546 * sin(5*a-1))}} L 392 {{cy - r * (1.2732 * sin(a-0.3) + 0.4244 * sin(3*a-0.9) + 0.2546 * sin(5*a-1.5))}} L 416 {{cy - r * (1.2732 * sin(a-0.4) + 0.4244 * sin(3*a-1.2) + 0.2546 * sin(5*a-2))}} L 440 {{cy - r * (1.2732 * sin(a-0.5) + 0.4244 * sin(3*a-1.5) + 0.2546 * sin(5*a-2.5))}} L 464 {{cy - r * (1.2732 * sin(a-0.6) + 0.4244 * sin(3*a-1.8) + 0.2546 * sin(5*a-3))}} L 488 {{cy - r * (1.2732 * sin(a-0.7) + 0.4244 * sin(3*a-2.1) + 0.2546 * sin(5*a-3.5))}} L 512 {{cy - r * (1.2732 * sin(a-0.8) + 0.4244 * sin(3*a-2.4) + 0.2546 * sin(5*a-4))}} L 536 {{cy - r * (1.2732 * sin(a-0.9) + 0.4244 * sin(3*a-2.7) + 0.2546 * sin(5*a-4.5))}} L 560 {{cy - r * (1.2732 * sin(a-1) + 0.4244 * sin(3*a-3) + 0.2546 * sin(5*a-5))}} L 584 {{cy - r * (1.2732 * sin(a-1.1) + 0.4244 * sin(3*a-3.3) + 0.2546 * sin(5*a-5.5))}} L 608 {{cy - r * (1.2732 * sin(a-1.2) + 0.4244 * sin(3*a-3.6) + 0.2546 * sin(5*a-6))}} L 632 {{cy - r * (1.2732 * sin(a-1.3) + 0.4244 * sin(3*a-3.9) + 0.2546 * sin(5*a-6.5))}} L 656 {{cy - r * (1.2732 * sin(a-1.4) + 0.4244 * sin(3*a-4.2) + 0.2546 * sin(5*a-7))}} L 680 {{cy - r * (1.2732 * sin(a-1.5) + 0.4244 * sin(3*a-4.5) + 0.2546 * sin(5*a-7.5))}}",
        },
        { kind: "label", x: 12, y: 20, text: "Square wave = sum of odd harmonics (1×, 3×, 5×)", size: 11 },
        { kind: "label", x: "cx", y: "cy + r * 1.5 + 16", text: "three circles, one pen", anchor: "middle", size: 10 },
        { kind: "label", x: 320, y: 20, text: "pen height, sampled rightward", size: 10 },
      ],
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/demo-examples.test.ts`
Expected: PASS — the new test plus the existing schema-validity and type-coverage tests (the schema-valid run also proves every derived expr ≤ 80 chars, params ordered, and all expressions resolve: schema catches the first two, and a later full-render check catches the third).

- [ ] **Step 5: Render-level verification (slots resolve at compile time)**

Run: `npm run typecheck && npx vitest run tests/figures/authored.test.ts tests/figure.test.ts`
Expected: green. Then prove the demo figure actually compiles with zero salvage warnings:

```bash
node -e "import('./demo/examples.js').then(async m => { const { renderExplanation } = await import('./dist/index.js'); const r = renderExplanation(m.figuresIr); console.log('warnings:', r.warnings.length); if (r.warnings.length) console.log(r.warnings); })"
```

Expected output: `warnings: 0`. **This requires a build first** — run `npm run build` before it (the demo server imports `dist/`). If any warning appears, fix the fixture (a dropped element means an expression mis-resolves) and re-run until zero.

- [ ] **Step 6: Visual smoke check (optional but recommended)**

Run: `npm run demo` and open `http://localhost:4173#figures` — the epicycles figure appears in both the clean and sketch sections (the server renders `figuresIr` twice; no server change needed). Confirm the wave looks square-ish with small Gibbs ripples and the connector is horizontal. Stop the server with Ctrl-C.

- [ ] **Step 7: Commit**

```bash
git add demo/examples.js tests/demo-examples.test.ts
git commit -m "$(cat <<'EOF'
demo: Fourier epicycles figure showcasing path slots and derived chains

Three epicycles (1×, 3×, 5×) sum to a square wave: params t/r drive a
derived chain, an expression-offset group holds the circle stack, and
the wave is 16 sampled points authored as {{expr}} path slots.

🤖 Generated with Codebuff
Co-Authored-By: Codebuff <noreply@codebuff.com>
EOF
)"
```

---

### Task 4: Roadmap bookkeeping + full verification

**Files:**
- Modify: `docs/ROADMAP.md` (Shipped bullet in; backlog line out)

**Interfaces:** none — docs only.

- [ ] **Step 1: Update ROADMAP.md**

In the `## Shipped` section, append this bullet after the bespoke-figures bullet:

```markdown
- **Path slots + epicycles showcase** (2026-09-29) — authored `path` d strings
  accept `{{expr}}` slots (evaluated against params/derived, grammar-gated
  after expansion); the demo gains a Fourier-epicycles figure exercising
  params, derived chains, expression-offset groups and slots. Spec:
  `docs/superpowers/specs/2026-09-29-path-slots-epicycles-demo-design.md`.
```

In the `## Backlog` section, delete this line (this work fulfills it):

```markdown
- Demo gallery of bespoke figures (step-1 follow-up polish).
```

- [ ] **Step 2: Full verification**

Run: `npm test && npm run typecheck && npm run build`
Expected: all suites green, no type errors, clean build.

- [ ] **Step 3: Commit**

```bash
git add docs/ROADMAP.md
git commit -m "$(cat <<'EOF'
docs: record path slots + epicycles showcase as shipped

🤖 Generated with Codebuff
Co-Authored-By: Codebuff <noreply@codebuff.com>
EOF
)"
```

---

## Self-Review (done at plan-writing time)

- **Spec coverage:** slots in `path.d` only (Task 1); 64-slot / 80-char caps and post-expansion grammar + MAX_LEN gates (Task 1 tests); salvage isolation (Task 1); prompt guidance (Task 2); epicycles figure with live `t`/`r`, derived chain, group, arcs, dots, labels, 16-slot wave, both demo sections (Task 3); roadmap (Task 4). No schema/grammar/svg/sketch changes — matches spec.
- **Placeholders:** none — every code step carries complete code; the long `d` string is written out in full.
- **Type consistency:** `expandPathSlots(d, env, warn)` used exactly as defined; warning codes match between implementation and tests; demo test reads `figuresIr` fields that exist (`title`, `elements`, `d`).
