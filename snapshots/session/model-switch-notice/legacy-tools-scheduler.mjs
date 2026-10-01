/** Test-only plugin that publishes the tools scheduler under the legacy key. */

const GLOBAL = Symbol.for('@deepseek-ai/dsh-tools.scheduler')

export const name = 'legacy-tools-scheduler-compat'
export const inject = ['tools']

/**
 * Move the mounted tools service's scheduler to the private symbol an older
 * profile-local `dsh-tools` copy used, so the replayed session runs through the
 * loop's legacy scheduler lookup.
 * @param {import('@deepseek-ai/cordis').Context} ctx - composition context.
 */
export function apply(ctx) {
  const scheduler = ctx.tools[GLOBAL]
  if (scheduler === undefined) throw new Error('legacy tools scheduler plugin requires the mounted scheduler')
  Reflect.deleteProperty(ctx.tools, GLOBAL)
  Object.defineProperty(ctx.tools, Symbol('@deepseek-ai/dsh-tools.scheduler'), { value: scheduler })
}
