/** Shared secret-free provider catalog. */
export interface ExternalToolCatalogEntry {
  readonly id: string
  readonly displayName: string
  readonly description: string
  readonly capabilities: readonly string[]
  readonly credentialRef: string
  readonly baseURL?: string
  readonly toolName?: string
}

export const EXTERNAL_TOOL_CATALOG: readonly ExternalToolCatalogEntry[] = [
  { id: 'brave-search', displayName: 'Brave Search', description: '隐私友好的网页搜索', capabilities: ['search'], credentialRef: 'BRAVE_SEARCH_API_KEY', baseURL: 'https://api.search.brave.com', toolName: 'brave_search' },
  { id: 'tavily', displayName: 'Tavily', description: '面向 Agent 的搜索与摘要', capabilities: ['search'], credentialRef: 'TAVILY_API_KEY', baseURL: 'https://api.tavily.com', toolName: 'tavily_search' },
  { id: 'firecrawl', displayName: 'Firecrawl', description: '网页抓取与 Markdown 提取', capabilities: ['extract'], credentialRef: 'FIRECRAWL_API_KEY', baseURL: 'https://api.firecrawl.dev', toolName: 'firecrawl_extract' },
  { id: 'exa', displayName: 'Exa', description: '语义搜索与研究', capabilities: ['search'], credentialRef: 'EXA_API_KEY', baseURL: 'https://api.exa.ai', toolName: 'exa_search' },
  { id: 'github', displayName: 'GitHub', description: 'GitHub 仓库与代码搜索', capabilities: ['repository', 'search'], credentialRef: 'GITHUB_TOKEN', baseURL: 'https://api.github.com', toolName: 'github_search' },
  { id: 'fal', displayName: 'FAL', description: '图像与媒体生成', capabilities: ['image', 'video'], credentialRef: 'FAL_KEY', baseURL: 'https://fal.run' },
  { id: 'elevenlabs', displayName: 'ElevenLabs', description: '语音生成', capabilities: ['audio'], credentialRef: 'ELEVENLABS_API_KEY', baseURL: 'https://api.elevenlabs.io' },
  { id: 'browserbase', displayName: 'Browserbase', description: '托管浏览器会话', capabilities: ['browser'], credentialRef: 'BROWSERBASE_API_KEY', baseURL: 'https://www.browserbase.com' },
]

export function externalToolEntry(id: string): ExternalToolCatalogEntry | undefined {
  return EXTERNAL_TOOL_CATALOG.find(entry => entry.id === id)
}
