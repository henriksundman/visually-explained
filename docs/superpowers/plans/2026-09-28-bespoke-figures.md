# Bespoke LLM-Authored Figures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an LLM author bespoke parametrized figures as data (Scene-JSON with expressions) that render to themed, sketchable, progressively-drawn SVG — static render with initial param values, format ready for the future interactive runtime.

**Architecture:** New authored-figure layer (`src/figures/authored.ts`) accepts expression-bearing elements, resolves them against `params`/`derived` via a new hand-rolled evaluator (`src/figures/expr.ts`), validates path data against a whitelist grammar (`src/figures/pathGrammar.ts`), and compiles into the existing internal numeric `Scene` that `sceneToSvg` already renders. A new `figure` primitive wires it into the registry; nothing downstream changes.

**Tech Stack:** TypeScript, zod ^4, roughjs ^4.6.6, vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-28-bespoke-figures-design.md`

## Global Constraints

- **Scene JSON, never raw SVG** — the LLM emits data; `d` strings pass `isSafePathD` before use; all text is `escapeHtml`ed at emit (existing `svg.ts` discipline).
- **Dependency-free** — the expression evaluator is hand-rolled recursive descent. No `eval`, no `new Function`, no new packages.
- **Lenient salvage** — invalid elements drop individually with a warning (`ctx.addWarning`); an empty scene renders `exp-fig-empty` copy; a render never throws on bad model output.
- **Determinism** — no `Date.now`/`Math.random` in any new module; sketch randomness only via existing `seedNumber`.
- **Number formatting** — use `n2()` semantics (`String(Math.round(v * 100) / 100)`) everywhere coordinates hit `d` strings or attributes.
- **Colors** — only named tones `"ink" | "muted" | "accent"`, mapped to `var(--exp-ink)` / `var(--exp-text-muted)` / `var(--exp-accent)` at emit time. Never literal hex.
- **Element cap** — a compiled scene keeps at most `MAX_ELEMENTS = 60` elements; excess drops with a warning.
- **Guard object lookups with `Object.hasOwn`** in the evaluator (prototype keys like `constructor`/`__proto__` must not resolve).
- **Commit style** — conventional commits with the Codebuff trailer, one commit per task.
- **Theme coverage** — every `exp-*` class emitted by suite-visible code must exist in `src/themes/{tokens,light,dark}.css` (`tests/themes.test.ts` enforces via `allPrimitivesIr`).

## File Structure

| File | Responsibility |
|---|---|
| `src/figures/expr.ts` (new) | Expression tokenizer/parser/evaluator. Pure, cached-AST. |
| `src/figures/pathGrammar.ts` (new) | `isSafePathD(d): boolean` whitelist scanner. Pure. |
| `src/figures/authored.ts` (new) | Authored types (`FigureEl`, `AuthoredFigure`), lenient `parseFigureElement`, `compileFigure` → internal `Scene`. |
| `src/figures/scene.ts` (modify) | Add 5 internal element kinds + `FigureTone`. |
| `src/figures/svg.ts` (modify) | Clean-SVG compile cases + tone→var map consumer. |
| `src/figures/sketch.ts` (modify) | rough.js cases + `FIGURE_TONE_VAR` map owner. |
| `src/core/schema.ts` (modify) | `figureParamSchema`, `figureDerivedSchema`, `figureBlockSchema`, `FigureBlock`, Block union entry. |
| `src/primitives/figure.ts` (new) | `renderFigure` + `registerPrimitive("figure", …)`. |
| `src/core/registerAll.ts` (modify) | Import `../primitives/figure`. |
| `src/core/llm.ts` (modify) | Prompt documentation for `figure`. |
| `src/themes/tokens.css` (modify) | 5 new classes. |
| `tests/figures/expr.test.ts`, `tests/figures/path-grammar.test.ts`, `tests/figures/authored.test.ts` (new) | Unit tests. |
| `tests/figures/svg.test.ts`, `tests/figures/sketch.test.ts` (modify) | Element-kind tests. |
| `tests/figure.test.ts` (new) | Primitive + salvage + degradation. |
| `tests/presentation.test.ts` (modify) | Prompt guidance coverage. |
| `tests/fixtures.ts` (modify) | `allPrimitivesIr` gains a figure block. |
| `demo/examples.js`, `tests/demo-examples.test.ts` (modify) | Demo bespoke figure. |

---

### Task 1: Expression evaluator (`src/figures/expr.ts`)

**Files:**
- Create: `src/figures/expr.ts`
- Test: `tests/figures/expr.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (used by Tasks 3 and the future runtime):
  - `export class ExprError extends Error`
  - `export type ExprAst` (opaque union)
  - `export function parseExpr(src: string): ExprAst` — throws `ExprError`
  - `export function evalExpr(ast: ExprAst, env: Readonly<Record<string, number>>): number` — throws `ExprError`
  - `export function evaluate(src: string, env: Readonly<Record<string, number>>): number` — parse+eval convenience, throws `ExprError`

- [ ] **Step 1: Write the failing test**

Create `tests/figures/expr.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { evalExpr, evaluate, ExprError, parseExpr } from "../../src/figures/expr"

describe("arithmetic and precedence", () => {
  it.each([
    ["1 + 2 * 3", 7],
    ["(1 + 2) * 3", 9],
    ["2 ^ 3 ^ 2", 512], // ^ is right-associative
    ["1 - 2 - 3", -4], // - is left-associative
    ["-3 + 5", 2],
    ["2 * -3", -6],
    ["10 % 3", 1],
    ["7 / 2", 3.5],
    ["0.5 * 4", 2],
    ["100 / 10 / 5", 2],
  ])("%s → %n", (src, expected) => {
    expect(evaluate(src, {})).toBeCloseTo(expected as number)
  })
})

describe("functions and constants", () => {
  it("evaluates the fixed function table", () => {
    expect(evaluate("sin(PI/2)", {})).toBeCloseTo(1)
    expect(evaluate("cos(0)", {})).toBe(1)
    expect(evaluate("max(2, 7)", {})).toBe(7)
    expect(evaluate("min(2, 7)", {})).toBe(2)
    expect(evaluate("hypot(3, 4)", {})).toBe(5)
    expect(evaluate("floor(2.9)", {})).toBe(2)
    expect(evaluate("ceil(2.1)", {})).toBe(3)
    expect(evaluate("round(2.5)", {})).toBe(3)
    expect(evaluate("abs(-5)", {})).toBe(5)
    expect(evaluate("sqrt(16)", {})).toBe(4)
    expect(evaluate("pow(2, 10)", {})).toBe(1024)
    expect(evaluate("atan2(0, 1)", {})).toBeCloseTo(0)
    expect(evaluate("exp(0)", {})).toBe(1)
    expect(evaluate("log(E)", {})).toBeCloseTo(1)
    expect(evaluate("sign(-9)", {})).toBe(-1)
  })

  it("exposes PI, E, TAU", () => {
    expect(evaluate("PI", {})).toBeCloseTo(Math.PI)
    expect(evaluate("E", {})).toBeCloseTo(Math.E)
    expect(evaluate("TAU", {})).toBeCloseTo(Math.PI * 2)
  })
})

describe("environment", () => {
  it("resolves params from env", () => {
    expect(evaluate("a * b", { a: 3, b: 4 })).toBe(12)
  })
  it("env shadows nothing weirdly: consts win over same-named env keys", () => {
    expect(evaluate("PI", { PI: 3 })).toBeCloseTo(Math.PI)
  })
})

describe("rejection", () => {
  it.each([
    "1 +",
    ")",
    "(1",
    "foo(1)", // unknown function
    "1 ? 2 : 3",
    "a; b",
    "1..2",
    "1e", // dangling exponent
    "eval", // identifier, unknown at eval
    "constructor", // prototype key must not resolve
    "__proto__",
    "toString",
  ])("rejects %s", src => {
    expect(() => evaluate(src, {})).toThrow(ExprError)
  })

  it("rejects unknown identifiers at eval time, not parse time", () => {
    const ast = parseExpr("x + 1")
    expect(() => evalExpr(ast, {})).toThrow(ExprError)
  })

  it("rejects hostile characters", () => {
    for (const src of ["1 < 2", "{1}", "a`b", "1 # 2", "a && b"]) {
      expect(() => evaluate(src, {})).toThrow(ExprError)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/figures/expr.test.ts`
Expected: FAIL — "Cannot find module '../../src/figures/expr'" (or equivalent resolution error).

- [ ] **Step 3: Write the implementation**

Create `src/figures/expr.ts`:

```ts
/** Safe arithmetic expression evaluator for authored figures (spec §5).
 *  Hand-rolled recursive descent: no eval, no new Function, no host access.
 *  Parse once per expression when a scene loads; evaluate many times later —
 *  the cached AST is what makes the future interactive runtime cheap. */

export class ExprError extends Error {
  constructor(message: string) {
    super(`expr: ${message}`)
    this.name = "ExprError"
  }
}

type Node =
  | { t: "num"; v: number }
  | { t: "var"; name: string }
  | { t: "un"; op: "-"; a: Node }
  | { t: "bin"; op: "+" | "-" | "*" | "/" | "%" | "^"; a: Node; b: Node }
  | { t: "call"; fn: string; args: Node[] }

/** The fixed function table — no host access beyond pure Math functions. */
const FUNCS: Record<string, (...args: number[]) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  atan2: Math.atan2,
  sqrt: Math.sqrt,
  abs: Math.abs,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
  log: Math.log,
  exp: Math.exp,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sign: Math.sign,
  hypot: Math.hypot,
}

const CONSTS: Record<string, number> = { PI: Math.PI, E: Math.E, TAU: Math.PI * 2 }

