import { registerPrimitive, type RenderContext } from "../core/registry"
import { codeBlockSchema, type CodeBlock } from "../core/schema"
import { escapeHtml } from "../core/inline"
import { highlightCode } from "../core/highlight"

/** Code is displayed, not interpreted: escaped verbatim (no markdown, no HTML
 *  passthrough), with a dependency-free token pass for color only. */
export function renderCode(block: CodeBlock, _ctx: RenderContext): string {
  const lang = block.language
    ? `<span class="exp-code-lang">${escapeHtml(block.language)}</span>`
    : ""
  return (
    `<div class="exp-block exp-code">` +
    lang +
    `<pre><code class="exp-code-source">${highlightCode(block.code, block.language)}</code></pre>` +
    `</div>`
  )
}

registerPrimitive("code", { schema: codeBlockSchema, render: renderCode })
