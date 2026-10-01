# Link Inline Element Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `[label](href)` links inside `renderInline` — scheme-gated (http/https/mailto/#anchor), escaped, lenient — plus the model-surface updates that let the LLM emit them.

**Architecture:** All parsing stays in `src/core/inline.ts` inside the existing code-span-first split. Per segment: escapeHtml → emphasis (unchanged) → link pass (regex match → normalize href (strip control chars+spaces) → scheme gate → `<a>` or literal fallback). React inherits everything via the shared parser. The prompt rule text updates in all three shipped locations.

**Tech Stack:** TypeScript, vanilla regex (character-class only, linear), vitest, zero-dep demo server.

**Spec:** `docs/superpowers/specs/2026-10-01-link-inline-element-design.md`

**Branch:** `feature/link-inline` (already created from `main` @ `b64e16c`). Commit the plan file itself as the first commit.

## Global Constraints

- **No new deps.** No `target`/`rel` attributes emitted.
- **Scheme allowlist, case-insensitive, after normalization:** `https:`, `http:`, `mailto:`, or href starting `#`. Everything else → the whole `[label](href)` source renders literally, escaped, **no warning**.
- **Normalization before the gate:** strip all ASCII control characters and spaces (`/\u0000-\u0020/g`) from the href; the normalized form is what is emitted (kills `jav\tascript:`).
- **Link-free strings render byte-identical to today** — the link pass only rewrites strings containing a well-formed `[..](..)` pair (determinism lock; existing inline tests must pass unchanged).
- **Escape-first:** the link pass operates on the already-escaped segment; `escapeHtml`'s quote-escaping makes attribute breakout structurally impossible.
- **Leniency:** malformed pairs render literally; inline rendering never warns and never throws.
- **Prompt rule text** (all three locations) becomes exactly: `Put no HTML in any field. Inline emphasis only: **bold**, *italic*, \\\`code\\\`, [text](url).`
- **TDD:** behavior tasks RED before GREEN. Commits: one per task, conventional style, `🤖 Generated with Codebuff` footer. No pushing.
- **Test-count ledger:** 311 base → Task 1 +8 (319) → Task 2 +1 (320) → Task 3 +0 (320).

---

### Task 1: Link parsing + href gate in `renderInline`

**Files:**
- Modify: `src/core/inline.ts`
- Test: `tests/inline.test.ts` (append inside the existing `describe("renderInline")`)

**Interfaces:**
- Consumes: existing `escapeHtml` (same file).
- Produces: `renderInline(text: string): string` — same signature; output may now contain `<a href="…">…</a>`. Tasks 2–3 consume nothing new; React inherits via this shared function.

- [ ] **Step 1: Commit the plan file**

```bash
git add docs/superpowers/plans/2026-10-01-link-inline.md
git commit -m "$(cat <<'EOF'
Add implementation plan for the link inline element

🤖 Generated with Codebuff
Co-Authored-By: Codebuff <noreply@codebuff.com>
EOF
)"
```

- [ ] **Step 2: Write the failing tests**

Append inside `describe("renderInline")` in `tests/inline.test.ts` (after the "leaves unmatched markers literal" test, before the closing `})`):

