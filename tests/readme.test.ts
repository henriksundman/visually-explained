import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { registry } from "../src/core/registry"
import "../src/core/registerAll"

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8")
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

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

/** Compile-event kinds, read from the two type declarations that define them.
 *  They are types, so they erase at runtime — there is nothing to import. */
function eventKinds(): string[] {
  const client = read("src/compiler/client.ts")
  const stream = read("src/compiler/stream.ts")
  const sources = [
    client.slice(client.indexOf("export interface CompileEvent {"), client.indexOf("\n}", client.indexOf("export interface CompileEvent {"))),
    stream.slice(stream.indexOf("export type StreamCompileEvent ="), stream.indexOf("\n\n", stream.indexOf("export type StreamCompileEvent ="))),
  ]
  const kinds = new Set<string>()
  for (const src of sources) {
    for (const m of src.matchAll(/"([a-z][a-z-]*)"/g)) kinds.add(m[1])
  }
  return [...kinds]
}

/** The markdown table starting at `marker`: consecutive lines beginning "|". */
function tableRows(marker: string): string[] {
  const at = readme.indexOf(marker)
  expect(at, `README has no "${marker}" table`).toBeGreaterThan(-1)
  const rows: string[] = []
  for (const line of readme.slice(at).split("\n")) {
    if (!line.startsWith("|")) break
    rows.push(line)
  }
  return rows
}

/** Data rows only — everything after the header separator, so the header cell
 *  ("| `kind` |") is never mistaken for a value. */
function tableDataRows(marker: string): string[] {
  const rows = tableRows(marker)
  const separator = rows.findIndex((r) => /^\|\s*-+/.test(r))
  expect(separator, `README table at "${marker}" has no header separator`).toBeGreaterThan(-1)
  return rows.slice(separator + 1)
}

describe("README compile events", () => {
  it("documents exactly the event kinds the compiler declares", () => {
    // Set equality, not containment: a README row for a kind that no longer
    // exists is drift too. CompileEvent carries an index signature, so a new
    // kind type-checks without ever being added to the union — which is
    // precisely the case this catches.
    const rows = tableDataRows("| `kind` | Payload |")
    expect(rows.length, "README event table has no data rows").toBeGreaterThan(0)
    const documented = rows
      .map((r) => r.match(/^\|\s*`([a-z][a-z-]*)`/)?.[1])
      .filter((k): k is string => Boolean(k))
      .sort()
    // Sorted arrays, not Sets: vitest collapses Sets in the diff
    // ("Set{ 'a', …(6) }"), which hides which kind actually differs.
    expect(documented).toEqual(eventKinds().sort())
  })
})

describe("README development commands", () => {
  it("documents only npm scripts that exist", () => {
    const at = readme.indexOf("Development:")
    expect(at, "README has no 'Development:' section").toBeGreaterThan(-1)
    const named = [...readme.slice(at).matchAll(/`npm (?:run )?([a-z][a-z-]*)`/g)].map((m) => m[1])
    expect(named.length, "no npm commands found under 'Development:'").toBeGreaterThan(0)
    for (const script of named) {
      expect(
        pkg.scripts,
        `README documents \`npm ${script}\` but package.json defines no such script`,
      ).toHaveProperty(script)
    }
  })
})
