# Editorial Showcase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This repo executes plans **inline** — no CLI subagents (AGENTS.md).

**Goal:** Add a demo-only `/editorial` route that renders a coherent short
article in an editorial/print treatment — warm paper, oxblood accent, serif
prose, mono furniture — proving the library's public styling surface carries a
designed page.

**Architecture:** Four demo-side files, zero changes under `src/`. A
purpose-written document IR, a stylesheet that overrides the library's
documented tokens plus its public `.exp-*` class hooks, an HTML page shell
that renders client-side (the `/compile` pattern), and one route branch in the
demo server. Ordered so the page is *working and verified under the default
skin* before any editorial CSS is judged.

**Tech Stack:** Plain HTML/CSS/JS demo assets, ESM imports against the built
`dist/` (the `/compile` pattern), Google Fonts CDN for two families.

**Spec:** `docs/superpowers/specs/2026-10-02-editorial-showcase-design.md`
(approved 2026-10-02).

## Global Constraints

- **Zero library changes.** Nothing under `src/` is modified, added, or
  reformatted. If a component looks under-styled, fix it in the demo stylesheet
  or report it — never in `tokens.css`.
- **Token overrides must be total.** Every `--exp-*` variable the showcase
  depends on is set explicitly. A partial token set silently inherits library
  defaults and reads as two palettes mixed.
- **The token selector is `.exp.editorial`, never a bare wrapper.** The library
  declares its defaults *on `.exp` itself*, so tokens set on a parent element
  are overridden the instant `.exp` re-declares them.
- **Two families, no more:** Source Serif 4 (prose) and IBM Plex Mono (code +
  kicker furniture), both from the Google Fonts CDN with system fallbacks.
- **No shadows anywhere** in the showcase; `--exp-popover-shadow: none`.
- **No new pages beyond `/editorial`.** `/`, `/document`, `/interactive` and
  `/compile` keep their current appearance; the only change to them is an added
  link on `/`.
- **No new tests.** Demo-only surface, no library contract to pin (the user
  declined a route smoke test at design time).
- **Verification commands:** `npm run typecheck`, `npm test` (regression guard
  only — nothing under `src/` moves), `npm run build`, then the launchd demo
  server and `curl` from a **separate** tool call (AGENTS.md).
- **Merge gate (AGENTS.md):** execute on `feature/editorial-showcase`, stop at
  ready-to-merge, present the page for review. Do not merge without go-ahead.
- **Execution:** inline only; per-task commit; append a ledger line to
  `.superpowers/sdd/progress.md` after each task (the ledger is git-ignored —
  never `git add .superpowers`).

## File Structure

| File | Responsibility |
| --- | --- |
| `demo/editorialIr.js` | The article IR. One exported const. No DOM, no styles. |
| `demo/editorial.css` | The whole skin: token block, then the component block, then page chrome. |
| `demo/editorial.html` | Page shell: font links, chrome markup, ESM mount that calls `renderDocument`. |
| `demo/server.mjs` | `/editorial` route branch (file read, 200, 404 on failure) + the index link. |

Why client-side render rather than server-side: `editorial.html` iterates far
faster to style, and the demo server keeps no presentation logic. It also
means the page consumes the built `dist/index.js` exactly as a real browser
host would.

---

### Task 1: The article IR

**Files:**
- Create: `demo/editorialIr.js`

**Interfaces:**
- Consumes: nothing (self-contained data).
- Produces: `editorialDocIr` — a plain object satisfying `documentSchema`:
  `{ version: 1, title: string, summary: string, sections: Array<{ id?: string,
  title: string, blocks: unknown[] }> }`. Task 2 imports it; Task 3 styles it.

