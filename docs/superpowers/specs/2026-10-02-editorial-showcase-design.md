# Editorial Showcase — Design

**Date:** 2026-10-02
**Status:** Approved (brainstorm 2026-10-02 — scope, direction, typography and
content locked in session)
**Type:** Side quest — demo-only. **No library changes.**

## 1. Problem & Goal

The demo is dry. It proves the library's behaviour — every primitive, the
compiler stages, the warning channels — but it reads as a test harness rather
than a product, because the library ships one utilitarian default skin and the
demo pages put it on a bare white page with `system-ui`. Nothing about the
current demo shows what the output could look like *in a real publication*.

Goal: one demo route, `/editorial`, that renders a coherent short article in an
editorial/print treatment — warm paper, oxblood accent, serif prose, mono
furniture — and thereby demonstrates that the library's public styling surface
(tokens + documented class hooks) is expressive enough for a designed page.

The point being made is about **the library's re-skin surface**, not about the
library's features. If this page looks good, the theming story is proven.

## 2. Decisions (locked in brainstorm, 2026-10-02)

1. **Demo-only, zero library changes.** Nothing under `src/` is touched. The
   showcase is a consumer of the shipped package, exactly as a real host would
   be. Nothing is added to `src/themes/`, and `renderDocument`'s `theme` option
   keeps its three existing values.
2. **Tokens + a curated component layer** (not tokens-only). The token surface
   carries palette, base type, radius and spacing; a small stylesheet over the
   documented `.exp-*` classes carries the editorial details (display sizes,
   small-caps section labels, hairline rules). Rationale: the audit found
   heading typography is *not* tokenized — `.exp-doc-title` and
   `.exp-doc-section-title` hardcode `em` sizes, weights and a fixed
   `border-bottom`, and there is no heading font hook. A tokens-only re-skin
   would read as "recolored", not "designed". The class names are the
   documented theming hook, so styling them is the supported path.
3. **Editorial/print direction** — warm paper, warm ink, one oxblood accent,
   no shadows. Chosen over technical/Swiss (too close to the default to prove
   anything) and product/dark (would mostly re-demo the shipped dark theme).
4. **A full composed document**, not the existing example IRs. The prose has to
   read as an article or the page is a component gallery in disguise.
5. **Webfonts from a CDN** — Source Serif 4 (prose) + IBM Plex Mono (code and
   the mono furniture/kicker face). The demo already loads from `esm.sh`, so
   the pattern exists. System-serif fallbacks keep the page readable if the CDN
   is unreachable.
6. **No new page furniture beyond what a host genuinely owns.** A small
   masthead-ish header, a "this is a demo" line, and a back link — no drop caps,
   running heads, marginalia or pull quotes. Reasoning: chrome that isn't the
   library makes the page *look* designed without evidencing that the library
   can be; the showcase's credibility depends on the polish being in the
   library's own output.

## 3. Surface & Scope

New route on the existing demo server. Follows the `/interactive` shape in
`demo/server.mjs` (read a file, 200, 404 on failure).

| File | Role |
| --- | --- |
| `demo/editorial.css` | The stylesheet: token block + component block |
| `demo/editorialIr.js` | The article IR, exported like the `demo/examples.js` fixtures |
| `demo/editorial.html` | Page shell: webfont links, chrome, mount point, client-side render |
| `demo/server.mjs` | One route branch (`/editorial`) + an index link on `/` |

Client-side render in `editorial.html` via ESM imports (the `/compile` pattern),
not a server-side render in `server.mjs` (the `/` pattern). Rationale: a
dedicated file is cheaper to iterate on visually, and the demo server stays
free of presentation logic.

The route needs `/themes/*.css` and `/index.js` to be served — both already are.

### Out of scope

- Any change under `src/`.
- Adding a third theme to `src/themes/` or a new `renderDocument` theme value.
- Restyling `/`, `/document`, `/interactive` or `/compile`.
- A dark or alternate variant of the editorial skin.
- Printing the IR through the compiler (the compiler demo already has its own
  route).
- New tests. This is demo-only surface with no library contract to pin. The
  user declined a route smoke test when offered.

## 4. Visual Design

### 4.1 Palette — warm paper, warm ink, oxblood

| Token | Value |
| --- | --- |
| `--exp-surface` | `#fffdfa` |
| `--exp-surface-muted` | `#f1ece3` |
| `--exp-text` | `#1f1b16` |
| `--exp-text-muted` | `#6b6257` |
| `--exp-border` | `#ded6c9` |
| `--exp-accent` | `#8a2f3a` |
| `--exp-accent-soft` | `#f4e6e6` |
| `--exp-tip` / `--exp-tip-soft` | `#2f6b4f` / `#e6efe8` |
| `--exp-warning` / `--exp-warning-soft` | `#9a6b1f` / `#f7eedb` |
| `--exp-up` / `--exp-down` / `--exp-flat` | `#2f6b4f` / `#a3323a` / `#6b6257` |
| `--exp-ink` | `#1f1b16` |
| `--exp-edge` | `#8a8175` |
| `--exp-node-fill` | `#fffdfa` |
| `--exp-node-stroke` | `#8a2f3a` |
| `--exp-node-text` | `#1f1b16` |

Pure `#000` on cream reads harsh; pure `#fff` card grounds read as overlay.
Near-white `#fffdfa` sits *on* the paper rather than on top of it. `--exp-edge`
and `--exp-node-stroke` take the accent and ink so diagrams read as woodcuts.

