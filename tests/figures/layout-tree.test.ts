import { describe, expect, it } from "vitest"
import { layoutFlow } from "../../src/figures/layoutFlow"
import { layoutTree, mindMapTreeStats, mindMapFigureFits, mindMapFigureWidth, type TreeNodeSpec } from "../../src/figures/layoutTree"
import type { NodeBoxEl, Scene } from "../../src/figures/scene"

/** The "kinds of cache" tree from spec §3.3 — the one `layoutFlow`
 *  demonstrably misplaces by ~162px. */
const CACHE_TREE: TreeNodeSpec = {
  label: "Cache",
  children: [
    { label: "Browser cache" },
    { label: "CDN edge" },
    { label: "Shared cache", children: [{ label: "In-memory" }, { label: "On-disk" }] },
    { label: "TTL expiry", children: [{ label: "Time-based" }] },
    { label: "Eviction", children: [{ label: "LRU" }, { label: "LFU" }] },
  ],
}

const WIDE_TREE: TreeNodeSpec = {
  label: "Storage tiers",
  children: [
    { label: "Block storage (spinning rust and ink)", children: [{ label: "HDD" }, { label: "Tape" }] },
    { label: "Flash", children: [{ label: "NVMe" }, { label: "eMMC" }] },
  ],
}

const STAR_TREE: TreeNodeSpec = {
  label: "Root",
  children: Array.from({ length: 9 }, (_, i) => ({ label: `Child ${i}` })),
}

const CHAIN_TREE: TreeNodeSpec = {
  label: "L0",
  children: [{ label: "L1", children: [{ label: "L2", children: [{ label: "L3" }] }] }],
}

function chain(depth: number, prefix = "L"): TreeNodeSpec {
  let t: TreeNodeSpec = { label: `${prefix}${depth}` }
  for (let i = depth - 1; i >= 0; i--) t = { label: `${prefix}${i}`, children: [t] }
  return t
}

function countLeaves(t: TreeNodeSpec): number {
  if (!t.children || t.children.length === 0) return 1
  return t.children.reduce((s, c) => s + countLeaves(c), 0)
}

/** Pre-order traversal — the order `layoutTree` assigns ids in, so a node's id
 *  is `n` + its index here. Deriving parentage from the IR rather than by
 *  guessing from coordinates keeps the centring assertion exact: a geometric
 *  heuristic could count a grandchild as a child and quietly weaken it. */
function preOrder(node: TreeNodeSpec): TreeNodeSpec[] {
  return [node, ...(node.children ?? []).flatMap(preOrder)]
}

function boxes(scene: Scene): NodeBoxEl[] {
  return scene.elements.filter((e): e is NodeBoxEl => e.kind === "node-box")
}

function byId(scene: Scene): Map<string, NodeBoxEl> {
  return new Map(boxes(scene).map(b => [b.id, b]))
}

function centre(b: NodeBoxEl): number {
  return b.y + b.h / 2
}

/** The vertical extent of a node's WHOLE subtree — its own box unioned with
 *  every descendant's box.
 *
 *  This is deliberately not the node's own box. "Shared cache" is inset at
 *  y=171..215 inside a subtree that reaches 140..246, because its own
 *  children hang below it. A parent is centred over the region its
 *  DESCENDANTS occupy, not over the boxes of its immediate children — and
 *  confusing the two is the whole difference between a dendrogram and a list
 *  with extra steps.
 *
 *  Derived from the emitted boxes, so a layout that reserves the right space
 *  but serialises it wrongly still fails. */
function subtreeSpan(node: TreeNodeSpec, tree: TreeNodeSpec, emitted: Map<string, NodeBoxEl>): { top: number; bottom: number } {
  const order = preOrder(tree)
  const box = emitted.get(`n${order.indexOf(node)}`)
  if (!box) throw new Error(`missing box for ${node.label}`)
  let top = box.y
  let bottom = box.y + box.h
  for (const k of node.children ?? []) {
    const e = subtreeSpan(k, tree, emitted)
    top = Math.min(top, e.top)
    bottom = Math.max(bottom, e.bottom)
  }
  return { top, bottom }
}

/** Centre of the union of a node's children's subtree spans. */
function childSpanCentre(tree: TreeNodeSpec, kids: TreeNodeSpec[], emitted: Map<string, NodeBoxEl>): number {
  const spans = kids.map(k => subtreeSpan(k, tree, emitted))
  return (Math.min(...spans.map(s => s.top)) + Math.max(...spans.map(s => s.bottom))) / 2
}
/** Parent → its children, resolved through the pre-order id convention and
 *  looked up in the EMITTED scene — so a layout that computes the right
 *  number but serialises the wrong box fails here. */
