# Link Inline Element — Design

**Date:** 2026-10-01
**Status:** Approved (brainstorm 2026-10-01)
**Predecessor:** Explanations library v1 (`2026-09-27-explanations-library-design.md`)
**Backlog origin:** ROADMAP "Grounded authoring — … which need a link inline
element (renderInline's v1 subset is bold/italic/code only)". Shipped first as
a deliberate decomposition: grounded authoring's citations need somewhere to
live, and this is that primitive.

## 1. Problem & Goal

`renderInline` renders the v1 inline subset — `**bold**`, `*italic*`,
`` `code` `` — and nothing else. Grounded authoring (next cycle) needs output
that carries provenance: citations and references, i.e. links. Goal: a
`[label](href)` inline link that the model and hosts can author, rendered as a
real `<a>` — with a scheme gate that makes `javascript:`-style execution
impossible by construction.

## 2. Decisions (from brainstorm)

1. **Markdown-style `[label](href)`** — the form every LLM already emits
   natively and the same subset style as `**bold**`/`*italic*`; no private
   syntax to teach or fight drift on.
2. **Scheme allowlist (the security control)** — `http:`, `https:`,
   `mailto:`, and same-page `#anchor` hrefs only. Anything else degrades to
   plain text, no warning. No host-configurable gate in v1.
3. **Lenient degradation, no warning** — a gated-out or malformed link renders
   its source literally, exactly like unmatched `**` today. Inline leniency
   mirrors block salvage: never fail a render over prose.
4. **The model surface changes this time** — links are useless for grounding
   if the model can't emit them (the datasets cycle kept the surface frozen;
   this feature is the inline contract, so the contract updates).
5. **No fetching, ever** — the library renders hrefs as text; it never
   requests them. There is no SSRF surface and none may be added.

## 3. Syntax & Parsing (`src/core/inline.ts`)

- Per non-code segment of the existing code-span split, the order becomes:
  **escapeHtml → emphasis (unchanged) → links**.
  - Rationale (amended from the brainstorm sketch, which had links before
    emphasis): with links first, a stray `*` elsewhere in the segment can pair
    *into* an already-emitted `href` attribute and corrupt it. Emphasis-first
    keeps every link-free string byte-identical to today (determinism lock),
    and the only observable difference is confined to segments that contain
    both a link and an unpaired stray `*` — an accepted v1 quirk, same class
    as the existing stray-star pairing behavior.
- Link regex: `/\[([^\]]+)\]\(([^)\s]+)\)/g` — character classes only, no
  nested quantifiers, linear scan (ReDoS-safe). Applied to the **escaped**
  text, so the label and href are already entity-safe when matched.
- Labels pass through already-applied emphasis, so `[**x**](u)` nests:
  `<a href="u"><strong>x</strong></a>`. A URL containing `*` with no pairing
  star survives intact (tested).
- Malformed pairs — `[x](y z)` (space in href), `[x]`, `[x](` — render
  literally. The regex's `[^)\s]+` href class stops at whitespace, so a
  space-punctuated pair can never form an href token.
- No escaping mechanism in v1: a literal-looking `[x](y)` in prose renders as
  a link (same stance as `**` always meaning bold).

## 4. The Href Gate

Applied before emission, per candidate href:

1. **Normalize:** strip all ASCII control characters and spaces
   (`/\u0000-\u0020/g`) from the href. Browsers strip `jav\tascript:`'s tab
   at parse time, so the gate strips first — the bypass is dead by
   construction and the normalized form is what's emitted.
2. **Gate, case-insensitive:** allow `https:…`, `http:…`, `mailto:…`, or an
   in-page anchor beginning `#`. Everything else — `javascript:`, `data:`,
   `vbscript:`, protocol-relative (`//host`), bare-relative paths, unknown
   schemes — degrades to plain text (the whole `[label](href)` source string,
   escaped).
3. **Emit:** `<a href="${escapeHtml(normalized)}">${label}</a>`. `escapeHtml`
   escapes quotes, so attribute breakout is structurally impossible; the
   scheme gate is the second, behavioral control. No `target`, no `rel` —
   link-opening behavior is page/host territory (documented as a host
   responsibility; hosts wanting `rel="noopener"` add it host-side).

## 5. Model Surface (deliberate change)

- The shared prompt rule (`src/compiler/prompts.ts` line 38) becomes:
  "Put no HTML in any field. Inline emphasis only: **bold**, *italic*,
  \`code\`, [text](url)."
- `BLOCK_TYPE_DOCS` entries whose prose states the inline subset update to
  include the link form (grep "bold" to find them all).
- README inline note and `renderInline`'s doc comment follow.
- `explanationJsonSchema` / `documentJsonSchema` untouched — bodies are plain
  strings; the link lives inside them.

## 6. Security Walk (rafter-secure-design — ingestion, recorded 2026-10-01)

- **Trust boundary:** body strings of LLM-authored (or host-authored) blocks —
  free text. The parser at the boundary is `renderInline`.
- **Declared, not hand-parsed:** block schemas already bound every field
  (`z.string().min(1)`); the link is parsed from within a validated string.
  Length caps ride the existing field limits (200 on tips, etc.).
- **The unsafe-marker review:** the only HTML emission paths remain
  `renderInline`/`escapeHtml` (+ the React `dangerouslySetInnerHTML` uses that
  feed exclusively from them). Nothing new bypasses escaping.
- **Href gate** (§4) is the behavioral control; escaping is the structural
  one. The `jav\tascript:` control-char bypass has an explicit test.
- **SSRF:** N/A by design — the library never fetches hrefs (decision §2.5);
  any future "resolve/preview links" idea must re-run this walk.
- **Regex safety:** character-class-only, linear; no catastrophic
  backtracking shape.
- **Residual risk / host side:** `target`/`rel` choices, CSP for `http:`
  links on https pages, and any host-side fetching are all outside the
  library. Documented in README's host-responsibilities list.

## 7. Testing

- **Happy paths:** `https://`, `http://`, `mailto:`, `#anchor` → correct
  `<a>` markup, escaped label and href.
- **Gate matrix:** `javascript:alert(1)`, `JAvaScript:`, `java\tscript:`,
  `data:text/html,…`, `vbscript:`, `//host/path`, `relative/path` — all
  degrade to literal text, no warnings.
- **Malformed:** `[x](y z)`, `[x]`, stray `[x](y` → literal.
- **Nesting & precedence:** `[**bold**](u)` nests; code span containing
  `[x](y)` stays code; URL with `*` (no pair) survives; `**` emphasis around
  a link still works.
- **Determinism lock:** link-free strings render byte-identical to the
  pre-change output (existing inline tests pass unchanged).
- **Prompt snapshot:** the compiler prompt test updates to the new rule text.
- React path inherits everything via the shared `renderInline` — one
  smoke-level assertion in the React tests, no separate matrix.

## 8. Out of Scope

- Reference-style links (`[x][1]`), link titles (`[x](u "t")`), autolinking
  bare URLs.
- Host-configurable href gates (the datasets cycle's host-override option —
  revisit only if grounded authoring proves it necessary).
- Relative-URL support (deliberately degraded, not deferred-polished).
- Any form of link resolution, prefetching, or validation-by-fetch.

## 9. Plan Sizing (input to writing-plans)

Estimated 3 tasks: `renderInline` link parsing + gate + unit matrix → model
surface (prompts, `BLOCK_TYPE_DOCS`, README, doc comments) + prompt-snapshot
update → demo fixture link + full verification.