Code tokens (`--exp-tok-*`) are set to the muted warm set so highlighted code
stays inside the print palette instead of shouting.

### 4.2 Type — serif prose, mono furniture

- `--exp-font`: `'Source Serif 4', Charter, Georgia, serif`
- `--exp-mono`: `'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace`
- `--exp-font-size: 17px`, `--exp-line-height: 1.62` — print leading.
- `--exp-radius: 3px`, `--exp-radius-sm: 2px`
- `--exp-gap: 16px`, `--exp-pad: 20px`
- **No shadows.** Elevation comes from hairline borders only.

The signature move: **mono uppercase letterspaced kickers** for all
label furniture, against serif prose. That pairing is what makes the page read
technical-editorial rather than literary.

### 4.3 Component layer

The part the tokens cannot reach:

| Selector | Treatment |
| --- | --- |
| `.exp-doc-title` | `2.6em`, weight 600, `letter-spacing: -0.015em`, `line-height: 1.08` |
| `.exp-doc-summary` | `1.18em` italic serif, `--exp-text-muted` — a dek, not a subtitle |
| `.exp-doc-section-title` | **Mono uppercase kicker**, `0.82em`, `letter-spacing: 0.16em`, weight 600, with a hairline `border-bottom` — replacing the default bold-underlined heading so section headings recede and the prose leads |
| `.exp-doc-toc` | Un-floated and restyled as an inline "In this piece" list with mono numerals (see below) |
| `.exp-block` | The base class every primitive emits (each also carries a per-type modifier, e.g. `exp-concept`, `exp-chart`, `exp-quiz`, `exp-sources`). Restyle generically here: square-ish, border-only, no shadow. |
| `.exp-code` | Code grounds on `--exp-surface-muted` with the hairline border; the language chip in mono kicker style |
| `.exp-doc-toc-list`, `.exp-doc-toc-list a` | Mono numerals, hairline separation between items, no hover fill — a contents list, not a nav widget |

The TOC needs one **call-site** decision, not just CSS: it floats right and pins
by default (`position: sticky; float: right; max-width: 12rem`), which is a
product-docs pattern. The showcase calls `renderDocument(..., { tocSticky:
false })` to restore normal flow, then styles the resulting `.exp-doc-toc` /
`.exp-doc-toc-list` as an inline contents block. This is the supported opt-out,
not an override fight.

### 4.4 Page chrome (minimal, host-owned)

Header with the demo's identity, a one-line note that this is a re-skin of the
same library output, a back link to `/`, and the rendered document in a
`42rem` measure with charts/diagrams allowed to break out slightly wider.
Nothing that fakes editorial furniture the library doesn't produce.

## 5. Content — *"Why the sky is blue at noon and red at dusk"*

A real short article, written to earn the treatment and to exercise the block
range in the order an editor would actually use them.

| § | Blocks | Why it's here |
| --- | --- | --- |
| 1. The short answer | `concept`, `text` | Leads with the claim; concept block carries it as a formal statement |
| 2. Scattering and wavelength | `derivation`, `worked-example` | The `λ⁻⁴` relation as a derivation step; a numeric example under it |
| 3. The long path at dusk | `diagram`, `text` | Sun → atmosphere → observer, with the path length growing toward the horizon |
| 4. What the numbers say | `chart`, `callout` | Relative scattering 400–700nm; a callout for the caveat that the sky isn't *only* this |
| 5. Check yourself | `quiz` | The retrieval-practice primitive, in situ |
| 6. Sources | `sources` | Grounding provenance, closing the article the way the compiler would |

Seven primitives, one coherent argument. That is a strictly better showcase
than a grab-bag, and it demonstrates the compiler's own output vocabulary.

## 6. Implementation Notes

- The token block must set every variable it overrides explicitly — a token set
  that only partially overrides would silently inherit the library defaults and
  read as a mix of two palettes.
- The article's `<h1>`/dek come from the IR's `title`/`summary`; the chrome must
  not duplicate them.
- Webfonts load with `display=swap` and a system fallback stack, so a CDN
  failure degrades to Georgia/Menlo rather than an unreadable page.
- The page must not ship as the *only* demo entry point: `/` gains a link, and
  the existing demos are unchanged.

## 7. Verification

1. `npm run build` — the showcase consumes `dist/`, so it needs a fresh build
   (demo chrome is served from `dist/themes/*.css` and `dist/index.js`).
2. Demo server restarted via launchd; `curl` from a **separate** tool call:
   `/editorial` → 200, `/` → 200.
3. The IR parses against `documentSchema` (one-off check; the renderer degrades
   rather than throws, so this is verified explicitly rather than inferred).
4. Visual: paper ground, oxblood accent, serif headings, mono kickers, inline
   TOC, quiz and sources blocks all rendering in the treatment.
5. `npm run typecheck` and `npm test` remain green — nothing under `src/` moved,
   so this is a regression guard, not a change gate.

## 8. Risks

- **Partial token overrides** → mixed palette. Mitigated by §6's explicit
  requirement and by checking every block on the page, not just the first.
- **Float/pin TOC** → dead off-screen contents if `tocSticky: false` is missed.
  Mitigated by the call-site requirement in §4.3 and the visual check.
- **CDN unreachable** → serif falls back to Georgia. Acceptable and specified.
- **Scope creep into the library** — the temptation when a component looks
  under-styled is to fix it in `tokens.css`. Out of scope per §3; if the
  component layer needs many rules to look right, that is a *finding* worth
  reporting to the user, not a change to make here.