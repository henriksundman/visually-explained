import { registerPrimitive, type RenderContext } from "../core/registry"
import { codeBlockSchema, type CodeBlock } from "../core/schema"
import { escapeHtml } from "../core/inline"
import { highlightCode } from "../core/highlight"

/** Code is displayed, not interpreted: escaped verbatim (no markdown, no HTML
 *  passthrough), with a dependency-free token pass for color only. Over-long
 *  payloads truncate with a warning (schema caps at 20k — ReDoS bound). */
const MAX_RENDERED_CODE = 20000

export function renderCode(block: CodeBlock, ctx: RenderContext): string {
  let code = block.code
  if (code.length > MAX_RENDERED_CODE) {
    ctx.addWarning(`figure-code-truncated: code block truncated from ${code.length} to ${MAX_RENDERED_CODE} chars`)
    code = code.slice(0, MAX_RENDERED_CODE)
  }
  const lang = block.language
    ? `<span class="exp-code-lang">${escapeHtml(block.language)}</span>`
    : ""
  return (
    `<div class="exp-block exp-code">` +
    lang +
    `<pre><code class="exp-code-source">${highlightCode(code, block.language)}</code></pre>` +
    `</div>`
  )
}

registerPrimitive("code", { schema: codeBlockSchema, render: renderCode })
