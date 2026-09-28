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
