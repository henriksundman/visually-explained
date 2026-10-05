"use client"
import { useCallback, useEffect, useRef, useState, type FC, type RefObject } from "react"
import { hitElement, placePopover, type FigureElementEvent } from "./figureEvents"
import { renderInline } from "../core/inline"

export interface PopoverState {
  elId: string
  tip: string
  top: number
  left: number
  placement: "above" | "below"
}

interface BindHandlers {
  onPointerOver: (e: React.PointerEvent) => void
  onPointerOut: (e: React.PointerEvent) => void
  onClick: (e: React.MouseEvent) => void
  onFocusCapture: (e: React.FocusEvent) => void
  onBlurCapture: () => void
}

/** One delegated listener set per figure stage. Popover state is client-only
 *  and starts closed, so SSR markup is identical to the static render (spec §5).
 *  v1: no repositioning on scroll/sweep — pointerout closes the popover. */
export function useElementPopover(onEvent?: (e: FigureElementEvent) => void): {
  stageRef: RefObject<HTMLDivElement | null>
  pop: PopoverState | null
  bind: BindHandlers
} {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const [pop, setPop] = useState<PopoverState | null>(null)

  const show = useCallback((target: EventTarget | null) => {
    const hit = hitElement(target)
    const stage = stageRef.current
    if (!hit || !hit.tip || !stage) return
    const p = placePopover(hit.node.getBoundingClientRect(), stage.getBoundingClientRect())
    setPop({ elId: hit.elId, tip: hit.tip, top: p.top, left: p.left, placement: p.placement })
  }, [])

  const onPointerOver = useCallback(
    (e: React.PointerEvent) => {
      const hit = hitElement(e.target)
      if (!hit) return
      onEvent?.({ kind: "hover", elId: hit.elId, phase: "start" })
      show(e.target)
    },
    [onEvent, show],
  )

  const onPointerOut = useCallback(
    (e: React.PointerEvent) => {
      const hit = hitElement(e.target)
      if (hit) onEvent?.({ kind: "hover", elId: hit.elId, phase: "end" })
      setPop(null)
    },
    [onEvent],
  )

  const onClick = useCallback(
    (e: React.MouseEvent) => {
      const hit = hitElement(e.target)
      if (!hit) {
        setPop(null)
        return
      }
      onEvent?.({ kind: "click", elId: hit.elId })
      show(e.target)
    },
    [onEvent, show],
  )

  const onFocusCapture = useCallback((e: React.FocusEvent) => show(e.target), [show])
  const onBlurCapture = useCallback(() => setPop(null), [])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPop(null)
    }
    stage.addEventListener("keydown", onKey)
    return () => stage.removeEventListener("keydown", onKey)
  }, [])

  return {
    stageRef,
    pop,
    bind: { onPointerOver, onPointerOut, onClick, onFocusCapture, onBlurCapture },
  }
}

export const PopoverDiv: FC<{ pop: PopoverState; onWarning?: (warnings: string[]) => void }> = ({
  pop,
  onWarning,
}) => {
  // A tip is NOT part of any block's static render, so no pre-pass can collect
  // it: it appears at hover or focus time, long after every parent has
  // rendered. It therefore reports through its own sink, called at the moment
  // of the render below — which is safe precisely because nobody reads the
  // array afterwards. (The delegated quiz/figure case is the opposite: a parent
  // DOES read it later, which is why those needed a pre-pass instead.)
  const warnings: string[] = []
  const html = renderInline(pop.tip, { addWarning: (m: string) => warnings.push(m) })
  onWarning?.([...warnings])
  // Deliberately no `failOnWarning` counterpart, unlike the render entry
  // points. This component mounts from a hover or a focus, so throwing during
  // its render would tear down the figure the reader is looking at — a worse
  // failure than an unreported tip, and not the trade a policy switch should
  // silently make. Recorded in the spec rather than left implicit.
  return (
    <div
      className={`exp-popover exp-popover-${pop.placement}`}
      role="tooltip"
      style={{ top: pop.top, left: pop.left }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

/** Static-path wrapper: same delegation around a rendered block's HTML.
 *  Only mounted when the host passed onElementEvent (opt-in, keeps
 *  <Explanation> RSC-safe by default). */
export const FigureEvents: FC<{
  html: string
  onEvent?: (e: FigureElementEvent) => void
  onWarning?: (warnings: string[]) => void
}> = ({ html, onEvent, onWarning }) => {
  const { stageRef, pop, bind } = useElementPopover(onEvent)
  return (
    <div ref={stageRef} className="exp-fig-events" {...bind}>
      <div dangerouslySetInnerHTML={{ __html: html }} />
      {pop && <PopoverDiv pop={pop} onWarning={onWarning} />}
    </div>
  )
}
