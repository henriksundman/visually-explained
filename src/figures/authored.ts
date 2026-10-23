/** Authored figure model — what the LLM emits for `figure` blocks (spec §2).
 *  parseFigureElement leniently accepts unknown JSON; compileFigure resolves
 *  every expression against params/derived, flattens groups, and emits the
 *  internal numeric Scene that sceneToSvg consumes. Scene's invariant "no
 *  expressions, no groups, numeric only" is preserved. */

import { evaluate } from "./expr"
import { plainMathLabel } from "./labelMath"
import { isSafePathD } from "./pathGrammar"
import type {
  FigureBoxEl,
  FigureDotEl,
  FigureLabelEl,
  FigureLineEl,
  FigurePathEl,
  FigureTone,
  Scene,
  SceneElement,
} from "./scene"

export type Tone = FigureTone
export type Num = number | string
export interface XY {
  x: Num
  y: Num
}

export type FigureEl =
  | { kind: "path"; d: string; tone?: Tone; fill?: Tone; width?: Num; id?: string; tip?: string } // d: path data; {{expr}} slots allowed
  | { kind: "curve"; from: XY; cp1: XY; cp2: XY; to: XY; tone?: Tone; width?: Num; label?: string; id?: string; tip?: string }
  | { kind: "arc"; cx: Num; cy: Num; rx: Num; ry: Num; start: Num; end: Num; tone?: Tone; width?: Num; label?: string; id?: string; tip?: string }
  | { kind: "box"; x: Num; y: Num; w: Num; h: Num; r?: Num; label?: string; tone?: Tone; fill?: Tone; id?: string; tip?: string }
  | { kind: "line"; x1: Num; y1: Num; x2: Num; y2: Num; tone?: Tone; width?: Num; label?: string; id?: string; tip?: string }
  | { kind: "dot"; cx: Num; cy: Num; r?: Num; tone?: Tone; label?: string; id?: string; tip?: string }
  | { kind: "label"; x: Num; y: Num; text: string; size?: Num; anchor?: "start" | "middle" | "end"; id?: string; tip?: string }
  | { kind: "group"; dx?: Num; dy?: Num; elements: FigureEl[] } // identity deliberately absent (events spec §3)

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
  /** Declared drag handles. Consumed by the React runtime only — the static
   *  renderer ignores this field entirely. */
  draggable?: DraggableSpec[]
  elements: FigureEl[]
}

const DEFAULT_W = 360
const DEFAULT_H = 240
const MAX_ELEMENTS = 60

const BOX_CHAR_W = 7.5 // per-char estimate at 13px — same basis as layoutFlow's wrapLabel

/** Wrap a box label to the box width (figure scene quality spec §3.3): word
 *  boundaries, 16px horizontal padding, never fewer than 6 chars per line.
 *  Single-line results return the label unwrapped, so the renderer's existing
 *  single-line markup (and the corpus) stays byte-identical. */
function wrapBoxLabel(label: string, w: number): string[] {
  // Math spans are stripped before wrapping (see layoutFlow.wrapEdgeLabel): a
  // wrap or hard-cut must never split a `\(…\)` span — the emit layer cannot
  // strip a half-span, and it would surface as literal TeX.
  label = plainMathLabel(label)
  const maxChars = Math.max(6, Math.floor((w - 16) / BOX_CHAR_W))
  const lines: string[] = []
  let line = ""
  for (const word of label.split(/\s+/)) {
    if (line && line.length + 1 + word.length > maxChars) {
      lines.push(line)
      line = word
    } else {
      line = line ? `${line} ${word}` : word
    }
  }
  if (line) lines.push(line)
  return lines.length > 1 ? lines : [label]
}
const MAX_PATH_SLOTS = 64
const MAX_SLOT_EXPR = 80

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

const EL_ID_RE = /^[\w][\w-]*$/

/** A declared direct-manipulation handle (drag-to-vary spec §4). `x`/`y` name
 *  the params the drag writes; an absent axis is fixed, not free. */
export interface DraggableSpec {
  id: string
  x?: string
  y?: string
}

const MAX_DRAGGABLES = 16