```ts
  it("renders safe links", () => {
    expect(renderInline("[docs](https://example.com/a)")).toBe(
      `<a href="https://example.com/a">docs</a>`,
    )
    expect(renderInline("[mail](mailto:a@b.co)")).toBe(`<a href="mailto:a@b.co">mail</a>`)
    expect(renderInline("[jump](#sec-1)")).toBe(`<a href="#sec-1">jump</a>`)
    expect(renderInline("[old](http://example.com)")).toBe(`<a href="http://example.com">old</a>`)
  })

  it("escapes labels and hrefs", () => {
    expect(renderInline(`["x"](https://e.com/?a=1&b=2)`)).toBe(
      `<a href="https://e.com/?a=1&amp;b=2">&quot;x&quot;</a>`,
    )
  })

  it("degrades unsafe schemes and relatives to literal text", () => {
    for (const bad of [
      "[x](javascript:alert(1))",
      "[x](JAvaScript:alert(1))",
      "[x](java\tscript:alert(1))", // \s in the href class stops the pair forming; tab stays literal
      "[x](java\u0000script:alert(1))", // non-whitespace control forms a candidate; the gate strips + rejects it
      "[x](data:text/html;base64,PHNjcmlwdD4=)",
      "[x](vbscript:x)",
      "[x](//host/path)",
      "[x](relative/path)",
    ]) {
      expect(renderInline(bad)).toBe(bad)
    }
  })

  it("renders malformed pairs literally", () => {
    expect(renderInline("[x](y z)")).toBe("[x](y z)")
    expect(renderInline("[x] alone stays")).toBe("[x] alone stays")
    expect(renderInline("[x](unclosed")).toBe("[x](unclosed")
  })

  it("nests emphasis inside labels and leaves starred hrefs intact", () => {
    expect(renderInline("[**bold label**](https://e.com)")).toBe(
      `<a href="https://e.com"><strong>bold label</strong></a>`,
    )
    expect(renderInline("[x](https://e.com/a*b*c)")).toBe(`<a href="https://e.com/a*b*c">x</a>`)
  })

  it("code spans beat link syntax", () => {
    expect(renderInline("`[x](https://e.com)`")).toBe("<code>[x](https://e.com)</code>")
  })

  it("leaves link-free strings byte-identical", () => {
    expect(renderInline("plain **b** *i* `c` [ not a link (x)")).toBe(
      "plain <strong>b</strong> <em>i</em> <code>c</code> [ not a link (x)",
    )
  })
```

- [ ] **Step 3: Run to verify RED**

Run: `npx vitest run tests/inline.test.ts`
Expected: FAIL — 7 new tests fail (links render literally today); the 5 existing renderInline tests + escapeHtml stay green.

- [ ] **Step 4: Implement in `src/core/inline.ts`**

Replace the entire `renderInline` function (and its doc comment) with:

```ts
/** Renders the v1 inline subset: **bold**, *italic*, `code`, [label](href).
 * Code spans are split out first so their content is never further processed;
 * everything is HTML-escaped, so no raw HTML can pass through and attribute
 * breakout is structurally impossible. Link hrefs are scheme-gated (https,
 * http, mailto, #anchor — after stripping control chars and spaces, the same
 * normalization browsers apply, which kills `jav\tascript:`); anything else
 * degrades to literal text. Nesting is not supported beyond emphasis inside
 * labels; markers render literally when unmatched. */
const LINK_RE = /\[([^\]]+)\]\(([^)\s]+)\)/g

function safeHref(href: string): string | null {
  const normalized = href.replace(/[\u0000-\u0020]/g, "")
  if (/^https:/i.test(normalized)) return normalized
  if (/^http:/i.test(normalized)) return normalized
  if (/^mailto:/i.test(normalized)) return normalized
  if (normalized.startsWith("#")) return normalized
  return null
}

