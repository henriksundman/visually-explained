// Zero-dependency demo server. Serves the built package (dist/) — doubles as a
// smoke test of the published artifact shape. `npm run demo` builds first.
import { createServer } from "node:http"
import { readFile } from "node:fs/promises"
import { renderExplanation, renderDocument } from "../dist/index.js"
import { educationIr, dataIr, capabilitiesIr, figuresIr, howToIr, demoDocIr } from "./examples.js"
import { MATH_CORPUS } from "./mathCorpus.js"
import { renderWithKaTeX, renderWithTemml } from "./mathEngines.js"

const port = Number(process.env.PORT ?? 4173)

/** Escape text interpolated into the comparison page. The engine output itself
 *  is trusted markup and is emitted raw; everything else goes through here. */
function escapeForPage(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function section(id, theme, ir, extraClass = "", sketch = false) {  // root:false — the section itself is the token-bearing .exp scope, so the
  // theme class on it actually governs the palette (a nested default .exp
  // root would re-declare light tokens and defeat the toggle).
  const { html } = renderExplanation(ir, { theme: "none", root: false, sketch })
  return `<section id="${id}" class="exp exp-theme-${theme}${extraClass ? ` ${extraClass}` : ""}${sketch ? " exp-sketch" : ""}">${html}</section>`
}

// Scroll-spy: mark the TOC link of the section currently in the reading band
// with aria-current="true" — the theme styles that state, so the script stays a
// dumb attribute toggle. Demo chrome only: the library's SSR output is
// script-free by contract.
const tocScrollSpy = `
<script>
(() => {
  const links = Array.from(document.querySelectorAll(".exp-doc-toc-list a"))
  if (!links.length || !("IntersectionObserver" in window)) return
  const byId = new Map(links.map(a => [a.hash.slice(1), a]))
  const inBand = new Set()
  const apply = id => {
    for (const a of links) a.removeAttribute("aria-current")
    const link = byId.get(id)
    if (link) link.setAttribute("aria-current", "true")
  }
  const io = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (e.isIntersecting) inBand.add(e.target.id)
      else inBand.delete(e.target.id)
    }
    // Topmost section in the band wins; otherwise keep the last known current.
    const head = links.map(a => a.hash.slice(1)).find(id => inBand.has(id))
    if (head) apply(head)
  // Reading line at 40% of the viewport: a section wins only once its tail
  // has scrolled ~40% up from the bottom (scrolling up) — 20% flipped while
  // the incoming section was still half-visible. The band's bottom edge is
  // inert (membership + topmost pick); it just needs to straddle the line.
  }, { rootMargin: "-40% 0px -55% 0px" })
  for (const id of byId.keys()) {
    const el = document.getElementById(id)
    if (el) io.observe(el)
  }
  // A short last section may never reach the band: mark it at page bottom.
  addEventListener("scroll", () => {
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
      apply(links[links.length - 1].hash.slice(1))
    }
  }, { passive: true })
  apply(links[0].hash.slice(1))
})()
</script>`

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>explanations — demo</title>
<link rel="stylesheet" href="/themes/tokens.css">
<link rel="stylesheet" href="/themes/light.css">
<link rel="stylesheet" href="/themes/dark.css">
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 46rem; padding: 0 1rem; }
  section { display: block; margin: 2rem 0; }
  #theme-toggle { cursor: pointer; }
  /* Token-override showcase: any consumer can re-skin without touching the
     library — just set custom properties on a wrapper. */
  .demo-tokens {
    --exp-accent: #7c3aed;
    --exp-accent-soft: #ede9fe;
    --exp-radius: 2px;
    --exp-font-size: 17px;
  }
