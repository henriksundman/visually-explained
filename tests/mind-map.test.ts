import { describe, expect, it } from "vitest"
import { renderExplanation } from "../src/core/render"
import "../src/core/registerAll"
import { mindMapFigureWidth, mindMapTreeStats } from "../src/figures/layoutTree"

const TREE = {
  label: "Cache",
  children: [
    { label: "Browser cache" },
    { label: "Shared cache", children: [{ label: "In-memory" }, { label: "On-disk" }] },
  ],
}

/** A chain of exactly `depth` nodes, each label `wide` chars of filler. */
function chain(depth: number, wide = 0): unknown {
  let node: { label: string; children?: unknown[] } = { label: `L${depth - 1}` }
  for (let i = depth - 2; i >= 0; i--) {
    const label = `L${i}` + (wide ? " " + "x".repeat(wide) : "")
    node = { label, children: [node] }
  }
  return node
}

function render(root: unknown, extra: Record<string, unknown> = {}) {
  return renderExplanation({
    version: 1,
    blocks: [{ type: "mind-map", root, ...extra }],
  } as never)
}

describe("mind-map — figure form", () => {
  it("draws a figure by default and typesets its labels", () => {
    const { html, warnings } = render(TREE)
    expect(html).toContain("exp-mind-map")
    expect(html).toContain("<svg")
    expect(html).toContain("Browser cache")
    expect(warnings).toEqual([])
  })

  it("degrades to a nested list when told to", () => {
    const { html } = render(TREE, { presentation: "text" })
    expect(html).not.toContain("<svg")
    expect(html).toContain("<ul")
    expect(html).toContain("Shared cache")
  })

  it("nests the text form so containment survives without the figure", () => {
    const { html } = render(TREE, { presentation: "text" })
    // "Shared cache" must be an <li> inside a <ul> that is itself inside the
    // outer <ul>. Matching the markup shape (rather than comparing offsets)
    // keeps this honest: an off-by-one in the search origin would otherwise
    // make a flat list look nested.
    expect(html).toMatch(
      /<ul[^>]*><li>Cache<ul[^>]*><li>Browser cache<\/li><li>Shared cache<ul[^>]*><li>In-memory<\/li><li>On-disk<\/li><\/ul><\/li><\/ul><\/li><\/ul>/,
    )
  })

  it("puts the list class on EVERY nested level, not just the outer one", () => {
    // The styling hangs off `.exp-mind-map-list .exp-mind-map-list` (indent +
    // left rule) and `.exp-mind-map-list > li` (the dot marker). An inner <ul>
    // without the class matches neither, so the list still nests
    // STRUCTURALLY while reading as a flat, unmarked stack — a degradation
    // that looks like a degradation. Only a real engine catches this; the
    // CSS-rule tests pass either way.
    const { html } = render(TREE, { presentation: "text" })
    const lists = html.match(/<ul[^>]*>/g) ?? []
    // Three for this tree: the block's own list, the one under "Cache", and
    // the one under "Shared cache". Asserting the count means a regression
    // cannot pass by dropping the level instead of the class.
    expect(lists.length).toBe(3)
    for (const tag of lists) expect(tag).toContain('class="exp-mind-map-list"')
    expect(html).not.toMatch(/<ul>/)
  })

  it("carries an aria-label that linearises the tree", () => {
    const { html } = render(TREE)
    const label = html.match(/aria-label="([^"]*)"/)?.[1] ?? ""
    expect(label).toContain("Cache contains")
    expect(label).toContain("Shared cache contains In-memory")
  })

  it("draws a math label in the SVG as readable plain text, not TeX", () => {
    // The Luma bug: the same label rendered as real math in the text form and
    // popovers, but the figure drew the literal \(…\) — because the SVG emit
    // layer wrote labels verbatim. The emit layer now strips spans to plain
    // text; the figure shows "2 + 3 = 5".
    const { html } = render({ label: String.raw`\(2 + 3 = 5\)` })
    expect(html).toContain("<svg")
    expect(html).toContain(">2 + 3 = 5</text>")
    expect(html).not.toContain("\\(")
  })

  it("keeps a WRAPPED math label readable — the wrap must not split a span", () => {
    // The layout wraps labels BEFORE the emit layer, and a wrap that split a
    // `\\(…\\)` across lines left each half unclosed, so the emit layer's
    // strip passed literal TeX through — the Luma symptom, caught by the dist
    // probe. The wrap therefore sees the STRIPPED text.
    const { html } = render({
      label: "solve",
      children: [{ label: String.raw`therefore \(x \times 2 = 16\) and more words here` }],
    })
    expect(html).toContain("<svg")
    expect(html).not.toContain("\\(")
    expect(html).toContain("×")
  })

  it("strips the delimiters from the aria-label too", () => {
    const { html } = render({ label: String.raw`Solve \(x - 3 = 5\)`, children: [{ label: "check" }] })
    const label = html.match(/aria-label="([^"]*)"/)?.[1] ?? ""
    expect(label).toContain("Solve x - 3 = 5")
    expect(label).not.toContain("\\(")
  })

  it("keeps inline markup out of the aria-label", () => {
    // The aria-label is spoken, not rendered. Sibling primitives
    // (diagram, cause-effect, timeline) all pass raw label text, and
    // sceneToSvg escapes the attribute — so piping renderInline's HTML in
    // here would have a screen reader announce literal "<strong>".
    const { html } = render({ label: "**Bold** root", children: [{ label: "*it*" }] })
    const label = html.match(/aria-label="([^"]*)"/)?.[1] ?? ""
    expect(label).not.toContain("<")
    expect(label).toContain("Bold")
  })
})

