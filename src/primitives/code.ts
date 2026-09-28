import { registerPrimitive, type RenderContext } from "../core/registry"
import { codeBlockSchema, type CodeBlock } from "../core/schema"
import { escapeHtml } from "../core/inline"

/** Code is displayed, not interpreted: everything is escaped verbatim — no
 *  inline markdown, no HTML passes through (spec: library-wide escaping rule). */
export function renderCode(block: CodeBlock, _ctx: RenderContext): string {
  const lang = block.language
    ? `<span class="exp-code-lang">${escapeHtml(block.language)}</span>`
    : ""
  return (
    `<div class="exp-block exp-code">` +
    lang +
    `<pre><code class="exp-code-source">${escapeHtml(block.code)}</code></pre>` +
    `</div>`
  )
}

registerPrimitive("code", { schema: codeBlockSchema, render: renderCode })
