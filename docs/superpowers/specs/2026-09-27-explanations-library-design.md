# Design: `explanations` — a TypeScript library for LLM-generated visual explanations

**Status:** Approved design (2026-09-27)
**Goal:** A TypeScript library that renders LLM-produced explanation trees as styleable HTML/CSS, consumable from any project (primary target: Next.js).

## 1. Problem & approach

LLMs asked to "explain X visually" produce arbitrary HTML that is unverifiable, unthemeable, and unsafe to render. Instead, the LLM emits a **constrained, typed IR** (a JSON tree of explanation primitives) and the library deterministically renders it to semantic HTML styled via design tokens.

This mirrors the proven Mermaid pattern (constrained DSL → diagram) but for explanations rather than diagrams, with a forgiving validator because LLM output is occasionally imperfect.

## 2. Decisions (from brainstorming session)

| Question | Decision |
|---|---|
| Primitive model | **Hybrid**: ~10 curated composites + small escape hatch (`stack`, `text`), registry-based so new primitives can be added additively |
| Explanation domain | **Educational/learning** and **data-driven explanations** |
| Integration | **HTML-first core + thin React adapter** (output quality is identical because the LLM only ever emits IR) |
| Styling | **Default themes (light/dark) + CSS custom property token overrides** |
| Packaging | **Single package with subpath exports** (`explanations`, `explanations/react`, `explanations/themes/*.css`), internally separated so a future split is mechanical |
| Runtime dependency | **zod v4 only** — TS types via `z.infer`, JSON Schema via `z.toJSONSchema()`; no drift between types, schema, and LLM contract |

## 3. Architecture & data flow

```
LLM → IR (JSON) → validate (lenient) → render → HTML string → [React adapter] → Next.js RSC
```

- Core is pure TypeScript, zero DOM dependencies, renders to strings.
- The React adapter is a server component by default (no client JS); a primitive can later gain a React implementation for interactivity without changing the IR.

## 4. The IR

```ts
type Explanation = {
  version: 1
  title?: string
  summary?: string
  blocks: Block[]
}

type Block = { id?: string; type: <primitive name>; ...payload }
```

Plain tree — no cross-references between blocks.

### v1 composite catalog

| Primitive | Purpose |
|---|---|
| `step-list` | Numbered steps, each with optional detail |
| `worked-example` | Problem → steps → result |
| `derivation` | Equation/argument steps with annotations (math is a plain string; KaTeX rendering is the consumer's choice, not bundled) |
| `concept` | Definition + intuition + analogy |
| `comparison` | Dimensions × items table |
| `cause-effect` | Because/therefore chains |
| `data-callout` | Metric + delta + context sentence |
| `timeline` | Ordered events |
| `callout` | note / tip / warning |

### Escape hatch

- `stack` — nested blocks, **max depth 2**
- `text` — a paragraph

### Extensibility

- Composites are entries in a typed registry; adding one is additive, no core changes.
- IR carries `version` for forward-compatible evolution.
- Unknown types degrade to a styled fallback block (older consumers don't break).

## 5. Validation & error handling (lenient by default)

- Unknown block type → styled fallback block.
- Missing optional fields → fine.
- Block missing required content → skipped and reported.
- `renderExplanation(ir)` → `{ html, warnings }`
- `validateExplanation(ir)` → diagnostics (for dev tooling)
- `{ strict: true }` opts into throwing.
- **Security:** raw HTML from the LLM is never rendered. Text fields support only a tiny inline subset (bold, italic, inline code) which the library parses and escapes. All other characters are escaped.

## 6. Rendering & styling

- Semantic, prefixed class names (`exp-step-list`, `exp-step`, `exp-step-num`, …); zero inline styles.
- All visual styling via CSS custom properties (`--exp-accent`, `--exp-surface`, `--exp-radius`, `--exp-font`, …).
- Shipped themes: `light`, `dark`, built on the tokens. Consumers override tokens or author custom themes.
- Same IR renders differently only via CSS.

## 7. React adapter

```tsx
<Explanation ir={ir} theme="light" />   // server component, no client JS
```

- Renders core's HTML string, auto-loads the stylesheet.
- Escape hatch: `components={{ 'step-list': MyStepList }}` swaps a custom React renderer for any primitive.

## 8. LLM contract

Exported from the core package:

- `explanationJsonSchema` — strict JSON Schema derived from the zod schema, ready for structured outputs / tool calling.
- `systemPromptSnippet` — a tested markdown instruction block telling models how to pick primitives and fill payloads.

The catalog is deliberately flat and closed: that is what keeps LLM output reliable.

## 9. Package layout

```
src/
  core/        types.ts, schema.ts, validate.ts, render.ts
  primitives/  one file per composite
  react/       Explanation.tsx
  themes/      tokens.css, light.css, dark.css
```

Subpath exports: `.` (core), `./react`, `./themes/light.css`, `./themes/dark.css`.

## 10. Testing

- Unit tests: lenient validator, HTML escaping.
- Per-primitive HTML golden tests.
- Contract test: JSON Schema ↔ zod consistency.
- RSC render test for the React adapter.

## 11. Out of scope (v1)

- Interactive primitives (client-side hydration)
- Math rendering (KaTeX integration — consumer's choice)
- Additional renderers (e.g., email-safe HTML, SVG export)
- Consumer-contributed primitives at runtime beyond the `components` adapter swap