type Tok = { k: "num" | "id" | "op"; v: string }

function tokenize(src: string): Tok[] {
  const toks: Tok[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]!
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++
      continue
    }
    if (c >= "0" && c <= "9") {
      let j = i
      while (j < src.length && ((src[j]! >= "0" && src[j]! <= "9") || src[j] === ".")) j++
      const v = src.slice(i, j)
      if ((v.match(/\./g) ?? []).length > 1) throw new ExprError(`bad number "${v}"`)
      toks.push({ k: "num", v })
      i = j
      continue
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j]!)) j++
      toks.push({ k: "id", v: src.slice(i, j) })
      i = j
      continue
    }
    if ("+-*/%^(),".includes(c)) {
      toks.push({ k: "op", v: c })
      i++
      continue
    }
    throw new ExprError(`unexpected character "${c}"`)
  }
  return toks
}

export function parseExpr(src: string): ExprAst {
  const toks = tokenize(src)
  let pos = 0
  const peek = () => toks[pos]
  const eat = (v: string): boolean => {
    if (toks[pos]?.k === "op" && toks[pos]!.v === v) {
      pos++
      return true
    }
    return false
  }
  const expect = (v: string): void => {
    if (!eat(v)) throw new ExprError(`expected "${v}"`)
  }

  function primary(): Node {
    const t = peek()
    if (!t) throw new ExprError("unexpected end of expression")
    if (t.k === "num") {
      pos++
      return { t: "num", v: Number(t.v) }
    }
    if (t.k === "id") {
      pos++
      if (eat("(")) {
        const args: Node[] = []
        if (!eat(")")) {
          do {
            args.push(additive())
          } while (eat(","))
          expect(")")
        }
        if (!Object.hasOwn(FUNCS, t.v)) throw new ExprError(`unknown function "${t.v}"`)
        return { t: "call", fn: t.v, args }
      }
      return { t: "var", name: t.v }
    }
    if (t.v === "(") {
      pos++
      const e = additive()
      expect(")")
      return e
    }
    throw new ExprError(`unexpected "${t.v}"`)
  }

  function unary(): Node {
    if (eat("-")) return { t: "un", op: "-", a: unary() }
    return primary()
  }

  function power(): Node {
    const base = unary()
    if (eat("^")) return { t: "bin", op: "^", a: base, b: power() } // right-assoc
    return base
  }

  function multiplicative(): Node {
    let a = power()
    for (;;) {
      if (eat("*")) a = { t: "bin", op: "*", a, b: power() }
      else if (eat("/")) a = { t: "bin", op: "/", a, b: power() }
      else if (eat("%")) a = { t: "bin", op: "%", a, b: power() }
      else return a
    }
  }

  function additive(): Node {
    let a = multiplicative()
    for (;;) {
      if (eat("+")) a = { t: "bin", op: "+", a, b: multiplicative() }
      else if (eat("-")) a = { t: "bin", op: "-", a, b: multiplicative() }
      else return a
    }
  }

  const out = additive()
  if (pos < toks.length) throw new ExprError(`unexpected "${String(toks[pos]!.v)}"`)
  return out
}

/** Public AST type — opaque to consumers; produced only by parseExpr. */
export type ExprAst = Node

export function evalExpr(ast: ExprAst, env: Readonly<Record<string, number>>): number {
  switch (ast.t) {
    case "num":
      return ast.v
    case "var": {
      if (Object.hasOwn(CONSTS, ast.name)) return CONSTS[ast.name]!
      if (Object.hasOwn(env, ast.name)) return env[ast.name]!
      throw new ExprError(`unknown identifier "${ast.name}"`)
    }
    case "un":
      return -evalExpr(ast.a, env)
    case "bin": {
      const a = evalExpr(ast.a, env)
      const b = evalExpr(ast.b, env)
      switch (ast.op) {
        case "+":
          return a + b
        case "-":
          return a - b
        case "*":
          return a * b
        case "/":
          return a / b
        case "%":
          return a % b
        case "^":
          return Math.pow(a, b)
      }
    }
    case "call":
      return FUNCS[ast.fn]!(...ast.args.map(a => evalExpr(a, env)))
  }
}

export function evaluate(src: string, env: Readonly<Record<string, number>>): number {
  return evalExpr(parseExpr(src), env)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/figures/expr.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/figures/expr.ts tests/figures/expr.test.ts
git commit -m "$(cat <<'EOF'
feat(figures): safe hand-rolled expression evaluator for authored figures

Recursive-descent parser with fixed function table and constants; no eval,
no host access, prototype-key-safe via Object.hasOwn. Cached AST for the
future interactive runtime.

🤖 Generated with Codebuff
Co-Authored-By: Codebuff <noreply@codebuff.com>
EOF
)"
```

---

### Task 2: Path `d` grammar (`src/figures/pathGrammar.ts`)

**Files:**
- Create: `src/figures/pathGrammar.ts`
- Test: `tests/figures/path-grammar.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export function isSafePathD(d: string): boolean` — true only for `d` strings using `M L H V C S Q T A Z` (and lowercase) commands, numbers, and valid arc flags. Used by Task 3 (`compileFigure`).

- [ ] **Step 1: Write the failing test**

Create `tests/figures/path-grammar.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { isSafePathD } from "../../src/figures/pathGrammar"

