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