function linksOf(scene: Scene, tree: TreeNodeSpec): Array<{ parent: NodeBoxEl; kids: TreeNodeSpec[] }> {
  const order = preOrder(tree)
  const emitted = byId(scene)
  const out: Array<{ parent: NodeBoxEl; kids: TreeNodeSpec[] }> = []
  for (let i = 0; i < order.length; i++) {
    const kids = order[i]!.children ?? []
    if (kids.length === 0) continue
    const parent = emitted.get(`n${i}`)
    if (!parent) throw new Error(`missing box for pre-order index ${i} (${order[i]!.label})`)
    out.push({ parent, kids })
  }
  return out
}

describe("layoutTree — the centring invariant", () => {
  it("centres every parent over its own children's span", () => {
    const { scene } = layoutTree(CACHE_TREE)
    const emitted = byId(scene)
    const links = linksOf(scene, CACHE_TREE)
    expect(links.length).toBeGreaterThan(0)
    for (const { parent, kids } of links) {
      expect(Math.abs(centre(parent) - childSpanCentre(CACHE_TREE, kids, emitted)),
        `${parent.label} is off its subtree centre`).toBeLessThanOrEqual(0.5)
    }
  })

  it("centres every parent in every adversarial tree too", () => {
    for (const tree of [WIDE_TREE, STAR_TREE, CHAIN_TREE, chain(8)]) {
      const { scene } = layoutTree(tree)
      const emitted = byId(scene)
      for (const { parent, kids } of linksOf(scene, tree)) {
        expect(Math.abs(centre(parent) - childSpanCentre(tree, kids, emitted)),
          `${parent.label} off centre in ${parent.id}`).toBeLessThanOrEqual(0.5)
      }
    }
  })

  it("FAILS against layoutFlow on the same tree (bites check)", () => {
    // Not a permanent claim about layoutFlow — it is the evidence that the
    // assertion above can fail at all. Without this pair, "centring is the
    // property that distinguishes the two layouts" is an untested assertion.
    const { scene } = layoutFlow({
      nodes: [
        { id: "cache", label: "Cache" },
        { id: "browser", label: "Browser cache" },
        { id: "cdn", label: "CDN edge" },
        { id: "shared", label: "Shared cache" },
        { id: "mem", label: "In-memory" },
        { id: "disk", label: "On-disk" },
        { id: "ttl", label: "TTL expiry" },
        { id: "evict", label: "Eviction" },
      ],
      edges: [
        { from: "cache", to: "browser" },
        { from: "cache", to: "cdn" },
        { from: "cache", to: "shared" },
        { from: "shared", to: "mem" },
        { from: "shared", to: "disk" },
        { from: "browser", to: "ttl" },
        { from: "shared", to: "evict" },
      ],
      direction: "lr",
    })
    const b = byId(scene)
    const shared = b.get("shared")!
    const span = (centre(b.get("mem")!) + centre(b.get("disk")!)) / 2
    expect(Math.abs(centre(shared) - span)).toBeGreaterThan(1)
  })
})

describe("layoutTree — containment and structure", () => {
  const TREES: ReadonlyArray<readonly [string, TreeNodeSpec]> = [
    ["cache", CACHE_TREE],
    ["wide", WIDE_TREE],
    ["star", STAR_TREE],
    ["chain", CHAIN_TREE],
  ]

  it.each(TREES)("%s: no two nodes overlap within a column", (_name, tree) => {
    const { scene } = layoutTree(tree)
    const byCol = new Map<number, NodeBoxEl[]>()
    for (const b of boxes(scene)) {
      const key = Math.round(b.x)
      byCol.set(key, [...(byCol.get(key) ?? []), b])
    }
    for (const [x, col] of byCol) {
      const sorted = [...col].sort((a, b) => a.y - b.y)
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i]!.y, `overlap at x=${x}: ${sorted[i - 1]!.label} / ${sorted[i]!.label}`)
          .toBeGreaterThanOrEqual(sorted[i - 1]!.y + sorted[i - 1]!.h)
      }
    }
  })

  it.each(TREES)("%s: no two columns overlap horizontally", (_name, tree) => {
    const { scene } = layoutTree(tree)
    const cols = [...new Set(boxes(scene).map(b => Math.round(b.x)))].sort((a, b) => a - b)
    const widest = new Map<number, number>()
    for (const b of boxes(scene)) {
      const k = Math.round(b.x)
      widest.set(k, Math.max(widest.get(k) ?? 0, b.x + b.w))
    }
    for (let i = 1; i < cols.length; i++) {
      expect(widest.get(cols[i - 1]!)!).toBeLessThanOrEqual(cols[i]!)
    }
  })

  it.each(TREES)("%s: keeps every element inside the scene box", (_name, tree) => {
    const { scene } = layoutTree(tree)
    for (const b of boxes(scene)) {
      expect(b.x).toBeGreaterThanOrEqual(0)
      expect(b.y).toBeGreaterThanOrEqual(0)
      expect(b.x + b.w).toBeLessThanOrEqual(scene.width + 0.01)
      expect(b.y + b.h).toBeLessThanOrEqual(scene.height + 0.01)
    }
  })

  it.each(TREES)("%s: emits one trunk per non-leaf, never one per edge", (_name, tree) => {
    const { scene } = layoutTree(tree)
    const trunks = scene.elements.filter(e => e.kind === "line-path")
    const nonLeaves = mindMapTreeStats(tree).nodes - countLeaves(tree)
    expect(trunks).toHaveLength(nonLeaves)
    // And a trunk is never a per-child elbow: one path, not N.
    for (const t of trunks) {
      if (t.kind !== "line-path") continue
      expect(t.d.startsWith("M ")).toBe(true)
    }
  })

  it("carries no arrowhead — containment is not directed", () => {
    const { scene } = layoutTree(CACHE_TREE)
    const heads = scene.elements.filter(e => e.kind === "arrow")
    expect(heads).toEqual([])
  })

  it("carries node ids in pre-order, stably", () => {
    const { scene } = layoutTree(CACHE_TREE)
    expect(boxes(scene).map(b => b.id)).toEqual(preOrder(CACHE_TREE).map((_, i) => `n${i}`))
  })

  it("gives depth to the node shape so hierarchy reads without connectors", () => {
    const { scene } = layoutTree(CACHE_TREE)
    const emitted = byId(scene)
    expect(emitted.get("n0")!.shape).toBe("pill")
    expect(emitted.get("n1")!.shape).toBe("box")
    expect(emitted.get("n4")!.shape).toBe("note")
  })
})

