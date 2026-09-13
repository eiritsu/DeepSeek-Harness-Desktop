/** Reviewed plugin discovery and installation for the Electron application shell. */

import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { isAbsolute, join, normalize, resolve, sep } from 'node:path'
import { gt, valid } from 'semver'
import type {
  CommunityPlugin,
  InstalledPlugin,
  PluginAuditRecord,
  PluginBridgeReplies,
  PluginBridgeRequest,
  PluginCategory,
  PluginReviewReport,
  ThirdPartyCategory,
  ThirdPartyPlugin,
} from '@deepseek-ai/dsh-client-ui-plugin-library/client'
import type { DesktopProjectManager } from './project-manager.ts'

const BUILT_IN_PLUGINS = [
  '@deepseek-ai/dsh-client-ui-deepseek-files',
  '@deepseek-ai/dsh-client-ui-plugin-library',
  '@deepseek-ai/dsh-external-tools',
  '@deepseek-ai/dsh-file-recognizer-office',
  '@deepseek-ai/dsh-model-catalog',
] as const
const REVIEW_TTL_MS = 15 * 60 * 1_000
const REMOTE_LIMIT_BYTES = 2 * 1024 * 1024
const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/iu
const REPOSITORY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/u
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u

type ManagedRequest = Exclude<PluginBridgeRequest,
  { readonly action: 'exportConfig' | 'importConfig' | 'resetData' | 'selectDirectory' }>

interface PendingReview {
  readonly source: string
  readonly installSource: string
  readonly kind: PluginReviewReport['kind']
  readonly subject: string
  readonly packageName: string
  readonly requiresForceInstall: boolean
  readonly expiresAt: number
}

interface Inspection {
  readonly category: PluginCategory
  readonly installable: boolean
  readonly packageName?: string
  readonly findings: readonly string[]
  readonly risks: readonly string[]
}

interface NormalizedSource {
  readonly source: string
  readonly installSource: string
  readonly kind: PluginReviewReport['kind']
  readonly subject: string
  readonly pinFinding: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value)
    ? Math.max(minimum, Math.min(maximum, value))
    : fallback
}

async function fetchPayload(url: URL): Promise<{ readonly status: number; readonly data: Buffer }> {
  const response = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
    headers: {
      accept: url.hostname === 'api.github.com' || url.hostname === 'registry.npmjs.org'
        ? 'application/json'
        : 'text/plain,application/json;q=0.9,*/*;q=0.8',
      'user-agent': 'DeepSeek-Harness-Desktop/0.1',
    },
  })
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > REMOTE_LIMIT_BYTES) throw new Error('远程插件清单超过 2 MiB 检查上限。')
  const data = Buffer.from(await response.arrayBuffer())
  if (data.byteLength > REMOTE_LIMIT_BYTES) throw new Error('远程插件清单超过 2 MiB 检查上限。')
  return { status: response.status, data }
}

async function fetchJson(url: URL): Promise<unknown> {
  const response = await fetchPayload(url)
  if (response.status !== 200) throw new Error(`${url.hostname} 返回 HTTP ${String(response.status)}。`)
  return JSON.parse(response.data.toString('utf8'))
}

function safePatchPath(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.startsWith('./') || value.includes('\\')) return undefined
  const parts = value.slice(2).split('/')
  if (parts.length === 0 || parts.some(part => part === '' || part === '.' || part === '..' || !/^[A-Za-z0-9._-]+$/u.test(part))) return undefined
  const last = parts.at(-1)
  return last?.endsWith('.yml') === true || last?.endsWith('.yaml') === true ? parts.join('/') : undefined
}