Block shapes used (from `src/core/schema.ts`, all verified):
`concept` `{term, definition, intuition?, analogy?}` · `text` `{body}` ·
`derivation` `{steps: [{expression, note?}], conclusion?}` ·
`worked-example` `{problem, steps: [{title, detail?}], result}` ·
`diagram` `{nodes: [{id, label, shape?, tip?}], edges: [{from, to, label?,
kind?}], direction?}` · `chart` `{kind: "bar", points: [{label, value, tip?}],
unit?, caption?}` · `callout` `{variant: "note"|"tip"|"warning", body}` ·
`quiz` `{question, options: [{text, why?}], answer, explanation?}` ·
`sources` `{title?, items: [{id, title, url?, detail?}]}`.

- [ ] **Step 1: Create `demo/editorialIr.js`**

Scattering ratios are `(λ_short / λ_long)^4`, evaluated for the chart so the
numbers are real: 450nm→0.62, 500→0.41, 550→0.28, 600→0.20, 650→0.14,
700→0.11, normalized to 400nm = 1.00.

```js
// The article rendered at /editorial — a purpose-written document IR, shaped
// to exercise seven primitives in the order an editor would actually use them
// (concept → derivation → worked example → diagram → chart → quiz → sources).
//
// Every value here must satisfy documentSchema; the demo renderer degrades
// rather than throws, so an invalid block would silently render as a fallback.
// Source urls are example.com placeholders, per the existing demo fixtures.

export const editorialDocIr = {
  version: 1,
  title: "Why the sky is blue at noon and red at dusk",
  summary:
    "One mechanism — Rayleigh scattering — plus the changing length of a ray's path through the atmosphere, accounts for both.",
  sections: [
    {
      id: "short-answer",
      title: "The short answer",
      blocks: [
        {
          type: "text",
          body:
            "The familiar answer is that air scatters blue light more than red. That is true, and on its own it does not explain the sunset — because at sunset the sun is no brighter, and the sky is not darker.",
        },
        {
          type: "concept",
          term: "Rayleigh scattering",
          definition:
            "Scattering by particles much smaller than the wavelength of light, at an intensity proportional to the inverse fourth power of that wavelength.",
          intuition:
            "Short wavelengths are deflected far more readily than long ones. Blue light is bounced around the sky many times over; red light mostly travels straight through.",
          analogy:
            "Like a pond: ripples much smaller than a wave are scattered strongly, while long swells pass through untouched.",
        },
        {
          type: "text",
          body:
            "So the zenith looks blue. What is missing from that answer is the **path length** — how far through the atmosphere the light actually travels before it reaches your eye.",
        },
      ],
    },
    {
      id: "scattering",
      title: "Scattering and wavelength",
      blocks: [
        {
          type: "derivation",
          steps: [
            {
              expression: "I(λ) ∝ 1 / λ^4",
              note: "Scattered intensity against wavelength.",
            },
            {
              expression: "I(450) / I(700) = (700 / 450)^4 ≈ 5.9",
              note: "Blue is scattered nearly six times harder than deep red.",
            },
            {
              expression: "I(400) / I(700) = (700 / 400)^4 ≈ 9.4",
              note: "Violet, at the short end, is scattered hardest of all.",
            },
          ],
          conclusion:
            "Violet scatters more than blue, yet the zenith reads blue: the sun's own spectrum, light scattered in from the rest of the sky, and the eye's sensitivity all pull the perceived colour away from violet.",
        },
        {
          type: "worked-example",
          problem: "How much harder does 480nm light scatter than 640nm light, and what does that imply for a horizon view?",
          steps: [
            {
              title: "Write the ratio",
              detail: "`I(480) / I(640) = (640 / 480)^4`",
            },
            {
              title: "Evaluate it",
              detail: "`(4/3)^4 = 256/81 ≈ 3.16`",
            },
            {
              title: "Interpret it",
              detail:
                "Looking up at noon, blue wins by a factor of about three. Toward the horizon the path is far longer, and that is where the effect gets decisive.",
            },
          ],
          result: "A factor of ≈3.2 — real, but nowhere near enough to explain a sunset.",
        },
      ],
    },
    {
      id: "long-path",
      title: "The long path at dusk",
      blocks: [
        {
          type: "text",
          body:
            "When the sun sits low, light reaching you has crossed the atmosphere **sideways**. At the extreme — the sun on the horizon — it passes through roughly 38 times the air that a noon ray does.",
        },
        {
          type: "diagram",
          direction: "lr",
          nodes: [
            {
              id: "sun",
              label: "Sun",
              shape: "round",
              tip: "Low on the horizon — the geometry that matters",
            },
            {
              id: "air",
              label: "Atmosphere",
              shape: "box",
              tip: "About 8 km deep; the whole crossing happens here",
            },
            {
              id: "eye",
              label: "Your eye",
              shape: "pill",
              tip: "Looking along the horizon, into the scattering volume",
            },
          ],
          edges: [
            {
              from: "sun",
              to: "air",
              label: "slant path — up to 38× the vertical",
              kind: "leads",
            },
            {
              from: "air",
              to: "eye",
              label: "back-scattered light, blue mostly gone",
              kind: "leads",
            },
          ],
        },
        {
          type: "text",
          body:
            "Raise the factor from 3 to 38 and the arithmetic turns over. The short wavelengths are scattered out of the beam almost completely; what survives the journey to your eye is what scattering spared — the long reds and oranges.",
        },
      ],
    },
    {
      id: "numbers",
      title: "What the numbers say",
      blocks: [
        {
          type: "text",
          body:
            "Relative scattered intensity across the visible range, normalized to 400nm. Read it twice: once as the noon bias towards blue, and once as the filter a long path applies.",
        },
        {
          type: "chart",
          kind: "bar",
          unit: "relative intensity",
          caption:
            "Scattered intensity ∝ 1/λ^4, normalized to 400nm. A factor of 9.4 separates the two ends of the spectrum.",
          points: [
            { label: "400nm", value: 1, tip: "Violet — scattered hardest" },
            { label: "450nm", value: 0.62, tip: "Blue" },
            { label: "500nm", value: 0.41, tip: "Cyan-green" },
            { label: "550nm", value: 0.28, tip: "Green" },
            { label: "600nm", value: 0.2, tip: "Orange" },
            { label: "650nm", value: 0.14, tip: "Red" },
            { label: "700nm", value: 0.11, tip: "Deep red — scattered least" },
          ],
        },
        {
          type: "callout",
          variant: "note",
          body:
            "Scattering is not the whole story. Aerosols, which are larger than air molecules, scatter much more evenly across wavelengths — dust and pollution are why a hazy sunset is pale rather than fiery.",
        },
      ],
    },
    {
      id: "check",
      title: "Check yourself",
      blocks: [
        {
          type: "quiz",
          question: "The sun is no dimmer at sunset. So why does the horizon look red?",
          options: [
            {
              text: "The light travels much further through the atmosphere",
              why: "Correct — a longer path strips out the short wavelengths, leaving the long ones.",
            },
            {
              text: "The atmosphere gets thicker as the sun sets",
              why: "The air is the same; only the angle of the path through it changes.",
            },
            {
              text: "Red light is produced only near the horizon",
              why: "There is no mechanism that would turn red light into red light — it is a filtering story.",
            },
            {
              text: "Dust in the air scatters blue away",
              why: "Aerosols do scatter, but they scatter all wavelengths about equally — they wash the sunset out rather than redden it.",
            },
          ],
          answer: 0,
          explanation:
            "Scattering favours short wavelengths, so distance through the atmosphere selects for the long ones. The sun's brightness is a red herring.",
        },
      ],
    },
    {
      id: "sources",
      title: "Sources",
      blocks: [
        {
          type: "sources",
          title: "Sources",
          items: [
            {
              id: "rayleigh-notes",
              title: "Rayleigh scattering — reference notes",
              url: "https://example.com/rayleigh-scattering",
              detail: "Where the inverse fourth-power relation and its derivation are set out.",
            },
            {
              id: "airmass",
              title: "Air mass and airmass factors",
              url: "https://example.com/air-mass",
              detail: "The roughly 38× horizon-to-zenith figure used in the path-length argument.",
            },
          ],
        },
      ],
    },
  ],
}
```

