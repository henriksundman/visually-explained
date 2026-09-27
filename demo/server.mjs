// Zero-dependency demo server. Serves the built package (dist/) — doubles as a
// smoke test of the published artifact shape. `npm run demo` builds first.
import { createServer } from "node:http"
import { readFile } from "node:fs/promises"
import { renderExplanation } from "../dist/index.js"
import { educationIr, dataIr } from "./examples.js"

const port = Number(process.env.PORT ?? 4173)

function section(id, theme, ir) {
  const { html } = renderExplanation(ir, { theme: "none" })
  return `<section id="${id}" class="exp exp-theme-${theme}">${html}</section>`
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
</style>
</head>
<body>
<h1>explanations — demo</h1>
<p>One render, two themes: the education explanation starts light, the data explanation starts dark. The toggle swaps the theme classes.</p>
<button id="theme-toggle" type="button">Toggle theme</button>
${section("education", "light", educationIr)}
${section("data", "dark", dataIr)}
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
  res.writeHead(404, { "content-type": "text/plain" })
  res.end("not found")
})

server.listen(port, () => {
  console.log(`Demo running at http://localhost:${port}`)
})