function inspectManifest(value: unknown, patchExists: (path: string) => Promise<boolean>, published: boolean): Promise<Inspection> {
  return (async () => {
    if (!isRecord(value)) return { category: 'blocked', installable: false, findings: ['package.json 不是有效的 JSON 对象，已阻止安装。'], risks: [] }
    const packageName = value.name
    if (typeof packageName !== 'string' || !PACKAGE_NAME_PATTERN.test(packageName)) {
      return { category: 'blocked', installable: false, findings: ['package.json 缺少有效 name，已阻止安装。'], risks: [] }
    }
    const risks: string[] = []
    if (published) {
      for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
        const dependencies = value[field]
        if (!isRecord(dependencies)) continue
        for (const [name, spec] of Object.entries(dependencies)) {
          if (typeof spec === 'string' && spec.startsWith('workspace:')) risks.push(`${field} 中的 ${name} 使用 ${spec}；发布包无法从用户 workspace 解析该依赖。`)
        }
      }
    }
    const dsh = value.dsh
    const bundle = isRecord(dsh) ? dsh.bundle : undefined
    const patch = isRecord(bundle) ? safePatchPath(bundle.patch) : undefined
    if (patch === undefined) {
      return { category: 'needs-adapter', installable: false, packageName, findings: ['package 未声明有效 dsh.bundle.patch；不会作为 Profile Bundle 激活。'], risks }
    }
    if (!await patchExists(patch)) {
      return { category: 'blocked', installable: false, packageName, findings: [`dsh.bundle.patch 指向的 ${patch} 不存在，已阻止安装。`], risks }
    }
    const scripts = isRecord(value.scripts) ? value.scripts : {}
    const lifecycle = ['preinstall', 'install', 'postinstall', 'prepare'].filter(name => Object.hasOwn(scripts, name))
    return {
      category: 'profile-bundle',
      installable: true,
      packageName,
      findings: [
        `识别为可直接安装的 DSH Profile Bundle（${packageName}）。`,
        `组合入口 ${patch} 存在。`,
        lifecycle.length === 0 ? '清单未声明安装 lifecycle script。' : `清单声明了 ${String(lifecycle.length)} 个安装 lifecycle script；安装时会禁用。`,
      ],
      risks,
    }
  })()
}

function installedVersion(runtimeDsh: string, name: string): string | undefined {
  const path = join(runtimeDsh, 'node_modules', ...name.split('/'), 'package.json')
  if (!existsSync(path)) return undefined
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
  return isRecord(value) && typeof value.version === 'string' ? value.version : undefined
}

/** Electron implementation of the desktop plugin-library bridge. */
export class ElectronPluginLibrary {
  private readonly pending = new Map<string, PendingReview>()
  private readonly thirdParty = new Map<string, ThirdPartyPlugin>()

  /**
   * @param root - Electron support root containing the audit log.
   * @param runtimeDsh - Verified bundled DSH runtime root.
   * @param manager - External desktop profile owner.
   * @param mutate - Serialized package mutation that restarts the Host.
   */
  constructor(
    private readonly root: string,
    private readonly runtimeDsh: string,
    private readonly manager: DesktopProjectManager,
    private readonly mutate: (mutation: Parameters<DesktopProjectManager['mutate']>[0]) => Promise<void>,
  ) {}

  /** Validate and execute one plugin-library bridge request. */
  async request(request: ManagedRequest): Promise<unknown> {
    switch (request.action) {
      case 'list': return { plugins: await this.list() } satisfies PluginBridgeReplies['list']
      case 'logs': return { records: await this.logs() } satisfies PluginBridgeReplies['logs']
      case 'catalog': return this.catalog(request)
      case 'thirdPartyCatalog':
      case 'skillHubCatalog': return this.skillHubCatalog(request)
      case 'review': return { report: await this.review(request.source) } satisfies PluginBridgeReplies['review']
      case 'reviewUpdate': return { report: await this.reviewUpdate(request.package) } satisfies PluginBridgeReplies['reviewUpdate']
      case 'reviewRepository': return { report: await this.reviewRepository(request.repository) } satisfies PluginBridgeReplies['reviewRepository']
      case 'reviewThirdParty': return { report: await this.reviewThirdParty(request.id) } satisfies PluginBridgeReplies['reviewThirdParty']
      case 'install': await this.install(request.reviewId, request.force); return { ok: true } satisfies PluginBridgeReplies['install']
      case 'cancelReview': this.pending.delete(request.reviewId); return { ok: true } satisfies PluginBridgeReplies['cancelReview']
      case 'remove': await this.remove(request.package); return { ok: true } satisfies PluginBridgeReplies['remove']
      default: request satisfies never
    }
  }