- [ ] **Step 2: Verify the IR parses against `documentSchema`**

The renderer degrades rather than throws, so an invalid block would show up as
a silent fallback — check it explicitly.

```bash
node --input-type=module -e "
import { editorialDocIr } from './demo/editorialIr.js'
import { documentSchema } from './dist/index.js'
const r = documentSchema.safeParse(editorialDocIr)
if (!r.success) { console.error(JSON.stringify(r.error.issues, null, 2)); process.exit(1) }
const types = new Set()
const walk = bs => bs.forEach(b => { types.add(b.type); if (b.type === 'stack') walk(b.blocks) })
r.data.sections.forEach(s => walk(s.blocks))
console.log('sections:', r.data.sections.length)
console.log('block types:', [...types].sort().join(', '))
"
```

Expected output:

```
sections: 6
block types: callout, chart, concept, derivation, diagram, quiz, sources, text, worked-example
```

If `dist/` predates any library change, `npm run build` first — but at branch
start `dist/` is current, so this should run as-is.

- [ ] **Step 3: Commit**

```bash
git add demo/editorialIr.js
git commit -m "feat(demo): editorial showcase article IR"
```

---

### Task 2: The page shell and route (default skin)

Get the page rendering and serving *before* any styling, so Task 3's visual
judgment isn't chasing a broken page.