</style>
</head>
<body>
<h1>explanations — demo</h1>
<p>One render, many looks: the education explanation starts light, the data explanation starts dark, and the toggle swaps theme classes without re-rendering.</p>
<button id="theme-toggle" type="button">Toggle theme</button>
${section("education", "light", educationIr)}
${section("data", "dark", dataIr)}
<h2>Capabilities</h2>
<p>Leniency and theming: the model below invented a <code>gauge</code> block type and emitted one broken block — the library renders a fallback and skips the rest. The second copy is the <em>same IR</em> re-skinned purely with token overrides on the wrapper.</p>
${section("capabilities", "light", capabilitiesIr)}
${section("capabilities-themed", "light", capabilitiesIr, "demo-tokens")}
<h2>Figures</h2>
<p>LLM-emitted diagram and chart blocks, a cause-effect chain drawn as an arrow figure — the same IR twice: clean strokes, then the rough.js sketch pass.</p>
<p><a href="/interactive">Interactive figures →</a> · <a href="/document">Document page →</a> · <a href="/math">Math engines →</a> · <a href="/compile">Compile demo →</a> · <a href="/editorial">Editorial showcase →</a></p>
${section("figures", "light", figuresIr)}
${section("figures-sketch", "dark", figuresIr, "", true)}
<h2>How-to</h2>
<p>A recipe-style explanation: numbered steps, the request pipeline as a diagram, a rollout chart, and the outcome as a big number with its trend sparkline.</p>
${section("howto", "light", howToIr)}
<script>
  document.getElementById("theme-toggle").addEventListener("click", () => {
    document.querySelectorAll("section.exp").forEach(el => {
      el.classList.toggle("exp-theme-light")
      el.classList.toggle("exp-theme-dark")
    })
  })
