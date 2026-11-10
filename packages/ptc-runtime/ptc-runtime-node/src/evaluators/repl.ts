/** Node REPL evaluation with declarations retained in its context. */
import { start } from 'node:repl'
import { PassThrough, Writable } from 'node:stream'
import { Parser, type Pattern, type Program } from 'acorn'
import type { ProgramEvaluator } from './types.ts'

/** Collect bound identifier names from a top-level Acorn declaration pattern. */
function collectPatternIdentifiers(pattern: Pattern, names: string[]): void {
  switch (pattern.type) {
    case 'Identifier':
      names.push(pattern.name)
      break
    case 'ObjectPattern':
      for (const property of pattern.properties) {
        collectPatternIdentifiers(property.type === 'RestElement' ? property.argument : property.value, names)
      }
      break
    case 'ArrayPattern':
      for (const element of pattern.elements) {
        if (element !== null) collectPatternIdentifiers(element, names)
      }
      break
    case 'AssignmentPattern':
      collectPatternIdentifiers(pattern.left, names)
      break
    case 'RestElement':
      collectPatternIdentifiers(pattern.argument, names)
      break
    /* v8 ignore next 2 -- Acorn declaration bindings exclude member expressions. */
    case 'MemberExpression':
      break
  }
}

/**
 * Lower top-level `const`, `let`, and `class` declarations to re-declarable `var`
 * bindings so multi-turn evaluations retain variables without failing when models reuse names.
 * Clears Node REPL lazy built-in getters shadowed by those bindings so `var` writes take effect.
 * @param code - Type-stripped JavaScript program.
 * @param context - Active REPL global context object.
 * @returns Program with top-level lexical bindings converted to var.
 */
function relaxReplDeclarations(code: string, context: Record<string, unknown>): string {
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
  const names: string[] = []
  for (const node of root.body) {
    if (node.type === 'VariableDeclaration' && (node.kind === 'const' || node.kind === 'let')) {
      edits.push({ start: node.start, end: node.start + node.kind.length, replacement: 'var' })
      for (const declarator of node.declarations) collectPatternIdentifiers(declarator.id, names)
    } else if (node.type === 'ClassDeclaration') {
      edits.push({ start: node.start, end: node.start, replacement: `var ${node.id.name} = ` })
      names.push(node.id.name)
    }
  }
  // Node REPL seeds lazy built-in module accessors (e.g. `fs`); `var` declarations do not overwrite accessors unless cleared first.
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(context, name)
    if (descriptor?.configurable && descriptor.get !== undefined) Reflect.deleteProperty(context, name)
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
      const relaxed = relaxReplDeclarations(code, repl.context)
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