  private async list(): Promise<readonly InstalledPlugin[]> {
    const external = this.manager.listPlugins()
    const rows = await Promise.all(external.map(async (plugin) => {
      let latestVersion: string | undefined
      const registryVersion = this.manager.registryPluginVersion(plugin.name)
      if (registryVersion !== undefined) {
        try {
          const latest = await this.latestNpmVersion(plugin.name)
          if (gt(latest, registryVersion)) latestVersion = latest
        } catch {
          // Update discovery is optional; inventory remains usable during a registry outage.
        }
      }
      return {
        name: plugin.name,
        displayName: plugin.name,
        version: plugin.version,
        removable: true,
        ...latestVersion === undefined ? {} : { latestVersion },
      }
    }))
    for (const name of BUILT_IN_PLUGINS) {
      const version = installedVersion(this.runtimeDsh, name)
      if (version !== undefined && !rows.some(row => row.name === name)) rows.push({ name, displayName: name, version, removable: false })
    }
    return rows.sort((left, right) => left.name.localeCompare(right.name))
  }

  private async logs(): Promise<readonly PluginAuditRecord[]> {
    try {
      const text = await readFile(this.auditPath, 'utf8')
      return text.split(/\r?\n/u).filter(Boolean).slice(-200).map(line => JSON.parse(line) as PluginAuditRecord).reverse()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }

  private get auditPath(): string { return join(this.root, 'logs', 'plugin-audit.jsonl') }

  private async appendAudit(action: string, subject: string, status: PluginAuditRecord['status'], message: string): Promise<void> {
    await mkdir(join(this.root, 'logs'), { recursive: true, mode: 0o700 })
    const record: PluginAuditRecord = { id: randomUUID(), timestamp: new Date().toISOString(), action, subject, status, message }
    await appendFile(this.auditPath, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 })
  }