describe("layoutTree — adversarial input", () => {
  const CASES: ReadonlyArray<readonly [string, TreeNodeSpec]> = [
    ["single node", { label: "Alone" }],
    ["unicode", { label: "κόσμος — 世", children: [{ label: "ελλάδα" }, { label: "日本" }] }],
    ["one very long unbreakable token", { label: "x".repeat(400) }],
    ["one very long sentence", { label: "a ".repeat(200) }],
    ["mixed widths", { label: "R", children: [{ label: "a".repeat(90) }, { label: "b" }, { label: "c".repeat(60) }] }],
    ["deep but legal (11)", chain(11)],
    ["star of 9", STAR_TREE],
  ]

  it.each(CASES)("%s lays out finite and NaN-free", (_name, tree) => {
    const { scene } = layoutTree(tree)
    expect(Number.isFinite(scene.width)).toBe(true)
    expect(Number.isFinite(scene.height)).toBe(true)
    expect(scene.width).toBeGreaterThan(0)
    expect(scene.height).toBeGreaterThan(0)
    for (const b of boxes(scene)) {
      expect(Number.isFinite(b.x + b.y + b.w + b.h), `${b.label} is not finite`).toBe(true)
    }
  })

  it.each(CASES)("%s keeps its centring invariant", (_name, tree) => {
    const { scene } = layoutTree(tree)
    const emitted = byId(scene)
    for (const { parent, kids } of linksOf(scene, tree)) {
      expect(Math.abs(centre(parent) - childSpanCentre(tree, kids, emitted)), parent.label)
        .toBeLessThanOrEqual(0.5)
    }
  })

  it("is deterministic", () => {
    expect(JSON.stringify(layoutTree(WIDE_TREE))).toEqual(JSON.stringify(layoutTree(WIDE_TREE)))
    expect(JSON.stringify(layoutTree(CACHE_TREE))).toEqual(JSON.stringify(layoutTree(CACHE_TREE)))
  })

  it("counts nodes and depth", () => {
    expect(mindMapTreeStats(CACHE_TREE)).toEqual({ nodes: 11, depth: 3 })
    expect(mindMapTreeStats({ label: "solo" })).toEqual({ nodes: 1, depth: 1 })
    expect(mindMapTreeStats(CHAIN_TREE)).toEqual({ nodes: 4, depth: 4 })
  })

  // Breadth is nearly FREE and depth is what costs width, because columns hug
  // their own widest label: 8 children with 100-character labels all wrap into
  // ONE 176px column. So the 825px ceiling is a DEPTH ceiling in practice,
  // which is why it catches "deep and wide-labelled" specifically and why
  // MIND_MAP_MAX_DEPTH is the load-bearing policy guard rather than the
  // node count. These two cases pin that relationship rather than assuming it.
  it("treats breadth as cheap and depth as expensive", () => {
    const wideLabels = (d: number): TreeNodeSpec =>
      chain(d, `${"wide label ".repeat(4)}`)
    const deepNarrow = chain(6, "L")

    // 8 siblings, each label far longer than the column: one column, still fits.
    const broadButShallow: TreeNodeSpec = {
      label: "root",
      children: Array.from({ length: 8 }, (_, i) => ({ label: `${"wide".repeat(20)} ${i}` })),
    }
    expect(mindMapFigureWidth(broadButShallow)).toBeLessThanOrEqual(825)
    expect(mindMapFigureFits(broadButShallow)).toBe(true)

    // Same label width, but six levels deep: six columns, over the ceiling.
    expect(mindMapFigureFits(wideLabels(6))).toBe(false)
    // Six levels of SHORT labels stays inside it.
    expect(mindMapFigureFits(deepNarrow)).toBe(true)
  })
})
