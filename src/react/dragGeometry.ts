/**
 * Drag geometry for direct manipulation (drag-to-vary spec §5–6).
 *
 * Deliberately DOM-free and React-free. There is no jsdom in this repo's test
 * environment, so the only way to test coordinate conversion is as pure
 * functions over plain objects — and keeping the module honest about that also
 * makes it impossible for it to quietly depend on a live element.
 *
 * The only thing that ever leaves this module is a number. Scene coordinates
 * are never written back into the Scene: a drag produces a value, the existing
 * `values → compileFigure → sceneToSvg` path re-solves everything else.
 */

/** A 2×3 affine matrix in SVG's [a c e; b d f] form, as `getScreenCTM()` gives. */
export interface SceneMatrix {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

export interface ClientPoint {
  clientX: number
  clientY: number
}

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

export interface SceneSource {
  /** Preferred: exact under any CSS transform, zoom, or page scale. */
  matrix: SceneMatrix | null
  /** Fallback: correct for plain uniform scaling, blind to rotation/skew. */
  rect: Rect | null
  viewW: number
  viewH: number
}

export interface ParamRange {
  min: number
  max: number
}

export interface ParamSpec extends ParamRange {
  /** Present for authoring parity; deliberately NOT applied to a drag. */
  step: number
}

/**
 * Inverse of the 2×3 affine matrix. Returns null on a singular
 * (zero-determinant) matrix rather than dividing by zero and handing the
 * caller Infinity — the caller then tries the rect fallback, and failing that
 * writes nothing at all.
 */
function invertAffine(p: ClientPoint, m: SceneMatrix): { x: number; y: number } | null {
  const det = m.a * m.d - m.b * m.c
  if (!det || !Number.isFinite(det)) return null
  const dx = p.clientX - m.e
  const dy = p.clientY - m.f
  const x = (m.d * dx - m.c * dy) / det
  const y = (-m.b * dx + m.a * dy) / det
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return { x, y }
}

/**
 * Client point → scene coordinates.
 *
 * Returns null when neither source is usable. This is the "a drag must never
 * silently no-op" guard from the spec's global constraints: the caller writes
 * no param at all rather than writing a wrong one, because a figure that
 * quietly jumps to a guessed position is worse than one that does not move.
 */
export function clientToScene(pt: ClientPoint, src: SceneSource): { x: number; y: number } | null {
  if (!Number.isFinite(pt.clientX) || !Number.isFinite(pt.clientY)) return null
  if (src.matrix) {
    const r = invertAffine(pt, src.matrix)
    if (r) return r
  }
  if (src.rect && src.rect.width > 0 && src.rect.height > 0) {
    const x = (pt.clientX - src.rect.left) * (src.viewW / src.rect.width)
    const y = (pt.clientY - src.rect.top) * (src.viewH / src.rect.height)
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y }
  }
  return null
}

/**
 * Clamp with the LOWER bound applied last.
 *
 * The ordering is the whole point. A plain `min(max(x, lo), hi)` lets the wrong
 * bound win when an LLM authors `min > max` (the degenerate-clamp case in
 * DEBUGGING.md Part 1); applying `min` last makes such a range resolve to
 * `min` deterministically instead of depending on argument order.
 */
export function clampParam(v: number, range: ParamRange): number {
  if (!Number.isFinite(v)) return range.min
  return Math.max(range.min, Math.min(range.max, v))
}

/**
 * The value a drag writes.
 *
 * The slider's `step` is ignored **on purpose**: it exists so a slider lands on
 * round numbers, and honouring it makes a dragged point visibly stick and jump
 * between increments. `min`/`max` still bound the drag, which is correct —
 * an author writing `min: 0, max: 360` is describing the canvas.
 *
 * `grabOffset` is subtracted so the element does not snap its centre to the
 * cursor on contact; it is the distance from the element's origin to the point
 * the pointer actually went down on.
 */
export function dragValueFor(
  sceneValue: number,
  spec: ParamSpec,
  opts?: { value: number; grabOffset: number },
): number {
  const raw = opts ? sceneValue - opts.grabOffset : sceneValue
  return clampParam(raw, spec)
}
