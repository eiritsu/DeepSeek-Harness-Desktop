/** Shared secret-free provider catalog. */
export interface ExternalToolCatalogEntry {
  readonly id: string
  readonly displayName: string
  readonly description: string
  readonly descriptionKey: ExternalToolDescriptionKey
  readonly capabilities: readonly string[]
  readonly credentialRef: string
  readonly baseURL?: string
  readonly toolName?: string
}

/** Locale keys for provider descriptions rendered by the Client settings page. */
export type ExternalToolDescriptionKey =
  | 'externalToolsProvider.brave-search' | 'externalToolsProvider.tavily'
  | 'externalToolsProvider.firecrawl' | 'externalToolsProvider.exa'
  | 'externalToolsProvider.github' | 'externalToolsProvider.fal'
  | 'externalToolsProvider.elevenlabs' | 'externalToolsProvider.browserbase'

/** Default order for the provider-neutral native web search adapter. */
export const DEFAULT_SEARCH_PRIORITY = ['tavily', 'brave-search', 'exa'] as const

/**
 * Return whether an external provider implements the provider-neutral web seam.
 * @param id - catalog provider id.
 * @returns whether the provider participates in native web search selection.
 */
export function isNativeSearchProvider(id: string): boolean {
  return (DEFAULT_SEARCH_PRIORITY as readonly string[]).includes(id)
}

/** Secret-free catalog entries shown by the settings surface. */
export const EXTERNAL_TOOL_CATALOG: readonly ExternalToolCatalogEntry[] = [
  { id: 'brave-search', displayName: 'Brave Search', description: 'Privacy-oriented web search.', descriptionKey: 'externalToolsProvider.brave-search', capabilities: ['search'], credentialRef: 'BRAVE_SEARCH_API_KEY', baseURL: 'https://api.search.brave.com', toolName: 'brave_search' },
  { id: 'tavily', displayName: 'Tavily', description: 'Agent-oriented search with summaries.', descriptionKey: 'externalToolsProvider.tavily', capabilities: ['search'], credentialRef: 'TAVILY_API_KEY', baseURL: 'https://api.tavily.com', toolName: 'tavily_search' },
  { id: 'firecrawl', displayName: 'Firecrawl', description: 'Fetch web pages as Markdown.', descriptionKey: 'externalToolsProvider.firecrawl', capabilities: ['extract'], credentialRef: 'FIRECRAWL_API_KEY', baseURL: 'https://api.firecrawl.dev', toolName: 'firecrawl_extract' },
  { id: 'exa', displayName: 'Exa', description: 'Semantic search and research.', descriptionKey: 'externalToolsProvider.exa', capabilities: ['search'], credentialRef: 'EXA_API_KEY', baseURL: 'https://api.exa.ai', toolName: 'exa_search' },
  { id: 'github', displayName: 'GitHub', description: 'Search GitHub repositories and code.', descriptionKey: 'externalToolsProvider.github', capabilities: ['repository', 'search'], credentialRef: 'GITHUB_TOKEN', baseURL: 'https://api.github.com', toolName: 'github_search' },
  { id: 'fal', displayName: 'FAL', description: 'Generate images and media.', descriptionKey: 'externalToolsProvider.fal', capabilities: ['image', 'video'], credentialRef: 'FAL_KEY', baseURL: 'https://fal.run' },
  { id: 'elevenlabs', displayName: 'ElevenLabs', description: 'Generate speech and audio.', descriptionKey: 'externalToolsProvider.elevenlabs', capabilities: ['audio'], credentialRef: 'ELEVENLABS_API_KEY', baseURL: 'https://api.elevenlabs.io' },
  { id: 'browserbase', displayName: 'Browserbase', description: 'Run managed browser sessions.', descriptionKey: 'externalToolsProvider.browserbase', capabilities: ['browser'], credentialRef: 'BROWSERBASE_API_KEY', baseURL: 'https://www.browserbase.com' },
]

/**
 * Find one catalog entry by provider id.
 * @param id - catalog provider id.
 * @returns the matching entry, or `undefined` when the id is unknown.
 */
export function externalToolEntry(id: string): ExternalToolCatalogEntry | undefined {
  return EXTERNAL_TOOL_CATALOG.find(entry => entry.id === id)
}
