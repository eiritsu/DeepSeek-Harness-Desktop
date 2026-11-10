import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { formatTypeScriptSyntaxError } from '../src/syntax-diagnostic.ts'
import { mountRuntime } from './setup.ts'

describe('formatTypeScriptSyntaxError', () => {
  it('pinpoints unclosed single/double quotes across newlines and removes wrapper offset', async () => {
    const { runtime } = await mountRuntime(new Context())
    const policy = runtime['ctx'].sandboxPolicy.resolve()
    const spec = runtime.resolve({
      sandboxPolicy: policy,
      program: [
        'const a = await tools.edit({',
        '  old_string: \'if (x) {',
        '  return 1;',
        '}\',',
        '});',
      ].join('\n'),
      bindings: [],
    })
    const result = await runtime.run(spec)
    expect(result.error?.kind).toBe('exception')
    const message = result.error?.message ?? ''
    expect(message).toContain('ptc-program.ts:')
    expect(message).not.toContain('async function __dsh_program__()')
    expect(message).not.toContain('at parseTypeScript')
    expect(message).toContain('SyntaxError:')
    expect(message).toContain('Note: Unclosed string literal started at line 2, column 15:')
    expect(message).toContain('Hint: Single-quoted')
  })

  it('pinpoints Python triple quotes and unescaped quotes with ^ pointers', async () => {
    const { runtime } = await mountRuntime(new Context())
    const policy = runtime['ctx'].sandboxPolicy.resolve()

    const triple = await runtime.run(runtime.resolve({
      sandboxPolicy: policy,
      program: "await tools.write({ file_path: 'a.py', content: '''import os\n''' })",
      bindings: [],
    }))
    expect(triple.error?.message).toContain('Python triple-quoted string')

    const contraction = await runtime.run(runtime.resolve({
      sandboxPolicy: policy,
      program: "console.log({ msg: 'don't fail' });",
      bindings: [],
    }))
    expect(contraction.error?.message).toContain('ptc-program.ts:1')
    expect(contraction.error?.message).toContain("SyntaxError: Expected ','")
    expect(contraction.error?.message).toContain('Hint: Check the line marked with ^')
  })

  it('reports syntax errors cleanly in REPL mode without line offsets and handles long single lines', async () => {
    const { runtime } = await mountRuntime(new Context(), { executionMode: 'persistent-in-memory' })
    const policy = runtime['ctx'].sandboxPolicy.resolve()
    const padding = 'x'.repeat(260)
    const longSingleLine = `const a = "${padding}"; const b = await tools.bash({ cmd: 'echo don't break ${padding}' });`
    const res = await runtime.run(runtime.resolve({
      sandboxPolicy: policy,
      program: longSingleLine,
      bindings: [],
    }))
    expect(res.error?.kind).toBe('exception')
    const msg = res.error?.message ?? ''
    expect(msg).toContain('ptc-program.ts:1')
    expect(msg).toContain('...')
    expect(msg).toContain('^')
    expect(msg).toContain("SyntaxError: Expected ','")
  })

  it('handles EOF unclosed quotes, hashbangs, non-comma syntax errors, and direct helper edge cases', () => {
    const eofErr = new SyntaxError('Expected \',\', got \'<eof>\'')
    eofErr.stack = ':3\nconst x = "unclosed\n}\n\nSyntaxError: Expected \',\', got \'<eof>\'\n    at parseTypeScript'
    const formattedEof = formatTypeScriptSyntaxError(eofErr, '#!/usr/bin/env node\nconst x = "unclosed', 1)
    expect(formattedEof.message).toContain('ptc-program.ts:2')
    expect(formattedEof.message).not.toContain('\n}\n')
    expect(formattedEof.message).toContain('Note: Unclosed string literal started at line 2, column 11.')

    const longErr = new SyntaxError('Unexpected token')
    longErr.stack = `:1\n${'a'.repeat(300)}\n\nSyntaxError: Unexpected token`
    const formattedLong = formatTypeScriptSyntaxError(longErr, 'a'.repeat(300), 0)
    expect(formattedLong.message).toContain(`${'a'.repeat(240)}...`)
    expect(formattedLong.message).toContain('SyntaxError: Unexpected token')

    const longCaretStart = new SyntaxError('Unexpected token')
    longCaretStart.stack = `:1\n${'b'.repeat(300)}\n  ^\n\nSyntaxError: Unexpected token`
    const formattedStart = formatTypeScriptSyntaxError(longCaretStart, 'b'.repeat(300), 0)
    expect(formattedStart.message).toContain('...')
    expect(formattedStart.message).not.toContain('...bbb')

    const longCaretEnd = new SyntaxError('Unexpected token')
    longCaretEnd.stack = `:1\n${'c'.repeat(300)}\n${' '.repeat(295)}^\n\nSyntaxError: Unexpected token`
    const formattedEnd = formatTypeScriptSyntaxError(longCaretEnd, 'c'.repeat(300), 0)
    expect(formattedEnd.message.startsWith('ptc-program.ts:1\n...')).toBe(true)
    expect(formattedEnd.message).not.toContain('ccc...')

    const emptyHeader = new SyntaxError('Bad')
    emptyHeader.stack = ':1\n    at something'
    expect(formatTypeScriptSyntaxError(emptyHeader, 'const =', 0).message).toBe('ptc-program.ts:1\n\nSyntaxError: Bad')

    const noLocStack = new SyntaxError('plain')
    noLocStack.stack = 'SyntaxError: plain\n    at foo'
    expect(formatTypeScriptSyntaxError(noLocStack, 'foo', 0)).toBe(noLocStack)

    const undefinedStack = new SyntaxError('empty-stack')
    Object.defineProperty(undefinedStack, 'stack', { value: undefined })
    expect(formatTypeScriptSyntaxError(undefinedStack, 'foo', 0)).toBe(undefinedStack)

    const plainError = new Error('boom')
    expect(formatTypeScriptSyntaxError(plainError, 'foo', 0)).toBe(plainError)
    expect(formatTypeScriptSyntaxError('raw-string', 'foo', 0).message).toBe('raw-string')
  })
})