**Files:**
- Create: `demo/editorial.html`
- Modify: `demo/server.mjs` (route branch + index link)

**Interfaces:**
- Consumes: `editorialDocIr` from Task 1; `renderDocument` from `dist/index.js`.
- Produces: `GET /editorial` → 200 with a rendered document; a link on `/`.

- [ ] **Step 1: Create `demo/editorial.html`**

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Why the sky is blue at noon and red at dusk — explanations</title>
<script type="importmap">
{
  "imports": {
    "zod": "https://esm.sh/zod@4",
    "roughjs": "https://esm.sh/roughjs@4.6.6",
    "explanations": "/index.js"
  }
}
</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&display=swap">
<link rel="stylesheet" href="/themes/tokens.css">
<link rel="stylesheet" href="/editorial.css">
</head>
<body class="ed-page">
<header class="ed-head">
  <p class="ed-kicker">explanations — editorial showcase</p>
  <p class="ed-note">
    The same library output, re-skinned from the outside: design tokens for the
    palette and type, the documented <code>.exp-*</code> classes for the
    editorial details. No library code involved.
  </p>
  <p class="ed-back"><a href="/">← all demos</a></p>
</header>
<main id="root"></main>
<script type="module">
  import { renderDocument } from "explanations"
  import { editorialDocIr } from "/editorialIr.js"

  const { html, warnings } = renderDocument(editorialDocIr, {
    // The document root is the token-bearing .exp scope. theme: "none" keeps
    // the page in charge of its own ground.
    theme: "none",
    // The TOC floats right and pins by default, which is a product-docs
    // pattern. An editorial piece wants it inline, as a contents list.
    tocSticky: false,
  })

  const root = document.getElementById("root")
  root.innerHTML = html
  // renderDocument already emits `<article class="exp exp-doc">` — it IS the
  // token scope. Add the `editorial` class to that same element rather than
  // wrapping it: a wrapping element with its own .exp would re-declare the
  // library's default tokens closer to the content and silently win, undoing
  // the whole skin. (See editorial.css — hence the .exp.editorial selector.)
  root.querySelector(".exp-doc").classList.add("editorial")
  if (warnings.length) console.warn("[editorial] render warnings:", warnings)
