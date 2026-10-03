import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { registry } from "../src/core/registry"
import "../src/core/registerAll"

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8")

/** The "## Block types" section. Ends at the next level-2 heading, so the
 *  "### Images" subsection stays inside. */
function blockTypesSection(): string {
  const start = readme.indexOf("## Block types")
  expect(start, "README has no '## Block types' section").toBeGreaterThan(-1)
  const rest = readme.slice(start + 1)
  const end = rest.search(/\n## /)
  return end === -1 ? rest : rest.slice(0, end)
}

/** Just the bullet list inside that section. Scoping matters: the "### Images"
 *  prose also contains `image`, so a section-wide check would pass even with the
 *  block type deleted from the list — the drift this test exists to catch. */
function documentedList(): string {
  const lines = blockTypesSection().split("\n")
  const start = lines.findIndex((l) => l.startsWith("- "))
  expect(start, "README's '## Block types' section has no bullet list").toBeGreaterThan(-1)
  const list: string[] = []
  for (const line of lines.slice(start)) {
    if (line.trim() === "") continue
    if (line.startsWith("- ") || /^\s/.test(line)) {
      list.push(line)
      continue
    }
    break // prose resumes: the list has ended
  }
  return list.join("\n")
}

describe("README block types", () => {
  it("documents every registered block type", () => {
    const list = documentedList()
    for (const type of Object.keys(registry)) {
      expect(
        list,
        `block type \`${type}\` is registered but not listed in README's "Block types" list`,
      ).toContain(`\`${type}\``)
    }
  })

  it("states a primitive count that matches the registry", () => {
    const section = blockTypesSection()
    const stated = [...section.matchAll(/(\d+)\s+primitives/g)].map((m) => Number(m[1]))
    expect(stated, "README's '## Block types' section states no 'N primitives' count").toHaveLength(1)
    expect(stated[0], "README primitive count is stale — bump it to match registerAll.ts").toBe(
      Object.keys(registry).length,
    )
  })
})
