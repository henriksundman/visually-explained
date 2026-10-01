export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/** Renders the v1 inline subset: **bold**, *italic*, `code`, [label](href).
 * Code spans are split out first so their content is never further processed;
 * everything is HTML-escaped, so no raw HTML can pass through and attribute
 * breakout is structurally impossible. Link hrefs are scheme-gated (https,
 * http, mailto, #anchor — after stripping control chars and spaces, the same
 * normalization browsers apply, which kills `jav\tascript:`); anything else
 * degrades to literal text. Nesting is not supported beyond emphasis inside
 * labels; markers render literally when unmatched. */
const LINK_RE = /\[([^\]]+)\]\(([^)\s]+)\)/g

function safeHref(href: string): string | null {
  const normalized = href.replace(/[\u0000-\u0020]/g, "")
  // A raw "<" in the candidate can only be emphasis markup that leaked into
  // the URL (a paired *…* before the link pass) — real "<" arrives escaped as
  // &lt;. Degrade the link to literal text rather than emit a corrupted href.
  if (normalized.includes("<")) return null
  if (/^https:/i.test(normalized)) return normalized
  if (/^http:/i.test(normalized)) return normalized
  if (/^mailto:/i.test(normalized)) return normalized
  if (normalized.startsWith("#")) return normalized
  return null
}

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
      out = out.replace(LINK_RE, (src: string, label: string, href: string): string => {
        const target = safeHref(href)
        if (target === null) return src
        return `<a href="${target}">${label}</a>`
      })
      return out
    })
    .join("")
}
