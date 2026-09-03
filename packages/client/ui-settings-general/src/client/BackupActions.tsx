import { useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './BackupActions.module.css'

type BackupRequest = { action: 'exportConfig' | 'importConfig' | 'resetData' }
type BackupReply = { path?: string; ok?: boolean }

function bridge(): { request(request: BackupRequest): Promise<BackupReply> } | undefined {
  type DesktopBridgeWindow = Window & {
    dshDesktopPluginBridge?: { request: (request: BackupRequest) => Promise<BackupReply> }
  }
  return (window as DesktopBridgeWindow).dshDesktopPluginBridge
}

/** Settings actions for a desensitized configuration archive and data reset. */
export type BackupActionsProps = PropsRuntime<'settings.general.item'> & PropsLocale<'settings'>

/** Render native-backed export, import, and reset controls. */
export function BackupActions({ t }: BackupActionsProps) {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string>()
  const run = async (action: BackupRequest['action']): Promise<void> => {
    const native = bridge()
    if (native === undefined || busy) return
    setBusy(true)
    setStatus(undefined)
    try {
      const result = await native.request({ action })
      if (action === 'exportConfig' && result.path !== undefined) setStatus(t('backup.exported'))
      else if (action === 'importConfig' && result.ok === true) setStatus(t('backup.imported'))
      else if (action === 'resetData' && result.ok === true) setStatus(t('backup.reset'))
    } catch {
      setStatus(t('backup.error'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={css.row}>
      <div className={css.copy}>
        <div className={css.title}>{t('backup.title')}</div>
        <div className={css.description}>{t('backup.description')}</div>
        {status === undefined ? null : <div className={css.status} role="status">{status}</div>}
      </div>
      <div className={css.actions}>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => { void run('exportConfig') }}>{t('backup.export')}</Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => { void run('importConfig') }}>{t('backup.import')}</Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => { void run('resetData') }}>{t('backup.resetAction')}</Button>
      </div>
    </div>
  )
}
