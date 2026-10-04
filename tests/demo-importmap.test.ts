import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Every demo page loads the library as a bare specifier through an importmap,
 * so a page whose map is missing one of the library's runtime dependencies
 * fails at module-resolution time and renders NOTHING -- while still returning
 * 200 with a plausible-looking shell.
 *
 * That is not hypothetical: the 2026-10-03 math cycle added `temml` as a
 * dependency, and /editorial and /compile kept their old importmaps. Both went
 * blank and both still answered 200, so every route check in the repo's history
 * passed. /interactive was updated and kept working, which is why the bug
 * survived a full cycle unnoticed.
 *
 * This reads the real runtime dependency list rather than hardcoding it, so the
 * next dependency added cannot silently break a page again.
 */
const DEMO_DIR = join(process.cwd(), "demo")

/** Bare specifiers the built bundle can reach. Keep in sync with
 *  package.json `dependencies` — which is what this test actually reads. */
function runtimeDependencies(): string[] {
  const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"))
  return Object.keys(pkg.dependencies ?? {}).sort()
}

function importmapOf(html: string): Record<string, string> | null {
  const match = html.match(/<script type="importmap">([\s\S]*?)<\/script>/)
  if (!match) return null
  try {
    return JSON.parse(match[1]).imports ?? null
  } catch {
    return null
  }
}

describe("demo importmaps cover every runtime dependency", () => {
  const deps = runtimeDependencies()

  it("finds the dependency list (guards against a bad path silently passing)", () => {
    expect(deps.length).toBeGreaterThan(0)
    expect(deps).toContain("temml")
  })

  const pages = readdirSync(DEMO_DIR).filter(f => f.endsWith(".html"))

  it("finds demo pages to check", () => {
    expect(pages.length).toBeGreaterThan(0)
  })

  for (const page of pages) {
    it(`${page} maps every runtime dependency`, () => {
      const html = readFileSync(join(DEMO_DIR, page), "utf8")
      const map = importmapOf(html)
      // A page with no importmap loads no bare specifiers, so it needs none.
      if (!map) return
      const missing = deps.filter(d => !(d in map))
      expect(
        missing,
        `${page} is missing importmap entries for ${missing.join(", ")}. ` +
          `The page will fail to resolve them at runtime and render nothing, ` +
          `while still returning HTTP 200.`,
      ).toEqual([])
    })
  }

  it("every dependency is mapped by at least one page that uses it", () => {
    // Catches the inverse error: a dep nobody maps, which is the same blank
    // page by a different route.
    const allMapped = new Set<string>()
    for (const page of pages) {
      const map = importmapOf(readFileSync(join(DEMO_DIR, page), "utf8"))
      if (map) for (const k of Object.keys(map)) allMapped.add(k)
    }
    // react is served from /react/index.js on some pages and esm.sh on others.
    expect(deps.every(d => allMapped.has(d))).toBe(true)
  })
})