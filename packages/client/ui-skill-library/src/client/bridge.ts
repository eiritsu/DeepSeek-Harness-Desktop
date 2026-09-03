/** Native bridge used to proxy SkillHub requests from the desktop shell. */

export interface SkillHubBridge {
  request(request: {
    readonly action: 'skillHubSkills' | 'skillHubPackages'
    readonly page: number
    readonly pageSize: number
    readonly query: string
    readonly sort?: string
    readonly category?: string
    readonly source?: string
    readonly scene?: string
  }): Promise<{ readonly items: readonly Record<string, unknown>[]; readonly total: number }>
  request(request: { readonly action: 'downloadSkill'; readonly slug: string }): Promise<{ readonly path: string }>
  request(request: { readonly action: 'listSkills' }): Promise<{ readonly skills: readonly string[] }>
  request(request: { readonly action: 'removeSkill'; readonly name: string }): Promise<{ readonly ok: true }>
}

declare global {
  interface Window { dshDesktopPluginBridge?: SkillHubBridge }
}
