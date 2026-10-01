# Sources Block Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `sources` block type — a numbered, anchorable reference list (`items: [{ id, title, url?, detail? }]`) — registered, styled, documented, and end-to-end testable with the inline citation anchors shipped last cycle.

**Architecture:** Schema entry in the discriminated union (JSON-schema exports propagate automatically via `z.toJSONSchema`), one new primitive importing the shared `safeHref` gate (now exported from `inline.ts`), `BLOCK_TYPE_DOCS` entry (flows into all prompt contracts automatically), theme CSS in `tokens.css`, README count bump. All-or-nothing item salvage by design; leniency lives in the URL gate and optional fields.

**Tech Stack:** TypeScript, zod, vitest, zero-dep demo server.

**Spec:** `docs/superpowers/specs/2026-10-01-sources-block-design.md`

**Branch:** `feature/sources-block` (already created from `main` @ `7273717`). Commit the plan file itself as the first commit.

## Global Constraints

- **No new deps; no compiler changes this cycle.**
- **Anchor contract:** item `li` id is `source-<id>` — citations target `[x](#source-<id>)`. The `source-` prefix namespaces against section anchors.
- **Shared gate:** URLs render as links only when `safeHref` (exported from `src/core/inline.ts`) passes them; gated-out URLs degrade the *link*, never the item.
- **All-or-nothing item salvage:** an invalid item fails the block schema wholesale — no per-item drop. Leniency: URL gate + optional fields only.
- **Caps:** item `id` ≤64, `title` ≤200, `url` ≤500, `detail` ≤400; 1–24 items; block `title` ≤200 optional.
- **Text surfaces:** block/item titles and details pass through `renderInline`; ids/urls escape via `escapeHtml` (attribute-safe).
- **Existing suite green unchanged** throughout (block-count text assertions in README are the only doc-number changes).
- **TDD:** behavior tasks RED before GREEN; contract locks labeled as such.
- **Test-count ledger:** 320 base → Task 1 +6 (326) → Task 2 +2 (328) → Task 3 +3 (331).
- **Commits:** one per task, conventional style, `🤖 Generated with Codebuff` footer. No pushing.

---

### Task 1: Schema, gate export, primitive, registration

**Files:**
- Modify: `src/core/schema.ts` (add `sourcesBlockSchema` + union entry + type export)
- Modify: `src/core/inline.ts` (export `safeHref`)
- Create: `src/primitives/sources.ts`
- Modify: `src/core/registerAll.ts` (one import line)
- Test: `tests/sources.test.ts` (new)

