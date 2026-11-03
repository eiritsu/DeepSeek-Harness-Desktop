/** Node REPL evaluation with declarations retained in its context. */
import { start } from 'node:repl'
import { PassThrough, Writable } from 'node:stream'
import { Parser, type Program } from 'acorn'
import type { ProgramEvaluator } from './types.ts'

/**
 * Lower top-level `const`, `let`, and `class` declarations to re-declarable `var`
 * bindings so multi-turn evaluations retain variables without failing when models reuse names.
 * @param code - Type-stripped JavaScript program.
 * @returns Program with top-level lexical bindings converted to var.
 */
function relaxReplDeclarations(code: string): string {
  let root: Program
  try {
    const source = code.startsWith('#!') ? `//${code.slice(2)}` : code
    root = Parser.parse(source, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
    })
  } catch {
    return code
  }
  const edits: { start: number; end: number; replacement: string }[] = []
  for (const node of root.body) {
    if (node.type === 'VariableDeclaration' && (node.kind === 'const' || node.kind === 'let')) {
      edits.push({ start: node.start, end: node.start + node.kind.length, replacement: 'var' })
    } else if (node.type === 'ClassDeclaration' && node.id?.type === 'Identifier') {
      edits.push({ start: node.start, end: node.start, replacement: `var ${node.id.name} = ` })
    }
  }
  if (edits.length === 0) return code
  edits.sort((a, b) => b.start - a.start)
  let result = code
  for (const edit of edits) {
    result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end)
  }
  return result
}

/**
 * Create a REPL whose globals survive sequential evaluations until close.
 * @param reportError - REPL diagnostics attributed to the active evaluation.
 * @returns Retained globals, asynchronous evaluation and REPL cleanup.
 */
export function createReplEvaluator(reportError: (message: string) => void): ProgramEvaluator {
  const input = new PassThrough()
  const output = new Writable({ write(chunk: Buffer, _encoding, callback) {
    const message = chunk.toString().trim()
    if (message) reportError(message)
    callback()
  } })
  const repl = start({ input, output, terminal: false, prompt: '', useGlobal: false, ignoreUndefined: true })
  // Interactive result setters print notices; program assignments use ordinary retained globals.
  for (const name of ['_', '_error']) {
    Object.defineProperty(repl.context, name, { configurable: true, enumerable: true, writable: true, value: undefined })
  }
  return {
    globals: repl.context,
    evaluate(code, finish) {
      const relaxed = relaxReplDeclarations(code)
      // Node's REPL treats a leading brace as an object expression before transforming await.
      const program = relaxed.trimStart().startsWith('{') ? `;${relaxed}` : relaxed
      repl.eval(`${program}\n`, repl.context, 'ptc-repl', (error: Error | null, value: unknown) => {
        finish(error ? { ok: false, error } : { ok: true, value })
      })
    },
    close() {
      repl.close()
      input.destroy()
      output.destroy()
    },
  }
}
