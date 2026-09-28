import { escapeHtml } from "./inline"

/** Dependency-free single-pass tokenizer for the code primitive.
 *  One regex, no DOM, deterministic — output is escaped HTML with
 *  .exp-tok-* spans. Comments need a language hint only for `#`
 *  (c-family keeps `#` plain; python/ruby/shell/yaml treat it as a comment). */

type TokenClass = "key" | "lit" | "num" | "str" | "com"

const KEYWORDS = new Set([
  "var", "let", "const", "function", "return", "if", "else", "for", "while", "import", "from",
  "export", "default", "class", "extends", "new", "await", "async", "try", "catch", "finally",
  "throw", "switch", "case", "break", "continue", "typeof", "instanceof", "in", "of", "do",
  "yield", "static", "get", "set", "def", "lambda", "pass", "raise", "with", "as", "elif",
  "end", "module", "require", "then", "elsif", "unless", "func", "go", "defer", "select",
  "range", "map", "struct", "interface", "package", "public", "private", "protected", "void",
  "fn", "impl", "match", "loop",
])

const LITERALS = new Set(["true", "false", "null", "undefined", "nil", "none", "True", "False", "None"])

const LANGS_WITH_HASH_COMMENTS = new Set(["python", "py", "ruby", "rb", "sh", "bash", "shell", "yaml", "yml", "toml", "r"])

const TOKEN_RE =
  /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*|--[^\n]*|"(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?|`(?:[^`\\]|\\.)*`?|\b\d+(?:\.\d+)?\b|\b[a-zA-Z_$][\w$]*\b)/g

export function highlightCode(source: string, language?: string): string {
  const hashComments = !!language && LANGS_WITH_HASH_COMMENTS.has(language.toLowerCase())
  let out = ""
  let last = 0
  for (const m of source.matchAll(TOKEN_RE)) {
    const idx = m.index ?? 0
    const tok = m[0]
    out += escapeHtml(source.slice(last, idx))
    last = idx + tok.length
    out += tokenSpan(tok, hashComments)
  }
  out += escapeHtml(source.slice(last))
  return out
}

function tokenSpan(tok: string, hashComments: boolean): string {
  const cls = classify(tok, hashComments)
  return cls ? `<span class="exp-tok-${cls}">${escapeHtml(tok)}</span>` : escapeHtml(tok)
}

function classify(tok: string, hashComments: boolean): TokenClass | null {
  if (tok.startsWith("//") || tok.startsWith("/*")) return "com"
  if (tok.startsWith("#")) return hashComments ? "com" : null
  if (tok.startsWith("--")) return "com"
  const first = tok[0]
  if (first === '"' || first === "'" || first === "`") return "str"
  if (/^\d/.test(tok)) return "num"
  if (KEYWORDS.has(tok)) return "key"
  if (LITERALS.has(tok)) return "lit"
  return null
}
