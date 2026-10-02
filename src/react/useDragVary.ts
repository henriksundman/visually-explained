"use client"

/**
 * Direct manipulation for authored figures (drag-to-vary spec §7–8).
 *
 * The SVG is injected with `dangerouslySetInnerHTML`, so there are no React
 * elements to attach handlers to. Everything here is delegated off the stage
 * exactly as `useElementPopover` does — one listener set per figure.
 *
 * The hook owns no geometry: it resolves a pointer to a scene point through
 * `dragGeometry` and writes a number into the SAME `values` state a slider
 * writes. That shared state is the whole design — it is why a slider thumb
 * follows a dragged handle instead of the two drifting apart.
 */

import { useCallback, useMemo, useRef, useState, type RefObject } from "react"
import type { DraggableSpec } from "../figures/authored"
import type { FigureSpec } from "../figures/authored"
import type { DraggableAxes } from "../figures/svg"
import { clampParam, clientToScene, dragValueFor, type SceneMatrix } from "./dragGeometry"

/** Keyboard nudge increments, in scene units. Deliberately not the param's
 *  `step`: that is a slider affordance and would make arrow keys stutter. */
export const NUDGE = 1
export const NUDGE_COARSE = 10

export interface DragBindHandlers {
  onPointerDown: (e: React.PointerEvent) => void
  onPointerMove: (e: React.PointerEvent) => void
  onPointerUp: (e: React.PointerEvent) => void
  onPointerCancel: (e: React.PointerEvent) => void
  onKeyDown: (e: React.KeyboardEvent) => void
}

/** Resolve a declared handle's axes, or null when the id is not declared. */
export function dragAxes(
  draggable: DraggableSpec[] | undefined,
  id: string,
): { x?: string; y?: string } | null {
  const d = draggable?.find(e => e.id === id)
  if (!d) return null
  return { ...(d.x !== undefined ? { x: d.x } : {}), ...(d.y !== undefined ? { y: d.y } : {}) }
}

export function isDraggable(draggable: DraggableSpec[] | undefined, id: string): boolean {
  return dragAxes(draggable, id) !== null
}

/** Axis letter(s) for a declared handle, for the `data-draggable` attribute. */
export function axesFor(draggable: DraggableSpec[] | undefined, id: string): DraggableAxes | null {
  const a = dragAxes(draggable, id)
  if (!a) return null
  if (a.x !== undefined && a.y !== undefined) return "xy"
  return a.x !== undefined ? "x" : "y"
}

/** Arrow-key delta. Scene-relative, never the param's step. */
export function nudge(direction: number, fine: boolean): number {
  return direction * (fine ? NUDGE_COARSE : NUDGE)
}

interface ActiveDrag {
  id: string
  x?: string
  y?: string
  /** Distance from the handle's scene origin to where the pointer went down. */
  offsetX: number
  offsetY: number
  /** The handle's current scene position, so offsets survive a re-render. */
  originX: number
  originY: number
}

export interface UseDragVaryArgs {
  draggable: DraggableSpec[] | undefined
  params: FigureSpec[]
  values: Record<string, number>
  setParam: (name: string, value: number) => void
  stageRef: RefObject<HTMLDivElement | null>
  /** Scene dimensions, for the rect fallback. */
  viewW: number
  viewH: number
}