  private async latestNpmVersion(name: string): Promise<string> {
    if (!PACKAGE_NAME_PATTERN.test(name)) throw new Error('插件包名格式无效。')
    const value = await fetchJson(new URL(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`))
    if (!isRecord(value) || typeof value.version !== 'string' || valid(value.version) !== value.version) throw new Error('npm registry 没有返回有效精确版本。')
    return value.version
  }

  private async catalog(request: Extract<ManagedRequest, { action: 'catalog' }>): Promise<PluginBridgeReplies['catalog']> {
    const page = finiteInteger(request.page, 1, 1, 50)
    const pageSize = finiteInteger(request.pageSize, 12, 1, 24)
    const query = request.query.trim().slice(0, 80)
    const url = new URL('https://api.github.com/search/repositories')
    url.searchParams.set('q', query === '' ? 'topic:dsh-plugin' : `topic:dsh-plugin ${query}`)
    url.searchParams.set('sort', 'updated'); url.searchParams.set('order', 'desc')
    url.searchParams.set('per_page', String(pageSize)); url.searchParams.set('page', String(page))
    const value = await fetchJson(url)
    if (!isRecord(value) || !Array.isArray(value.items)) throw new Error('GitHub 插件目录响应格式无效。')
    const plugins: CommunityPlugin[] = []
    for (const item of value.items) {
      if (!isRecord(item) || typeof item.full_name !== 'string' || !REPOSITORY_PATTERN.test(item.full_name)) continue
      let inspection: Inspection = { category: 'blocked', installable: false, findings: [], risks: [] }
      try { inspection = await this.inspectGitHub(item.full_name, typeof item.default_branch === 'string' ? item.default_branch : 'HEAD', false) } catch {}
      plugins.push({
        repository: item.full_name,
        ...(typeof item.description === 'string' ? { description: item.description } : {}),
        stars: typeof item.stargazers_count === 'number' ? item.stargazers_count : 0,
        ...(typeof item.language === 'string' ? { language: item.language } : {}),
        updatedAt: typeof item.pushed_at === 'string' ? item.pushed_at : '',
        htmlUrl: typeof item.html_url === 'string' ? item.html_url : `https://github.com/${item.full_name}`,
        category: inspection.category,
        installable: inspection.installable,
      })
    }
    const total = typeof value.total_count === 'number' ? Math.min(1_000, value.total_count) : plugins.length
    return { plugins, hasMore: page * pageSize < total }
  }

  private async skillHubCatalog(request: Extract<ManagedRequest, { action: 'skillHubCatalog' | 'thirdPartyCatalog' }>): Promise<PluginBridgeReplies['skillHubCatalog']> {
    const page = finiteInteger(request.page, 1, 1, 10_000)
    const pageSize = finiteInteger(request.pageSize, 12, 1, 100)
    const url = new URL('https://api.skillhub.cn/api/v1/plugins')
    url.searchParams.set('page', String(page)); url.searchParams.set('page_size', String(pageSize)); url.searchParams.set('sort', 'stars')
    const query = request.query.trim().slice(0, 80)
    if (query !== '') url.searchParams.set('q', query)
    if (/^[a-z0-9-]+$/u.test(request.category)) url.searchParams.set('category', request.category)
    const value = await fetchJson(url)
    if (!isRecord(value)) throw new Error('SkillHub 插件市场响应格式无效。')
    const plugins: ThirdPartyPlugin[] = []
    for (const item of Array.isArray(value.items) ? value.items : []) {
      if (!isRecord(item) || typeof item.fullName !== 'string' || !REPOSITORY_PATTERN.test(item.fullName)) continue
      const repositoryUrl = typeof item.repositoryUrl === 'string' ? item.repositoryUrl : `https://github.com/${item.fullName}`
      const description = typeof item.description === 'string' ? item.description : ''
      const plugin: ThirdPartyPlugin = {
        id: item.fullName, name: item.fullName, repository: item.fullName,
        englishDescription: description, chineseDescription: description,
        stars: typeof item.stars === 'number' ? item.stars : 0,
        categoryId: typeof item.categoryKey === 'string' ? item.categoryKey : '',
        detailUrl: repositoryUrl, repositoryUrl,
      }
      this.thirdParty.set(plugin.id, plugin); plugins.push(plugin)
    }
    const total = typeof value.total === 'number' ? value.total : (page - 1) * pageSize + plugins.length
    const categories = await this.skillHubCategories().catch(() => [])
    return { plugins, hasMore: page * pageSize < total, total, catalogTotal: total, categories }
  }

  private async skillHubCategories(): Promise<readonly ThirdPartyCategory[]> {
    const value = await fetchJson(new URL('https://api.skillhub.cn/api/v1/plugins/categories'))
    if (!isRecord(value) || !Array.isArray(value.items)) return []
    return value.items.flatMap((item): ThirdPartyCategory[] => isRecord(item) && typeof item.key === 'string'
      ? [{ id: item.key, englishName: typeof item.displayName === 'string' ? item.displayName : item.key, chineseName: typeof item.displayName === 'string' ? item.displayName : item.key, count: 0 }]
      : [])
  }

  private normalizeSource(raw: string): NormalizedSource {
    const source = raw.trim()
    if (isAbsolute(source)) {
      const path = resolve(source)
      return { source: path, installSource: `file:${path}`, kind: 'local', subject: normalize(path).split(sep).at(-1) ?? path, pinFinding: '本地目录会在安装前再次检查。' }
    }
    if (source.startsWith('https://github.com/')) {
      const url = new URL(source)
      if (url.username !== '' || url.password !== '' || url.port !== '' || url.search !== '') throw new Error('GitHub URL 不能包含凭据、端口或查询参数。')
      const [owner, rawRepository] = url.pathname.replace(/^\//u, '').split('/')
      const repository = rawRepository?.replace(/\.git$/u, '')
      const commit = url.hash.slice(1).toLowerCase()
      const subject = `${owner ?? ''}/${repository ?? ''}`
      if (!REPOSITORY_PATTERN.test(subject) || !COMMIT_PATTERN.test(commit)) throw new Error('GitHub 来源必须固定到完整的 40 位 commit。')
      const normalized = `https://github.com/${subject}.git#${commit}`
      return { source: normalized, installSource: normalized, kind: 'github', subject, pinFinding: `来源固定到 commit ${commit}。` }
    }
    const separator = source.startsWith('@') ? source.indexOf('@', source.indexOf('/') + 1) : source.lastIndexOf('@')
    if (separator <= 0) throw new Error('npm 来源必须包含精确 semver 版本。')
    const name = source.slice(0, separator)
    const version = source.slice(separator + 1)
    if (!PACKAGE_NAME_PATTERN.test(name) || valid(version) !== version) throw new Error('npm 来源必须是有效包名和精确 semver 版本。')
    return { source: `${name}@${version}`, installSource: `${name}@${version}`, kind: 'npm', subject: name, pinFinding: `来源固定到 npm 版本 ${version}。` }
  }

  private async inspect(source: NormalizedSource): Promise<Inspection> {
    if (source.kind === 'local') {
      const manifestPath = join(source.source, 'package.json')
      if (!existsSync(manifestPath)) return { category: 'external-project', installable: false, findings: ['本地目录没有 package.json。'], risks: [] }
      const value: unknown = JSON.parse(await readFile(manifestPath, 'utf8'))
      return inspectManifest(value, patch => Promise.resolve(existsSync(resolve(source.source, patch))), true)
    }
    if (source.kind === 'github') return this.inspectGitHub(source.subject, source.source.slice(source.source.lastIndexOf('#') + 1), true)
    const version = source.source.slice(source.source.lastIndexOf('@') + 1)
    const value = await fetchJson(new URL(`https://registry.npmjs.org/${encodeURIComponent(source.subject)}/${version}`))
    return inspectManifest(value, async patch => (await fetchPayload(new URL(`https://unpkg.com/${source.subject}@${version}/${patch}`))).status === 200, true)
  }

  private async inspectGitHub(repository: string, reference: string, validateCommit: boolean): Promise<Inspection> {
    if (validateCommit) {
      const commit = await fetchJson(new URL(`https://api.github.com/repos/${repository}/commits/${reference}`))
      if (!isRecord(commit) || typeof commit.sha !== 'string') throw new Error('GitHub 没有返回有效 commit。')
    }
    const base = `https://raw.githubusercontent.com/${repository}/${reference}/`
    const manifest = await fetchPayload(new URL(`${base}package.json`))
    if (manifest.status !== 200) return { category: 'external-project', installable: false, findings: ['仓库根目录没有 package.json。'], risks: [] }
    const value: unknown = JSON.parse(manifest.data.toString('utf8'))
    return inspectManifest(value, async patch => (await fetchPayload(new URL(patch, base))).status === 200, false)
  }

  private async review(source: string): Promise<PluginReviewReport> {
    let normalized: NormalizedSource
    try { normalized = this.normalizeSource(source) } catch (error) {
      await this.appendAudit('review', source, 'failure', error instanceof Error ? error.message : String(error)); throw error
    }
    const inspection = await this.inspect(normalized)
    const subject = normalized.kind === 'local' ? inspection.packageName ?? normalized.subject : normalized.subject
    const expiresAt = Date.now() + REVIEW_TTL_MS
    const requiresForceInstall = inspection.risks.length > 0
    let reviewId: string | undefined
    if (inspection.installable && inspection.packageName !== undefined) {
      reviewId = randomUUID()
      this.pending.set(reviewId, { ...normalized, subject, packageName: inspection.packageName, requiresForceInstall, expiresAt })
    }
    const findings = [normalized.pinFinding, ...inspection.findings, '安装时禁用 dependency lifecycle scripts。', '插件仍作为本机代码运行。']
    await this.appendAudit('review', subject, 'review', [...findings, ...inspection.risks].join(' '))
    return {
      ...reviewId === undefined ? {} : { reviewId },
      source: normalized.source,
      kind: normalized.kind,
      subject,
      category: inspection.category,
      installable: inspection.installable,
      requiresForceInstall,
      ...inspection.packageName === undefined ? {} : { packageName: inspection.packageName },
      findings,
      risks: inspection.risks,
      expiresAt: new Date(expiresAt).toISOString(),
    }
  }

  private async reviewUpdate(packageName: string): Promise<PluginReviewReport> {
    if (!PACKAGE_NAME_PATTERN.test(packageName)) throw new Error('插件包名格式无效。')
    const current = this.manager.registryPluginVersion(packageName)
    if (current === undefined) throw new Error('该插件不是以 npm 精确版本安装，无法自动更新。')
    const latest = await this.latestNpmVersion(packageName)
    if (!gt(latest, current)) throw new Error('该插件已经是最新版本。')
    return this.review(`${packageName}@${latest}`)
  }

  private async resolveHead(repository: string): Promise<string> {
    if (!REPOSITORY_PATTERN.test(repository)) throw new Error('社区插件仓库名格式无效。')
    const details = await fetchJson(new URL(`https://api.github.com/repos/${repository}`))
    if (!isRecord(details) || typeof details.default_branch !== 'string') throw new Error('GitHub 仓库没有有效默认分支。')
    const commit = await fetchJson(new URL(`https://api.github.com/repos/${repository}/commits/${details.default_branch}`))
    if (!isRecord(commit) || typeof commit.sha !== 'string' || !COMMIT_PATTERN.test(commit.sha)) throw new Error('GitHub 没有返回有效 commit。')
    return commit.sha
  }

  private async reviewRepository(repository: string): Promise<PluginReviewReport> {
    return this.review(`https://github.com/${repository}#${await this.resolveHead(repository)}`)
  }

  private async reviewThirdParty(id: string): Promise<PluginReviewReport> {
    const plugin = this.thirdParty.get(id)
    if (plugin === undefined) throw new Error('SkillHub 插件条目已过期，请刷新目录后重试。')
    return this.review(`https://github.com/${plugin.repository}#${await this.resolveHead(plugin.repository)}`)
  }

  private async install(reviewId: string, force: boolean): Promise<void> {
    const review = this.pending.get(reviewId)
    if (review === undefined || review.expiresAt <= Date.now()) {
      this.pending.delete(reviewId)
      throw new Error('审查记录不存在或已过期，请重新审查。')
    }
    if (review.requiresForceInstall && !force) throw new Error('该插件包含审查风险；需要明确选择强制安装。')
    if (review.kind === 'local') {
      const current = await this.inspect(this.normalizeSource(review.source))
      if (
        !current.installable
        || current.packageName !== review.packageName
        || (current.risks.length > 0) !== review.requiresForceInstall
      ) throw new Error('本地插件目录在审查后发生结构变化，请重新审查。')
    }
    this.pending.delete(reviewId)
    try {
      await this.mutate({ type: 'plugin-add', spec: review.installSource, expectedName: review.packageName })
      const detail = review.requiresForceInstall
        ? '用户确认风险后安装固定来源；lifecycle scripts 未执行。'
        : '已安装固定来源；lifecycle scripts 未执行。'
      await this.appendAudit('install', review.subject, 'success', detail)
    } catch (error) {
      await this.appendAudit('install', review.subject, 'failure', error instanceof Error ? error.message : String(error)); throw error
    }
  }

  private async remove(packageName: string): Promise<void> {
    if (!PACKAGE_NAME_PATTERN.test(packageName)) throw new Error('插件包名格式无效。')
    try { await this.mutate({ type: 'plugin-remove', name: packageName }); await this.appendAudit('remove', packageName, 'success', '已从桌面 Profile 移除。') }
    catch (error) { await this.appendAudit('remove', packageName, 'failure', error instanceof Error ? error.message : String(error)); throw error }
  }
}

