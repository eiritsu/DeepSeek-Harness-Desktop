/** Format Node TypeScript erasure syntax failures with source locations and quoting hints. */
import { Parser } from 'acorn'

const MAX_SNIPPET_LINE_CHARS = 240
const CARET_HALF_WINDOW = 100
const CARET_LINE_PATTERN = /^ *\^+$/
const STACK_LINE_PREFIX_PATTERN = /^:(\d+)\r?\n/

/** Clip an oversized line and matching caret line around the pointer column. */
function clipLineWithCaret(line: string, caretLine: string): [string, string] {
  if (line.length <= MAX_SNIPPET_LINE_CHARS && caretLine.length <= MAX_SNIPPET_LINE_CHARS) {
    return [line, caretLine]
  }
  const firstCaret = caretLine.indexOf('^')
  const windowStart = Math.max(0, firstCaret - CARET_HALF_WINDOW)
  const windowEnd = Math.min(Math.max(line.length, caretLine.length), windowStart + MAX_SNIPPET_LINE_CHARS)
  const prefix = windowStart > 0 ? '...' : ''
  const suffix = windowEnd < line.length ? '...' : ''
  return [
    `${prefix}${line.slice(windowStart, windowEnd)}${suffix}`,
    `${' '.repeat(prefix.length)}${caretLine.slice(windowStart, windowEnd)}`,
  ]
}

/** Clip every line in a rendered code snippet, pairing each line with its caret row when present. */
function clipSnippetLines(lines: readonly string[]): string[] {
  const result: string[] = []
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] as string
    const next = lines[index + 1]
    if (next !== undefined && CARET_LINE_PATTERN.test(next)) {
      result.push(...clipLineWithCaret(line, next))
      index += 1
    } else {
      result.push(line.length <= MAX_SNIPPET_LINE_CHARS ? line : `${line.slice(0, MAX_SNIPPET_LINE_CHARS)}...`)
    }
  }
  return result
}

/** Remove synthetic wrapper lines added by `per-call` function-body compilation. */
function stripWrapperLines(lines: readonly string[], rawLine: number, programLineCount: number, lineOffset: number): string[] {
  if (lineOffset === 0) return [...lines]
  const cleaned = [...lines]
  if (cleaned[0] === 'async function __dsh_program__() {') cleaned.shift()
  if (cleaned[cleaned.length - 1] === '}' && rawLine >= programLineCount + lineOffset) cleaned.pop()
  return cleaned
}

/** Read a 1-based line and 0-based column from an Acorn `SyntaxError` when present. */
interface AcornSyntaxError extends SyntaxError {
  readonly loc?: { readonly line: number; readonly column: number }
}

/** Detect unclosed string constants or quote mismatches and return targeted recovery guidance. */
function buildSyntaxHints(program: string, programLines: readonly string[], errorLine: number, errorMessage: string): string[] {
  try {
    const source = program.startsWith('#!') ? `//${program.slice(2)}` : program
    Parser.parse(source, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
    })
  } catch (error: unknown) {
    if (error instanceof SyntaxError && error.message.startsWith('Unterminated string constant')) {
      const loc = (error as AcornSyntaxError).loc
      /* v8 ignore next -- Acorn always attaches `loc` on SyntaxError. */
      if (loc !== undefined) {
        const lineText = programLines[loc.line - 1] ?? ''
        const around = lineText.slice(Math.max(0, loc.column - 2), loc.column + 4)
        if (around.includes("'''") || around.includes('"""')) {
          return [
            `Note: Python triple-quoted string (''' or """) started at line ${loc.line}, column ${loc.column + 1}.`,
            'Hint: JavaScript/TypeScript does not support Python triple quotes; use backtick template literals (`...`).',
          ]
        }
        if (loc.line < errorLine) {
          const [clipped] = clipLineWithCaret(lineText, `${' '.repeat(loc.column)}^`)
          return [
            `Note: Unclosed string literal started at line ${loc.line}, column ${loc.column + 1}:`,
            clipped,
            'Hint: Single-quoted (\'...\') and double-quoted ("...") JS strings cannot span raw newlines (a single \\n in tool JSON decodes to a raw newline). Use backtick template literals (`...`, escaping inner ` and ${...}) or write \\\\n in JSON.',
          ]
        }
        return [
          `Note: Unclosed string literal started at line ${loc.line}, column ${loc.column + 1}.`,
          'Hint: Ensure quotes (\' or ") are closed and inner quotes of the same kind are escaped.',
        ]
      }
    }
  }
  if (errorMessage.includes("Expected ','")) {
    return [
      'Hint: Check the line marked with ^ for an unescaped quote (\' or "), a raw newline inside \'...\'/"..." (use `...` or \\\\n in JSON), or non-JS syntax.',
    ]
  }
  return []
}

/**
 * Format a `stripTypeScriptTypes` syntax error with cleaned line numbers, bounded code context,
 * and actionable recovery hints when strings or quotes break parsing.
 * @param error - Value thrown by `stripTypeScriptTypes`.
 * @param program - Original unwrapped model-submitted TypeScript/JavaScript source.
 * @param lineOffset - Synthetic lines prepended before `program` (1 for `per-call`, 0 otherwise).
 * @returns `SyntaxError` carrying readable location diagnostics when parse location is present, else an `Error`.
 */
export function formatTypeScriptSyntaxError(error: unknown, program: string, lineOffset: number): Error {
  if (!(error instanceof SyntaxError)) {
    return error instanceof Error ? error : new Error(String(error))
  }
  const stack = error.stack ?? ''
  const lineMatch = STACK_LINE_PREFIX_PATTERN.exec(stack)
  if (lineMatch === null) return error

  const rawLine = Number(lineMatch[1])
  const programLines = program.split(/\r?\n/)
  const errorLine = Math.min(programLines.length, Math.max(1, rawLine - lineOffset))

  const messageIndex = stack.indexOf('\nSyntaxError')
  const rawHeader = messageIndex >= 0 ? stack.slice(lineMatch[0].length, messageIndex) : ''
  const headerLines = rawHeader.trimEnd() === '' ? [] : rawHeader.trimEnd().split(/\r?\n/)
  const snippetLines = clipSnippetLines(stripWrapperLines(headerLines, rawLine, programLines.length, lineOffset))
  const hints = buildSyntaxHints(program, programLines, errorLine, error.message)

  const parts = [`ptc-program.ts:${errorLine}`]
  if (snippetLines.length > 0) parts.push(...snippetLines)
  parts.push('', `SyntaxError: ${error.message}`)
  if (hints.length > 0) parts.push(...hints)
  return new SyntaxError(parts.join('\n'), { cause: error })
}
