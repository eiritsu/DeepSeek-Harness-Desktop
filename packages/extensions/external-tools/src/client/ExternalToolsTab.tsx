/** Settings page for credential-gated external tool providers. */
import { useEffect, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ExternalToolsFace } from './controller.ts'
import { isNativeSearchProvider } from '../catalog.ts'
import css from './ExternalToolsTab.module.css'
export type ExternalToolsTabProps = PropsRuntime<'settings.plugins.tab'> & PropsLocale<'settings.plugins'> & InjectFace<ExternalToolsFace>
export function ExternalToolsTab(props: ExternalToolsTabProps) {
  const [, rerender] = useState(0)
  const state = props.useExternalTools(snapshot => snapshot)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  // The renderer creates a fresh props object whenever the settings section
  // reprojects its slots. Depend on the controller methods instead, otherwise
  // every parent render starts another refresh and can keep the snapshot in
  // `loading` while older requests are discarded by the generation guard.
  useEffect(() => {
    const off = props.subscribe(() => { rerender(value => value + 1) })
    void props.refresh()
    return off
  }, [props.subscribe, props.refresh])
  return <div className={css.root}>
    <p className={css.hint}>{props.t('externalToolsHint')}</p>
    {state.error !== undefined && <><p className={css.error}>{state.error}</p><button className={css.retry} type="button" onClick={() => { void props.refresh() }}>{props.t('externalToolsRetry')}</button></>}
    {state.loading && <p className={css.muted}>{props.t('externalToolsLoading')}</p>}
    {state.rows.map(row => <section className={css.card} key={row.entry.id}>
      <div className={css.header}><div><h3>{row.entry.displayName}</h3><p>{row.entry.description}</p></div><label className={css.toggle}><input type="checkbox" checked={row.enabled} onChange={() => { void props.toggle(row.entry.id) }} /><span>{props.t('externalToolsEnable')}</span></label></div>
      <div className={css.field}><label htmlFor={`external-tool-${row.entry.id}`}>{props.t('externalToolsApiKey')}</label><div className={css.inputRow}><input id={`external-tool-${row.entry.id}`} type="password" value={drafts[row.entry.id] ?? ''} placeholder={row.configured ? props.t('externalToolsKeyConfigured') : props.t('externalToolsKeyPlaceholder')} disabled={!row.writable} onChange={(event) => { setDrafts(prev => ({ ...prev, [row.entry.id]: event.target.value })) }} /><button type="button" disabled={!row.writable || (drafts[row.entry.id] ?? '') === ''} onClick={() => { void props.setKey(row.entry.id, drafts[row.entry.id] ?? '').then(() => { setDrafts(prev => ({ ...prev, [row.entry.id]: '' })) }) }}>{props.t('externalToolsSave')}</button>{row.configured && <button type="button" disabled={!row.writable} onClick={() => { void props.clearKey(row.entry.id) }}>{props.t('externalToolsClear')}</button>}</div><small className={row.configured ? css.ok : css.muted}>{row.configured ? props.t('externalToolsKeyConfigured') : props.t('externalToolsKeyUnset')}</small></div>
      {row.entry.baseURL !== undefined && <div className={css.field}><label htmlFor={`external-endpoint-${row.entry.id}`}>{props.t('externalToolsEndpoint')}</label><div className={css.inputRow}><input id={`external-endpoint-${row.entry.id}`} type="url" defaultValue={row.endpoint} placeholder={props.t('externalToolsEndpointPlaceholder')} disabled={!row.writable} onBlur={(event) => { void props.setEndpoint(row.entry.id, event.target.value) }} /></div></div>}
      {row.entry.capabilities.includes('search') && isNativeSearchProvider(row.entry.id) && <div className={css.field}><label htmlFor={`external-priority-${row.entry.id}`}>{props.t('externalToolsSearchPriority')}</label><select id={`external-priority-${row.entry.id}`} value={Math.max(0, state.searchPriority.indexOf(row.entry.id))} onChange={(event) => { const next = [...state.searchPriority]; const from = next.indexOf(row.entry.id); const to = Number(event.target.value); if (from >= 0 && from !== to) { next.splice(from, 1); next.splice(to, 0, row.entry.id); void props.setSearchPriority(next) } }}><option value={0}>1</option><option value={1}>2</option><option value={2}>3</option></select></div>}
      {row.entry.toolName === undefined && <small className={css.muted}>{props.t('externalToolsUnsupported')}</small>}
    </section>)}
  </div>
}
