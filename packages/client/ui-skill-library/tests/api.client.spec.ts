import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchSkillPackages, fetchSkills, packageUrl, skillUrl } from '../src/client/api.ts'
import type { SkillHubBridge } from '../src/client/bridge.ts'

afterEach(() => { vi.unstubAllGlobals() })

describe('SkillHub API projection', () => {
  it('normalizes bridge rows without exposing native transport details', async () => {
    const request = vi.fn(async () => ({
      items: [{
        slug: 'office-reader',
        displayName: 'Office Reader',
        description_zh: '读取文档',
        downloads: '12',
        requires_api_key: 'true',
      }],
      total: 1,
    }))
    const bridge = { request } as unknown as SkillHubBridge

    await expect(fetchSkills({
      page: 2,
      pageSize: 24,
      query: 'office',
      sort: 'downloads',
      category: 'documents',
      source: 'official',
    }, new AbortController().signal, bridge)).resolves.toEqual({
      items: [{
        slug: 'office-reader',
        name: 'Office Reader',
        descriptionZh: '读取文档',
        downloads: 12,
        stars: 0,
        requiresApiKey: true,
      }],
      total: 1,
    })
    expect(request).toHaveBeenCalledWith({
      action: 'skillHubSkills',
      page: 2,
      pageSize: 24,
      query: 'office',
      sort: 'downloads',
      category: 'documents',
      source: 'official',
    })
  })

  it('encodes public skill identifiers', () => {
    expect(skillUrl('folder/name')).toBe('https://skillhub.cloud.tencent.com/skills/folder%2Fname')
    expect(packageUrl('folder/name')).toBe('https://skillhub.cloud.tencent.com/skillspackage/folder%2Fname')
  })

  it('normalizes every supported skill and package metadata form', async () => {
    const request = vi.fn(async (input: { action: string }) => input.action === 'skillHubSkills' ? {
      items: [
        { name: 'from-name', namespace: { displayName: 'Namespace' }, publisher: { name: 'Publisher' }, installs: 7, stars: '3', score: 2, description: 'Description', descriptionZh: '说明', category: 'tools', iconUrl: 'https://img.test/icon', version: '1', source: 'community', labels: { requires_api_key: true } },
        { slug: 'from-slug', namespace: 'literal', displayName: 'Display', downloads: Number.POSITIVE_INFINITY, requires_api_key: false },
        { name: ' ', displayName: ' ', slug: ' ', downloads: 'bad', stars: null },
      ],
      total: 3,
    } : {
      items: [
        { id: 'id-1', slug: 'package-1', displayName: 'Package', summary: 'Summary', scene: 'work', subScene: 'docs' },
        { slug: 'package-2', name: 'Named package' },
        { id: ' ', slug: ' ', displayName: ' ', name: ' ' },
      ],
      total: 3,
    })
    const bridge = { request } as unknown as SkillHubBridge
    const skills = await fetchSkills({ page: 1, pageSize: 24, query: '', sort: 'score', category: '', source: 'all' }, new AbortController().signal, bridge)
    expect(skills.items).toEqual([
      expect.objectContaining({ slug: 'from-name', name: 'from-name', namespace: 'Namespace', publisher: 'Publisher', downloads: 7, stars: 3, score: 2, requiresApiKey: true }),
      expect.objectContaining({ slug: 'from-slug', name: 'Display', namespace: 'literal', downloads: 0, requiresApiKey: false }),
      expect.objectContaining({ slug: 'unknown-skill', name: 'Unnamed skill', downloads: 0, stars: 0 }),
    ])
    const packages = await fetchSkillPackages({ page: 1, pageSize: 24, query: '', scene: '' }, new AbortController().signal, bridge)
    expect(packages.items).toEqual([
      { id: 'id-1', slug: 'package-1', displayName: 'Package', summary: 'Summary', scene: 'work', subScene: 'docs' },
      { id: 'package-2', slug: 'package-2', displayName: 'Named package' },
      { id: 'unknown-package', slug: 'unknown-package', displayName: 'Unnamed package' },
    ])
  })

  it('builds filtered web requests and honors explicit totals', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { skills: [{ slug: 'one', name: 'One', downloads: 1, stars: 2 }], total: 9 } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { skillSets: [{ slug: 'set', displayName: 'Set' }], total: 4 } }) })
    vi.stubGlobal('fetch', fetchMock)
    const signal = new AbortController().signal
    await expect(fetchSkills({ page: 2, pageSize: 10, query: 'office docs', sort: 'newest', category: 'docs', source: 'official' }, signal)).resolves.toMatchObject({ total: 9 })
    await expect(fetchSkillPackages({ page: 3, pageSize: 8, query: 'work', scene: 'office' }, signal)).resolves.toMatchObject({ total: 4 })
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('keyword=office+docs')
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('category=docs')
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('source=official')
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('scene=office')
  })

  it('derives web totals for full and partial pages and accepts top-level payloads', async () => {
    const full = Array.from({ length: 2 }, (_, index) => ({ slug: `skill-${index}`, downloads: 0, stars: 0 }))
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills: full }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skills: [{ slug: 'last', downloads: 0, stars: 0 }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skillSets: full.map(({ slug }) => ({ slug })) }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ skillSets: [{ slug: 'last' }] }) })
    vi.stubGlobal('fetch', fetchMock)
    const signal = new AbortController().signal
    await expect(fetchSkills({ page: 2, pageSize: 2, query: '', sort: 'score', category: '', source: 'all' }, signal)).resolves.toMatchObject({ total: 5 })
    await expect(fetchSkills({ page: 2, pageSize: 2, query: '', sort: 'score', category: '', source: '' }, signal)).resolves.toMatchObject({ total: 3 })
    await expect(fetchSkillPackages({ page: 2, pageSize: 2, query: '', scene: '' }, signal)).resolves.toMatchObject({ total: 5 })
    await expect(fetchSkillPackages({ page: 2, pageSize: 2, query: '', scene: '' }, signal)).resolves.toMatchObject({ total: 3 })
  })

  it('reports non-successful SkillHub responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })))
    await expect(fetchSkills({ page: 1, pageSize: 24, query: '', sort: 'score', category: '', source: 'all' }, new AbortController().signal)).rejects.toThrow('SkillHub request failed (503)')
  })

  it('treats omitted web item arrays as empty pages', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ data: { total: 0 } }) })))
    const signal = new AbortController().signal
    await expect(fetchSkills({ page: 1, pageSize: 24, query: '', sort: 'score', category: '', source: 'all' }, signal)).resolves.toEqual({ items: [], total: 0 })
    await expect(fetchSkillPackages({ page: 1, pageSize: 24, query: '', scene: '' }, signal)).resolves.toEqual({ items: [], total: 0 })
  })
})