export function renderInline(text: string): string {
  const parts = text.split(/(`[^`]+`)/g)
  return parts
    .map(part => {
      if (part.length >= 2 && part.startsWith("`") && part.endsWith("`")) {
        return `<code>${escapeHtml(part.slice(1, -1))}</code>`
      }
      let out = escapeHtml(part)
      out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      out = out.replace(/\*([^*]+)\*/g, "<em>$1</em>")
      out = out.replace(LINK_RE, (src: string, label: string, href: string): string => {
        const target = safeHref(href)
        if (target === null) return src
        return `<a href="${target}">${label}</a>`
      })
      return out
    })
    .join("")
}
```

Notes for the implementer:
- The link pass runs on the **escaped** segment (spec §4): labels/hrefs are already entity-safe, so no further escaping inside the replacer — `escapeHtml` here would double-escape `&amp;`.
- Order is escape → emphasis → links (spec §3): emphasis keeps link-free strings untouched, and a stray `*` can never pair *into* an emitted href.
- `LINK_RE` is module-level with `/g` — `replace` resets `lastIndex` per call, so reuse is safe; do not use it with `.exec`/`.test` loops.
- Division of labor (verified during plan review): the href class `[^)\s]+` already refuses **whitespace** inside hrefs, so `jav\tascript:` never forms a candidate link at all — it renders literally with the tab intact. **Normalization exists for the non-whitespace control characters** (e.g. `\u0000`), which do form candidates; the gate strips them and rejects. Both layers tested.
- The gate tests `http:`/`https:`/`mailto:` prefixes on the **normalized** href; `#` is checked on the normalized string too.
- React smoke (spec §7): append at the end of `tests/react.test.tsx` (top-level describe — the file already imports `renderToStaticMarkup` and `Explanation`):

```tsx
describe("link smoke (react)", () => {
  it("renders links through the shared inline parser", () => {
    const html = renderToStaticMarkup(
      <Explanation ir={{ version: 1, blocks: [{ type: "text", body: "[x](https://e.com)" }] }} />,
    )
    expect(html).toContain(`<a href="https://e.com">x</a>`)
  })
})
```

Include this file in the Task 1 commit.

- [ ] **Step 5: Run to verify GREEN**

Run: `npx vitest run tests/inline.test.ts tests/react.test.tsx`
Expected: PASS — inline 13/13 (6 existing + 7 new), react file green including the new smoke test.

- [ ] **Step 6: Full suite + typecheck**

Run: `npx vitest run && npx tsc --noEmit && echo OK`
Expected: 319/319 tests, tsc clean (existing render/React/diagram tests unchanged — link-free output is byte-identical).

- [ ] **Step 7: Commit**

```bash
git add src/core/inline.ts tests/inline.test.ts tests/react.test.tsx
git commit -m "$(cat <<'EOF'
feat(inline): scheme-gated [label](href) links in renderInline

🤖 Generated with Codebuff
Co-Authored-By: Codebuff <noreply@codebuff.com>
EOF
)"
```

---

### Task 2: Model surface — prompt rule in all three shipped locations

**Files:**
- Modify: `src/compiler/prompts.ts:38`, `src/core/llm.ts:21`, `src/core/llm.ts:45` (the rule line), `README.md:124`, `src/core/inline.ts` doc comment (already updated in Task 1 — verify only)
- Test: `tests/compiler-prompts.test.ts` (append assertions)

**Interfaces:**
- Consumes: Task 1 (links render). Produces: LLM-facing contract text; no code signatures change.

- [ ] **Step 1: Write the failing test**

Append to `tests/compiler-prompts.test.ts` (inside `describe("section prompts")`, after the "system prompt shares the block-type text verbatim" test):

```ts
  it("teaches the link inline form", () => {
    expect(sectionSystemPrompt()).toContain("[text](url)")
  })
```

- [ ] **Step 2: Run to verify RED**

Run: `npx vitest run tests/compiler-prompts.test.ts`
Expected: FAIL — the prompt does not yet mention `[text](url)`.

- [ ] **Step 3: Update the rule text**

In all three files, replace the line (identical text in each):

```ts
- Put no HTML in any field. Inline emphasis only: **bold**, *italic*, \`code\`.
```

with:

```ts
- Put no HTML in any field. Inline emphasis only: **bold**, *italic*, \`code\`, [text](url).
```

Locations: `src/compiler/prompts.ts` (one occurrence, line ~38), `src/core/llm.ts` (two occurrences — `systemPromptSnippet` and `documentSystemPromptSnippet`). Leave surrounding lines untouched. `BLOCK_TYPE_DOCS` (`src/core/blockTypes.ts`) gets **no change** — it never states the inline subset (verified by grep).

- [ ] **Step 4: README**

In `README.md`, replace:

```markdown
Inline emphasis only: `**bold**`, `*italic*`, `` `code` ``. No HTML in any
```

with:

```markdown
Inline emphasis only: `**bold**`, `*italic*`, `` `code` ``, `[text](url)` —
links are scheme-gated to http(s), `mailto:`, and `#anchors`; anything else
degrades to literal text. No HTML in any
```

- [ ] **Step 5: Run to verify GREEN + full suite**

Run: `npx vitest run tests/compiler-prompts.test.ts && npx vitest run && npx tsc --noEmit && echo OK`
Expected: 320/320 tests, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/compiler/prompts.ts src/core/llm.ts README.md tests/compiler-prompts.test.ts
git commit -m "$(cat <<'EOF'
feat(llm): teach the link inline form in prompt contracts

🤖 Generated with Codebuff
Co-Authored-By: Codebuff <noreply@codebuff.com>
EOF
)"
```

---

### Task 3: Demo link, ROADMAP, verification

**Files:**
- Modify: `demo/examples.js` (one text body gains a link)
- Modify: `docs/ROADMAP.md` (Shipped bullet + backlog wording)
- Modify: `.superpowers/sdd/progress.md` (git-ignored ledger — no commit)

**Interfaces:**
- Consumes: shipped Tasks 1–2. Produces: docs/demo only.

- [ ] **Step 1: Demo fixture link**

In `demo/examples.js`, find the first `text` block of `educationIr` (a `{ type: "text", body: … }` in the first ~40 lines) and append a sentence with a real link to its body, e.g.:

```js
      { type: "text", body: "…existing body… See [the spec](https://developer.mozilla.org/en-US/docs/Web/JavaScript) for details." },
```

(Preserve the existing body text exactly; only append the sentence. Any https URL works — pick one that suits the paragraph.)

- [ ] **Step 2: ROADMAP**

In `docs/ROADMAP.md`, append to **Shipped** (after the Real data bullet):

```markdown
- **Link inline element** (2026-10-01) — `renderInline` gains
  `[label](href)`: scheme-gated (https/http/mailto/#anchor after
  control-char/space normalization), escaped, lenient (gated or malformed
  links render literally); the LLM prompt contracts teach the form. The
  grounded-authoring prerequisite. Spec:
  `docs/superpowers/specs/2026-10-01-link-inline-element-design.md`.
```

and in the backlog's Grounded authoring bullet, replace:

```markdown
  citation blocks or inline references, which need a link inline element
  (renderInline's v1 subset is bold/italic/code only). The gap between a
```

with:

```markdown
  citation blocks or inline references (the link inline element shipped
  2026-10-01 unblocks this). The gap between a
```

- [ ] **Step 3: Full verification**

```bash
npx tsc --noEmit && npx vitest run 2>&1 | grep -E "Test Files|Tests "
npm run build
launchctl remove explanations-demo 2>/dev/null; true
launchctl submit -l explanations-demo -- "$(command -v node)" "$PWD/demo/server.mjs"
sleep 1
curl -s -o /dev/null -w "root:%{http_code} " http://localhost:4173/
curl -s http://localhost:4173/ | grep -c 'href="https://'
./scripts/vexp verify
```

Expected: tsc clean; 323/323; build ok; root 200; the served page contains at least one rendered `<a href="https://…">`; `vexp verify` clean (run any tests it flags).

- [ ] **Step 4: Commit**

```bash
git add demo/examples.js docs/ROADMAP.md
git commit -m "$(cat <<'EOF'
docs+demo: link inline element shipped, roadmap updated

🤖 Generated with Codebuff
Co-Authored-By: Codebuff <noreply@codebuff.com>
EOF
)"
```

- [ ] **Step 5: Update the progress ledger** (git-ignored — no commit)

Append to `.superpowers/sdd/progress.md`:

```text
Link-inline Task 1: complete (renderInline link pass + scheme gate; 7 inline tests + react smoke)
Link-inline Task 2: complete (prompt rule in prompts.ts + llm.ts x2; README; 1 prompt test)
Link-inline Task 3: complete (demo link; ROADMAP shipped bullet + backlog rewording; verification green)
Branch finished: main fast-forwarded to <sha> (<N> commits, <T>/<T> tests + tsc on merged result), <push state>, feature/link-inline deleted.
```

- [ ] **Step 6: Fresh-eyes review pass against the spec**

Re-read `docs/superpowers/specs/2026-10-01-link-inline-element-design.md` §3–§8 and check each requirement against the shipped code: parse order, gate matrix, no-warning leniency, three-location rule text, determinism lock, out-of-scope list untouched. Fix discrepancies in a follow-up commit before finishing the branch.
