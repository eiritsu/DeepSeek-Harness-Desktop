/**
 * Shared model facts for the whole harness (`ctx.modelCatalog`).
 *
 * Every channel that serves a model reads the same canonical record for it,
 * so two routes naming one model report the same modalities, the same context
 * window, and the same output ceiling. What a channel can *encode* stays the
 * channel's own: the catalog reports the levels one channel declares it
 * accepts, and the adapter intersects that with what its transport can send.
 *
 * The catalog is an optional enhancement over each adapter's built-in facts,
 * not a replacement for them: a route pi-ai already describes keeps working
 * without this service, and a route the catalog has never heard of keeps the
 * facts its own configuration declared.
 *
 * @module @deepseek-ai/dsh-model-catalog
 */

import { SharedModelCatalog } from './service.ts'

export { Config, DEFAULT_CATALOG_URL, DEFAULT_MAX_RESPONSE_BYTES, DEFAULT_REFRESH_INTERVAL_MS, DEFAULT_REQUEST_TIMEOUT_MS, resolveConfig } from './config.ts'
export type { ResolvedConfig } from './config.ts'
export { EMPTY_FACTS } from './facts.ts'
export type { ModelFacts, ModelFactsRequest, ModelFactsView } from './facts.ts'
export { parseCatalogDocument } from './parse.ts'
export type { CanonicalRecord, ChannelEfforts, ParsedCatalog } from './parse.ts'
export { CatalogView, validateAliases } from './resolve.ts'
export type { CatalogAlias } from './resolve.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Canonical model facts shared by every channel, from the last good catalog read. */
    modelCatalog: SharedModelCatalog
  }
}

export default SharedModelCatalog
