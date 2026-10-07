import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { renderExplanation } from "../src/core/render"
import "../src/core/registerAll"
import { allPrimitivesIr } from "./fixtures"

const cssFiles = ["tokens", "light", "dark"]

describe("themes", () => {
  it("defines every class the renderer emits", () => {
    const css = cssFiles.map(n => readFileSync(`src/themes/${n}.css`, "utf8")).join("\n")
    const defined = new Set([...css.matchAll(/\.exp-[a-z0-9-]+/g)].map(m => m[0].slice(1)))
    const { html } = renderExplanation(allPrimitivesIr)
    const used = new Set(
      [...html.matchAll(/class="([^"]+)"/g)]
        .flatMap(m => m[1]!.split(" "))
        .filter(c => c.startsWith("exp-")),
    )
    const missing = [...used].filter(c => !defined.has(c))
    expect(missing).toEqual([])
  })

  it("pins the document TOC by default with an inline opt-out", () => {
    const css = readFileSync("src/themes/tokens.css", "utf8")
    expect(css).toMatch(/\.exp-doc-toc\s*{[^}]*position: sticky/)
    expect(css).toMatch(/\.exp-doc-toc-inline\s*{[^}]*float: none/)
  })

  it("keeps the block heading on the same type scale as the fragment title", () => {
    const css = readFileSync("src/themes/tokens.css", "utf8")
    // Both are h3 in this library, so they must not drift apart. Pinned by
    // value rather than by selector so a rename cannot silently break it.
    const scale = (sel: string) =>
      css.match(new RegExp(`\\${sel}\\s*{[^}]*font-size: ([0-9.]+em)`))?.[1]
    expect(scale(".exp-heading")).toBe("1.15em")
    expect(scale(".exp-title")).toBe(scale(".exp-heading"))
    // And it must not grow a section's bottom rule: an in-flow heading is not a
    // structural break.
    expect(css).not.toMatch(/\.exp-heading\s*{[^}]*border-bottom/)
  })

  it("renders inline math at body size in compact style, not display size", () => {
    const css = readFileSync("src/themes/tokens.css", "utf8")
    // .exp math is 1.2em + math-style: normal, which is right for a derivation
    // step and wrong for a formula inside a sentence: 19.2px beside 16px body
    // text, and full-size fractions where compact is the inline convention.
    expect(css).toMatch(/\.exp-math-inline math\s*{[^}]*font-size: 1em/)
    expect(css).toMatch(/\.exp-math-inline math\s*{[^}]*math-style: compact/)
  })

  it("styles the TOC's active (aria-current) link for scroll-spy hosts", () => {
    const css = readFileSync("src/themes/tokens.css", "utf8")
    expect(css).toMatch(/\.exp-doc-toc-list a\[aria-current="true"\]\s*{[^}]*font-weight/)
    expect(css).toMatch(/\.exp-doc-toc-list a\[aria-current="true"\]\s*{[^}]*text-decoration: underline/)
  })

  it("styles the mind-map nested list and leaves room between levels", () => {
    const css = readFileSync("src/themes/tokens.css", "utf8")
    expect(css).toMatch(/\.exp-mind-map-list\s*{[^}]*list-style/)
    // Nesting must read as nesting: an indented inner list, not a flat one.
    expect(css).toMatch(/\.exp-mind-map-list \.exp-mind-map-list\s*{[^}]*margin-left/)
  })

  it("lays an image with prose out as two columns that self-collapse", () => {
    const css = readFileSync("src/themes/tokens.css", "utf8")
    // flex-wrap IS the responsive mechanism here — the bases are the
    // breakpoint. If this ever becomes a media query, this assertion is the
    // thing that noticed, and it should be rewritten rather than deleted.
    expect(css).toMatch(/\.exp-image-body\s*{[^}]*flex-wrap: wrap/)
    // min-width: 0 stops a long word in the prose forcing the row wider than
    // its column; without it the collapse silently stops working.
    expect(css).toMatch(/\.exp-image-body \.exp-image-prose\s*{[^}]*min-width: 0/)
    // The caption is a direct child of <figure>, so it cannot join the prose
    // column and must claim a full-width line beneath both.
    expect(css).toMatch(/\.exp-image-body \.exp-fig-caption\s*{[^}]*flex: 1 1 100%/)
  })

  it("gives edge labels a background halo so a label over a line stays readable", () => {
    const css = readFileSync("src/themes/tokens.css", "utf8")
    // The stroke paints UNDER the fill (paint-order) in the page background
    // colour, which dark.css overrides — the halo must follow the theme.
    expect(css).toMatch(/\.exp-edge-label\s*{[^}]*paint-order: stroke/)
    expect(css).toMatch(/\.exp-edge-label\s*{[^}]*stroke: var\(--exp-surface\)/)
    expect(css).toMatch(/\.exp-edge-label\s*{[^}]*stroke-width: 3px/)
  })

  it("dark theme overrides surface tokens under .exp-theme-dark", () => {
    const dark = readFileSync("src/themes/dark.css", "utf8")
    expect(dark).toContain(".exp-theme-dark")
    expect(dark).toContain("--exp-surface")
  })

  it("light theme overrides tokens under .exp-theme-light", () => {
    const light = readFileSync("src/themes/light.css", "utf8")
    expect(light).toContain(".exp-theme-light")
    expect(light).toContain("--exp-accent")
  })
})