**Interfaces:**
- Consumes: `registerPrimitive`/`RenderContext` from `../core/registry`; `escapeHtml`, `renderInline` from `../core/inline`; `safeHref` (after this task's export).
- Produces: `sourcesBlockSchema`, `type SourcesBlock` (exported from package root via `schema.ts`); registered primitive `"sources"`. Task 2 consumes the registered type + emitted classes; Task 3 consumes everything.

- [ ] **Step 1: Commit the plan file**

```bash
git add docs/superpowers/plans/2026-10-01-sources-block.md
git commit -m "$(cat <<'EOF'
Add implementation plan for the sources block

🤖 Generated with Codebuff
Co-Authored-By: Codebuff <noreply@codebuff.com>
EOF
)"
```

- [ ] **Step 2: Write the failing tests**

Create `tests/sources.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { renderExplanation } from "../src/core/render"
import { sourcesBlockSchema } from "../src/core/schema"
import "../src/core/registerAll"

const sourcesBlock = {
  type: "sources" as const,
  id: "src",
  title: "References",
  items: [
    { id: "s1", title: "The main paper", url: "https://example.com/paper", detail: "Where the **counting** argument comes from." },
    { id: "s2", title: "Private notes" },
    { id: "s3", title: "Bad link attempt", url: "javascript:alert(1)" },
  ],
}

describe("sources schema", () => {
  it("accepts a valid block and rejects out-of-bounds shapes", () => {
    expect(sourcesBlockSchema.safeParse(sourcesBlock).success).toBe(true)
    expect(sourcesBlockSchema.safeParse({ ...sourcesBlock, items: [] }).success).toBe(false)
    expect(
      sourcesBlockSchema.safeParse({
        ...sourcesBlock,
        items: Array.from({ length: 25 }, (_, i) => ({ id: `x${i}`, title: "t" })),
      }).success,
    ).toBe(false)
    expect(sourcesBlockSchema.safeParse({ ...sourcesBlock, items: [{ id: "", title: "t" }] }).success).toBe(false)
  })
})

describe("sources render", () => {
  it("renders the list with anchors, links, and details", () => {
    const { html, warnings } = renderExplanation({ version: 1, blocks: [sourcesBlock] })
    expect(html).toContain(`<div class="exp-block exp-sources">`)
    expect(html).toContain(`<p class="exp-sources-title">References</p>`)
    expect(html).toContain(`id="source-s1"`)
    expect(html).toContain(`<a class="exp-source-link" href="https://example.com/paper">The main paper</a>`)
    expect(html).toContain(`<strong>counting</strong>`) // detail passes through renderInline
    expect(html).toContain(`id="source-s2"`)
    expect(warnings).toEqual([])
  })

  it("renders url-less titles as plain text and degrades gated URLs", () => {
    const { html } = renderExplanation({ version: 1, blocks: [sourcesBlock] })
    // s2 has no url: title is text, not a link to itself.
    expect(html).not.toContain(`href="#source-s2"`)
    expect(html).toContain(`>Private notes</li>`)
    // s3's javascript: URL fails the gate: item survives, link does not.
    expect(html).toContain(`id="source-s3"`)
    expect(html).not.toContain(`href="javascript:`)
    expect(html).toContain(`>Bad link attempt</li>`)
  })

  it("escapes ids, titles, and details", () => {
    const { html } = renderExplanation({
      version: 1,
      blocks: [
        {
          type: "sources",
          id: "s",
          items: [{ id: `x&quot;y`, title: `<script>alert(1)</script>`, detail: `a & b` }],
        },
      ],
    })
    expect(html).toContain(`id="source-x&quot;y"`)
    expect(html).not.toContain("<script>")
    expect(html).toContain("&lt;script&gt;")
    expect(html).toContain("a &amp; b")
  })
})
```

- [ ] **Step 3: Run to verify RED**

Run: `npx vitest run tests/sources.test.ts`
Expected: FAIL — `Cannot find module '../src/core/schema'` export missing / block renders as fallback (`exp-fallback`), so schema + render tests fail.

- [ ] **Step 4: Add the schema**

In `src/core/schema.ts`, before `blockUnionSchema` (after `stackBlockSchema`), add:

```ts
export const sourcesBlockSchema = z.object({
  id: idSchema,
  type: z.literal("sources"),
  title: z.string().min(1).max(200).optional(),
  items: z
    .array(
      z.object({
        id: z.string().min(1).max(64),
        title: z.string().min(1).max(200),
        url: z.string().min(1).max(500).optional(),
        detail: z.string().min(1).max(400).optional(),
      }),
    )
    .min(1)
    .max(24),
})
export type SourcesBlock = z.infer<typeof sourcesBlockSchema>
```

and add `sourcesBlockSchema,` to the `blockUnionSchema` list (after
`figureBlockSchema`).

- [ ] **Step 5: Export `safeHref` from `src/core/inline.ts`**

Replace `function safeHref(href: string): string | null {` with:

```ts
/** Shared href gate (link-inline spec §4): normalize control chars + spaces,
 *  then allowlist https/http/mailto/#anchor. Second consumer: the sources
 *  primitive (two link emitters, one policy). */
export function safeHref(href: string): string | null {
```

- [ ] **Step 6: Create `src/primitives/sources.ts`**

```ts
import { registerPrimitive, type RenderContext } from "../core/registry"
import { sourcesBlockSchema, type SourcesBlock } from "../core/schema"
import { escapeHtml, renderInline, safeHref } from "../core/inline"

export function renderSources(block: SourcesBlock, ctx: RenderContext): string {
  const items = block.items
    .map(it => {
      const href = it.url !== undefined ? safeHref(it.url) : null
      const title = href
        ? `<a class="exp-source-link" href="${escapeHtml(href)}">${renderInline(it.title)}</a>`
        : renderInline(it.title)
      const detail = it.detail ? `<p class="exp-source-detail">${renderInline(it.detail)}</p>` : ""
      return `<li id="source-${escapeHtml(it.id)}" class="exp-source">${title}${detail}</li>`
    })
    .join("")
  const heading = block.title ? `<p class="exp-sources-title">${renderInline(block.title)}</p>` : ""
  return `<div class="exp-block exp-sources">${heading}<ol class="exp-sources-list">${items}</ol></div>`
}

registerPrimitive("sources", { schema: sourcesBlockSchema, render: renderSources })
```

- [ ] **Step 7: Register in `src/core/registerAll.ts`**

Add after the figure import (last line):

```ts
import "../primitives/sources"
```

- [ ] **Step 8: Run to verify GREEN**

Run: `npx vitest run tests/sources.test.ts`
Expected: PASS — 3/3.

- [ ] **Step 9: Full suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit && echo OK`
Expected: 326/326 tests, tsc clean. (`tests/llm.test.ts`'s "mentions every registered block type" assertions now include `sources` automatically — the JSON schema is derived from the union via `z.toJSONSchema`, so they pass without edits.)

- [ ] **Step 10: Commit**

```bash
git add src/core/schema.ts src/core/inline.ts src/primitives/sources.ts src/core/registerAll.ts tests/sources.test.ts
git commit -m "$(cat <<'EOF'
feat(sources): anchorable reference list block with shared href gate

🤖 Generated with Codebuff
Co-Authored-By: Codebuff <noreply@codebuff.com>
EOF
)"
```

---

### Task 2: BLOCK_TYPE_DOCS, theme CSS, README count

**Files:**
- Modify: `src/core/blockTypes.ts` (one entry)
- Modify: `src/themes/tokens.css` (append ~40 lines)
- Modify: `README.md` (block list + count)
- Test: `tests/sources.test.ts` (append 2 assertions)

**Interfaces:**
- Consumes: registered `sources` primitive (Task 1). Produces: model-facing contract text + styling; no code signatures change.

- [ ] **Step 1: Write the failing tests**

Append inside `describe("sources render")` in `tests/sources.test.ts` (before its closing `})`):

```ts
  it("is taught in the block-type contract", () => {
    expect(BLOCK_TYPE_DOCS).toContain("sources:")
    expect(BLOCK_TYPE_DOCS).toContain("source-<id>")
  })
```

and add to the file's imports:

```ts
import { BLOCK_TYPE_DOCS } from "../src/core/blockTypes"
```

(Spec §7's prompt-snapshot assertion — `sectionSystemPrompt()` carries the
sources entry — is already pinned by the existing
"system prompt shares the block-type text verbatim" test in
tests/compiler-prompts.test.ts, which asserts BLOCK_TYPE_DOCS verbatim.
No new assertion needed; adding one would duplicate it.)

- [ ] **Step 2: Run to verify RED**

Run: `npx vitest run tests/sources.test.ts`
Expected: FAIL — 1 failure (the new contract test; BLOCK_TYPE_DOCS lacks `sources:`).

- [ ] **Step 3: Add the BLOCK_TYPE_DOCS entry**

In `src/core/blockTypes.ts`, insert after the `figure:` line (before `stack:`):

```ts
- sources: { title?, items: [{ id, title, url?, detail? }] } — a numbered reference list; each item anchors as source-<id> for inline citations ([label](#source-<id>) in body text, or [label](url) when the source has one). List the sources that ground the explanation; keep ids short and stable.
```

- [ ] **Step 4: Theme CSS**

In `src/themes/tokens.css`:

(a) In the "Container hooks" list, add `.exp-sources` after `.exp-chart`:

```css
.exp-chart,
.exp-sources {
  min-width: 0;
}
```

(b) Append at the end of the file:

```css
/* Sources block: numbered, anchorable reference list (grounded authoring). */
.exp-sources-title {
  margin: 0 0 var(--exp-gap);
  font-weight: 650;
}

.exp-sources-list {
  margin: 0;
  padding-left: 20px;
}

.exp-source {
  padding: 6px 0;
}

.exp-source + .exp-source {
  border-top: 1px solid var(--exp-border);
}

.exp-source-link {
  color: var(--exp-accent);
  text-decoration: none;
}

.exp-source-link:hover {
  text-decoration: underline;
}

.exp-source-detail {
  margin: 2px 0 0;
  font-size: 0.9em;
  color: var(--exp-text-muted);
}
```

Note: `.exp-sources-list` deliberately does NOT join the `list-style: none`
group — numbering is the `<ol>`'s job (spec §4). `light.css`/`dark.css` need
**no changes** (all colors ride existing tokens).

- [ ] **Step 5: README**

(a) In the block list (line ~92), change:

```markdown
- **Pedagogy:** `concept`, `worked-example`, `derivation`, `comparison`,
  `cause-effect`, `callout`, `data-callout`
```

to:

```markdown
- **Pedagogy:** `concept`, `worked-example`, `derivation`, `comparison`,
  `cause-effect`, `callout`, `data-callout`, `sources`
```

(b) Change `15 primitives; each block is` to `16 primitives; each block is`.

- [ ] **Step 6: Run to verify GREEN + full suite**

Run: `npx vitest run tests/sources.test.ts && npx vitest run && npx tsc --noEmit && echo OK`
Expected: 328/328 tests, tsc clean.

- [ ] **Step 7: Commit**

```bash
git add src/core/blockTypes.ts src/themes/tokens.css README.md tests/sources.test.ts
git commit -m "$(cat <<'EOF'
feat(sources): block-type contract, theme styling, README

🤖 Generated with Codebuff
Co-Authored-By: Codebuff <noreply@codebuff.com>
EOF
)"
```

---

### Task 3: End-to-end citation test, demo fixture, ROADMAP, verification

**Files:**
- Test: `tests/sources.test.ts` (append end-to-end describe)
- Modify: `demo/examples.js` (sources block + citation in the data fixture)
- Modify: `docs/ROADMAP.md` (Shipped bullet + backlog wording)
- Modify: `.superpowers/sdd/progress.md` (git-ignored ledger — no commit)

**Interfaces:**
- Consumes: shipped Tasks 1–2. Produces: docs/demo only.

- [ ] **Step 1: Write the end-to-end citation test**

Append at the end of `tests/sources.test.ts`:

```ts
describe("inline citation end-to-end", () => {
  it("cites a source item from body text", () => {
    const { html } = renderExplanation({
      version: 1,
      blocks: [
        { type: "text", body: "The counting argument is standard [S1](#source-s1)." },
        {
          type: "sources",
          id: "refs",
          items: [{ id: "s1", title: "The main paper", url: "https://example.com/paper" }],
        },
      ],
    })
    expect(html).toContain(`href="#source-s1"`) // the citation anchor
    expect(html).toContain(`id="source-s1"`) // the target
    expect(html.indexOf(`href="#source-s1"`)).toBeLessThan(html.indexOf(`id="source-s1"`))
  })

  it("arrives through renderDocument sections too", () => {
    const { html } = renderDocument({
      version: 1,
      title: "Doc",
      sections: [
        {
          title: "S",
          blocks: [
            { type: "text", body: "Grounded claim [S1](#source-s1)." },
            { type: "sources", id: "refs", items: [{ id: "s1", title: "Paper" }] },
          ],
        },
      ],
    })
    expect(html).toContain(`href="#source-s1"`)
    expect(html).toContain(`id="source-s1"`)
  })
})
```

and add `renderDocument` to the existing `../src/core/renderDocument` import
(add the import line if absent):

```ts
import { renderDocument } from "../src/core/renderDocument"
```

- [ ] **Step 2: Run (contract locks — expect PASS immediately)**

Run: `npx vitest run tests/sources.test.ts`
Expected: PASS — 6/6 file tests. (These lock the citation contract end-to-end; they are not expected to fail.)

- [ ] **Step 3: Demo fixture**

In `demo/examples.js`, `dataIr` — append a sources block as the LAST block of `dataIr.blocks` (find the closing `]` of the blocks array) and add one citation to the first text block of `dataIr` (the one beginning "Three signals tell you..."):

(a) Append to `dataIr.blocks`:

```js
    {
      type: "sources",
      id: "refs",
      title: "Sources",
      items: [
        { id: "latency-numbers", title: "Frontend latency study", url: "https://web.dev/articles/vitals", detail: "Where the p95 thresholds come from." },
        { id: "deploy-log", title: "Deploy log, week 38", detail: "Internal — the deploy-day spike is visible in the raw log." },
      ],
    },
```

(b) Append to that first text block's body: ` Grounded in [the latency study](#source-latency-numbers).`

- [ ] **Step 4: ROADMAP**

In `docs/ROADMAP.md`, append to **Shipped** (after the Link inline element bullet):

```markdown
- **Sources block** (2026-10-01) — grounded authoring part 1: a `sources`
  block (numbered, anchorable reference list, `items: [{ id, title, url?,
  detail? }]`) with `source-<id>` anchors matching inline citations
  (`[label](#source-<id>)`); shared `safeHref` gate; `BLOCK_TYPE_DOCS`
  contract + theme styling. Part 2 (compiler grounding) specs next. Spec:
  `docs/superpowers/specs/2026-10-01-sources-block-design.md`.
```

and in the backlog's Grounded authoring bullet, replace:

```markdown
- **Grounded authoring** — hosts supply source material (documents, notes)
  that constrains outline/section prompts; output carries provenance:
  citation blocks or inline references (the link inline element shipped
  2026-10-01 unblocks this). The gap between a demo and real content.
```

with:

```markdown
- **Grounded authoring** — hosts supply source material (documents, notes)
  that constrains outline/section prompts; output carries provenance via
  inline citations and the sources block (shipped 2026-10-01). Part 2:
  compiler wiring — SourceExcerpt prompts, citation teaching, audit
  warnings. The gap between a demo and real content.
```

- [ ] **Step 5: Full verification**

```bash
npx tsc --noEmit && npx vitest run 2>&1 | grep -E "Test Files|Tests "
npm run build
launchctl remove explanations-demo 2>/dev/null; true
launchctl submit -l explanations-demo -- "$(command -v node)" "$PWD/demo/server.mjs"
sleep 1
curl -s -o /dev/null -w "root:%{http_code} doc:" http://localhost:4173/
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4173/document
curl -s http://localhost:4173/ | grep -c 'id="source-latency-numbers"'
curl -s http://localhost:4173/document | grep -c 'href="#source-latency-numbers"'
./scripts/vexp verify
```

Expected: tsc clean; 331/331; build ok; both routes 200; the served `/` page contains the anchor target `source-latency-numbers` (≥1); the served `/document` page contains the citation anchor (≥1); `vexp verify` clean (run any tests it flags).

- [ ] **Step 6: Commit**

```bash
git add tests/sources.test.ts demo/examples.js docs/ROADMAP.md
git commit -m "$(cat <<'EOF'
docs+demo: sources block end-to-end citation demo, roadmap updated

🤖 Generated with Codebuff
Co-Authored-By: Codebuff <noreply@codebuff.com>
EOF
)"
```

- [ ] **Step 7: Update the progress ledger** (git-ignored — no commit)

Append to `.superpowers/sdd/progress.md`:

```text
Sources Task 1: complete (schema + union + safeHref export + primitive + registerAll; 3 tests)
Sources Task 2: complete (BLOCK_TYPE_DOCS entry + theme CSS + README 16 primitives; 1 test)
Sources Task 3: complete (end-to-end citation + renderDocument tests; demo sources block in dataIr; ROADMAP; verification green)
Branch finished: main fast-forwarded to <sha> (<N> commits, <T>/<T> tests + tsc on merged result), <push state>, feature/sources-block deleted.
```

- [ ] **Step 8: Fresh-eyes review pass against the spec**

Re-read `docs/superpowers/specs/2026-10-01-sources-block-design.md` §3–§8 and check each requirement against the shipped code: schema caps, anchor contract, gate reuse, no per-item salvage, BLOCK_TYPE_DOCS wording, theme hooks, README count, out-of-scope untouched. Fix discrepancies in a follow-up commit before finishing the branch.