</script>
</body>
</html>
```

- [ ] **Step 2: Serve `/editorial.css` and `/editorialIr.js` from the demo server**

Two new route branches in `demo/server.mjs`, placed after the existing
`/compileClient.js` branch and following its exact shape:

```js
  if (url.pathname === "/editorialIr.js") {
    try {
      const js = await readFile(new URL("./editorialIr.js", import.meta.url))
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" })
      res.end(js)
    } catch {
      res.writeHead(404, { "content-type": "text/plain" })
      res.end("not found")
    }
    return
  }
  if (url.pathname === "/editorial.css") {
    try {
      const css = await readFile(new URL("./editorial.css", import.meta.url))
      res.writeHead(200, { "content-type": "text/css; charset=utf-8" })
      res.end(css)
    } catch {
      res.writeHead(404, { "content-type": "text/plain" })
      res.end("not found")
    }
    return
  }
```

- [ ] **Step 3: Add the `/editorial` HTML route**

One branch, matching the `/interactive` shape exactly. Place it directly after
the `/compile` branch:

```js
  if (url.pathname === "/editorial") {
    try {
      const html = await readFile(new URL("./editorial.html", import.meta.url))
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
      res.end(html)
    } catch {
      res.writeHead(404, { "content-type": "text/plain" })
      res.end("not found")
    }
    return
  }
