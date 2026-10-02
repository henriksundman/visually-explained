"use client"
import { useEffect, useMemo, useRef, useState, type FC } from "react"
import { buildAuthored } from "../primitives/figure"
import { compileFigure } from "../figures/authored"
import { hashSeed } from "../figures/seed"
import { n2, sceneToSvg } from "../figures/svg"
import { renderInline } from "../core/inline"
import { PopoverDiv, useElementPopover } from "./ElementPopover"
import { useDragVary, axesFor } from "./useDragVary"
import { FocusPreservingSvg } from "./FocusPreservingSvg"
import type { DraggableAxes } from "../figures/svg"
import type { FigureElementEvent } from "./figureEvents"
import type { FigureBlock } from "../core/schema"

export interface InteractiveFigureProps {
  /** Raw block payload (schema-parsed or unknown); parsed leniently. */
  block: unknown
  /** Hand-drawn (rough.js) stroke pass, matching the static option. */
  sketch?: boolean
  /** Delegate hover/click events for identified elements (events spec §5). */
  onElementEvent?: (e: FigureElementEvent) => void
}

/** Width (ch) of the widest value the param can ever display, so the value
 *  column never shifts the controls row. Sweep intermediates are fractional
 *  (45.83), so the bound is the worst-case n2 FORMAT over [min, max] —
 *  sign + integer digits + "." + 2 decimals — plus a ch of slack. */
export function valueColumnCh(p: { min: number; max: number }): number {
  const digits = (v: number) => String(Math.trunc(Math.abs(v))).length
  const intDigits = Math.max(digits(p.min), digits(p.max), 1)
  const sign = p.min < 0 ? 1 : 0
  return sign + intDigits + 3 + 1
}

/** Sweep speed: steps advanced per second of playback. Decoupled from the
 *  param's step size so small-step params don't crawl and big-step params
 *  don't blur — one full range = max(step)/10 seconds roughly. */
const SWEEP_STEPS_PER_SEC = 10

/** Pure sweep step: advances SWEEP_STEPS_PER_SEC × step per second, wrapping
 *  at max. Frame-rate independent; zero/negative dt is a no-op. Exported for tests. */
export function nextSweepValue(
  current: number,
  spec: { min: number; max: number; step: number },
  dtMs: number,
): number {
  if (dtMs <= 0) return current
  const next = current + spec.step * SWEEP_STEPS_PER_SEC * (dtMs / 1000)
  return next > spec.max ? spec.min : next
}

interface ParamSpec {
  name: string
  min: number
  max: number
  step: number
  initial: number
}

export const InteractiveFigure: FC<InteractiveFigureProps> = ({ block, sketch = false, onElementEvent }) => {
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

  // Declared handles → axes map. Derived here (rather than taken from the
  // hook) because the markup memo below needs it, and the hook needs this
  // component's scene dimensions — deriving it keeps that one-directional.
  const draggableMap = useMemo(() => {
    const m = new Map<string, DraggableAxes>()
    for (const d of authored.draggable ?? []) {
      const axes = axesFor(authored.draggable, d.id)
      if (axes) m.set(d.id, axes)
    }
    return m
  }, [authored.draggable])

  // Initial render depends only on `block` → deterministic SSR = hydration.
  // Scene dimensions ride along with the markup: the drag hook needs them for
  // the bounding-rect fallback when a screen CTM is unavailable.
  const { svg, viewW, viewH } = useMemo(() => {
    if (authored.elements.length === 0) return { svg: null, viewW: 0, viewH: 0 }
    const figure = {
      ...authored,
      params: params.map(p => ({ ...p, initial: values[p.name] ?? p.initial })),
    }
    const { scene } = compileFigure(figure)
    if (scene.elements.length === 0) return { svg: null, viewW: 0, viewH: 0 }
    return {
      svg: sceneToSvg(scene, {
        ariaLabel: authored.title ?? authored.caption ?? "Interactive figure",
        sketch,
        seed:
          raw.id ??
          hashSeed(`${authored.title ?? ""}|${authored.caption ?? ""}|${authored.elements.length}`),
        draggable: draggableMap,
      }),
      viewW: scene.width,
      viewH: scene.height,
    }
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

  const { stageRef, pop, bind } = useElementPopover(onElementEvent)

  // Direct manipulation writes to the SAME `values` state a slider writes, so
  // a slider bound to a dragged param tracks the handle by construction.
  const drag = useDragVary({
    draggable: authored.draggable,
    params,
    values,
    setParam,
    stageRef,
    viewW,
    viewH,
  })
  // The popover owns over/out/click/focus; drag owns down/move/up/cancel/key.
  // Disjoint key sets, so the two can share one element.
  const stageBind = { ...bind, ...drag.bind }

  const header = authored.title ? (
    <h4 className="exp-fig-title" dangerouslySetInnerHTML={{ __html: renderInline(authored.title) }} />
  ) : null
  const caption = authored.caption ? (
    <p className="exp-fig-caption" dangerouslySetInnerHTML={{ __html: renderInline(authored.caption) }} />
  ) : null
  const body = svg ? (
    <div
      className={`exp-fig-stage${drag.activeId ? " exp-fig-stage-dragging" : ""}`}
      ref={stageRef}
      {...stageBind}
    >
      <FocusPreservingSvg html={svg} />
      {pop && <PopoverDiv pop={pop} />}
    </div>
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
            <span className="exp-fig-param-value" style={{ minWidth: `${valueColumnCh(p)}ch` }}>
              {n2(values[p.name] ?? p.initial)}
            </span>
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
