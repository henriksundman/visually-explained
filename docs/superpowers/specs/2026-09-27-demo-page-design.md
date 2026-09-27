# Design: static demo page for the explanations library

**Status:** Approved design (2026-09-27)
**Goal:** A zero-dependency demo that renders one education and one data-driven explanation in both shipped themes, doubling as a living dev playground and a smoke test of the built package.

## Decisions

- **Static dev page now; Next.js proof later** as part of the README integration guide.
- Serves from **built `dist/` artifacts** (not `src/`), so `npm run demo` doubles as an end-to-end check of the published shape.
- Theme switching demonstrates the **token architecture**: render once with `theme: "none"`, toggle one CSS class (`exp-theme-light` / `exp-theme-dark`) on the page wrapper. No re-render, no framework.

## Content — `demo/examples.js`

Two hand-written IR fixtures (what an LLM would emit), each exercising a different slice of the catalog and doubling as README seeds:

- **`educationIr` — "Why does dividing by a fraction multiply?"**
  - `concept` (term / definition / analogy)
  - `worked-example` (problem → steps → result)
  - `derivation` (escape-only math expressions)
  - `callout` (tip)
  - grouped in a `stack` to show nesting
- **`dataIr` — "Why did activation spike?"**
  - two `data-callout`s (one trend up, one trend down)
  - `comparison` (2 items × dimensions table)
  - `cause-effect` chain
  - `timeline`
  - `callout` (warning)

All fixture content must be schema-valid against `explanationSchema` (asserted in the demo test below) so the demo cannot drift from the IR contract.

## Server — `demo/server.mjs`

Zero-dependency Node `http` server, wired as `npm run demo` (builds first, then serves):

| Route | Behavior |
|---|---|
| `/` | One HTML page: both explanations via `renderExplanation(ir, { theme: "none" })`, page sections wrapped in `exp exp-theme-light` / `exp exp-theme-dark`, small inline toggle script |
| `/themes/tokens.css`, `/themes/light.css`, `/themes/dark.css` | Served from `dist/themes/` |

- Port 4173, overridable via `PORT`; prints the URL on start.
- Page chrome (headings, toggle button) uses plain unstyled HTML outside `.exp` scopes — the demo styles nothing of its own.

## Testing / verification

- `tests/demo-examples.test.ts` — asserts both fixtures parse against `explanationSchema` and cover the intended block types (education: `concept`, `worked-example`, `derivation`, `callout`, `stack`; data: `data-callout`, `comparison`, `cause-effect`, `timeline`, `callout`).
- Manual/CI: start server, `curl /` contains both titles and `exp-` markup; CSS routes return 200. Visual check is the user's.

## Out of scope

- Next.js app (deferred to README integration guide)
- Responsive/layout polish, persistent theme preference (e.g. localStorage)
- Serving from `src/` or HMR-style watch mode
