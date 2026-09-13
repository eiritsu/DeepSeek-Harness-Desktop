/** Generate Host Typert declarations required before a clean Host TypeScript build. */

import { resolve } from 'node:path'
import { typertPlugin } from '../packages/typert/generator/src/tsdown-plugin.ts'

/**
 * Emit the Host reflection and Remote Client declarations consumed by the Host aggregate.
 * @param root - Workspace root containing `tsconfig.host.json`.
 * @returns Nothing after every current Host contributor has been emitted.
 */
export function bootstrapHostTypert(root: string): void {
  typertPlugin({ mode: 'workspace', faces: ['host'] }).writeBundle({ dir: resolve(root, 'lib') })
}

if (import.meta.main) bootstrapHostTypert(resolve(import.meta.dirname, '..'))
