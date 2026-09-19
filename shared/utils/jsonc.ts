/**
 * Tolerant JSONC reader.
 *
 * OpenCode's configuration files allow comments and trailing commas. A regex
 * that strips `//` would corrupt any value containing `https://` — which the
 * user's own config has — so this is a character scanner that tracks string
 * state.
 *
 * Only the subset JSON.parse needs is removed: comments and trailing commas.
 */

function isWhitespace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r'
}

/**
 * Index of the next character that is not whitespace or comment.
 *
 * Trailing-comma detection has to look past a comment, or `[1, // note\n]`
 * would keep its comma.
 */
function nextMeaningful(input: string, from: number): number {
  let i = from
  while (i < input.length) {
    const char = input[i] as string
    if (isWhitespace(char)) {
      i++
      continue
    }
    if (char === '/' && input[i + 1] === '/') {
      while (i < input.length && input[i] !== '\n') i++
      continue
    }
    if (char === '/' && input[i + 1] === '*') {
      i += 2
      while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) i++
      i += 2
      continue
    }
    break
  }
  return i
}

/** Strip comments and trailing commas, leaving valid JSON. */
export function stripJsonc(input: string): string {
  const source = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  let out = ''
  let i = 0
  let inString = false
  let escaped = false

  while (i < source.length) {
    const char = source[i] as string

    if (inString) {
      out += char
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      i++
      continue
    }

    if (char === '"') {
      inString = true
      out += char
      i++
      continue
    }

    if (char === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++
      continue
    }

    if (char === '/' && source[i + 1] === '*') {
      i += 2
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i++
      i += 2
      continue
    }

    if (char === ',') {
      const next = source[nextMeaningful(source, i + 1)]
      if (next === '}' || next === ']') {
        i++
        continue
      }
    }

    out += char
    i++
  }

  return out
}

/** Parse a JSONC document. @throws {SyntaxError} like JSON.parse. */
export function parseJsonc<T = unknown>(input: string): T {
  return JSON.parse(stripJsonc(input)) as T
}

/** Parse without throwing, for files that may be mid-edit or malformed. */
export function tryParseJsonc<T = unknown>(
  input: string,
): { ok: true; value: T } | { ok: false; error: string } {
  try {
    return { ok: true, value: parseJsonc<T>(input) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'invalid JSONC' }
  }
}

/** Front-matter `model:` from an agent definition, if it declares one. */
export function frontMatterModel(markdown: string): string | null {
  // Only the leading `---` block counts; a `model:` in the body is prose.
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown)
  if (!match) return null
  const line = /^model:\s*(.+)$/m.exec(match[1] as string)
  return line ? (line[1] as string).trim().replace(/^["']|["']$/g, '') : null
}
