/** Full-frame SkillHub skill and skill-package marketplace. */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { IconCloseOutline16, IconSearchOutline16, IconSkillOutline16, IconTrashOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { fetchSkills, skillUrl, type SkillHubSkill } from './api.ts'
import type { SkillHubBridge } from './bridge.ts'
import type { SkillLibraryController } from './controller.ts'
import css from './SkillLibraryOverlay.module.css'

export interface SkillLibraryOverlayInjected { readonly controller: SkillLibraryController; readonly bridge: SkillHubBridge }
export type SkillLibraryOverlayProps = PropsRuntime<'shell.overlay'> & PropsLocale<'skillLibrary'> & InjectFace<SkillLibraryOverlayInjected>
type Tab = 'installed' | 'review' | 'discovery' | 'logs'
type CardView = 'detailed' | 'compact'
type SkillSort = 'score' | 'trending' | 'downloads' | 'newest'
type FilterMenu = 'source' | 'category' | 'apiKey' | null

function message(error: unknown): string { return error instanceof Error ? error.message : String(error) }

/** Render paged SkillHub data with an internal scroll viewport and prefetch. */
export function SkillLibraryOverlay({ controller, bridge, t }: SkillLibraryOverlayProps) {
  const open = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const [tab, setTab] = useState<Tab>('installed')
  const [queryInput, setQueryInput] = useState('')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SkillSort>('score')
  const [category, setCategory] = useState('')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [apiKeyFilter, setApiKeyFilter] = useState<'all' | 'required' | 'none'>('all')
  const [items, setItems] = useState<readonly SkillHubSkill[]>([])
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [downloading, setDownloading] = useState<string>()
  const [removing, setRemoving] = useState<string>()
  const [installedSkills, setInstalledSkills] = useState<readonly string[]>([])
  const [installedQuery, setInstalledQuery] = useState('')
  const [installedView, setInstalledView] = useState<CardView>('detailed')
  const [openFilter, setOpenFilter] = useState<FilterMenu>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const requestVersion = useRef(0)
  const loadingRef = useRef(false)
  const pageSize = 24
  const hasMore = total > 0 && page * pageSize < total
  const categoryOptions = [...new Set(items.map(item => item.category).filter((value): value is string => typeof value === 'string' && value.length > 0))].sort()
  const visibleItems = useMemo(() => apiKeyFilter === 'all' ? items : items.filter(item => apiKeyFilter === 'required' ? item.requiresApiKey === true : item.requiresApiKey !== true), [apiKeyFilter, items])
  const filteredInstalledSkills = useMemo(() => {
    const normalized = installedQuery.trim().toLocaleLowerCase()
    if (normalized.length === 0) return installedSkills
    return installedSkills.filter(skill => skill.toLocaleLowerCase().includes(normalized))
  }, [installedQuery, installedSkills])

  const load = async (nextPage: number, reset: boolean): Promise<void> => {
    if (loadingRef.current) return
    loadingRef.current = true
    const version = reset ? requestVersion.current + 1 : requestVersion.current
    if (reset) requestVersion.current = version
    setLoading(true)
    setError(undefined)
    try {
      const result = await fetchSkills(
        { page: nextPage, pageSize, query, sort, category, source: sourceFilter },
        new AbortController().signal,
        bridge,
      )
      if (version !== requestVersion.current) return
      setItems(current => reset ? result.items : [...current, ...result.items.filter(item => !current.some(existing => 'slug' in existing && 'slug' in item && existing.slug === item.slug))])
      setPage(nextPage)
      setTotal(result.total)
      if (reset && viewport.current !== null) viewport.current.scrollTop = 0
    } catch (reason) {
      if (version === requestVersion.current) setError(message(reason))
    } finally {
      loadingRef.current = false
      if (version === requestVersion.current) setLoading(false)
    }
  }

  useEffect(() => {
    if (!open || tab !== 'discovery') return
    void load(1, true)
    const onKeyDown = (event: KeyboardEvent): void => { if (event.key === 'Escape') controller.hide() }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [open, tab, query, sort, category, sourceFilter])

  useEffect(() => {
    if (!open || tab !== 'installed') return
    void bridge.request({ action: 'listSkills' }).then((result) => { setInstalledSkills(result.skills) }).catch((reason) => { setError(message(reason)) })
  }, [bridge, open, tab])

  const onScroll = (element: HTMLDivElement): void => {
    if (element.scrollHeight - element.scrollTop - element.clientHeight < 180 && hasMore && !loadingRef.current) void load(page + 1, false)
  }

  const download = async (skill: SkillHubSkill): Promise<void> => {
    setDownloading(skill.slug)
    setError(undefined)
    try {
      await bridge.request({ action: 'downloadSkill', slug: skill.slug })
    } catch (reason) {
      setError(message(reason))
    } finally {
      setDownloading(undefined)
    }
  }

  const removeSkill = async (skill: string): Promise<void> => {
    setRemoving(skill)
    setError(undefined)
    try {
      await bridge.request({ action: 'removeSkill', name: skill })
      const result = await bridge.request({ action: 'listSkills' })
      setInstalledSkills(result.skills)
    } catch (reason) {
      setError(message(reason))
    } finally {
      setRemoving(undefined)
    }
  }

  const filterMenu = (kind: Exclude<FilterMenu, null>, label: string, value: string, options: readonly { value: string; label: string }[], select: (value: string) => void): JSX.Element => <div className={css.filter}><button type="button" className={css.filterTrigger} aria-haspopup="menu" aria-expanded={openFilter === kind} onClick={() => { setOpenFilter(openFilter === kind ? null : kind) }}>{label}<span className={css.chevron} aria-hidden="true">⌄</span></button>{openFilter === kind ? <div className={css.filterMenu} role="menu">{options.map(option => <button key={option.value} type="button" role="menuitemradio" aria-checked={value === option.value} className={value === option.value ? css.filterSelected : undefined} onClick={() => { select(option.value); setOpenFilter(null) }}>{value === option.value ? <span aria-hidden="true">✓</span> : <span className={css.filterCheck} aria-hidden="true" />}{option.label}</button>)}</div> : null}</div>

  if (!open) return null
  return <div className={css.scrim} data-skill-library-overlay>
    <section className={css.surface} aria-label={t('title')}>
      <header className={css.header}><div><h1>{t('title')}</h1><p>{t('subtitle')}</p></div><button type="button" className={css.close} aria-label={t('close')} onClick={() => { controller.hide() }}><IconCloseOutline16 /></button></header>
      <nav className={css.tabs} aria-label={t('title')}>
        {(['installed', 'review', 'discovery', 'logs'] as const).map(id => <button key={id} type="button" aria-current={tab === id ? 'page' : undefined} onClick={() => { setTab(id) }}>{t(id)}</button>)}
      </nav>
      <div className={css.body} aria-busy={loading}>
        {error !== undefined ? <p className={css.error} role="alert">{t('failed', { message: error })}</p> : null}
        {tab === 'installed' ? <section className={css.installed}>
          <div className={css.toolbar}>
            <label className={css.search}>
              <IconSearchOutline16 aria-hidden="true" />
              <input type="search" value={installedQuery} aria-label={t('installed')} placeholder={t('installed')} onChange={(event) => { setInstalledQuery(event.currentTarget.value) }} />
            </label>
            <div className={css.viewSwitch} aria-label={t('installed')}>
              <button type="button" aria-pressed={installedView === 'detailed'} onClick={() => { setInstalledView('detailed') }}>{t('detailed')}</button>
              <button type="button" aria-pressed={installedView === 'compact'} onClick={() => { setInstalledView('compact') }}>{t('compact')}</button>
            </div>
          </div>
          {installedSkills.length === 0 ? <p className={css.note}>{t('installedEmpty')}</p> : filteredInstalledSkills.length === 0 ? <p className={css.note}>{t('empty')}</p> : <ul className={css.skillGrid} data-view={installedView}>
            {filteredInstalledSkills.map(skill => <li key={skill} className={css.skillCard}>
              <span className={css.skillIcon} aria-hidden="true"><IconSkillOutline16 size={18} /></span>
              <div className={css.skillIdentity}><strong title={skill}>{skill}</strong><span>{t('installedLocation')}</span></div>
              <div className={css.skillActions}>
                <span className={css.defaultInstalled}>{t('installedStatus')}</span>
                <button type="button" className={css.remove} disabled={removing !== undefined} onClick={() => { void removeSkill(skill) }}>
                  <IconTrashOutline16 size={14} />
                  {removing === skill ? t('removing') : t('remove')}
                </button>
              </div>
            </li>)}
          </ul>}
        </section> : null}
        {tab === 'review' ? <section className={css.panel}><h2>{t('review')}</h2><p>{t('reviewEmpty')}</p></section> : null}
        {tab === 'logs' ? <section className={css.panel}><h2>{t('logs')}</h2><p>{t('logsEmpty')}</p></section> : null}
        {tab === 'discovery' ? <section className={css.catalog}>
          <div className={css.skillSortTabs} aria-label={t('skillSort')}>
            {(['score', 'trending', 'downloads', 'newest'] as const).map(id => <button key={id} type="button" aria-current={sort === id ? 'page' : undefined} onClick={() => { setSort(id) }}>{t(id === 'score' ? 'sortScore' : id === 'trending' ? 'sortTrending' : id === 'downloads' ? 'sortDownloads' : 'sortNewest')}</button>)}
          </div>
          <div className={css.toolbar}><form className={css.search} onSubmit={(event) => { event.preventDefault(); setQuery(queryInput.trim()) }}><IconSearchOutline16 aria-hidden="true" /><input type="search" value={queryInput} aria-label={t('searchSkills')} placeholder={t('searchSkills')} onChange={(event) => { setQueryInput(event.currentTarget.value) }} /></form>{filterMenu('source', sourceFilter === 'all' ? t('allSources') : sourceFilter === 'official' ? t('officialSource') : t('communitySource'), sourceFilter, [{ value: 'all', label: t('allSources') }, { value: 'official', label: t('officialSource') }, { value: 'community', label: t('communitySource') }], setSourceFilter)}{filterMenu('category', category === '' ? t('allCategories') : category, category, [{ value: '', label: t('allCategories') }, ...categoryOptions.map(option => ({ value: option, label: option }))], setCategory)}{filterMenu('apiKey', apiKeyFilter === 'all' ? t('apiKeyAll') : apiKeyFilter === 'required' ? t('apiKeyRequired') : t('apiKeyNone'), apiKeyFilter, [{ value: 'all', label: t('apiKeyAll') }, { value: 'none', label: t('apiKeyNone') }, { value: 'required', label: t('apiKeyRequired') }], (value) => { setApiKeyFilter(value as typeof apiKeyFilter) })}</div>
          <div className={css.viewport} ref={viewport} onScroll={(event) => { onScroll(event.currentTarget) }}>
            {loading && visibleItems.length === 0 ? <p className={css.note}>{t('loading')}</p> : null}
            {!loading && visibleItems.length === 0 ? <p className={css.note}>{t('empty')}</p> : null}
            {visibleItems.length > 0 ? <ul className={css.grid}>{visibleItems.map(item => <li key={item.slug} className={css.card}><div className={css.cardHeading}>{item.iconUrl ? <img className={css.icon} src={item.iconUrl} alt="" /> : <span className={css.icon}><IconSkillOutline16 size={20} /></span>}<strong title={item.name}>{item.name}</strong>{item.category ? <span className={css.badge}>{item.category}</span> : null}</div><p>{item.descriptionZh ?? item.description ?? ''}</p><div className={css.meta}><span>☆ {item.stars.toLocaleString()}</span><span>⇩ {item.downloads.toLocaleString()}</span><span>{item.publisher ?? item.source ?? t('sourceSkillHub')}</span></div><div className={css.actions}><a href={skillUrl(item.slug)} target="_blank" rel="noreferrer">{t('open')}</a><button type="button" onClick={() => { void download(item) }}>{downloading === item.slug ? t('downloading') : t('download')}</button></div></li>)}</ul> : null}
            <div className={css.loadMore}>{loading && visibleItems.length > 0 ? <span>{t('loadingMore')}</span> : null}{!loading && hasMore && visibleItems.length > 0 ? <button type="button" onClick={() => { void load(page + 1, false) }}>{t('loadMore')}</button> : null}{!loading && !hasMore && visibleItems.length > 0 ? <span>{t('allLoaded')}</span> : null}</div>
          </div>
          <div className={css.pager}><button type="button" disabled={page <= 1 || loading} onClick={() => { void load(page - 1, true) }}>{t('previous')}</button><span>{t('page', { page })}</span><button type="button" disabled={!hasMore || loading} onClick={() => { void load(page + 1, true) }}>{t('next')}</button></div>
        </section> : null}
      </div>
    </section>
  </div>
}
