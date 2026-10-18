/**
 * Configuration for the model catalog. Every value here is a deployment
 * choice: which document to read, how often to re-read it, how long one
 * request may take, how large a body may be, and which route-local model ids
 * the deployment names explicitly.
 *
 * @module @deepseek-ai/dsh-model-catalog/src/config
 */

import schema from '@deepseek-ai/schemastery'
import type { CatalogAlias } from './resolve.ts'

export type { CatalogAlias } from './resolve.ts'

/** The canonical models.dev catalog document. */
export const DEFAULT_CATALOG_URL = 'https://models.dev/catalog.json?type=all'

/** How long a successfully read document stays fresh, in milliseconds. */
export const DEFAULT_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000

/** Longest wait for one catalog request, in milliseconds. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000

/** Largest response body this package will read, in bytes. */
export const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024

/** Refresh and resolution configuration. */
export interface Config {
  /** JSON document carrying canonical models and per-channel model entries. */
  catalogURL?: string
  /** Route-local model ids mapped onto qualified canonical ids. */
  aliases?: CatalogAlias[]
  /** Time a successfully read document stays fresh, in milliseconds. */
  refreshIntervalMs?: number
  /** Longest wait for one request, in milliseconds. */
  requestTimeoutMs?: number
  /** Largest response body read, in bytes. */
  maxResponseBytes?: number
}

/** Validated plugin configuration. */
export const Config: schema<Config> = schema.object({
  catalogURL: schema.string().default(DEFAULT_CATALOG_URL),
  aliases: schema.array(schema.object({
    ownedBy: schema.string().description('Upstream owner this mapping belongs to; omit to match any owner.'),
    modelId: schema.string().required().description('Model id the serving route uses.'),
    canonicalId: schema.string().required().description('Qualified owner/model identifier from the catalog.'),
  })).default([]),
  refreshIntervalMs: schema.number().step(1).min(1).default(DEFAULT_REFRESH_INTERVAL_MS),
  requestTimeoutMs: schema.number().step(1).min(1).default(DEFAULT_REQUEST_TIMEOUT_MS),
  maxResponseBytes: schema.number().step(1).min(1).default(DEFAULT_MAX_RESPONSE_BYTES),
})

/** Configuration with every default materialized, as the service reads it. */
export interface ResolvedConfig {
  /** JSON document carrying canonical models and per-channel model entries. */
  catalogURL: string
  /** Route-local model ids mapped onto qualified canonical ids. */
  aliases: readonly CatalogAlias[]
  /** Time a successfully read document stays fresh, in milliseconds. */
  refreshIntervalMs: number
  /** Longest wait for one request, in milliseconds. */
  requestTimeoutMs: number
  /** Largest response body read, in bytes. */
  maxResponseBytes: number
}

/**
 * Materialize the deployment's configuration.
 *
 * Every default is applied here, once, so nothing downstream reads a field
 * that may be absent: a service method that could observe two shapes is a
 * service method with two behaviours.
 * @param config - the validated plugin configuration.
 * @returns the configuration with every default applied.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  return {
    catalogURL: config.catalogURL ?? DEFAULT_CATALOG_URL,
    aliases: (config.aliases ?? []).map(alias => ({ ...alias })),
    refreshIntervalMs: config.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS,
    requestTimeoutMs: config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    maxResponseBytes: config.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
  }
}
