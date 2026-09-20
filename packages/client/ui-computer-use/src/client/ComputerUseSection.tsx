/**
 * Computer Use settings section: the native desktop-control master toggle and
 * its current status. The Host serves the section only while its own
 * `computer-use-cua-driver-native` settings namespace is available, so the page
 * carries no "unavailable" branch; this component still guards the mirror in
 * case the section unmounts one render after the namespace went away. The
 * switch follows the durable setting, never the click echo.
 */
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { createComputerUseStore } from './settings-store.ts'
import css from './ComputerUseSection.module.css'

/** Injected business face: the runtime toggle write (t rides the standard locale seat). */
export interface ComputerUseInjected {
  /** Ask the Host to mount or unmount the native runtime. */
  setEnabled: (enabled: boolean) => void
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type ComputerUseSectionProps =
  PropsRuntime<'settings.section'> & PropsStore<ReturnType<typeof createComputerUseStore>>
  & PropsLocale<'settings.computerUse'> & ComputerUseInjected

/**
 * Render the Computer Use section.
 * @param props - composed slot props.
 * @returns the section element tree, or nothing while the namespace is unavailable.
 */
export function ComputerUseSection({ t, setEnabled, useStore }: ComputerUseSectionProps) {
  const available = useStore(s => s.available)
  const writable = useStore(s => s.writable)
  const enabled = useStore(s => s.enabled)
  if (!available) return null
  return (
    <div className={css.section}>
      <h2 className={css.title}>{t('computerUse.title')}</h2>
      <p className={css.description}>{t('computerUse.description')}</p>
      <div className={css.row}>
        <div className={css.rowText}>
          <div className={css.rowTitle}>{t('computerUse.toggle')}</div>
          <div className={css.status} role="status">
            {t(enabled ? 'computerUse.status.enabled' : 'computerUse.status.disabled')}
          </div>
        </div>
        <Switch
          checked={enabled}
          label={t('computerUse.toggle')}
          disabled={!writable}
          onChange={setEnabled}
        />
      </div>
    </div>
  )
}
