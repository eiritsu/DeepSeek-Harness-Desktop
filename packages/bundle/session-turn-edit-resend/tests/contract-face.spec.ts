/**
 * The bundle's browser-facing contract outlet must not load the Host Session
 * entry. `@deepseek-ai/dsh-session` merges `Context.sessions: SessionStore`, and
 * the Client program declares the same key as the API `ISessions`; whichever
 * declaration the compiler sees first wins silently under `skipLibCheck`. A
 * bare host import reachable from the contract therefore flips `ctx.sessions`
 * to the Host store for every client package. The contract imports leaf modules
 * (`@deepseek-ai/dsh-session/types`) instead, which carry no `Context` merge.
 */

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../../../..', import.meta.url))
const CONTRACT = 'packages/bundle/session-turn-edit-resend/src/types.ts'
/** The Host entry that carries the `SessionStore` `Context` merge. */
const HOST_SESSION_ENTRY = '/packages/core/session/src/index.ts'

/** Compiler options from the repository base config, resolved against the root. */
function baseCompilerOptions(): ts.CompilerOptions {
  const read: { config?: unknown; error?: ts.Diagnostic } = ts.readConfigFile(
    resolve(root, 'tsconfig.base.json'),
    path => ts.sys.readFile(path),
  )
  if (read.error !== undefined) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'))
  if (typeof read.config !== 'object' || read.config === null) throw new Error('tsconfig.base.json is not an object')
  const { compilerOptions } = read.config as { compilerOptions?: unknown }
  const parsed = ts.convertCompilerOptionsFromJson(compilerOptions, root)
  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors.map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n'))
  }
  return parsed.options
}

describe('turn edit and resend contract outlet', () => {
  it('loads no Host Session entry from the browser-facing types module', () => {
    const program = ts.createProgram([resolve(root, CONTRACT)], baseCompilerOptions())
    const loaded = program.getSourceFiles().map(file => file.fileName.replaceAll('\\', '/'))
    expect(loaded.filter(file => file.endsWith(HOST_SESSION_ENTRY))).toEqual([])
  })
})
