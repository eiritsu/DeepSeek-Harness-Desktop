import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopSkillLibrary, parseDesktopSkillRequest } from '../src/skill-library.ts'

const roots: string[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('desktop Skill library', () => {
  it('rejects malformed renderer requests at the IPC parser', () => {
    expect(() => parseDesktopSkillRequest({ action: 'skillHubSkills', page: '1', pageSize: 24, query: '' }))
      .toThrow(/page must be an integer/)
    expect(() => parseDesktopSkillRequest({ action: 'downloadSkill', slug: '../outside' }))
      .toThrow(/invalid SkillHub skill identifier/)
    expect(() => parseDesktopSkillRequest({ action: 'unknown' })).toThrow(/unknown Skill library action/)
  })

  it('bounds and normalizes catalog responses in the main process', async () => {
    const fetch = vi.fn(async (url: URL) => {
      expect(url.searchParams.get('keyword')).toBe('office')
      return new Response(JSON.stringify({ data: { skills: [{ slug: 'office' }, null], total: 7 } }))
    })
    vi.stubGlobal('fetch', fetch)
    const root = await mkdtemp(join(tmpdir(), 'dsh-skill-library-'))
    roots.push(root)
    const library = new DesktopSkillLibrary(root)

    await expect(library.request(parseDesktopSkillRequest({
      action: 'skillHubSkills', page: 2, pageSize: 24, query: 'office', sort: 'score', source: 'all',
    }))).resolves.toEqual({ items: [{ slug: 'office' }], total: 7 })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('lists frontmatter names and removes only one exact installed Skill', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-skill-library-'))
    roots.push(root)
    await mkdir(join(root, 'office-reader'))
    await mkdir(join(root, 'other'))
    await writeFile(join(root, 'office-reader', 'SKILL.md'), '---\nname: Office Reader\n---\n')
    await writeFile(join(root, 'other', 'SKILL.md'), '---\nname: Other\n---\n')
    const library = new DesktopSkillLibrary(root)

    await expect(library.request({ action: 'listSkills' })).resolves.toEqual({ skills: ['Office Reader', 'Other'] })
    await expect(library.request({ action: 'removeSkill', name: 'Office Reader' })).resolves.toEqual({ ok: true })
    await expect(library.request({ action: 'listSkills' })).resolves.toEqual({ skills: ['Other'] })
    await expect(library.request({ action: 'removeSkill', name: 'Office' })).rejects.toThrow(/Expected one installed Skill/)
  })
})