/** Lenient parse of the block's `draggable` list. A malformed entry drops
 *  ALONE (with a warning) rather than taking the figure with it, matching how
 *  elements and chart points salvage. Returns undefined when absent so the
 *  overwhelmingly common no-drag case carries no extra field.
 *
 *  Lives here, not in primitives/figure.ts, so it can reuse the module-private
 *  EL_ID_RE — there must be exactly one element-id rule in the codebase. */
export function parseDraggables(raw: unknown, warn: (m: string) => void): DraggableSpec[] | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw)) {
    warn("figure-drag-not-a-list: draggable must be an array; ignored")
    return undefined
  }
  const out: DraggableSpec[] = []
  for (const item of raw) {
    if (out.length >= MAX_DRAGGABLES) {
      warn(`figure-drag-too-many: more than ${MAX_DRAGGABLES} draggable entries; excess dropped`)
      break
    }
    if (typeof item !== "object" || item === null) {
      warn("figure-drag-entry-invalid: draggable entry must be an object; dropped")
      continue
    }
    const r = item as Record<string, unknown>
    const id = r.id
    if (typeof id !== "string" || id.length > 100 || !EL_ID_RE.test(id)) {
      warn("figure-drag-id-invalid: draggable id must match /^[\\w][\\w-]*$/ (max 100 chars); entry dropped")
      continue
    }
    const x = typeof r.x === "string" && r.x !== "" ? r.x : undefined
    const y = typeof r.y === "string" && r.y !== "" ? r.y : undefined
    // A handle on neither axis is not a handle: it would be grabbable and do
    // nothing, which reads as a broken figure rather than a rejected entry.
    if (x === undefined && y === undefined) {
      warn(`figure-drag-no-axis: draggable "${id}" names no axis; entry dropped`)
      continue
    }
    out.push({ id, ...(x !== undefined ? { x } : {}), ...(y !== undefined ? { y } : {}) })
  }
  return out
}

/** Lenient identity parse: invalid input drops the FIELD (not the element)
 *  with a warning; the element still renders, just anonymous (spec §3). */
function parseId(v: unknown, warn: (m: string) => void): string | undefined {
  if (v === undefined) return undefined
  if (typeof v === "string" && v.length <= 100 && EL_ID_RE.test(v)) return v
  warn("figure-id-invalid: element id must match /^[\\w][\\w-]*$/ (max 100 chars)")
  return undefined
}

function parseTip(v: unknown, warn: (m: string) => void): string | undefined {
  if (v === undefined) return undefined
  if (typeof v !== "string" || v.trim() === "") return undefined
  if (v.length > 200) {
    warn("figure-tip-too-long: tip must be at most 200 characters")
    return undefined
  }
  return v
}

/** Compile-side identity gate. parseFigureElement already dropped invalid
 *  fields for the JSON path; this covers direct compileFigure callers, whose
 *  elements skip parsing. Same rules, same messages, no double warnings. */
