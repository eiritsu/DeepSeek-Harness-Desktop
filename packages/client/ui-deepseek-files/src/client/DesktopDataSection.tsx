import { useState, type ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './DeepseekFilesSection.module.css'

interface ElectronDataBridge {
  exportConfiguration(): Promise<unknown>
  importConfiguration(): Promise<unknown>
  exportBackup(): Promise<unknown>
  importBackup(): Promise<unknown>
  reset(): Promise<unknown>
}

declare global {
  interface DshDesktopApplicationBridge {
    readonly data?: ElectronDataBridge
  }
  interface DshDesktopPluginBridge {
    request(request: { action: string }): Promise<unknown>
  }
  interface Window {
    dshDesktop?: DshDesktopApplicationBridge
    dshDesktopPluginBridge?: DshDesktopPluginBridge
  }
}

type DesktopDataSectionProps = PropsRuntime<'settings.section'> & PropsLocale<'settings.deepseekFiles'>
type Operation = 'configExport' | 'configImport' | 'sessionExport' | 'sessionImport' | 'sessionReset' | 'resetAll'

function operation(operation: Operation): Promise<unknown> {
  const electron = window.dshDesktop?.data
  if (electron !== undefined && operation !== 'resetAll') {
    if (operation === 'configExport') return electron.exportConfiguration()
    if (operation === 'configImport') return electron.importConfiguration()
    if (operation === 'sessionExport') return electron.exportBackup()
    if (operation === 'sessionImport') return electron.importBackup()
    return electron.reset()
  }
  const swift = window.dshDesktopPluginBridge
  if (swift === undefined) return Promise.reject(new Error('desktop data bridge unavailable'))
  const action = {
    configExport: 'exportConfig',
    configImport: 'importConfig',
    sessionExport: 'exportSessionDatabase',
    sessionImport: 'importSessionDatabase',
    sessionReset: 'resetSessionDatabase',
    resetAll: 'resetData',
  }[operation]
  return swift.request({ action })
}

/** Render desktop-shell backup, restore, and reset controls. */
export function DesktopDataSection({ t }: DesktopDataSectionProps): ReactNode {
  const electronAvailable = window.dshDesktop?.data !== undefined
  const swiftAvailable = window.dshDesktopPluginBridge !== undefined
  const available = electronAvailable || swiftAvailable
  const [busy, setBusy] = useState<Operation>()
  const [outcome, setOutcome] = useState<'done' | 'failed'>()
  const run = (kind: Operation): void => {
    setBusy(kind)
    setOutcome(undefined)
    void operation(kind).then(() => { setOutcome('done') }, () => { setOutcome('failed') })
      .finally(() => { setBusy(undefined) })
  }
  return (
    <div className={css.page}>
      <header>
        <h1>{t('dataTitle')}</h1>
        <p>{t('dataIntro')}</p>
      </header>
      {!available ? <p className={css.status}>{t('dataUnavailable')}</p> : (
        <>
          {electronAvailable || swiftAvailable ? <section className={css.card}>
            <h2>{t('configBackupTitle')}</h2>
            <p>{t('configBackupIntro')}</p>
            <div className={css.actions}>
              <button type="button" disabled={busy !== undefined} onClick={() => { run('configExport') }}>{t('exportData')}</button>
              <button type="button" className={css.secondary} disabled={busy !== undefined} onClick={() => { run('configImport') }}>{t('importData')}</button>
            </div>
          </section> : null}
          <section className={css.card}>
            <h2>{t('sessionBackupTitle')}</h2>
            <p>{t('sessionBackupIntro')}</p>
            <div className={css.actions}>
              <button type="button" disabled={busy !== undefined} onClick={() => { run('sessionExport') }}>{t('exportData')}</button>
              <button type="button" className={css.secondary} disabled={busy !== undefined} onClick={() => { run('sessionImport') }}>{t('importData')}</button>
              <button type="button" className={css.secondary} disabled={busy !== undefined} onClick={() => { run('sessionReset') }}>{t('resetSessions')}</button>
            </div>
          </section>
          {swiftAvailable ? <section className={css.card}>
            <h2>{t('resetAllTitle')}</h2>
            <p>{t('resetAllIntro')}</p>
            <div className={css.actions}>
              <button type="button" className={css.secondary} disabled={busy !== undefined} onClick={() => { run('resetAll') }}>{t('resetData')}</button>
            </div>
          </section> : null}
          {busy !== undefined ? <p className={css.status} role="status">{t('dataWorking')}</p> : null}
          {outcome === 'done' ? <p className={css.outcome} role="status">{t('dataDone')}</p> : null}
          {outcome === 'failed' ? <p className={css.error} role="alert">{t('dataFailed')}</p> : null}
        </>
      )}
    </div>
  )
}
