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
