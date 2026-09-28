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