describe("isSafePathD", () => {
  it("accepts well-formed path data", () => {
    const ok = [
      "M 0 0 L 10 10",
      "M0,0 L10,10",
      "M 0 0 C 10 0 10 20 20 20",
      "m 0 0 l 5 5 z",
      "M 0 0 A 5 5 0 0 1 10 10",
      "M 0 0 A 5 5 0 1 0 10 10 L 20 10",
      "M 0 0 L 1e2 10",
      "M 0 0 L -5.5 +3",
      "M 1 2 3 4", // implicit lineto repeat
      "Z",
      "M 0 0 Z",
      "M 0 0 H 10 V 10 H 0 Z",
      "M 0 0 Q 5 5 10 0 T 20 0",
      "M 0 0 S 5 5 10 10",
      "  M 0 0 L 10 10  ",
    ]
    for (const d of ok) expect(isSafePathD(d), d).toBe(true)
  })

  it("rejects malformed or hostile input", () => {
    const bad = [
      "", // empty
      "10 10", // number before any command
      "M 0 0 X 5", // unknown command letter
      "M 0 0 < 5", // injection attempt
      "M {x} 0 L 5 5", // template injection
      "M 0 0 L 1e 5", // dangling exponent
      "M 0 0 A 5 5 0 2 1 10 10", // arc flag out of range
      "M 0 0 A 5 5 0 0 1.5 10 10", // arc flag not 0/1
      "M 0 0 L 1 2 3", // dangling parameter
      "M 0 0 Z 3", // numbers after Z
      "M 0 0;drop", // semicolon
      "M 0 0 L", // command with no parameters
      "M 0 0 L M 5 5", // command swallowed with no parameters
      "M 0 0 L " + "5 ".repeat(5000), // length cap
    ]
    for (const d of bad) expect(isSafePathD(d), JSON.stringify(d.slice(0, 40))).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/figures/path-grammar.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/figures/pathGrammar.ts`:

```ts
/** Strict whitelist validation for authored SVG path `d` strings (spec §Path
 *  Grammar). Only M/L/H/V/C/S/Q/T/A/Z commands (both cases), numbers, and
 *  valid arc flags pass. Anything else — unknown letters, markup, entity
 *  encodings — rejects, so authored path data can never carry injection. */

const ARITY: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 }

const MAX_LEN = 4096

export function isSafePathD(d: string): boolean {
  if (typeof d !== "string" || d.length === 0 || d.length > MAX_LEN) return false
  let i = 0
  let cmd = ""
  let count = 0 // parameters consumed by the current command instance
  let sawCommand = false
  const isDigit = (c: string) => c >= "0" && c <= "9"
  const isCommand = (c: string) => "MLHVCSQTAZmlhvcsqtaz".includes(c)
  const up = (): string => cmd.toUpperCase()

  /** Reads a number (sign, digits, optional decimal, optional exponent). */
  function readNumber(): boolean {
    if (d[i] === "+" || d[i] === "-") i++
    let digits = 0
    while (i < d.length && isDigit(d[i]!)) {
      i++
      digits++
    }
    if (d[i] === ".") {
      i++
      while (i < d.length && isDigit(d[i]!)) {
        i++
        digits++
      }
    }
    if (digits === 0) return false
    if (d[i] === "e" || d[i] === "E") {
      const save = i
      i++
      if (d[i] === "+" || d[i] === "-") i++
      let ed = 0
      while (i < d.length && isDigit(d[i]!)) {
        i++
        ed++
      }
      if (ed === 0) {
        i = save
        return false // "1e" is not a number
      }
    }
    return true
  }

  while (i < d.length) {
    const c = d[i]!
    if (c === " " || c === "," || c === "\t" || c === "\n" || c === "\r") {
      i++
      continue
    }
    if (isCommand(c)) {
      // A new command may not start while the previous one got no parameters
      // (Z excepted — it takes none).
      if (sawCommand && up() !== "Z" && count === 0) return false
      cmd = c
      count = 0
      sawCommand = true
      i++
      continue
    }
    if (c === "+" || c === "-" || c === "." || isDigit(c)) {
      if (!sawCommand) return false
      // Arc flags (4th and 5th params of A/a, after rx ry rot) must be a bare 0 or 1.
      if (up() === "A" && (count === 3 || count === 4)) {
        if (c !== "0" && c !== "1") return false
        i++
        const nxt = d[i]
        if (nxt !== undefined && (isDigit(nxt) || nxt === ".")) return false
        count++
        continue
      }
      if (!readNumber()) return false
      count++
      continue
    }
    return false // any other character rejects
  }

  if (!sawCommand) return false
  const u = up()
  if (u === "Z") return count === 0
  return count > 0 && count % ARITY[u] === 0
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/figures/path-grammar.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/figures/pathGrammar.ts tests/figures/path-grammar.test.ts
git commit -m "$(cat <<'EOF'
feat(figures): whitelist grammar validator for authored path data

Imperative scanner accepting only SVG path commands/numbers; arc flags
constrained to 0/1, dangling parameters and hostile characters rejected.

🤖 Generated with Codebuff
Co-Authored-By: Codebuff <noreply@codebuff.com>
EOF
)"
```

---

### Task 3: Authored figure model + compiler (`src/figures/authored.ts`, `scene.ts` kinds)

**Files:**
- Modify: `src/figures/scene.ts` (append 5 element kinds + `FigureTone`)
- Create: `src/figures/authored.ts`
- Test: `tests/figures/authored.test.ts`

**Interfaces:**
- Consumes: `evaluate`/`ExprError` (Task 1), `isSafePathD` (Task 2), `FigureParam`/`FigureDerived` types from `src/core/schema` (added in Task 5 — declare the imports now; Task 5 adds the schema). To keep Task 3 self-contained, define `AuthoredFigure`'s param/derived shapes structurally here and have Task 5's zod schemas produce compatible objects.
- Produces (used by Tasks 4–6):
  - `export type Tone = "ink" | "muted" | "accent"`, `export type Num = number | string`, `export interface XY { x: Num; y: Num }`
  - `export type FigureEl` (union: path/curve/arc/box/line/dot/label/group)
  - `export interface AuthoredFigure { title?; caption?; width?; height?; params?; derived?; elements: FigureEl[] }`
  - `export function parseFigureElement(raw: unknown, warn: (m: string) => void): FigureEl | null` — lenient per-element parse
  - `export function compileFigure(figure: AuthoredFigure): { scene: Scene; warnings: string[] }`

- [ ] **Step 1: Write the failing test**

Create `tests/figures/authored.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { compileFigure, parseFigureElement } from "../../src/figures/authored"

describe("compileFigure", () => {
  it("resolves numeric fields from params and derived values", () => {
    const { scene, warnings } = compileFigure({
      params: [{ name: "t", min: 0, max: 10, step: 0.5, initial: 5 }],
      derived: [{ name: "d", expr: "t * 2" }],
      elements: [
        { kind: "box", x: "10 + t", y: "d", w: 50, h: 20 },
        { kind: "label", x: "t", y: 10, text: "pos" },
      ],
    })
    expect(warnings).toEqual([])
    const box = scene.elements[0] as { kind: string; x: number; y: number }
    expect(box.x).toBe(15)
    expect(box.y).toBe(10)
    const label = scene.elements[1] as { x: number }
    expect(label.x).toBe(5)
  })

  it("compiles curve and arc into safe path d strings", () => {
    const { scene, warnings } = compileFigure({
      elements: [
        { kind: "curve", from: { x: 0, y: 0 }, cp1: { x: 10, y: 0 }, cp2: { x: 10, y: 20 }, to: { x: 20, y: 20 } },
        { kind: "arc", cx: 50, cy: 50, rx: 20, ry: 10, start: 0, end: 90 },
      ],
    })
    expect(warnings).toEqual([])
    const curve = scene.elements[0] as { kind: string; d: string }
    expect(curve.kind).toBe("figure-path")
    expect(curve.d).toMatch(/^M 0 0 C /)
    const arc = scene.elements[1] as { d: string }
    expect(arc.d).toContain(" A 20 10 0 0 1 ")
  })

  it("sets the large-arc flag for arcs over 180°", () => {
    const { scene } = compileFigure({
      elements: [{ kind: "arc", cx: 50, cy: 50, rx: 20, ry: 20, start: 0, end: 270 }],
    })
    expect((scene.elements[0] as { d: string }).d).toContain(" A 20 20 0 1 1 ")
  })

  it("applies group offsets to coordinate elements, bakes them into curve/arc, and leaves authored paths absolute", () => {
    const { scene, warnings } = compileFigure({
      elements: [
        {
          kind: "group",
          dx: 10,
          dy: "5",
          elements: [
            { kind: "dot", cx: 1, cy: 2 },
            { kind: "curve", from: { x: 0, y: 0 }, cp1: { x: 1, y: 0 }, cp2: { x: 1, y: 1 }, to: { x: 2, y: 2 } },
            { kind: "path", d: "M 0 0 L 5 5" },
          ],
        },
      ],
    })
    expect(warnings).toEqual([])
    const dot = scene.elements[0] as { cx: number; cy: number }
    expect(dot.cx).toBe(11)
    expect(dot.cy).toBe(7)
    const curve = scene.elements[1] as { d: string }
    expect(curve.d).toContain("M 10 5")
    const path = scene.elements[2] as { d: string }
    expect(path.d).toBe("M 0 0 L 5 5") // authored d is never rewritten
  })

  it("rejects nested groups with a warning", () => {
    const warnings: string[] = []
    const inner = parseFigureElement({ kind: "dot", cx: 0, cy: 0 }, m => warnings.push(m))
    const outer = parseFigureElement(
      { kind: "group", elements: [{ kind: "group", elements: inner ? [inner] : [] }] },
      m => warnings.push(m),
    )
    const { scene } = compileFigure({ elements: outer ? [outer] : [] })
    expect(warnings.some(w => w.includes("group"))).toBe(true)
    expect(scene.elements).toEqual([])
  })

  it("drops elements with unresolvable expressions and reports them", () => {
    const { scene, warnings } = compileFigure({
      params: [{ name: "t", min: 0, max: 5, step: 1, initial: 1 }],
      elements: [
        { kind: "dot", cx: "nope + 1", cy: 5 },
        { kind: "dot", cx: "1/0", cy: 5 },
        { kind: "dot", cx: 3, cy: 4 },
      ],
    })
    expect(scene.elements).toHaveLength(1)
    expect(warnings).toHaveLength(2)
  })

  it("rejects unsafe path d at compile time", () => {
    const { scene, warnings } = compileFigure({
      elements: [{ kind: "path", d: "M 0 0 < 5" }],
    })
    expect(scene.elements).toEqual([])
    expect(warnings[0]).toContain("figure-path-unsafe")
  })

  it("caps the scene at 60 elements with a warning", () => {
    const elements = Array.from({ length: 70 }, () => ({ kind: "dot", cx: 1, cy: 1 }) as const)
    const { scene, warnings } = compileFigure({ elements: [...elements] })
    expect(scene.elements).toHaveLength(60)
    expect(warnings.some(w => w.includes("figure-too-many"))).toBe(true)
  })

  it("defaults canvas to 360×240 and honors overrides", () => {
    expect(compileFigure({ elements: [] }).scene.width).toBe(360)
    expect(compileFigure({ elements: [] }).scene.height).toBe(240)
    expect(compileFigure({ width: 500, height: 100, elements: [] }).scene.width).toBe(500)
  })
})

describe("parseFigureElement", () => {
  it("parses every kind leniently", () => {
    const warnings: string[] = []
    const warn = (m: string) => warnings.push(m)
    expect(parseFigureElement({ kind: "path", d: "M 0 0 L 1 1", tone: "ink", width: "w" }, warn)).toMatchObject({ kind: "path" })
    expect(parseFigureElement({ kind: "curve", from: { x: 0, y: 0 }, cp1: { x: 0, y: 0 }, cp2: { x: 1, y: 1 }, to: { x: 2, y: 2 } }, warn)).toMatchObject({ kind: "curve" })
    expect(parseFigureElement({ kind: "arc", cx: 0, cy: 0, rx: 1, ry: 1, start: 0, end: 90 }, warn)).toMatchObject({ kind: "arc" })
    expect(parseFigureElement({ kind: "box", x: 0, y: 0, w: 10, h: 5, label: "L" }, warn)).toMatchObject({ kind: "box" })
    expect(parseFigureElement({ kind: "line", x1: 0, y1: 0, x2: 1, y2: 1 }, warn)).toMatchObject({ kind: "line" })
    expect(parseFigureElement({ kind: "dot", cx: 1, cy: 2 }, warn)).toMatchObject({ kind: "dot" })
    expect(parseFigureElement({ kind: "label", x: 0, y: 0, text: "hi" }, warn)).toMatchObject({ kind: "label" })
    expect(parseFigureElement({ kind: "group", elements: [] }, warn)).toMatchObject({ kind: "group" })
    expect(warnings).toEqual([])
  })

  it("returns null with a warning for garbage", () => {
    const warnings: string[] = []
    const warn = (m: string) => warnings.push(m)
    expect(parseFigureElement(null, warn)).toBeNull()
    expect(parseFigureElement({ kind: "wedge" }, warn)).toBeNull()
    expect(parseFigureElement({ kind: "path" }, warn)).toBeNull() // missing d
    expect(parseFigureElement({ kind: "dot", cx: "x" }, warn)).toBeNull() // missing cy
    expect(parseFigureElement({ kind: "label", x: 0, y: 0, text: "  " }, warn)).toBeNull() // empty text
    expect(parseFigureElement({ kind: "dot", cx: 0, cy: 0, tone: "chartreuse" }, warn)).toBeNull()
    expect(warnings.length).toBeGreaterThanOrEqual(6)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/figures/authored.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Add the internal Scene element kinds**

Append to `src/figures/scene.ts` (after `SparklineEl`, before the `SceneElement` union):

```ts
export type FigureTone = "ink" | "muted" | "accent"

export interface FigurePathEl {
  kind: "figure-path"
  d: string
  tone: FigureTone
  fill: FigureTone | null
  width: number
}

export interface FigureBoxEl {
  kind: "figure-box"
  x: number
  y: number
  w: number
  h: number
  r: number
  label: string | null
  tone: FigureTone
  fill: FigureTone | null
}

export interface FigureLineEl {
  kind: "figure-line"
  x1: number
  y1: number
  x2: number
  y2: number
  tone: FigureTone
  width: number
}

export interface FigureDotEl {
  kind: "figure-dot"
  cx: number
  cy: number
  r: number
  tone: FigureTone
}

export interface FigureLabelEl {
  kind: "figure-label"
  x: number
  y: number
  text: string
  size: number
  anchor: "start" | "middle" | "end"
}
```

Extend the union in place:

```ts
export type SceneElement =
  | NodeBoxEl
  | ArrowEl
  | LabelEl
  | AxisEl
  | BarEl
  | LinePathEl
  | DotEl
  | SparklineEl
  | FigurePathEl
  | FigureBoxEl
  | FigureLineEl
  | FigureDotEl
  | FigureLabelEl
```

- [ ] **Step 4: Write the implementation**

Create `src/figures/authored.ts`:

```ts
/** Authored figure model — what the LLM emits for `figure` blocks (spec §2).
 *  parseFigureElement leniently accepts unknown JSON; compileFigure resolves
 *  every expression against params/derived, flattens groups, and emits the
 *  internal numeric Scene that sceneToSvg consumes. Scene's invariant "no
 *  expressions, no groups, numeric only" is preserved. */

import { evaluate } from "./expr"
import { isSafePathD } from "./pathGrammar"
import type { FigureBoxEl, FigureDotEl, FigureLabelEl, FigureLineEl, FigurePathEl, FigureTone, Scene, SceneElement } from "./scene"

export type Tone = FigureTone
export type Num = number | string
export interface XY {
  x: Num
  y: Num
}

export type FigureEl =
  | { kind: "path"; d: string; tone?: Tone; fill?: Tone; width?: Num }
  | { kind: "curve"; from: XY; cp1: XY; cp2: XY; to: XY; tone?: Tone; width?: Num }
  | { kind: "arc"; cx: Num; cy: Num; rx: Num; ry: Num; start: Num; end: Num; tone?: Tone; width?: Num }
  | { kind: "box"; x: Num; y: Num; w: Num; h: Num; r?: Num; label?: string; tone?: Tone; fill?: Tone }
  | { kind: "line"; x1: Num; y1: Num; x2: Num; y2: Num; tone?: Tone; width?: Num }
  | { kind: "dot"; cx: Num; cy: Num; r?: Num; tone?: Tone }
  | { kind: "label"; x: Num; y: Num; text: string; size?: Num; anchor?: "start" | "middle" | "end" }
  | { kind: "group"; dx?: Num; dy?: Num; elements: FigureEl[] }

export interface FigureSpec {
  name: string
  min: number
  max: number
  step: number
  initial: number
}
export interface DerivedSpec {
  name: string
  expr: string
}

export interface AuthoredFigure {
  title?: string
  caption?: string
  width?: number
  height?: number
  params?: FigureSpec[]
  derived?: DerivedSpec[]
  elements: FigureEl[]
}

const DEFAULT_W = 360
const DEFAULT_H = 240
const MAX_ELEMENTS = 60

const nf = (v: number): string => String(Math.round(v * 100) / 100)

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null

/** Lenient Num parse: finite number, or expression string (≤80 chars). */
function parseNum(v: unknown): Num | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string" && v.trim() !== "" && v.length <= 80) return v
  return undefined
}

function parseXY(v: unknown): XY | null {
  if (!isObj(v)) return null
  const x = parseNum(v.x)
  const y = parseNum(v.y)
  return x !== undefined && y !== undefined ? { x, y } : null
}

const TONES: readonly Tone[] = ["ink", "muted", "accent"]
function parseTone(v: unknown): Tone | undefined {
  return typeof v === "string" && (TONES as readonly string[]).includes(v) ? (v as Tone) : undefined
}

/** Resolves one Num against the env, or null when unresolvable/non-finite. */
function resolve(v: Num, env: Readonly<Record<string, number>>): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null
  try {
    const out = evaluate(v, env)
    return Number.isFinite(out) ? out : null
  } catch {
    return null
  }
}

/** Lenient per-element parse (spec §Salvage): garbage in → null + warning. */
export function parseFigureElement(raw: unknown, warn: (m: string) => void): FigureEl | null {
  if (!isObj(raw) || typeof raw.kind !== "string") {
    warn("figure-element-invalid: element is not an object with a kind")
    return null
  }
  const badTone = (t: unknown): boolean => t !== undefined && parseTone(t) === undefined
  switch (raw.kind) {
    case "path": {
      if (typeof raw.d !== "string" || raw.d === "") {
        warn("figure-path-bad: path needs a d string")
        return null
      }
      if (badTone(raw.tone) || badTone(raw.fill)) {
        warn("figure-tone-bad: tone must be ink|muted|accent")
        return null
      }
      return {
        kind: "path",
        d: raw.d,
        tone: parseTone(raw.tone),
        fill: parseTone(raw.fill),
        width: parseNum(raw.width),
      }
    }
    case "curve": {
      const from = parseXY(raw.from)
      const cp1 = parseXY(raw.cp1)
      const cp2 = parseXY(raw.cp2)
      const to = parseXY(raw.to)
      if (!from || !cp1 || !cp2 || !to) {
        warn("figure-curve-bad: curve needs from/cp1/cp2/to with x,y")
        return null
      }
      if (badTone(raw.tone)) {
        warn("figure-tone-bad: tone must be ink|muted|accent")
        return null
      }
      return { kind: "curve", from, cp1, cp2, to, tone: parseTone(raw.tone), width: parseNum(raw.width) }
    }
    case "arc": {
      const cx = parseNum(raw.cx)
      const cy = parseNum(raw.cy)
      const rx = parseNum(raw.rx)
      const ry = parseNum(raw.ry)
      const start = parseNum(raw.start)
      const end = parseNum(raw.end)
      if (cx === undefined || cy === undefined || rx === undefined || ry === undefined || start === undefined || end === undefined) {
        warn("figure-arc-bad: arc needs cx, cy, rx, ry, start, end")
        return null
      }
      if (badTone(raw.tone)) {
        warn("figure-tone-bad: tone must be ink|muted|accent")
        return null
      }
      return { kind: "arc", cx, cy, rx, ry, start, end, tone: parseTone(raw.tone), width: parseNum(raw.width) }
    }
    case "box": {
      const x = parseNum(raw.x)
      const y = parseNum(raw.y)
      const w = parseNum(raw.w)
      const h = parseNum(raw.h)
      if (x === undefined || y === undefined || w === undefined || h === undefined) {
        warn("figure-box-bad: box needs x, y, w, h")
        return null
      }
      if (badTone(raw.tone) || badTone(raw.fill)) {
        warn("figure-tone-bad: tone must be ink|muted|accent")
        return null
      }
      return {
        kind: "box",
        x,
        y,
        w,
        h,
        r: parseNum(raw.r),
        label: typeof raw.label === "string" && raw.label.trim() !== "" ? raw.label : undefined,
        tone: parseTone(raw.tone),
        fill: parseTone(raw.fill),
      }
    }
    case "line": {
      const x1 = parseNum(raw.x1)
      const y1 = parseNum(raw.y1)
      const x2 = parseNum(raw.x2)
      const y2 = parseNum(raw.y2)
      if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) {
        warn("figure-line-bad: line needs x1, y1, x2, y2")
        return null
      }
      if (badTone(raw.tone)) {
        warn("figure-tone-bad: tone must be ink|muted|accent")
        return null
      }
      return { kind: "line", x1, y1, x2, y2, tone: parseTone(raw.tone), width: parseNum(raw.width) }
    }
    case "dot": {
      const cx = parseNum(raw.cx)
      const cy = parseNum(raw.cy)
      if (cx === undefined || cy === undefined) {
        warn("figure-dot-bad: dot needs cx, cy")
        return null
      }
      if (badTone(raw.tone)) {
        warn("figure-tone-bad: tone must be ink|muted|accent")
        return null
      }
      return { kind: "dot", cx, cy, r: parseNum(raw.r), tone: parseTone(raw.tone) }
    }
    case "label": {
      const x = parseNum(raw.x)
      const y = parseNum(raw.y)
      if (x === undefined || y === undefined || typeof raw.text !== "string" || raw.text.trim() === "") {
        warn("figure-label-bad: label needs x, y, and non-empty text")
        return null
      }
      const anchor = raw.anchor === "middle" || raw.anchor === "end" ? raw.anchor : "start"
      return { kind: "label", x, y, text: raw.text, size: parseNum(raw.size), anchor }
    }
    case "group": {
      if (!Array.isArray(raw.elements)) {
        warn("figure-group-bad: group needs an elements array")
        return null
      }
      const children: FigureEl[] = []
      for (const c of raw.elements) {
        const parsed = parseFigureElement(c, warn)
        if (parsed) children.push(parsed)
      }
      return { kind: "group", dx: parseNum(raw.dx), dy: parseNum(raw.dy), elements: children }
    }
    default:
      warn(`figure-kind-unknown: "${raw.kind}" is not an authored element kind`)
      return null
  }
}

function buildEnv(figure: AuthoredFigure): Record<string, number> | null {
  const env: Record<string, number> = {}
  for (const p of figure.params ?? []) env[p.name] = p.initial
  for (const d of figure.derived ?? []) {
    try {
      const v = evaluate(d.expr, env)
      if (!Number.isFinite(v)) return null
      env[d.name] = v
    } catch {
      return null
    }
  }
  return env
}

function arcPath(dx: number, dy: number, cx: number, cy: number, rx: number, ry: number, startDeg: number, endDeg: number): string {
  const rad = (deg: number) => (deg * Math.PI) / 180
  const x1 = dx + cx + rx * Math.cos(rad(startDeg))
  const y1 = dy + cy + ry * Math.sin(rad(startDeg))
  const x2 = dx + cx + rx * Math.cos(rad(endDeg))
  const y2 = dy + cy + ry * Math.sin(rad(endDeg))
  const large = Math.abs(endDeg - startDeg) > 180 ? 1 : 0
  const sweep = endDeg > startDeg ? 1 : 0
  return `M ${nf(x1)} ${nf(y1)} A ${nf(rx)} ${nf(ry)} 0 ${large} ${sweep} ${nf(x2)} ${nf(y2)}`
}

function compileEl(
  el: FigureEl,
  env: Readonly<Record<string, number>>,
  dx: number,
  dy: number,
  warn: (m: string) => void,
): SceneElement | null {
  const n = (v: Num): number | null => resolve(v, env)
  const finite = (...vs: (number | null)[]): boolean => vs.every(v => v !== null)
  const widthOf = (v: Num | undefined, fallback: number): number | null =>
    v === undefined ? fallback : n(v)
  switch (el.kind) {
    case "path": {
      if (!isSafePathD(el.d)) {
        warn("figure-path-unsafe: path d rejected by the grammar")
        return null
      }
      const width = widthOf(el.width, 2)
      if (width === null || width <= 0) {
        warn("figure-path-width: width must resolve to a positive number")
        return null
      }
      const out: FigurePathEl = { kind: "figure-path", d: el.d, tone: el.tone ?? "accent", fill: el.fill ?? null, width }
      return out
    }
    case "curve": {
      const x1 = n(el.from.x)
      const y1 = n(el.from.y)
      const cx1 = n(el.cp1.x)
      const cy1 = n(el.cp1.y)
      const cx2 = n(el.cp2.x)
      const cy2 = n(el.cp2.y)
      const x2 = n(el.to.x)
      const y2 = n(el.to.y)
      if (!finite(x1, y1, cx1, cy1, cx2, cy2, x2, y2)) {
        warn("figure-curve-resolve: curve coordinates did not resolve")
        return null
      }
      const width = widthOf(el.width, 2)
      if (width === null || width <= 0) {
        warn("figure-curve-width: width must resolve to a positive number")
        return null
      }
      const d =
        `M ${nf(dx + x1!)} ${nf(dy + y1!)} C ${nf(dx + cx1!)} ${nf(dy + cy1!)} ` +
        `${nf(dx + cx2!)} ${nf(dy + cy2!)} ${nf(dx + x2!)} ${nf(dy + y2!)}`
      const out: FigurePathEl = { kind: "figure-path", d, tone: el.tone ?? "accent", fill: null, width }
      return out
    }
    case "arc": {
      const cx = n(el.cx)
      const cy = n(el.cy)
      const rx = n(el.rx)
      const ry = n(el.ry)
      const start = n(el.start)
      const end = n(el.end)
      if (!finite(cx, cy, rx, ry, start, end) || rx! <= 0 || ry! <= 0) {
        warn("figure-arc-resolve: arc fields must resolve to finite numbers with positive radii")
        return null
      }
      const width = widthOf(el.width, 2)
      if (width === null || width <= 0) {
        warn("figure-arc-width: width must resolve to a positive number")
        return null
      }
      const out: FigurePathEl = {
        kind: "figure-path",
        d: arcPath(dx, dy, cx!, cy!, rx!, ry!, start!, end!),
        tone: el.tone ?? "accent",
        fill: null,
        width,
      }
      return out
    }
    case "box": {
      const x = n(el.x)
      const y = n(el.y)
      const w = n(el.w)
      const h = n(el.h)
      const r = el.r === undefined ? 4 : n(el.r)
      if (!finite(x, y, w, h, r) || w! <= 0 || h! <= 0 || (r !== null && r! < 0)) {
        warn("figure-box-resolve: box fields must resolve to finite numbers with positive w/h")
        return null
      }
      const out: FigureBoxEl = {
        kind: "figure-box",
        x: dx + x!,
        y: dy + y!,
        w: w!,
        h: h!,
        r: r === null ? 4 : r!,
        label: el.label ?? null,
        tone: el.tone ?? "ink",
        fill: el.fill ?? null,
      }
      return out
    }
    case "line": {
      const x1 = n(el.x1)
      const y1 = n(el.y1)
      const x2 = n(el.x2)
      const y2 = n(el.y2)
      if (!finite(x1, y1, x2, y2)) {
        warn("figure-line-resolve: line coordinates did not resolve")
        return null
      }
      const width = widthOf(el.width, 1)
      if (width === null || width <= 0) {
        warn("figure-line-width: width must resolve to a positive number")
        return null
      }
      const out: FigureLineEl = {
        kind: "figure-line",
        x1: dx + x1!,
        y1: dy + y1!,
        x2: dx + x2!,
        y2: dy + y2!,
        tone: el.tone ?? "ink",
        width,
      }
      return out
    }
    case "dot": {
      const cx = n(el.cx)
      const cy = n(el.cy)
      const r = el.r === undefined ? 3 : n(el.r)
      if (!finite(cx, cy, r) || (r !== null && r! <= 0)) {
        warn("figure-dot-resolve: dot fields must resolve to finite numbers with positive r")
        return null
      }
      const out: FigureDotEl = { kind: "figure-dot", cx: dx + cx!, cy: dy + cy!, r: r === null ? 3 : r!, tone: el.tone ?? "accent" }
      return out
    }
    case "label": {
      const x = n(el.x)
      const y = n(el.y)
      const size = el.size === undefined ? 11 : n(el.size)
      if (!finite(x, y, size) || (size !== null && (size! <= 0 || size! > 40))) {
        warn("figure-label-resolve: label fields must resolve to finite numbers with a sane size")
        return null
      }
      const out: FigureLabelEl = {
        kind: "figure-label",
        x: dx + x!,
        y: dy + y!,
        text: el.text,
        size: size === null ? 11 : size!,
        anchor: el.anchor ?? "start",
      }
      return out
    }
    case "group":
      return null // handled by flatten; never reaches compileEl
  }
}

function flatten(
  els: readonly FigureEl[],
  env: Readonly<Record<string, number>>,
  dx: number,
  dy: number,
  depth: number,
  out: SceneElement[],
  warn: (m: string) => void,
): void {
  for (const el of els) {
    if (out.length >= MAX_ELEMENTS) {
      warn(`figure-too-many: scene truncated at ${MAX_ELEMENTS} elements`)
      return
    }
    if (el.kind === "group") {
      if (depth >= 1) {
        warn("figure-group-deep: groups nest at most one level")
        continue
      }
      const ddx = el.dx === undefined ? 0 : resolve(el.dx, env)
      const ddy = el.dy === undefined ? 0 : resolve(el.dy, env)
      if (ddx === null || ddy === null) {
        warn("figure-group-offset: group offset did not resolve")
        continue
      }
      flatten(el.elements, env, dx + ddx, dy + ddy, depth + 1, out, warn)
      continue
    }
    const compiled = compileEl(el, env, dx, dy, warn)
    if (compiled) out.push(compiled)
  }
}

export function compileFigure(figure: AuthoredFigure): { scene: Scene; warnings: string[] } {
  const warnings: string[] = []
  const warn = (m: string) => warnings.push(m)
  const width = figure.width ?? DEFAULT_W
  const height = figure.height ?? DEFAULT_H
  const env = buildEnv(figure)
  const elements: SceneElement[] = []
  if (!env) {
    warn("figure-env-invalid: params/derived could not be evaluated")
    return { scene: { width, height, elements }, warnings }
  }
  flatten(figure.elements, env, 0, 0, 0, elements, warn)
  return { scene: { width, height, elements }, warnings }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/figures/authored.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/figures/authored.ts src/figures/scene.ts tests/figures/authored.test.ts
git commit -m "$(cat <<'EOF'
feat(figures): authored figure model and compiler to internal Scene

FigureEl vocabulary (path/curve/arc/box/line/dot/label/group), lenient
parseFigureElement salvage, compileFigure resolving expressions against
params/derived and flattening groups into the numeric Scene. Scene gains
five internal figure-* element kinds.

🤖 Generated with Codebuff
Co-Authored-By: Codebuff <noreply@codebuff.com>
EOF
)"
```

### Task 4: Render the new Scene kinds (clean SVG + sketch) and theme them

**Files:**
- Modify: `src/figures/sketch.ts` (add `FIGURE_TONE_VAR` + 4 rough cases)
- Modify: `src/figures/svg.ts` (add 5 clean compile cases)
- Modify: `src/themes/tokens.css` (append 5 class rules)
- Modify: `tests/figures/svg.test.ts`, `tests/figures/sketch.test.ts`
- Modify: `tests/fixtures.ts` (`allPrimitivesIr` gains a `figure` block — required in this task so `tests/themes.test.ts` sees the new classes)

**Interfaces:**
- Consumes: `FigurePathEl`/`FigureBoxEl`/`FigureLineEl`/`FigureDotEl`/`FigureLabelEl` and `FigureTone` from `src/figures/scene.ts` (Task 3).
- Produces: SVG output for the five internal kinds using classes `exp-fig-path`, `exp-fig-box`, `exp-fig-line`, `exp-fig-dot` (new, CSS in this task) and the existing `exp-fig-label`. `FIGURE_TONE_VAR: Record<FigureTone, string>` lives in `sketch.ts`, imported by `svg.ts` (svg already imports from sketch, so no cycle).

- [ ] **Step 1: Write the failing tests**

Append to `tests/figures/svg.test.ts`:

```ts
describe("authored figure elements", () => {
  const scene: Scene = {
    width: 200,
    height: 100,
    elements: [
      { kind: "figure-path", d: "M 0 0 L 10 10", tone: "accent", fill: null, width: 2 },
      { kind: "figure-box", x: 10, y: 10, w: 80, h: 30, r: 4, label: "Box", tone: "ink", fill: null },
      { kind: "figure-line", x1: 0, y1: 0, x2: 5, y2: 5, tone: "muted", width: 1 },
      { kind: "figure-dot", cx: 50, cy: 50, r: 3, tone: "accent" },
      { kind: "figure-label", x: 5, y: 20, text: "a<b", size: 11, anchor: "middle" },
    ],
  }

  it("renders clean svg with tone vars and escaped text", () => {
    const svg = sceneToSvg(scene, { ariaLabel: "f" })
    expect(svg).toContain(`class="exp-fig-path"`)
    expect(svg).toContain(`stroke="var(--exp-accent)"`)
    expect(svg).toContain(`stroke="var(--exp-text-muted)"`)
    expect(svg).toContain(`class="exp-fig-box"`)
    expect(svg).toContain(">Box</text>")
    expect(svg).toContain(`class="exp-fig-line"`)
    expect(svg).toContain(`class="exp-fig-dot"`)
    expect(svg).toContain(`class="exp-fig-label"`)
    expect(svg).toContain("&lt;b") // hostile text escaped
  })

  it("renders sketch passes for the new kinds", () => {
    const svg = sceneToSvg(scene, { ariaLabel: "f", sketch: true, seed: "s" })
    expect(svg).toContain(`class="exp-fig-sketch"`)
  })
})
```

Append to `tests/figures/sketch.test.ts`:

```ts
describe("sketchElementSvg: authored figure kinds", () => {
  it("roughes figure-path, figure-box, figure-line, figure-dot", () => {
    const cases = [
      { kind: "figure-path" as const, d: "M 0 0 L 10 10", tone: "accent" as const, fill: null, width: 2 },
      { kind: "figure-box" as const, x: 0, y: 0, w: 10, h: 10, r: 2, label: null, tone: "ink" as const, fill: null },
      { kind: "figure-line" as const, x1: 0, y1: 0, x2: 1, y2: 1, tone: "muted" as const, width: 1 },
      { kind: "figure-dot" as const, cx: 1, cy: 1, r: 3, tone: "accent" as const },
    ]
    for (const el of cases) {
      const svg = sketchElementSvg(el, "s", 0)
      expect(svg).toContain(`class="exp-fig-sketch"`)
      expect(svg).toContain(`style="--draw-i:0"`)
    }
  })

  it("leaves figure-label crisp (returns empty)", () => {
    expect(
      sketchElementSvg({ kind: "figure-label", x: 0, y: 0, text: "t", size: 11, anchor: "start" }, "s", 0),
    ).toBe("")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/figures/svg.test.ts tests/figures/sketch.test.ts`
Expected: FAIL — TypeScript errors on the new element kinds (they exist in `scene.ts` from Task 3 but have no compile cases; `sceneToSvg`'s switch is exhaustive so the build breaks until cases exist).

- [ ] **Step 3: Implement — `sketch.ts` first (tone map owner)**

In `src/figures/sketch.ts`, extend the type import and add the exported map immediately after the imports:

```ts
import type { FigureTone, SceneElement } from "./scene"

/** Authored-figure tone → theme token. Owned here; svg.ts imports it. */
export const FIGURE_TONE_VAR: Record<FigureTone, string> = {
  ink: "var(--exp-ink)",
  muted: "var(--exp-text-muted)",
  accent: "var(--exp-accent)",
}
```

In `drawablesFor`, add these cases immediately **before** `default:`:

```ts
    case "figure-path":
      return [
        gen.path(el.d, {
          ...opt,
          stroke: FIGURE_TONE_VAR[el.tone],
          strokeWidth: el.width,
          fill: el.fill ? FIGURE_TONE_VAR[el.fill] : undefined,
        }),
      ]
    case "figure-box":
      return [
        gen.rectangle(el.x, el.y, el.w, el.h, {
          ...opt,
          stroke: FIGURE_TONE_VAR[el.tone],
          fill: el.fill ? FIGURE_TONE_VAR[el.fill] : undefined,
        }),
      ]
    case "figure-line":
      return [gen.line(el.x1, el.y1, el.x2, el.y2, { ...opt, stroke: FIGURE_TONE_VAR[el.tone], strokeWidth: el.width })]
    case "figure-dot":
      return [
        gen.circle(el.cx, el.cy, el.r * 2, { ...opt, stroke: FIGURE_TONE_VAR[el.tone], fill: FIGURE_TONE_VAR[el.tone] }),
      ]
```

(`figure-label` intentionally falls through to `default: return []` — text stays crisp, same rule as `label`.)

- [ ] **Step 4: Implement — `svg.ts` clean cases**

In `src/figures/svg.ts`, extend the sketch import and the scene type import:

```ts
import { FIGURE_TONE_VAR, sketchElementSvg } from "./sketch"
import type {
  ArrowEl,
  BarEl,
  DotEl,
  FigureBoxEl,
  FigureDotEl,
  FigureLabelEl,
  FigureLineEl,
  FigurePathEl,
  LabelEl,
  LinePathEl,
  NodeBoxEl,
  Scene,
  SceneElement,
  SparklineEl,
} from "./scene"
```

Add these functions after `sparkline`:

```ts
function figurePath(el: FigurePathEl, i: number): string {
  const fill = el.fill ? FIGURE_TONE_VAR[el.fill] : "none"
  const opacity = el.fill ? ` fill-opacity="0.12"` : ""
  return (
    `<path class="exp-fig-path" d="${el.d}" fill="${fill}"${opacity} stroke="${FIGURE_TONE_VAR[el.tone]}" ` +
    `stroke-width="${n2(el.width)}" stroke-linecap="round" style="--draw-i:${i}"/>`
  )
}

function figureBox(el: FigureBoxEl, i: number): string {
  const fill = el.fill ? FIGURE_TONE_VAR[el.fill] : "none"
  const opacity = el.fill ? ` fill-opacity="0.12"` : ""
  const label = el.label
    ? `<text x="${n2(el.x + el.w / 2)}" y="${n2(el.y + el.h / 2)}" text-anchor="middle" dominant-baseline="central" class="exp-fig-label">${escapeHtml(el.label)}</text>`
    : ""
  return (
    `<g class="exp-fig-box" style="--draw-i:${i}">` +
    `<rect x="${n2(el.x)}" y="${n2(el.y)}" width="${n2(el.w)}" height="${n2(el.h)}" rx="${n2(el.r)}" fill="${fill}"${opacity} stroke="${FIGURE_TONE_VAR[el.tone]}"/>` +
    label +
    `</g>`
  )
}

function figureLine(el: FigureLineEl, i: number): string {
  return (
    `<line class="exp-fig-line" x1="${n2(el.x1)}" y1="${n2(el.y1)}" x2="${n2(el.x2)}" y2="${n2(el.y2)}" ` +
    `stroke="${FIGURE_TONE_VAR[el.tone]}" stroke-width="${n2(el.width)}" style="--draw-i:${i}"/>`
  )
}

function figureDot(el: FigureDotEl, i: number): string {
  return (
    `<circle class="exp-fig-dot" cx="${n2(el.cx)}" cy="${n2(el.cy)}" r="${n2(el.r)}" ` +
    `fill="${FIGURE_TONE_VAR[el.tone]}" style="--draw-i:${i}"/>`
  )
}

function figureLabel(el: FigureLabelEl, i: number): string {
  return (
    `<text class="exp-fig-label" x="${n2(el.x)}" y="${n2(el.y)}" text-anchor="${el.anchor}" ` +
    `style="--draw-i:${i};font-size:${n2(el.size)}px">${escapeHtml(el.text)}</text>`
  )
}
```

Add to `cleanElement`'s switch:

```ts
    case "figure-path":
      return figurePath(el, i)
    case "figure-box":
      return figureBox(el, i)
    case "figure-line":
      return figureLine(el, i)
    case "figure-dot":
      return figureDot(el, i)
    case "figure-label":
      return figureLabel(el, i)
```

- [ ] **Step 5: Append the CSS (theme-coverage gate)**

Append to `src/themes/tokens.css`:

```css
/* Authored figure elements (figure block) */

.exp-fig-path {
  stroke-linejoin: round;
}

.exp-fig-box rect {
  stroke-width: 1.25;
}

.exp-fig-line {
  stroke-linecap: round;
}

.exp-fig-dot {
  stroke: none;
}

.exp-fig-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--exp-text);
  margin: 0 0 4px;
}
```

(`.exp-fig-title` is emitted by the `figure` primitive in Task 5 and pre-covered here; `exp-fig-label`, `exp-fig-caption`, `exp-fig-empty`, `exp-figure` already exist.)

- [ ] **Step 6: Add a figure to `allPrimitivesIr`**

In `tests/fixtures.ts`, insert before the closing `],` of `allPrimitivesIr.blocks` (after the chart entry):

```ts
    {
      type: "figure",
      title: "Damped oscillation",
      caption: "Authored scene: an expression-driven curve with a labeled marker.",
      params: [{ name: "k", min: 1, max: 5, step: 0.5, initial: 2 }],
      elements: [
        { kind: "path", d: "M 10 110 C 60 10 120 210 170 110", tone: "ink", width: 2 },
        { kind: "dot", cx: "10 + 40 * k", cy: 60 },
        { kind: "label", x: "10 + 40 * k", y: 50, text: "peak", anchor: "middle" },
      ],
    },
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/figures/svg.test.ts tests/figures/sketch.test.ts tests/themes.test.ts`
Expected: PASS — including `themes.test.ts` class coverage (`exp-fig-path|box|line|dot` now defined; `figure-label` reuses the existing `exp-fig-label`).

- [ ] **Step 8: Commit**

```bash
git add src/figures/sketch.ts src/figures/svg.ts src/themes/tokens.css tests/figures/svg.test.ts tests/figures/sketch.test.ts tests/fixtures.ts
git commit -m "$(cat <<'EOF'
feat(figures): render authored scene kinds — clean svg, sketch pass, tokens

Five internal figure-* kinds compile to themed SVG (tone→var(--exp-*)),
rough.js equivalents for sketch mode, --draw-i progressive-draw indexing,
and CSS for the new classes. allPrimitivesIr gains a figure block so the
theme-coverage gate holds.

🤖 Generated with Codebuff
Co-Authored-By: Codebuff <noreply@codebuff.com>
EOF
)"
```

---

### Task 5: `figure` block — schema, primitive, registration, prompt

**Files:**
- Modify: `src/core/schema.ts` (append schemas + Block union entry)
- Create: `src/primitives/figure.ts`
- Modify: `src/core/registerAll.ts` (add import)
- Modify: `src/core/llm.ts` (prompt documentation)
- Test: `tests/figure.test.ts` (new), `tests/presentation.test.ts` (extend)

**Interfaces:**
- Consumes: `compileFigure`, `parseFigureElement`, `AuthoredFigure`, `FigureEl`, `FigureSpec`, `DerivedSpec` from `src/figures/authored.ts` (Task 3); `sceneToSvg`, `hashSeed`; `renderInline`; `registerPrimitive`.
- Produces: registry entry `"figure"`; `figureBlockSchema`/`FigureBlock` exported from `src/core/schema.ts` (also flows into `explanationJsonSchema` automatically). The React adapter and demo need no changes.

- [ ] **Step 1: Write the failing tests**

Create `tests/figure.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { renderBlock, renderExplanation } from "../src/core/render"
import { explanationSchema } from "../src/core/schema"
import "../src/core/registerAll"

const base = {
  version: 1 as const,
  blocks: [
    {
      type: "figure" as const,
      title: "Orbit",
      caption: "A circle-ish thing.",
      params: [{ name: "r", min: 5, max: 50, step: 1, initial: 20 }],
      elements: [
        { kind: "arc" as const, cx: 100, cy: 80, rx: "r", ry: "r", start: 0, end: 270 },
        { kind: "label" as const, x: 100, y: 80, text: "r = <r>", anchor: "middle" as const },
      ],
    },
  ],
}

describe("figure primitive", () => {
  it("is schema-valid", () => {
    expect(explanationSchema.safeParse(base).success).toBe(true)
  })

  it("renders a themed figure with param-driven geometry", () => {
    const { html, warnings } = renderExplanation(base)
    expect(html).toContain(`<div class="exp-block exp-figure">`)
    expect(html).toContain(`<svg class="exp-figure"`)
    expect(html).toContain(`A 20 20 0 1 1`) // rx = ry = initial r = 20, large+sweep for 270°
    expect(html).toContain(`<h4 class="exp-fig-title">Orbit</h4>`)
    expect(html).toContain(`<p class="exp-fig-caption">A circle-ish thing.</p>`)
    expect(html).toContain("r = &lt;r&gt;")
    expect(warnings).toEqual([])
  })

  it("drops invalid elements individually and keeps the rest", () => {
    const { html, warnings } = renderExplanation({
      version: 1,
      blocks: [
        {
          type: "figure",
          elements: [{ kind: "dot", cx: "bogus + 1", cy: 5 }, { kind: "dot", cx: 5, cy: 5 }],
        },
      ],
    })
    expect(warnings.some(w => w.includes("figure-dot-resolve"))).toBe(true)
    expect(html).toContain(`class="exp-fig-dot"`)
  })

  it("degrades to exp-fig-empty when everything drops, including empty elements", () => {
    const dropped = renderExplanation({ version: 1, blocks: [{ type: "figure", elements: [{ kind: "wedge" }] }] })
    expect(dropped.html).toContain(`class="exp-fig-empty"`)
    expect(dropped.html).not.toContain(`exp-fig-dot`)
    const empty = renderExplanation({ version: 1, blocks: [{ type: "figure", elements: [] }] })
    expect(empty.html).toContain(`class="exp-fig-empty"`)
  })

  it("drops duplicate param names, first definition wins", () => {
    const { html, warnings } = renderExplanation({
      version: 1,
      blocks: [
        {
          type: "figure",
          params: [
            { name: "r", min: 1, max: 9, step: 1, initial: 4 },
            { name: "r", min: 1, max: 9, step: 1, initial: 8 },
          ],
          elements: [{ kind: "dot", cx: "r * 10", cy: 10 }],
        },
      ],
    })
    expect(warnings.some(w => w.includes("figure-param-duplicate"))).toBe(true)
    expect(html).toContain(`cx="40"`)
  })

  it("a schema-invalid figure never renders a broken figure", () => {
    const { html } = renderExplanation({
      version: 1,
      blocks: [{ type: "figure", params: [{ name: "r", min: 1, max: 2, step: 1, initial: 9 }], elements: [] }],
    })
    expect(html).not.toContain(`<svg class="exp-figure"`)
  })

  it("sketch option produces rough strokes, in both entry points", () => {
    expect(renderExplanation(base, { sketch: true }).html).toContain(`class="exp-fig-sketch"`)
    const html = renderBlock("figure", { title: "T", elements: [{ kind: "dot", cx: 1, cy: 2 }] }, 1, { sketch: true })
    expect(html).toContain(`class="exp-fig-sketch"`)
    expect(html).toContain(`class="exp-fig-dot"`)
  })
})
```

Append to `tests/presentation.test.ts` (add the import at the top with the others, and the describe at the end):

```ts
import { systemPromptSnippet } from "../src/core/llm"

describe("systemPromptSnippet: figure guidance", () => {
  it("documents the figure block with authoring rules", () => {
    expect(systemPromptSnippet).toContain("figure:")
    expect(systemPromptSnippet).toContain(`kind: "path"`)
    expect(systemPromptSnippet).toContain("360×240")
    expect(systemPromptSnippet).toContain("tones are")
    expect(systemPromptSnippet).toContain("≤60 elements")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/figure.test.ts tests/presentation.test.ts`
Expected: FAIL — `figure` is an unknown block type (renders as unknown/invalid), and the prompt lacks the guidance.

- [ ] **Step 3: Schema (`src/core/schema.ts`)**

Append at the end of the file (after `chartBlockSchema`), then add `FigureBlock` to the `Block` union and `figureBlockSchema` to `blockUnionSchema`'s `z.discriminatedUnion` list:

```ts
export const figureParamSchema = z
  .object({
    name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "name must be an identifier"),
    min: z.number().finite(),
    max: z.number().finite(),
    step: z.number().finite().positive(),
    initial: z.number().finite(),
  })
  .refine(p => p.min <= p.initial && p.initial <= p.max, { message: "initial must lie within [min, max]" })
export type FigureParam = z.infer<typeof figureParamSchema>

export const figureDerivedSchema = z.object({
  name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "name must be an identifier"),
  expr: z.string().min(1).max(80),
})
export type FigureDerived = z.infer<typeof figureDerivedSchema>

export const figureBlockSchema = z.object({
  id: idSchema,
  type: z.literal("figure"),
  title: z.string().min(1).optional(),
  caption: z.string().min(1).optional(),
  width: z.number().finite().int().min(80).max(1200).optional(),
  height: z.number().finite().int().min(60).max(1200).optional(),
  params: z.array(figureParamSchema).max(8).optional(),
  derived: z.array(figureDerivedSchema).max(8).optional(),
  // Lenient like stack children / chart points: elements are parsed at render
  // time so one malformed element drops alone instead of the whole figure.
  elements: z.array(z.unknown()),
})
export type FigureBlock = z.infer<typeof figureBlockSchema>
```

Union edits — in `Block`, after `| ChartBlock` add `| FigureBlock`; in `blockUnionSchema`, after `chartBlockSchema,` add `figureBlockSchema,`.

- [ ] **Step 4: Primitive (`src/primitives/figure.ts`)**

```ts
import { registerPrimitive, type RenderContext } from "../core/registry"
import { figureBlockSchema, type FigureBlock } from "../core/schema"
import { renderInline } from "../core/inline"
import {
  compileFigure,
  parseFigureElement,
  type AuthoredFigure,
  type DerivedSpec,
  type FigureEl,
  type FigureSpec,
} from "../figures/authored"
import { hashSeed } from "../figures/seed"
import { sceneToSvg } from "../figures/svg"

const MAX_TOTAL_ELEMENTS = 200

function dedupeNames<T extends { name: string }>(
  items: T[] | undefined,
  warnings: string[],
  what: string,
): T[] | undefined {
  if (!items) return undefined
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of items) {
    if (seen.has(item.name)) {
      warnings.push(`figure-${what}-duplicate: "${item.name}" is defined more than once; later definition dropped`)
      continue
    }
    seen.add(item.name)
    out.push(item)
  }
  return out
}

/** Builds the authored figure from the lenient schema output: elements are
 *  parsed one-by-one so a malformed element drops alone (spec §Salvage). */
function buildAuthored(block: FigureBlock, warnings: string[]): AuthoredFigure {
  const elements: FigureEl[] = []
  for (const raw of block.elements) {
    if (elements.length >= MAX_TOTAL_ELEMENTS) {
      warnings.push(`figure-too-many-elements: more than ${MAX_TOTAL_ELEMENTS} elements; excess dropped`)
      break
    }
    const el = parseFigureElement(raw, m => warnings.push(m))
    if (el) elements.push(el)
  }
  return {
    title: block.title,
    caption: block.caption,
    width: block.width,
    height: block.height,
    params: dedupeNames(block.params as FigureSpec[] | undefined, warnings, "param"),
    derived: dedupeNames(block.derived as DerivedSpec[] | undefined, warnings, "derived"),
    elements,
  }
}

export function renderFigure(block: FigureBlock, ctx: RenderContext): string {
  const warnings: string[] = []
  const authored = buildAuthored(block, warnings)
  const { scene, warnings: compileWarnings } = compileFigure(authored)
  warnings.push(...compileWarnings)
  for (const w of warnings) ctx.addWarning(w)

  const header = block.title ? `<h4 class="exp-fig-title">${renderInline(block.title)}</h4>` : ""
  const caption = block.caption ? `<p class="exp-fig-caption">${renderInline(block.caption)}</p>` : ""
  const aria = block.title ?? block.caption ?? "Authored figure"
  const body =
    scene.elements.length > 0
      ? sceneToSvg(scene, {
          ariaLabel: aria,
          sketch: ctx.sketch,
          seed: block.id ?? hashSeed(`${block.title ?? ""}|${block.caption ?? ""}|${block.elements.length}`),
        })
      : `<p class="exp-fig-empty">Figure could not be drawn.</p>`
  return `<div class="exp-block exp-figure">${header}${body}${caption}</div>`
}

registerPrimitive("figure", { schema: figureBlockSchema, render: renderFigure })
```

- [ ] **Step 5: Register + document**

In `src/core/registerAll.ts`, after the chart import add:

```ts
import "../primitives/figure"
```

In `src/core/llm.ts`, insert this line immediately **before** the `- stack:` line in `systemPromptSnippet`:

```
- figure: { title?, caption?, width?, height?, params?: [{ name, min, max, step, initial }], derived?: [{ name, expr }], elements: Element[] } — a bespoke drawn figure on a 360×240 canvas. Elements: { kind: "path", d } (d is plain path data: M L H V C S Q T A Z only), { kind: "curve", from, cp1, cp2, to } (each { x, y }), { kind: "arc", cx, cy, rx, ry, start, end } (degrees), { kind: "box", x, y, w, h, label? }, { kind: "line", x1, y1, x2, y2 }, { kind: "dot", cx, cy, r? }, { kind: "label", x, y, text, anchor? }, { kind: "group", dx?, dy?, elements } (one level). Numbers may be expressions over params/derived (e.g. "a * 2", "sin(PI/4)"); tones are "ink"|"muted"|"accent". Label everything; ≤60 elements.
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/figure.test.ts tests/presentation.test.ts tests/llm.test.ts`
Expected: PASS — `llm.test.ts`'s "mentions every registered block type" now sees `figure` in both the JSON schema and the prompt.

- [ ] **Step 7: Commit**

```bash
git add src/core/schema.ts src/primitives/figure.ts src/core/registerAll.ts src/core/llm.ts tests/figure.test.ts tests/presentation.test.ts
git commit -m "$(cat <<'EOF'
feat(figure): bespoke LLM-authored figure block with salvage and prompt docs

figureBlockSchema (params/derived constrained, elements lenient), renderFigure
compiling through the authored layer, registry + registerAll wiring, and
system-prompt authoring guidance.

🤖 Generated with Codebuff
Co-Authored-By: Codebuff <noreply@codebuff.com>
EOF
)"
```

---

### Task 6: Demo fixture — expression-driven bespoke figure

**Files:**
- Modify: `demo/examples.js` (`figuresIr.blocks` gains a `figure` entry)
- Modify: `tests/demo-examples.test.ts` (figures coverage list gains `"figure"`)

**Interfaces:**
- Consumes: the registered `figure` primitive (Task 5). The demo server needs no changes — it already renders every `figuresIr` section.

- [ ] **Step 1: Add the fixture block**

In `demo/examples.js`, inside `figuresIr.blocks`, insert after the `chart` block (before the `cause-effect` entry):

```js
    {
      type: "figure",
      title: "Orbit anatomy",
      caption: "A bespoke drawn figure — every number is an expression over rx and ry.",
      params: [
        { name: "rx", min: 40, max: 140, step: 5, initial: 120 },
        { name: "ry", min: 20, max: 90, step: 5, initial: 70 },
      ],
      derived: [
        { name: "cx", expr: "180" },
        { name: "cy", expr: "120" },
      ],
      elements: [
        { kind: "arc", cx: "cx", cy: "cy", rx: "rx", ry: "ry", start: 0, end: 180, tone: "accent", width: 2 },
        { kind: "arc", cx: "cx", cy: "cy", rx: "rx", ry: "ry", start: 180, end: 360, tone: "accent", width: 2 },
        { kind: "line", x1: "cx - rx - 10", y1: "cy", x2: "cx + rx + 10", y2: "cy", tone: "muted" },
        { kind: "line", x1: "cx", y1: "cy - ry - 10", x2: "cx", y2: "cy + ry + 10", tone: "muted" },
        { kind: "dot", cx: "cx + rx * cos(PI / 4)", cy: "cy - ry * sin(PI / 4)", tone: "ink" },
        { kind: "label", x: "cx + rx * cos(PI / 4) + 8", y: "cy - ry * sin(PI / 4) - 6", text: "θ = 45°", anchor: "start" },
        { kind: "label", x: 12, y: 20, text: "rx × ry ellipse", anchor: "start" },
      ],
    },
```

- [ ] **Step 2: Extend the demo test**

In `tests/demo-examples.test.ts`, replace the figures-coverage assertion line:

```ts
    for (const t of ["diagram", "chart", "cause-effect", "callout"]) {
```

with:

```ts
    for (const t of ["diagram", "chart", "figure", "cause-effect", "callout"]) {
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `npx vitest run tests/demo-examples.test.ts`
Expected: PASS — `figuresIr` stays schema-valid and now covers `figure`.

- [ ] **Step 4: Commit**

```bash
git add demo/examples.js tests/demo-examples.test.ts
git commit -m "$(cat <<'EOF'
demo(figures): expression-driven bespoke orbit figure in the figures showcase

🤖 Generated with Codebuff
Co-Authored-By: Codebuff <noreply@codebuff.com>
EOF
)"
```

---

### Task 7: Full verification + roadmap update

**Files:**
- Modify: `docs/ROADMAP.md` (mark step 1 shipped)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0, no output.

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: all files pass; the suite is the previous 115 tests plus the new ones (expr, path-grammar, authored, figure, plus extensions) — zero failures.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: tsup emits `dist/index.js`, `dist/index.cjs`, `dist/react/*` and the themes copy step completes without error.

- [ ] **Step 4: Demo smoke test**

```bash
node -e "const {spawn}=require('child_process'); const fs=require('fs'); const out=fs.openSync('/tmp/exp-demo.log','a'); const c=spawn('node',['demo/server.mjs'],{detached:true,stdio:['ignore',out,out],cwd:process.cwd()}); c.unref();"
sleep 1.5
curl -s http://localhost:4173/figures | grep -o "Orbit anatomy" | head -1
lsof -ti :4173 | xargs kill
```
Expected: the curl prints `Orbit anatomy` (the bespoke figure renders in the figures section).

- [ ] **Step 5: Update the roadmap**

In `docs/ROADMAP.md`, add to the **Shipped** list:

```markdown
- **Bespoke LLM-authored figures** (2026-09-28) — `figure` block: authored
  Scene elements (path/curve/arc/box/line/dot/label/group), params + derived
  values resolved by a hand-rolled expression evaluator, strict path grammar,
  static render at initial values. Spec:
  `docs/superpowers/specs/2026-09-28-bespoke-figures-design.md`.
```

and edit the first backlog bullet from:

```markdown
- **Interactive figure runtime** (first follow-up after step 1): React
  runtime consuming the bespoke-figure format *unchanged* — sliders bound to
  `params`, play/scrub controls, re-render via cached expression ASTs, SSR
  fallback showing `initial`-value render (already shipped by step 1).
```

to:

```markdown
- **Interactive figure runtime** (next up): React runtime consuming the
  bespoke-figure format *unchanged* (format shipped 2026-09-28) — sliders
  bound to `params`, play/scrub controls, re-render via the cached expression
  ASTs in `src/figures/expr.ts`, SSR fallback = the static render that already
  ships.
```

- [ ] **Step 6: Commit**

```bash
git add docs/ROADMAP.md
git commit -m "$(cat <<'EOF'
docs(roadmap): mark bespoke figures shipped; interactive runtime is next up

🤖 Generated with Codebuff
Co-Authored-By: Codebuff <noreply@codebuff.com>
EOF
)"
```

---

## Post-Implementation Notes (carried from planning)

- **Demo figure choice:** the spec's testing section sketched a Lissajous demo; a faithful Lissajous requires the model to pre-sample ~48 points into one `d` string, which makes a brittle fixture. The shipped demo figure ("Orbit anatomy") exercises the same capabilities (params, derived values, function calls like `cos(PI/4)`, arcs, lines, dots, labels) with hand-checkable numbers. The spec line was amended accordingly during planning.
- **Degenerate 360° arcs:** a single arc with identical start/end points renders nothing; always split full ellipses into two ≤180° arcs (the demo fixture does this).
- **Known follow-up:** `axis()` in `svg.ts` still uses a structural param type instead of importing `AxisEl` (pre-existing lint-level nit, out of scope).