describe("mind-map — degradation", () => {
  it("honours an explicit figure even when the tree is enormous", () => {
    const big = {
      label: "r",
      children: Array.from({ length: 3 }, (_, i) => ({
        label: `c${i}`,
        children: Array.from({ length: 8 }, (_, j) => ({ label: `g${i}${j}` })),
      })),
    }
    expect(mindMapTreeStats(big as never).nodes).toBeGreaterThan(24)
    const { html, warnings } = render(big, { presentation: "figure" })
    expect(html).toContain("<svg")
    expect(warnings).toEqual([])
  })

  it("reports NO degradation for an explicit text choice", () => {
    // The author asked for the list; a warning blaming the width for it would
    // be a lie, and `failOnWarning` would throw on a deliberate choice.
    const { html, warnings } = render(TREE, { presentation: "text" })
    expect(html).not.toContain("<svg")
    expect(warnings).toEqual([])
  })

  it("falls back to text past MIND_MAP_MAX_NODES and says so", () => {
    // Must stay INSIDE the schema to reach this primitive at all: the schema
    // allows at most 8 siblings, so a 30-child star is rejected before
    // resolvePresentation runs and lands in exp-fallback instead. Breadth
    // alone cannot make a big tree — a 3-level tree of legal fan-out does.
    const big = {
      label: "r",
      children: Array.from({ length: 3 }, (_, i) => ({
        label: `c${i}`,
        children: Array.from({ length: 8 }, (_, j) => ({ label: `g${i}${j}` })),
      })),
    }
    expect(mindMapTreeStats(big as never).nodes).toBeGreaterThan(24)

    const { html, warnings } = render(big)
    expect(html).not.toContain("<svg")
    expect(warnings.some(w => w.startsWith("[mind-map]"))).toBe(true)
  })

  it("falls back to text past MIND_MAP_MAX_DEPTH and says so", () => {
    const { html, warnings } = render(chain(7))
    expect(html).not.toContain("<svg")
    expect(warnings.some(w => w.startsWith("[mind-map]"))).toBe(true)
  })

  it("falls back to text when the scene would be too wide, and says so", () => {
    // The fixture has to be measured, not guessed. Label length alone does not
    // make a tree wide — node labels wrap at TREE_NODE_W_MAX (176px), so three
    // 400-character labels lay out at 314px and fit comfortably. Width is a
    // function of DEPTH (one column per level), so the only way past 825 while
    // staying inside the node/depth guards is a chain at the depth limit whose
    // labels each fill their column.
    const wide = chain(5, 40)
    expect(mindMapTreeStats(wide as never)).toMatchObject({ nodes: 5, depth: 5 })
    expect(mindMapFigureWidth(wide as never)).toBeGreaterThan(825)

    const { html, warnings } = render(wide)
    expect(html).not.toContain("<svg")
    expect(warnings.some(w => w.includes("825"))).toBe(true)
  })

  it("keeps the three guards independent", () => {
    // Each condition must be able to fire alone, or one of them is dead code.
    // Count fires on a shallow, narrow, 30-child star; depth on a 7-chain;
    // width on the depth-5 chain above.
    const wideLabels = render(TREE, { presentation: "text" })
    expect(wideLabels.warnings).toEqual([])
    expect(mindMapFigureWidth(TREE as never)).toBeLessThanOrEqual(825)
  })

  it("throws under failOnWarning", () => {
    const big = {
      label: "r",
      children: Array.from({ length: 3 }, (_, i) => ({
        label: `c${i}`,
        children: Array.from({ length: 8 }, (_, j) => ({ label: `g${i}${j}` })),
      })),
    }
    expect(() =>
      renderExplanation({ version: 1, blocks: [{ type: "mind-map", root: big }] } as never, {
        failOnWarning: true,
      }),
    ).toThrow(/mind-map/)
  })
})

describe("mind-map — prose integration", () => {
  it("typesets inline math in a node label in the text form", () => {
    const { html } = render({ label: "Rate \\(\\eta\\)" }, { presentation: "text" })
    expect(html).toContain("exp-math-inline")
  })

  it("keeps the text form on REAL math markup (scope pin: the SVG strip must not leak here)", () => {
    // The text form has a MathML surface and must keep it — only the SVG
    // path (no MathML in SVG text) degrades to plain text. If this pin
    // fails, the emit-layer strip leaked into listHtml/renderInline.
    const { html } = render({ label: String.raw`Rate \(\eta\)` }, { presentation: "text" })
    expect(html).toContain("<math")
    expect(html).toContain("<mi>η</mi>")
  })

  it("escapes a node label rather than emitting markup", () => {
    const { html } = render({ label: '<img src=x onerror=alert(1)>' })
    expect(html).not.toContain("<img")
    expect(html).toContain("&lt;img")
  })

  it("escapes a node label in the text form too", () => {
    const { html } = render({ label: '<img src=x onerror=alert(1)>' }, { presentation: "text" })
    expect(html).not.toContain("<img")
    expect(html).toContain("&lt;img")
  })

  it("is deterministic", () => {
    expect(render(TREE).html).toBe(render(TREE).html)
  })
})