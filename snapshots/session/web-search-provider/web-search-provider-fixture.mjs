/** Deterministic provider proving that generic web_search records its selected backend. */

/** Cordis plugin name. */
export const name = 'web-search-provider-fixture'

/** Service used by the fixture provider. */
export const inject = ['web']

/** Register one deterministic Tavily-labelled provider. */
export function apply(ctx) {
  ctx.web.registerSearchProvider({
    id: 'tavily',
    available: () => true,
    search: async ({ query }) => {
      if (query !== 'provider identity fixture') throw new Error(`unexpected snapshot query: ${query}`)
      return {
        content: 'Fixture answer.',
        sources: [{ url: 'https://fixture.invalid/provider', title: 'Fixture source', snippet: 'Deterministic result.' }],
        truncated: false,
      }
    },
  })
}