```

- [ ] **Step 4: Add the index link on `/`**

In the `page` template's link line, append the showcase:

```html
<p><a href="/interactive">Interactive figures →</a> · <a href="/document">Document page →</a> · <a href="/compile">Compile demo →</a> · <a href="/editorial">Editorial showcase →</a></p>
```

- [ ] **Step 5: Create a placeholder `demo/editorial.css` so the route resolves**

Task 3 replaces this file wholesale. It exists now so Step 6's `curl` returns
200 rather than 404 on the stylesheet.

```css
/* Editorial showcase skin — filled in by Task 3. */
```

- [ ] **Step 6: Build, restart the server, and verify from a separate tool call**

```bash
npm run build
```

```bash
launchctl remove explanations-demo 2>/dev/null; sleep 1
launchctl submit -l explanations-demo -- "$(command -v node)" "$PWD/demo/server.mjs"
```

Then, in a **separate** tool call:

```bash
for p in /editorial /editorial.css /editorialIr.js /; do printf "%s -> " "$p"; curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:4173$p"; done
```

Expected: `200` for all four. If `/editorial.css` is 404, the placeholder file
was not created before the server started.

- [ ] **Step 7: Confirm the page actually renders (not a blank shell)**

```bash
node --input-type=module -e "
import { renderDocument } from './dist/index.js'
import { editorialDocIr } from './demo/editorialIr.js'
const { html, warnings } = renderDocument(editorialDocIr, { theme: 'none', tocSticky: false })
console.log('render warnings:', warnings.length === 0 ? 'none' : warnings)
console.log('has toc:', html.includes('exp-doc-toc'))
console.log('sections:', (html.match(/exp-doc-section\"/g) || []).length)
const roots = (html.match(/class=\"exp[ \"]/g) || []).length
console.log('exp root elements:', roots, roots === 1 ? 'OK' : 'FAIL')
"
```

Expected: `render warnings: none`, `has toc: true`, `sections: 6`,
`exp root elements: 1 OK`.

Any render warning means a block in the IR is degrading to a fallback — fix
the IR in `demo/editorialIr.js`, never the renderer. More than one `.exp`
element would mean the page is nesting a second token scope, which would
re-declare the library defaults closer to the content and silently defeat the
whole skin.

- [ ] **Step 8: Regression guard**

```bash
npm run typecheck && npm test
```

Expected: tsc clean, 373/373 (unchanged — nothing under `src/` moved).

- [ ] **Step 9: Commit**

```bash
git add demo/editorial.html demo/editorial.css demo/server.mjs
git commit -m "feat(demo): editorial showcase page and route"
```

---

### Task 3: The editorial skin

The actual styling work. Two layers: tokens, then the component classes the
tokens can't reach.

**Files:**
- Modify: `demo/editorial.css` (replace the placeholder wholesale)

**Interfaces:**
- Consumes: the `.exp.editorial` root emitted by Task 2; the documented
  `.exp-*` classes emitted by `renderDocument` and the primitives.
- Produces: the complete stylesheet. Final deliverable of the branch.

Selectors verified against the source before use: `.exp-block` (the base class
every primitive emits, each also carrying a per-type modifier such as
`exp-concept`, `exp-chart`, `exp-quiz`, `exp-sources`), `.exp-doc-title`,
`.exp-doc-summary`, `.exp-doc-section`, `.exp-doc-section-title`,
`.exp-doc-toc`, `.exp-doc-toc-inline`, `.exp-doc-toc-list`, `.exp-code`,
`.exp-code-lang`, `.exp-concept-term`, `.exp-concept-definition`.

- [ ] **Step 1: Write the complete stylesheet**

Replace `demo/editorial.css` entirely with:

```css
/* Editorial showcase skin — demo-only, no library changes.
   Two layers: the library's documented design tokens (palette, type, shape),
   then a component layer over the public .exp-* class hooks for the editorial
   details the tokens do not reach — heading sizes, the section kicker, the
   contents list. That the second layer is small and clean is the point: the
   public styling surface is expressive enough to carry a designed page. */

/* ---- layer 1: tokens ---------------------------------------------------- */
/* The selector is .exp.editorial, never a bare wrapper class: the library
   declares its defaults ON .exp itself, so tokens set on a parent element are
   overridden the moment .exp re-declares them. The compound selector also
   beats .exp on specificity, so stylesheet order cannot flip the result. */
.exp.editorial {
  /* palette — warm paper, warm ink, one oxblood accent */
  --exp-text: #1f1b16;
  --exp-text-muted: #6b6257;
  --exp-accent: #8a2f3a;
  --exp-accent-soft: #f4e6e6;
  --exp-surface: #fffdfa;
  --exp-surface-muted: #f1ece3;
  --exp-border: #ded6c9;
  --exp-tip: #2f6b4f;
  --exp-tip-soft: #e6efe8;
  --exp-warning: #9a6b1f;
  --exp-warning-soft: #f7eedb;
  --exp-up: #2f6b4f;
  --exp-down: #a3323a;
  --exp-flat: #6b6257;

  /* figures inherit the accent, so a diagram reads as a woodcut */
  --exp-ink: #1f1b16;
  --exp-edge: #8a8175;
  --exp-node-fill: #fffdfa;
  --exp-node-stroke: #8a2f3a;
  --exp-node-text: #1f1b16;

  /* code tokens, pulled into the print palette so highlighting never shouts */
  --exp-tok-key: #8a2f3a;
  --exp-tok-lit: #9a6b1f;
  --exp-tok-num: #1f1b16;
  --exp-tok-str: #2f6b4f;
  --exp-tok-com: #9a9187;

  /* no shadows anywhere: elevation comes from hairlines */
  --exp-popover-bg: #1f1b16;
  --exp-popover-fg: #fffdfa;
  --exp-popover-shadow: none;

  /* shape & type — serif prose, mono furniture, print leading */
  --exp-font: "Source Serif 4", Charter, Georgia, "Times New Roman", serif;
  --exp-mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  --exp-font-size: 17px;
  --exp-line-height: 1.62;
  --exp-radius: 3px;
  --exp-radius-sm: 2px;
  --exp-gap: 16px;
  --exp-pad: 20px;
}

/* ---- layer 2: editorial details the tokens cannot reach ----------------- */

.exp.editorial .exp-doc-header {
  margin-bottom: calc(var(--exp-gap) * 1.25);
}

.exp.editorial .exp-doc-title {
  font-size: 2.6em;
  font-weight: 600;
  line-height: 1.08;
  letter-spacing: -0.015em;
  margin-bottom: 10px;
}

/* The dek is an italic serif lede, not a subtitle. */
.exp.editorial .exp-doc-summary {
  font-size: 1.18em;
  font-style: italic;
  line-height: 1.45;
  color: var(--exp-text-muted);
  max-width: 34rem;
}

/* Section headings become mono kickers over a hairline, so the prose leads
   and the structure stays quiet — the biggest departure from the default. */
.exp.editorial .exp-doc-section-title {
  font-family: var(--exp-mono);
  font-size: 0.78em;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--exp-accent);
  margin: 0 0 var(--exp-gap);
  padding-bottom: 10px;
  border-bottom: 1px solid var(--exp-border);
}

.exp.editorial .exp-doc-section {
  margin-top: calc(var(--exp-gap) * 2.5);
}

/* Contents list, inline (renderDocument is called with tocSticky: false).
   The library's .exp-doc-toc-inline already unpins it; this is the treatment. */
.exp.editorial .exp-doc-toc {
  background: transparent;
  border: 0;
  border-top: 1px solid var(--exp-border);
  border-bottom: 1px solid var(--exp-border);
  border-radius: 0;
  padding: 14px 0;
  margin: 0 0 calc(var(--exp-gap) * 2);
  font-size: 0.85em;
}

.exp.editorial .exp-doc-toc-list {
  display: block;
  font-family: var(--exp-mono);
  font-size: 0.95em;
  letter-spacing: 0.04em;
}

.exp.editorial .exp-doc-toc-list li {
  padding: 3px 0;
  counter-increment: toc;
}

.exp.editorial .exp-doc-toc-list li::before {
  content: counter(toc, decimal-leading-zero);
  color: var(--exp-text-muted);
  margin-right: 10px;
}

.exp.editorial .exp-doc-toc-list {
  counter-reset: toc;
}

.exp.editorial .exp-doc-toc-list a {
  color: var(--exp-text);
  text-decoration: none;
}

.exp.editorial .exp-doc-toc-list a:hover {
  color: var(--exp-accent);
}

/* Blocks: square-ish, border-only, no shadow. */
.exp.editorial .exp-block {
  box-shadow: none;
}

.exp.editorial .exp-code {
  background: var(--exp-surface-muted);
  border-color: var(--exp-border);
}

.exp.editorial .exp-code-lang {
  text-transform: uppercase;
  letter-spacing: 0.14em;
}

.exp.editorial .exp-concept-term {
  font-style: italic;
  color: var(--exp-accent);
}

/* ---- page chrome (host-owned, deliberately minimal) --------------------- */

html,
body {
  margin: 0;
  padding: 0;
}

.ed-page {
  background: #f4efe4;
  color: var(--exp-text, #1f1b16);
  font-family: "Source Serif 4", Charter, Georgia, serif;
  min-height: 100vh;
  margin: 0;
  padding: 0 1rem 6rem;
}

.ed-head,
.ed-page main {
  max-width: 42rem;
  margin: 0 auto;
}

.ed-head {
  padding: 4rem 0 1.5rem;
}

.ed-kicker {
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.72rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: #8a2f3a;
  margin: 0 0 1rem;
}

.ed-note {
  max-width: 34rem;
  font-size: 0.95rem;
  line-height: 1.55;
  color: #6b6257;
  border-left: 2px solid #ded6c9;
  padding-left: 1rem;
  margin: 0 0 1.5rem;
}

.ed-note code {
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.85em;
}

.ed-back {
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: 0.78rem;
  letter-spacing: 0.08em;
  margin: 0;
}

.ed-back a {
  color: #6b6257;
  text-decoration: none;
  border-bottom: 1px solid #ded6c9;
}

.ed-page main {
  padding-top: 2rem;
}

/* The rendered document is the page ground: lift it off the paper slightly
   so the article reads as a sheet rather than bleeding into the background. */
.ed-page main .exp {
  background: var(--exp-surface);
  border: 1px solid var(--exp-border);
  padding: calc(var(--exp-pad) * 1.8);
}
```

- [ ] **Step 2: Verify the stylesheet is served and complete**

```bash
curl -s http://localhost:4173/editorial.css | grep -c "exp.editorial"
```

Expected: `2` (the token block selector and the component-layer selectors both
matching the pattern — a non-zero count is what matters here; `0` means the
server is still serving a stale or missing file).

- [ ] **Step 3: Check every token the page depends on is overridden**

A partial token set silently inherits library defaults and reads as two
palettes mixed. Diff the showcase's token block against the library's:

```bash
node --input-type=module -e "
import { readFile } from 'node:fs/promises'
const showcase = await readFile('./demo/editorial.css', 'utf8')
const tokens = await readFile('./src/themes/tokens.css', 'utf8')
const declared = [...tokens.matchAll(/^\s{2}(--exp-[a-z-]+):/gm)].map(m => m[1])
const overridden = new Set([...showcase.matchAll(/(--exp-[a-z-]+):/g)].map(m => m[1]))
const missing = declared.filter(t => !overridden.has(t))
console.log('library tokens:', declared.length, '| overridden:', overridden.size)
console.log(missing.length ? 'NOT overridden: ' + missing.join(', ') : 'all library tokens overridden')
"
```

Expected: `all library tokens overridden`. If any token is listed, add it to
the token block before continuing — that is the mixed-palette failure mode.

- [ ] **Step 4: Verify the built package is untouched and green**

```bash
npm run typecheck && npm test && npm run build
```

Expected: tsc clean, 373/373, build succeeds. Confirms the "no library
changes" constraint held for the branch.

- [ ] **Step 5: Restart the demo and verify from a separate tool call**

```bash
launchctl remove explanations-demo 2>/dev/null; sleep 1
launchctl submit -l explanations-demo -- "$(command -v node)" "$PWD/demo/server.mjs"
```

Then, in a **separate** tool call:

```bash
for p in /editorial /editorial.css /editorialIr.js /; do printf "%s -> " "$p"; curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:4173$p"; done
curl -s http://localhost:4173/ | grep -c 'href="/editorial"'
```

Expected: `200` for all four routes, and `1` for the index link.

- [ ] **Step 6: Visual check (the actual acceptance criterion)**

Open http://localhost:4173/editorial and confirm each of these:

1. The page ground is warm paper; the article sits on a near-white sheet with a
   hairline border.
2. The title is large serif; the dek beneath it is italic and muted.
3. Section headings are small mono uppercase kickers with a hairline rule
   beneath — not large bold headings.
4. The contents list sits **inline** near the top, numbered `01`, `02`, …, and
   is not floating off to the right.
5. The chart, diagram, derivation, worked example, callout, quiz and sources
   blocks all render in the warm palette with oxblood accents — no leftover
   library blue anywhere.
6. Nothing is floating off-screen; nothing overlaps; the diagram and chart fit
   the measure.

If (4) fails, the `tocSticky: false` option is missing from the
`renderDocument` call in `demo/editorial.html`.

- [ ] **Step 7: Ledger + commit**

Append to `.superpowers/sdd/progress.md`:
`Editorial showcase Task 3: complete (<sha>; token set total, 373/373, tsc, build, /editorial 200 + assets, visual check passed)`

```bash
git add demo/editorial.css
git commit -m "feat(demo): editorial showcase skin — warm paper, oxblood, serif and mono"
```

---

## Branch finish — MERGE GATE

1. **Fresh-eyes review** against the spec
   (`2026-10-02-editorial-showcase-design.md`): confirm nothing under `src/`
   changed (`git diff main...HEAD --stat -- src/` must be empty), the token set
   is total, no shadows are declared, and scope stayed demo-side.
2. **Ledger:** append `Editorial showcase final review: …` and a
   `Branch finished (MERGE GATE)` line — not merged, branch kept, awaiting
   review.
3. **STOP and present** the URL, what to look at, and the diff stat.
4. After approval: fast-forward main, verify on the merged result, delete the
   branch, push on go-ahead.