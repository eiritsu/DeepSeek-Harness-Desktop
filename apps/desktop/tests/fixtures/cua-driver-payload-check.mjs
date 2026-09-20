/** Assert the packaged native Cua Driver SDK exposes the API the provider calls. */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Resolve the packaged SDK's declared ESM entry without executing it.
 * @param root - Materialized Desktop runtime directory.
 * @returns Absolute path to the module the native provider imports.
 */
export function cuaDriverEntry(root) {
  const packageRoot = join(root, 'node_modules', '@trycua', 'cua-driver')
  const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
  const rootExport = manifest.exports?.['.']
  const entry = typeof rootExport === 'string'
    ? rootExport
    : rootExport?.import ?? rootExport?.default ?? manifest.main
  assert.equal(typeof entry, 'string', 'packaged @trycua/cua-driver declares an ESM entry')
  return resolve(packageRoot, entry)
}

/**
 * Import the packaged SDK and assert the provider's API is present. Creating a
 * driver or requesting desktop permissions is out of scope.
 * @param entry - Absolute SDK entry path from {@link cuaDriverEntry}.
 * @param load - Dynamic import function, injectable for tests.
 */
export async function checkCuaDriverApi(entry, load = specifier => import(specifier)) {
  const module = await load(pathToFileURL(entry).href)
  const CuaDriver = module.CuaDriver ?? module.default?.CuaDriver
  assert.equal(typeof CuaDriver?.create, 'function', 'packaged @trycua/cua-driver exposes CuaDriver.create')
  assert.equal(typeof CuaDriver.prototype?.listToolsJson, 'function', 'packaged @trycua/cua-driver exposes CuaDriver.listToolsJson')
}
