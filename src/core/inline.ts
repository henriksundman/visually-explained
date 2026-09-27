export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/**
 * Renders the v1 inline subset: **bold**, *italic*, `code`.
 * Code spans are split out first so their content is never
 * further processed; everything is HTML-escaped, so no raw
 * HTML can pass through. Nesting is not supported in v1;
 * markers render literally when unmatched.
 */
export function renderInline(text: string): string {
  const parts = text.split(/(`[^`]+`)/g)
  return parts
    .map(part => {
      if (part.length >= 2 && part.startsWith("`") && part.endsWith("`")) {
        return `<code>${escapeHtml(part.slice(1, -1))}</code>`
      }
      let out = escapeHtml(part)
      out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      out = out.replace(/\*([^*]+)\*/g, "<em>$1</em>")
      return out
    })
    .join("")
}