/** Reject malformed values before they reach the Electron plugin manager. */
export function parsePluginBridgeRequest(value: unknown): PluginBridgeRequest {
  if (!isRecord(value) || typeof value.action !== 'string') throw new Error('dsh desktop: invalid plugin-library request')
  const text = (name: string): string => {
    const field = value[name]
    if (typeof field !== 'string' || field.length > 4_096) throw new Error(`dsh desktop: invalid plugin-library ${name}`)
    return field
  }
  const page = (): { page: number; pageSize: number; query: string } => {
    if (!Number.isSafeInteger(value.page) || !Number.isSafeInteger(value.pageSize)) throw new Error('dsh desktop: invalid plugin-library page')
    return { page: value.page as number, pageSize: value.pageSize as number, query: text('query') }
  }
  switch (value.action) {
    case 'list': case 'logs': case 'selectDirectory': case 'exportConfig': case 'importConfig': case 'resetData': return { action: value.action }
    case 'catalog': return { action: 'catalog', ...page() }
    case 'thirdPartyCatalog': case 'skillHubCatalog': {
      const common = page()
      if (value.sort !== 'stars') throw new Error('dsh desktop: invalid plugin-library sort')
      return { action: value.action, ...common, category: text('category'), sort: value.sort }
    }
    case 'review': return { action: 'review', source: text('source') }
    case 'reviewUpdate': return { action: 'reviewUpdate', package: text('package') }
    case 'reviewRepository': return { action: 'reviewRepository', repository: text('repository') }
    case 'reviewThirdParty': return { action: 'reviewThirdParty', id: text('id') }
    case 'install': {
      if (typeof value.force !== 'boolean') throw new Error('dsh desktop: invalid plugin-library force flag')
      return { action: 'install', reviewId: text('reviewId'), force: value.force }
    }
    case 'cancelReview': return { action: 'cancelReview', reviewId: text('reviewId') }
    case 'remove': return { action: 'remove', package: text('package') }
    default: throw new Error('dsh desktop: unsupported plugin-library request')
  }
}
