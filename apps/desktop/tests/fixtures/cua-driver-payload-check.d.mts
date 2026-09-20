/** Typed surface of {@link ./cua-driver-payload-check.mjs} for TypeScript tests. */

/**
 * Resolve the packaged SDK's declared ESM entry without executing it.
 * @param root - Materialized Desktop runtime directory.
 * @returns Absolute path to the module the native provider imports.
 */
export function cuaDriverEntry(root: string): string

/**
 * Import the packaged SDK and assert the provider's API is present.
 * @param entry - Absolute SDK entry path.
 * @param load - Dynamic import function, injectable for tests.
 */
export function checkCuaDriverApi(entry: string, load?: (specifier: string) => Promise<unknown>): Promise<void>
