// Zero-dependency demo server. Serves the built package (dist/) — doubles as a
// smoke test of the published artifact shape. `npm run demo` builds first.
import { createServer } from "node:http"
import { readFile } from "node:fs/promises"
import { renderExplanation } from "../dist/index.js"
import { educationIr, dataIr, capabilitiesIr, figuresIr, howToIr } from "./examples.js"

const port = Number(process.env.PORT ?? 4173)

function section(id, theme, ir, extraClass = "", sketch = false) {
  // root:false — the section itself is the token-bearing .exp scope, so the
  // theme class on it actually governs the palette (a nested default .exp
  // root would re-declare light tokens and defeat the toggle).
  const { html } = renderExplanation(ir, { theme: "none", root: false, sketch })
  return `<section id="${id}" class="exp exp-theme-${theme}${extraClass ? ` ${extraClass}` : ""}${sketch ? " exp-sketch" : ""}">${html}</section>`
}

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
<p><a href="/interactive">Interactive figures →</a></p>
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