</script>
</body>
</html>`

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost")
  if (url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end(page)
    return
  }
  if (url.pathname === "/compile") {
    // Streaming demo: the shell is static; the compile runs client-side via
    // compileDocumentStream so the progression is visible in the browser.
    try {
      const html = await readFile(new URL("./compile.html", import.meta.url))
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
      res.end(html)
    } catch {
      res.writeHead(404, { "content-type": "text/plain" })
      res.end("not found")
    }
    return
  }
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
  if (url.pathname === "/document") {
    // The document root is the token-bearing .exp scope; theme "none" keeps
    // the demo chrome in charge of the page background.
    const { html } = renderDocument(demoDocIr, {
      theme: "none",
      datasets: {
        "weekly-deploys": {
          kind: "bar",
          unit: "deploys",
          points: [
            { label: "Mon", value: 4 },
            { label: "Tue", value: 9, tip: "Deploy day" },
            { label: "Wed", value: 18 },
            { label: "Thu", value: 11 },
            { label: "Fri", value: 7 },
          ],
        },
        milestones: {
          events: [
            { when: "2024-Q1", what: "Design partners", tip: "Five teams" },
            { when: "2024-Q3", what: "Beta" },
            { when: "2025-Q1", what: "GA", tip: "Host announcement" },
          ],
        },
      },
      images: {
        // Self-hosted SVG, not a remote placeholder: `alt` is the host's
        // responsibility (the model never authors it) and nothing validates it
        // against the pixels, so the demo's alt must genuinely be true of the
        // image. See open thread #2 in docs/OPEN_THREADS.md.
        "signal-station": {
          src: "/assets/signal-station.svg",
          alt: "A railway platform under a signal gantry at dusk",
          width: 800,
          height: 600,
          subject: "a train platform under a signal gantry",
        },
      },
    })
    const docPage = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>explanations — document demo</title>
<link rel="stylesheet" href="/themes/tokens.css">
<link rel="stylesheet" href="/themes/light.css">
<link rel="stylesheet" href="/themes/dark.css">
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 46rem; padding: 0 1rem; }
</style>
</head>
<body>
<p><a href="/">← all examples</a></p>
${html}
${tocScrollSpy}
</body>
</html>`
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end(docPage)
    return
  }
  if (url.pathname.startsWith("/assets/")) {
    try {
      const body = await readFile(new URL(`.${url.pathname}`, import.meta.url))
      res.writeHead(200, { "content-type": "image/svg+xml" })
      res.end(body)
    } catch {
      res.writeHead(404, { "content-type": "text/plain" })
      res.end("not found")
    }
    return
  }
  if (url.pathname === "/math") {
    // The comparison the spec exists for: MathML fidelity is only answerable
    // in a browser, so both engines render the same corpus side by side and the
    // reader picks. KaTeX needs its stylesheet AND its font files served, or
    // its column silently renders unstyled and looks like a math bug.
    const cell = (r) =>
      typeof r === "string"
        ? `<td class="exp">${r}</td>`
        : `<td class="exp"><code class="exp-math-literal">degraded: ${escapeForPage(r.error)}</code></td>`
    const rows = MATH_CORPUS.map(({ tex, note }) => {
      const head = `<th>${escapeForPage(note)}<br><code>${escapeForPage(tex)}</code></th>`
      return `<tr>${head}${cell(renderWithTemml(tex))}${cell(renderWithKaTeX(tex))}</tr>`
    }).join("")
    const mathPage = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>explanations — math engines</title>
<link rel="stylesheet" href="/themes/tokens.css">
<link rel="stylesheet" href="/themes/light.css">
<link rel="stylesheet" href="/katex/katex.min.css">
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 62rem; padding: 0 1rem; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; vertical-align: top; padding: 8px 10px; border-top: 1px solid #e5e7eb; }
  th { width: 24%; font-weight: 500; }
  code { font-size: 0.85em; color: #5c6470; }
</style>
</head>
<body>
<p><a href="/">← all examples</a> · <a href="/document">Document page →</a></p>
<h1>Math engines, side by side</h1>
<p>Left: <strong>Temml</strong> (TeX→MathML, the shipped default — no font files, themes through the
<code>--exp-math-font</code> token). Right: <strong>KaTeX</strong> (<code>trust: false</code> — needs its CSS
and 60 font files, both served here). Same corpus, same expressions. The malformed row degrades in both,
though not identically: KaTeX echoes the rejected command in red.</p>
<table>
<thead><tr><th>Expression</th><th>Temml (MathML)</th><th>KaTeX (HTML+CSS)</th></tr></thead>
<tbody>${rows}</tbody>
</table>
</body>
</html>`
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
    res.end(mathPage)
    return
  }
  if (url.pathname.startsWith("/katex/")) {
    try {
      const rel = url.pathname.slice("/katex/".length)
      const body = await readFile(new URL(`../node_modules/katex/dist/${rel}`, import.meta.url))
      // katex.min.css references woff2, woff and ttf; the content type has to
      // follow the extension or the browser rejects the font.
      const ext = rel.slice(rel.lastIndexOf(".") + 1)
      const type = { css: "text/css", woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf" }[ext]
      if (!type) {
        res.writeHead(404, { "content-type": "text/plain" })
        res.end("not found")
        return
      }
      res.writeHead(200, { "content-type": type })
      res.end(body)
    } catch {
      res.writeHead(404, { "content-type": "text/plain" })
      res.end("not found")
    }
    return
  }
  if (url.pathname.startsWith("/themes/")) {
    try {
      const css = await readFile(new URL(`../dist${url.pathname}`, import.meta.url))
      res.writeHead(200, { "content-type": "text/css; charset=utf-8" })
      res.end(css)
    } catch {
      res.writeHead(404, { "content-type": "text/plain" })
      res.end("not found")
    }
    return
  }
  if (url.pathname === "/interactive") {
    try {
      const html = await readFile(new URL("./interactive.html", import.meta.url))
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
      res.end(html)
    } catch {
      res.writeHead(404, { "content-type": "text/plain" })
      res.end("not found")
    }
    return
  }
  if (url.pathname === "/examples.js") {
    const js = await readFile(new URL("./examples.js", import.meta.url))
    res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" })
    res.end(js)
    return
  }
  if (url.pathname === "/compileClient.js") {
    const js = await readFile(new URL("./compileClient.js", import.meta.url))
    res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" })
    res.end(js)
    return
  }
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
  if (url.pathname === "/index.js") {
    const js = await readFile(new URL("../dist/index.js", import.meta.url))
    res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" })
    res.end(js)
    return
  }
  if (url.pathname.startsWith("/react/")) {
    try {
      const js = await readFile(new URL(`../dist${url.pathname}`, import.meta.url))
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" })
      res.end(js)
    } catch {
      res.writeHead(404, { "content-type": "text/plain" })
      res.end("not found")
    }
    return
  }
  res.writeHead(404, { "content-type": "text/plain" })
  res.end("not found")
})

server.listen(port, () => {
  console.log(`Demo running at http://localhost:${port}`)
})
