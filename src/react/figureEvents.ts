/** Pure hit-test + popover placement logic for the interactivity layer
 *  (events spec §5). No React imports — the components in ElementPopover.tsx
 *  and the wiring tasks consume these; everything here is unit-testable. */

export type FigureElementEvent =
  | { kind: "hover"; elId: string; phase: "start" | "end" }
  | { kind: "click"; elId: string }

export interface ElementHit {
  elId: string
  tip: string | null
  node: Element
}

const MAX_TIP = 200

/** Tips sanitize to null: empty/whitespace and over-long never render. */
export function resolveTip(text: string | null): string | null {
  if (!text) return null
  const t = text.trim()
  return t !== "" && t.length <= MAX_TIP ? t : null
}

/** Walk from the event target up to the identified wrapper emitted by
 *  sceneToSvg (`<g class="exp-el" data-el-id=…>`). Chrome returns null. */
export function hitElement(target: EventTarget | null): ElementHit | null {
  if (!target || typeof (target as Element).closest !== "function") return null
  const el = (target as Element).closest<HTMLElement>(".exp-el")
  if (!el) return null
  const elId = el.getAttribute("data-el-id")
  if (!elId) return null
  return { elId, tip: resolveTip(el.getAttribute("data-tip")), node: el }
}

export interface Placement {
  top: number
  left: number
  placement: "above" | "below"
}

const GAP = 8
const MAX_W = 260
const HEADROOM = 60 // rough popover height allowance for the above/below flip

/** Position a max-width popover relative to the stage box. Prefer above the
 *  anchor (bottom edge sits GAP above it — the component adds translateY(-100%)),
 *  flip below when clipped, nudge horizontally inside the stage. Clamp lower
 *  bound last: on stages narrower than the popover the upper bound is
 *  negative and min-then-max would pin the popover past the left edge. */
export function placePopover(
  anchor: { left: number; top: number; width: number; height: number; right: number; bottom: number },
  stage: { left: number; top: number; right: number },
): Placement {
  let left = anchor.left + anchor.width / 2 - MAX_W / 2
  left = Math.max(Math.min(left, stage.right - MAX_W - 4), stage.left + 4)
  const above = anchor.top - stage.top >= HEADROOM
  const top = above ? anchor.top - stage.top - GAP : anchor.bottom - stage.top + GAP
  return { top, left: left - stage.left, placement: above ? "above" : "below" }
}
