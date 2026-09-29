"use client"
import { useEffect, useMemo, useRef, useState, type FC } from "react"
import { buildAuthored } from "../primitives/figure"
import { compileFigure } from "../figures/authored"
import { hashSeed } from "../figures/seed"
import { n2, sceneToSvg } from "../figures/svg"
import { renderInline } from "../core/inline"
import type { FigureBlock } from "../core/schema"

export interface InteractiveFigureProps {
  /** Raw block payload (schema-parsed or unknown); parsed leniently. */
  block: unknown
  /** Hand-drawn (rough.js) stroke pass, matching the static option. */
  sketch?: boolean
}

/** Pure sweep step: advances by step scaled to frame time, wrapping at max.
 *  Frame-rate independent; zero/negative dt is a no-op. Exported for tests. */
export function nextSweepValue(
  current: number,
  spec: { min: number; max: number; step: number },
  dtMs: number,
): number {
  if (dtMs <= 0) return current
  const next = current + spec.step * (dtMs / 16.67)
  return next > spec.max ? spec.min : next
}

interface ParamSpec {
  name: string
  min: number
  max: number
  step: number
  initial: number
}

export const InteractiveFigure: FC<InteractiveFigureProps> = ({ block, sketch = false }) => {
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

  // Initial render depends only on `block` → deterministic SSR = hydration.
  const svg = useMemo(() => {
    if (authored.elements.length === 0) return null
    const figure = {
      ...authored,
      params: params.map(p => ({ ...p, initial: values[p.name] ?? p.initial })),
    }
    const { scene } = compileFigure(figure)
    if (scene.elements.length === 0) return null
    return sceneToSvg(scene, {
      ariaLabel: authored.title ?? authored.caption ?? "Interactive figure",
      sketch,
      seed:
        raw.id ??
        hashSeed(`${authored.title ?? ""}|${authored.caption ?? ""}|${authored.elements.length}`),
    })
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

  const header = authored.title ? (
    <h4 className="exp-fig-title" dangerouslySetInnerHTML={{ __html: renderInline(authored.title) }} />
  ) : null
  const caption = authored.caption ? (
    <p className="exp-fig-caption" dangerouslySetInnerHTML={{ __html: renderInline(authored.caption) }} />
  ) : null
  const body = svg ? (
    <div className="exp-fig-stage" dangerouslySetInnerHTML={{ __html: svg }} />
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
            <span className="exp-fig-param-value">{n2(values[p.name] ?? p.initial)}</span>
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
