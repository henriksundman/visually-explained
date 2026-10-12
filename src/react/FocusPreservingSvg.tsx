"use client"

/**
 * Renders figure SVG markup while preserving keyboard focus across the swap.
 *
 * The SVG arrives as an HTML string (the Scene compiler emits markup, never
 * React elements), so it is injected with `dangerouslySetInnerHTML`. React
 * replaces that whole subtree whenever the string changes — and the string
 * changes on every parameter edit, because moving a slider re-solves the scene.
 *
 * The consequence is that any focused `.exp-el` inside the SVG is destroyed and
 * recreated, and focus falls to `<body>`. A keyboard user nudges an element
 * once and then has nothing focused: every subsequent keypress goes nowhere.
 *
 * This was pre-existing for tip handles (focusable via `tabindex`) and became
 * visible with drag, where holding an arrow key is the primary interaction.
 *
 * The fix records the focused element's `data-el-id` before the swap and
 * restores focus to the element carrying the same id afterwards. Ids are the
 * identity the scene layer already guarantees (first-wins, duplicates render
 * anonymous), so re-focusing by id is stable across a re-render.
 */

import { useEffect, useRef, type FC } from "react"

/** Attribute the emit layer writes for identified wrappers. */
const EL_ID = "data-el-id"

export const FocusPreservingSvg: FC<{ html: string }> = ({ html }) => {
  const hostRef = useRef<HTMLDivElement | null>(null)
  // Id of the element that holds focus inside the figure.
  const focusedId = useRef<string | null>(null)

  // Native listeners, NOT React's onFocusCapture. The SVG is injected through
  // `dangerouslySetInnerHTML`, so React never saw those nodes and its synthetic
  // focus events do not fire for them — the host div receives no focusin at
  // all. Attaching natively is the only way to observe focus inside markup
  // React did not create.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const onFocusIn = (e: FocusEvent) => {
      const id = (e.target as Element | null)?.getAttribute?.(EL_ID) ?? null
      if (id) focusedId.current = id
    }
    const onFocusOut = (e: FocusEvent) => {
      // relatedTarget is null when the node is DESTROYED rather than focus
      // moving — that is the subtree swap we must survive, so keep the id.
      // A real move elsewhere inside the figure updates it instead.
      const next = (e.relatedTarget as Element | null)?.getAttribute?.(EL_ID) ?? null
      if (next) {
        focusedId.current = next
        return
      }
      if (!e.relatedTarget) return // destroyed: retain, restore below
      focusedId.current = null
    }
    host.addEventListener("focusin", onFocusIn)
    host.addEventListener("focusout", onFocusOut)
    return () => {
      host.removeEventListener("focusin", onFocusIn)
      host.removeEventListener("focusout", onFocusOut)
    }
  }, [])

  // Runs on every commit, after React has written the new markup. The restore
  // itself is scheduled on the NEXT frame rather than called synchronously:
  // calling .focus() from inside a passive-effect flush re-fires focus/blur
  // synchronously through useElementPopover's capture handlers (setPop) —
  // during a per-frame sweep that chains a nested sync update every frame
  // until React aborts with "Maximum update depth exceeded" (uncaught,
  // boundary-blind; BUG-REPORT-sweep-focus-storm). One rAF hop puts the
  // restore in its own task, outside React's update: it cannot reenter a
  // flush, so no chain can form.
  const restoreRef = useRef<number | null>(null)
  const restoreScheduledRef = useRef(false)
  useEffect(() => {
    const id = focusedId.current
    const host = hostRef.current
    if (!id || !host) return
    const active = host.ownerDocument.activeElement
    if (active?.getAttribute?.(EL_ID) === id) return // focus already survived
    // At most one pending restore per commit batch (several can fire before
    // the next frame); the callback consults the ref for the id to restore,
    // so the last commit wins and a pending restore is never duplicated.
    if (restoreScheduledRef.current) return
    restoreScheduledRef.current = true
    restoreRef.current = requestAnimationFrame(() => {
      restoreScheduledRef.current = false
      restoreRef.current = null
      const want = focusedId.current
      const el = hostRef.current?.querySelector<SVGElement>(`[${EL_ID}="${CSS.escape(want ?? "")}"]`)
      if (!want || !el) return // focus moved elsewhere or the element is gone
      if (hostRef.current?.ownerDocument.activeElement?.getAttribute?.(EL_ID) === want) return
      el.focus()
    })
  })

  // Cancel a pending restore on unmount — the rAF must not fire on a dead ref.
  useEffect(() => () => {
    if (restoreRef.current !== null) cancelAnimationFrame(restoreRef.current)
  }, [])

  return <div ref={hostRef} dangerouslySetInnerHTML={{ __html: html }} />
}