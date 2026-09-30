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

  it("styles the TOC's active (aria-current) link for scroll-spy hosts", () => {
    const css = readFileSync("src/themes/tokens.css", "utf8")
    expect(css).toMatch(/\.exp-doc-toc-list a\[aria-current="true"\]\s*{[^}]*font-weight/)
    expect(css).toMatch(/\.exp-doc-toc-list a\[aria-current="true"\]\s*{[^}]*text-decoration: underline/)
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
