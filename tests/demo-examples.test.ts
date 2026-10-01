import { describe, expect, it } from "vitest"
import { explanationSchema } from "../src/core/schema"
import { documentSchema } from "../src/core/documentSchema"
import { renderExplanation } from "../src/core/render"
import { renderDocument } from "../src/core/renderDocument"
import "../src/core/registerAll"
import { educationIr, dataIr, capabilitiesIr, figuresIr, howToIr, demoDocIr } from "../demo/examples.js"

function collectTypes(ir: { blocks: unknown[] }): Set<string> {
  const types = new Set<string>()
  for (const raw of ir.blocks) {
    const b = raw as { type?: string; blocks?: unknown[] }
    if (typeof b.type !== "string") continue
    if (b.type === "stack" && Array.isArray(b.blocks)) {
      types.add("stack")
      for (const child of b.blocks) {
        const c = child as { type?: string }
        if (typeof c.type === "string") types.add(c.type)
      }
    } else {
      types.add(b.type)
    }
  }
  return types
}

describe("demo examples", () => {
  it("education fixture is schema-valid", () => {
    expect(explanationSchema.safeParse(educationIr).success).toBe(true)
  })

  it("data fixture is schema-valid", () => {
    expect(explanationSchema.safeParse(dataIr).success).toBe(true)
  })

  it("education fixture covers concept, worked-example, derivation, callout, stack, step-list, text", () => {
    const types = collectTypes(educationIr)
    for (const t of ["concept", "worked-example", "derivation", "callout", "stack", "step-list", "text"]) {
      expect(types.has(t)).toBe(true)
    }
  })

  it("data fixture covers data-callout, comparison, cause-effect, timeline, callout", () => {
    const types = collectTypes(dataIr)
    for (const t of ["data-callout", "comparison", "cause-effect", "timeline", "callout"]) {
      expect(types.has(t)).toBe(true)
    }
  })

  it("capabilities fixture intentionally contains an unknown and an invalid block", () => {
    const types = collectTypes(capabilitiesIr)
    expect(types.has("gauge")).toBe(true) // unknown → fallback
    expect(capabilitiesIr.blocks.some(b => (b as { type?: string }).type === "text" && !(b as { body?: string }).body)).toBe(true) // invalid → skipped
  })

  it("figures fixture is schema-valid", () => {
    expect(explanationSchema.safeParse(figuresIr).success).toBe(true)
  })

  it("figures fixture covers diagram, chart, cause-effect, callout", () => {
    const types = collectTypes(figuresIr)
    for (const t of ["diagram", "chart", "figure", "cause-effect", "callout"]) {
      expect(types.has(t)).toBe(true)
    }
  })

  it("figures fixture includes the Fourier epicycles figure with slotted paths", () => {
    const fig = figuresIr.blocks.find(
      b => (b as { type?: string }).type === "figure" && (b as { title?: string }).title === "Fourier epicycles",
    )
    expect(fig).toBeDefined()
    const elements = (fig as { elements: { kind: string; d?: string }[] }).elements
    expect(elements.some(e => e.kind === "group")).toBe(true)
    const wave = elements.find(e => e.kind === "path")
    expect(wave?.d?.split("{{").length).toBe(17) // 16 slots + trailing text
    // The samples must span a full square-wave period (2π): the 5th-harmonic
    // phase retardation in the last slot is 5·δ, so δmax = 30/5 = 6.0 ≈ 2π.
    expect(wave?.d).toContain("sin(a-6)")
    expect(wave?.d).toContain("5*a-30")
  })

  it("how-to fixture is schema-valid", () => {
    expect(explanationSchema.safeParse(howToIr).success).toBe(true)
  })

  it("how-to fixture covers step-list, code, diagram, chart, data-callout, callout", () => {
    const types = collectTypes(howToIr)
    for (const t of ["step-list", "code", "diagram", "chart", "data-callout", "callout"]) {
      expect(types.has(t)).toBe(true)
    }
  })

  it("demo fixtures carry element tips that survive rendering", () => {
    const { html } = renderExplanation(figuresIr)
    expect(html).toContain(`data-tip="Every incident review starts here"`)
    expect(html).toContain(`data-el-id="bar:Wed"`)
    expect(html).toContain(`data-tip="Deploy day — 2× the weekly median"`)
    expect(html).toContain(`data-el-id="pen"`)
    expect(html).toContain(`data-tip="Sum of the three circular motions — traced right as the square wave"`)
  })

  it("interactive demo import map covers every runtime dependency of the react entry", async () => {
    // Regression: the browser demo loads dist/react via an import map, so every
    // bare specifier the bundle externalizes (deps + peers) must be mapped or
    // the module graph fails to resolve and nothing mounts.
    const fs = await import("node:fs/promises")
    const pkg = JSON.parse(await fs.readFile("package.json", "utf8"))
    const runtime = { ...pkg.dependencies, ...pkg.peerDependencies }
    const html = await fs.readFile("demo/interactive.html", "utf8")
    for (const name of Object.keys(runtime)) {
      expect(html).toContain(`"${name}":`)
    }
    expect(html).toContain(`"react/jsx-runtime":`)
    expect(html).toContain(`"react-dom/client":`)
  })
})

describe("demoDocIr (document fixture)", () => {
  it("parses against documentSchema", () => {
    expect(documentSchema.safeParse(demoDocIr).success).toBe(true)
  })

  it("renders a page with a TOC and all five sections", () => {
    const { html } = renderDocument(demoDocIr, { theme: "none" })
    expect((html.match(/class="exp-doc-section"/g) ?? []).length).toBe(5)
    expect(html).toContain("exp-doc-toc")
    expect(html).toContain(`href="#sec-fig-epicycles"`)
    // The interactive epicycles figure composes into a section unchanged.
    expect(html).toContain(`data-el-id="pen"`)
  })
})