function identityOf(el: FigureEl, warn: (m: string) => void): { id?: string; tip?: string } {
  const out: { id?: string; tip?: string } = {}
  const id = (el as { id?: unknown }).id
  if (id !== undefined) {
    if (typeof id === "string" && id.length <= 100 && EL_ID_RE.test(id)) out.id = id
    else warn("figure-id-invalid: element id must match /^[\\w][\\w-]*$/ (max 100 chars)")
  }
  const tip = (el as { tip?: unknown }).tip
  if (typeof tip === "string" && tip.trim() !== "") {
    if (tip.length <= 200) out.tip = tip
    else warn("figure-tip-too-long: tip must be at most 200 characters")
  }
  return out
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

/** Lenient per-element parse (spec §Salvage): garbage in → null + warning.
 *  `depth` tracks group nesting; groups are legal only at the top level. */
export function parseFigureElement(raw: unknown, warn: (m: string) => void, depth = 0): FigureEl | null {
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
        id: parseId(raw.id, warn),
        tip: parseTip(raw.tip, warn),
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
      return { kind: "curve", from, cp1, cp2, to, tone: parseTone(raw.tone), width: parseNum(raw.width), label: typeof raw.label === "string" && raw.label.trim() !== "" ? raw.label : undefined, id: parseId(raw.id, warn), tip: parseTip(raw.tip, warn) }
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
      return { kind: "arc", cx, cy, rx, ry, start, end, tone: parseTone(raw.tone), width: parseNum(raw.width), label: typeof raw.label === "string" && raw.label.trim() !== "" ? raw.label : undefined, id: parseId(raw.id, warn), tip: parseTip(raw.tip, warn) }
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
        id: parseId(raw.id, warn),
        tip: parseTip(raw.tip, warn),
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
      return { kind: "line", x1, y1, x2, y2, tone: parseTone(raw.tone), width: parseNum(raw.width), label: typeof raw.label === "string" && raw.label.trim() !== "" ? raw.label : undefined, id: parseId(raw.id, warn), tip: parseTip(raw.tip, warn) }
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
      return { kind: "dot", cx, cy, r: parseNum(raw.r), tone: parseTone(raw.tone), label: typeof raw.label === "string" && raw.label.trim() !== "" ? raw.label : undefined, id: parseId(raw.id, warn), tip: parseTip(raw.tip, warn) }
    }
    case "label": {
      const x = parseNum(raw.x)
      const y = parseNum(raw.y)
      if (x === undefined || y === undefined || typeof raw.text !== "string" || raw.text.trim() === "") {
        warn("figure-label-bad: label needs x, y, and non-empty text")
        return null
      }
      const anchor = raw.anchor === "middle" || raw.anchor === "end" ? raw.anchor : "start"
      return { kind: "label", x, y, text: raw.text, size: parseNum(raw.size), anchor, id: parseId(raw.id, warn), tip: parseTip(raw.tip, warn) }
    }
    case "group": {
      if (depth >= 1) {
        warn("figure-group-deep: groups nest at most one level")
        return null
      }
      if (raw.id !== undefined || raw.tip !== undefined) {
        warn("figure-id-unsupported: groups do not carry identity in v1")
      }
      if (!Array.isArray(raw.elements)) {
        warn("figure-group-bad: group needs an elements array")
        return null
      }
      const children: FigureEl[] = []
      for (const c of raw.elements) {
        const parsed = parseFigureElement(c, warn, depth + 1)
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

function arcPath(
  dx: number,
  dy: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  startDeg: number,
  endDeg: number,
): string {
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
): SceneElement[] {
  const n = (v: Num): number | null => resolve(v, env)
  const finite = (...vs: (number | null)[]): boolean => vs.every(v => v !== null)
  const widthOf = (v: Num | undefined, fallback: number): number | null => (v === undefined ? fallback : n(v))
  switch (el.kind) {
    case "path": {
      const expanded = expandPathSlots(el.d, env, warn)
      if (expanded === null) return []
      if (!isSafePathD(expanded)) {
        warn("figure-path-unsafe: path d rejected by the grammar")
        return []
      }
      const width = widthOf(el.width, 2)
      if (width === null || width <= 0) {
        warn("figure-path-width: width must resolve to a positive number")
        return []
      }
      const out: FigurePathEl = { kind: "figure-path", d: expanded, tone: el.tone ?? "accent", fill: el.fill ?? null, width, ...identityOf(el, warn) }
      return [out]
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
        return []
      }
      const width = widthOf(el.width, 2)
      if (width === null || width <= 0) {
        warn("figure-curve-width: width must resolve to a positive number")
        return []
      }
      const d =
        `M ${nf(dx + x1!)} ${nf(dy + y1!)} C ${nf(dx + cx1!)} ${nf(dy + cy1!)} ` +
        `${nf(dx + cx2!)} ${nf(dy + cy2!)} ${nf(dx + x2!)} ${nf(dy + y2!)}`
      const out: FigurePathEl = { kind: "figure-path", d, tone: el.tone ?? "accent", fill: null, width, ...identityOf(el, warn) }
      const result: SceneElement[] = [out]
      // Label sugar: midpoint of from/to — control points can sit far off the
      // curve body and would push the name away from what it names.
      if (el.label) {
        result.push({ kind: "figure-label", x: dx + (x1! + x2!) / 2, y: dy + (y1! + y2!) / 2, text: el.label, size: 11, anchor: "middle" })
      }
      return result
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
        return []
      }
      const width = widthOf(el.width, 2)
      if (width === null || width <= 0) {
        warn("figure-arc-width: width must resolve to a positive number")
        return []
      }
      const out: FigurePathEl = {
        kind: "figure-path",
        d: arcPath(dx, dy, cx!, cy!, rx!, ry!, start!, end!),
        tone: el.tone ?? "accent",
        fill: null,
        width,
        ...identityOf(el, warn),
      }
      const result: SceneElement[] = [out]
      if (el.label) {
        result.push({ kind: "figure-label", x: dx + cx!, y: dy + cy!, text: el.label, size: 11, anchor: "middle" })
      }
      return result
    }
    case "box": {
      const x = n(el.x)
      const y = n(el.y)
      const w = n(el.w)
      const h = n(el.h)
      const r = el.r === undefined ? 4 : n(el.r)
      if (!finite(x, y, w, h, r) || w! <= 0 || h! <= 0 || (r !== null && r! < 0)) {
        warn("figure-box-resolve: box fields must resolve to finite numbers with positive w/h")
        return []
      }
      // A fitting label stays unwrapped: `lines` is absent for the single-line
      // case (scene.ts contract), so single-line markup stays byte-identical.
      const wrapped = el.label ? wrapBoxLabel(el.label, w!) : undefined
      const out: FigureBoxEl = {
        kind: "figure-box",
        x: dx + x!,
        y: dy + y!,
        w: w!,
        h: h!,
        r: r === null ? 4 : r!,
        label: el.label ?? null,
        lines: wrapped && wrapped.length > 1 ? wrapped : undefined,
        tone: el.tone ?? "ink",
        fill: el.fill ?? null,
        ...identityOf(el, warn),
      }
      return [out]
    }
    case "line": {
      const x1 = n(el.x1)
      const y1 = n(el.y1)
      const x2 = n(el.x2)
      const y2 = n(el.y2)
      if (!finite(x1, y1, x2, y2)) {
        warn("figure-line-resolve: line coordinates did not resolve")
        return []
      }
      const width = widthOf(el.width, 1)
      if (width === null || width <= 0) {
        warn("figure-line-width: width must resolve to a positive number")
        return []
      }
      const out: FigureLineEl = {
        kind: "figure-line",
        x1: dx + x1!,
        y1: dy + y1!,
        x2: dx + x2!,
        y2: dy + y2!,
        tone: el.tone ?? "ink",
        width,
        ...identityOf(el, warn),
      }
      const result: SceneElement[] = [out]
      if (el.label) {
        result.push({ kind: "figure-label", x: dx + (x1! + x2!) / 2, y: dy + (y1! + y2!) / 2, text: el.label, size: 11, anchor: "middle" })
      }
      return result
    }
    case "dot": {
      const cx = n(el.cx)
      const cy = n(el.cy)
      const r = el.r === undefined ? 3 : n(el.r)
      if (!finite(cx, cy, r) || (r !== null && r! <= 0)) {
        warn("figure-dot-resolve: dot fields must resolve to finite numbers with positive r")
        return []
      }
      const out: FigureDotEl = { kind: "figure-dot", cx: dx + cx!, cy: dy + cy!, r: r === null ? 3 : r!, tone: el.tone ?? "accent", ...identityOf(el, warn) }
      const result: SceneElement[] = [out]
      if (el.label) {
        result.push({ kind: "figure-label", x: dx + cx!, y: dy + cy! - (r === null ? 3 : r!) - 6, text: el.label, size: 11, anchor: "middle" })
      }
      return result
    }
    case "label": {
      const x = n(el.x)
      const y = n(el.y)
      const size = el.size === undefined ? 11 : n(el.size)
      if (!finite(x, y, size) || (size !== null && (size! <= 0 || size! > 40))) {
        warn("figure-label-resolve: label fields must resolve to finite numbers with a sane size")
        return []
      }
      const out: FigureLabelEl = {
        kind: "figure-label",
        x: dx + x!,
        y: dy + y!,
        text: el.text,
        size: size === null ? 11 : size!,
        anchor: el.anchor ?? "start",
        ...identityOf(el, warn),
      }
      return [out]
    }
    case "group":
      return [] // handled by flatten; never reaches compileEl
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
      if ((el as { id?: unknown }).id !== undefined || (el as { tip?: unknown }).tip !== undefined) {
        warn("figure-id-unsupported: groups do not carry identity in v1")
      }
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
    for (const c of compiled) {
      if (out.length >= MAX_ELEMENTS) {
        warn(`figure-too-many: scene truncated at ${MAX_ELEMENTS} elements`)
        return
      }
      out.push(c)
    }
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