export function useDragVary({
  draggable,
  params,
  values,
  setParam,
  stageRef,
  viewW,
  viewH,
}: UseDragVaryArgs): { bind: DragBindHandlers; draggableMap: Map<string, DraggableAxes>; activeId: string | null } {
  const [activeId, setActiveId] = useState<string | null>(null)
  const active = useRef<ActiveDrag | null>(null)

  const draggableMap = useMemo(() => {
    const m = new Map<string, DraggableAxes>()
    for (const d of draggable ?? []) {
      const axes = axesFor(draggable, d.id)
      if (axes) m.set(d.id, axes)
    }
    return m
  }, [draggable])

  const paramOf = useCallback(
    (name: string | undefined) => (name ? params.find(p => p.name === name) : undefined),
    [params],
  )

  /** Resolve a client point to scene coordinates via the live <svg>. */
  const toScene = useCallback(
    (clientX: number, clientY: number) => {
      const root = stageRef.current
      const svg = root?.querySelector("svg")
      if (!root || !svg) return null
      let matrix: SceneMatrix | null = null
      const ctm = svg.getScreenCTM?.()
      if (ctm) matrix = { a: ctm.a, b: ctm.b, c: ctm.c, d: ctm.d, e: ctm.e, f: ctm.f }
      const box = svg.getBoundingClientRect?.()
      return clientToScene(
        { clientX, clientY },
        {
          matrix,
          rect: box ? { left: box.left, top: box.top, width: box.width, height: box.height } : null,
          viewW,
          viewH,
        },
      )
    },
    [stageRef, viewW, viewH],
  )

  const write = useCallback(
    (name: string | undefined, raw: number, grabOffset: number, current: number) => {
      const p = paramOf(name)
      // An axis naming no declared param is inert — warn-free by design; the
      // author gets a handle that does not move rather than a crash.
      if (!p) return
      const next = dragValueFor(raw, p, { value: current, grabOffset })
      setParam(name!, next)
    },
    [paramOf, setParam],
  )

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const hit = (e.target as Element | null)?.closest?.("[data-draggable]") as HTMLElement | null
      if (!hit) return
      const id = hit.getAttribute("data-el-id")
      if (!id) return
      const axes = dragAxes(draggable, id)
      if (!axes) return
      const point = toScene(e.clientX, e.clientY)
      // No conversion ⇒ no write. A figure that quietly jumps to a guessed
      // position is worse than one that does not move.
      if (!point) return

      const spec = paramOf(axes.x ?? axes.y)
      const current = axes.x !== undefined ? (values[axes.x] ?? spec?.initial ?? 0) : 0
      const currentY = axes.y !== undefined ? (values[axes.y] ?? paramOf(axes.y)?.initial ?? 0) : 0

      active.current = {
        id,
        ...(axes.x !== undefined ? { x: axes.x } : {}),
        ...(axes.y !== undefined ? { y: axes.y } : {}),
        originX: current,
        originY: currentY,
        offsetX: point.x - current,
        offsetY: point.y - currentY,
      }
      setActiveId(id)
      // Capture on the SVG root: without it the drag dies the moment the
      // cursor outruns a moving handle.
      const root = stageRef.current
      const svg = root?.querySelector("svg")
      svg?.setPointerCapture?.(e.pointerId)
      e.preventDefault()
    },
    [draggable, paramOf, stageRef, toScene, values],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const a = active.current
      if (!a) return
      const point = toScene(e.clientX, e.clientY)
      if (!point) return
      if (a.x !== undefined) write(a.x, point.x, a.offsetX, a.originX)
      if (a.y !== undefined) write(a.y, point.y, a.offsetY, a.originY)
    },
    [toScene, write],
  )

  const endDrag = useCallback(() => {
    // A cancelled drag leaves the param at its last written value: a
    // half-finished drag is not an error state.
    active.current = null
    setActiveId(null)
  }, [])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const target = e.target as Element | null
      const id = target?.getAttribute?.("data-el-id")
      if (!id) return
      const axes = dragAxes(draggable, id)
      if (!axes) return

      const horiz = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0
      const vert = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0
      const isEnd = e.key === "Home" || e.key === "End"
      if (horiz === 0 && vert === 0 && !isEnd) return
      e.preventDefault()
      const fine = e.shiftKey

      for (const [axis, dir] of [
        [axes.x, horiz],
        [axes.y, vert],
      ] as const) {
        if (axis === undefined) continue
        const p = paramOf(axis)
        if (!p) continue
        const cur = values[axis] ?? p.initial
        if (isEnd) {
          // Home is the minimum, End the maximum, per the slider convention.
          setParam(axis, e.key === "Home" ? clampParam(p.min, p) : clampParam(p.max, p))
        } else if (dir !== 0) {
          setParam(axis, clampParam(cur + nudge(dir, fine), p))
        }
      }
    },
    [draggable, paramOf, setParam, values],
  )

  const bind = useMemo(
    () => ({ onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag, onKeyDown }),
    [onPointerDown, onPointerMove, endDrag, onKeyDown],
  )

  return { bind, draggableMap, activeId }
}