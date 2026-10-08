/** Fixed models.dev response for the keyless dynamic-reasoning Session scenario. */
import { applyLoopbackServerEffect } from '../loopback-fixture-server.mjs'

/** Model facts and the canonical provider controls used by replay. */
const CATALOG = {
  models: {
    'minimax/MiniMax-M3': {
      id: 'minimax/MiniMax-M3',
      modalities: { input: ['text'] },
      limit: { context: 1_000_000, output: 256_000 },
      reasoning: true,
    },
    'minimax/MiniMax-M2.7-highspeed': {
      id: 'minimax/MiniMax-M2.7-highspeed',
      modalities: { input: ['text'] },
      limit: { context: 1_000_000, output: 256_000 },
      reasoning: true,
    },
  },
  providers: {
    'minimax-cn': {
      id: 'minimax-cn',
      api: 'https://api.minimax.cn/anthropic/v1',
      models: {
        'MiniMax-M3': { reasoning_options: [{ type: 'toggle' }] },
        'MiniMax-M2.7-highspeed': { reasoning_options: [] },
      },
    },
  },
}

/** Fixed authority routed to the fixture listener's assigned port. */
const RECORDED_ENDPOINT = 'http://127.0.0.1:43119/catalog.json?type=all'

/** Cordis plugin name. */
export const name = 'catalog-reasoning-fixture'

function fixtureInput(input, endpoint) {
  const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input
  if (typeof url !== 'string') return input
  if (url !== RECORDED_ENDPOINT) {
    let parsed
    try {
      parsed = new URL(url)
    } catch {
      return input
    }
    if (parsed.host === new URL(RECORDED_ENDPOINT).host) {
      throw new Error(`catalog-reasoning-fixture: unexpected catalog URL: ${url}`)
    }
    return input
  }
  return input instanceof Request ? new Request(endpoint, input) : endpoint
}

/** Serve the deterministic catalog and route only its recorded authority locally. */
export async function apply(ctx) {
  let restoreFetch = () => {}
  await applyLoopbackServerEffect(ctx, {
    label: 'catalog-reasoning-fixture',
    requestListener: (request, response) => {
      if (request.method === 'GET' && request.url === '/catalog.json?type=all') {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify(CATALOG))
        return
      }
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('not found')
    },
    onListening: address => {
      const endpoint = `http://127.0.0.1:${String(address.port)}/catalog.json?type=all`
      const originalFetch = globalThis.fetch
      const fixtureFetch = (input, init) => originalFetch(fixtureInput(input, endpoint), init)
      globalThis.fetch = fixtureFetch
      restoreFetch = () => {
        if (globalThis.fetch !== fixtureFetch) {
          throw new Error('catalog-reasoning-fixture: global fetch owner changed before cleanup')
        }
        globalThis.fetch = originalFetch
      }
    },
    onCleanup: () => restoreFetch(),
  })
}
