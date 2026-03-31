import { useState } from 'react'
import {
  IconBrandGithub,
  IconBuildingCommunity,
  IconExternalLink,
  IconInfoCircle,
  IconRefresh,
  IconSettings2,
  IconStar,
  IconToggleLeft,
  IconToggleRight
} from '@tabler/icons-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DialogBackdrop,
  DialogClose,
  DialogPopup,
  DialogPortal,
  DialogRoot,
  DialogTrigger
} from '@/components/ui/dialog'
import { useDesktopConfigStore } from '@/stores/use-desktop-config-store'
import { updateTheme } from '@/lib/apply-theme'
import type { ThemeMode } from '../../../shared/desktop-contract'

type SettingsSection = 'general' | 'preferences' | 'about'

const NAV_ITEMS: { id: SettingsSection; label: string; icon: React.ReactNode }[] = [
  {
    id: 'general',
    label: 'General',
    icon: <IconSettings2 style={{ width: 14, height: 14 }} stroke={1.8} />
  },
  {
    id: 'preferences',
    label: 'Preferences',
    icon: <IconBuildingCommunity style={{ width: 14, height: 14 }} stroke={1.8} />
  },
  {
    id: 'about',
    label: 'About Us',
    icon: <IconInfoCircle style={{ width: 14, height: 14 }} stroke={1.8} />
  }
]

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System Default' }
]

const GITHUB_REPO = 'https://github.com/superplan-md/superplan-plugin'
const GITHUB_API_LATEST = 'https://api.github.com/repos/superplan-md/superplan-plugin/releases/latest'

type UpdateResult =
  | { status: 'up_to_date'; version: string }
  | { status: 'update_available'; version: string; publishedAt: string; htmlUrl: string }
  | { status: 'error'; message: string }

function SectionHeading({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div
      style={{ fontSize: '10px', letterSpacing: '0.08em' }}
      className="mb-3 font-semibold uppercase text-muted-foreground/50"
    >
      {children}
    </div>
  )
}

function Row({
  label,
  description,
  children
}: {
  label: string
  description?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <div style={{ fontSize: '12.5px' }} className="font-medium text-foreground/88">
          {label}
        </div>
        {description ? (
          <div style={{ fontSize: '11px' }} className="mt-0.5 text-muted-foreground/60">
            {description}
          </div>
        ) : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function Toggle({
  checked,
  onChange
}: {
  checked: boolean
  onChange: (next: boolean) => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'flex items-center transition-colors',
        checked ? 'text-sky-400' : 'text-foreground/30 hover:text-foreground/50'
      )}
    >
      {checked ? (
        <IconToggleRight style={{ width: 28, height: 28 }} stroke={1.5} />
      ) : (
        <IconToggleLeft style={{ width: 28, height: 28 }} stroke={1.5} />
      )}
    </button>
  )
}

function GeneralSection(): React.JSX.Element {
  const config = useDesktopConfigStore((s) => s.config)
  const mergeConfig = useDesktopConfigStore((s) => s.mergeConfig)

  function handleTheme(mode: ThemeMode): void {
    mergeConfig({ themeMode: mode })
    updateTheme(mode)
    void window.desktop.updateConfig({ themeMode: mode })
  }

  return (
    <div>
      <SectionHeading>Appearance</SectionHeading>

      <Row label="Theme" description="Choose how the app looks">
        <div className="flex gap-1">
          {THEME_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleTheme(opt.value)}
              style={{ fontSize: '11.5px' }}
              className={cn(
                'rounded-md px-2.5 py-1 font-medium transition-colors',
                config.themeMode === opt.value
                  ? 'bg-foreground/[0.10] text-foreground'
                  : 'text-foreground/45 hover:bg-foreground/[0.05] hover:text-foreground/70'
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </Row>
    </div>
  )
}

function PreferencesSection(): React.JSX.Element {
  const config = useDesktopConfigStore((s) => s.config)
  const mergeConfig = useDesktopConfigStore((s) => s.mergeConfig)
  const [checking, setChecking] = useState(false)
  const [updateResult, setUpdateResult] = useState<UpdateResult | null>(null)

  function handleOverlayToggle(next: boolean): void {
    mergeConfig({ overlayEnabled: next })
    void window.desktop.updateConfig({ overlayEnabled: next })
  }

  async function handleCheckForUpdate(): Promise<void> {
    setChecking(true)
    setUpdateResult(null)
    try {
      const res = await fetch(GITHUB_API_LATEST, {
        headers: { Accept: 'application/vnd.github+json' }
      })
      if (!res.ok) throw new Error(`GitHub API returned ${res.status}`)
      const data = (await res.json()) as {
        tag_name: string
        published_at: string
        html_url: string
      }
      const latestVersion = data.tag_name.replace(/^v/, '')
      const currentVersion = '1.0.0' // matches package.json version
      if (latestVersion === currentVersion) {
        setUpdateResult({ status: 'up_to_date', version: latestVersion })
      } else {
        setUpdateResult({
          status: 'update_available',
          version: latestVersion,
          publishedAt: data.published_at,
          htmlUrl: data.html_url
        })
      }
    } catch (err) {
      setUpdateResult({
        status: 'error',
        message: err instanceof Error ? err.message : 'Unknown error'
      })
    } finally {
      setChecking(false)
    }
  }

  return (
    <div>
      <SectionHeading>Overlay</SectionHeading>

      <Row label="Enable overlay" description="Show the floating overlay window while working">
        <Toggle checked={config.overlayEnabled} onChange={handleOverlayToggle} />
      </Row>

      <div className="my-3 border-t border-foreground/[0.06]" />

      <SectionHeading>Updates</SectionHeading>

      <Row label="Check for updates" description="Checks the latest release on GitHub">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleCheckForUpdate()}
            disabled={checking}
            className="gap-1.5 text-foreground/60"
          >
            <IconRefresh
              style={{ width: 12, height: 12 }}
              stroke={2}
              className={cn(checking && 'animate-spin')}
            />
            {checking ? 'Checking…' : 'Check now'}
          </Button>
        </div>
      </Row>

      {updateResult ? (
        <div
          style={{ fontSize: '11px' }}
          className={cn(
            'mt-1 rounded-md px-3 py-2',
            updateResult.status === 'update_available'
              ? 'bg-sky-400/10 text-sky-300'
              : updateResult.status === 'error'
                ? 'bg-red-400/10 text-red-300'
                : 'text-muted-foreground/60'
          )}
        >
          {updateResult.status === 'up_to_date' && (
            <span>You&apos;re on the latest version ({updateResult.version}).</span>
          )}
          {updateResult.status === 'error' && <span>Could not check: {updateResult.message}</span>}
          {updateResult.status === 'update_available' && (
            <span className="flex items-center gap-2">
              <span>
                Version <strong>{updateResult.version}</strong> is available.
              </span>
              <a
                href={updateResult.htmlUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-0.5 underline hover:text-sky-200"
              >
                View release
                <IconExternalLink style={{ width: 10, height: 10 }} stroke={2} />
              </a>
              <Button
                variant="outline"
                size="sm"
                disabled
                className="gap-1 text-foreground/40"
                title="Update Now (coming soon)"
              >
                Update Now
              </Button>
            </span>
          )}
        </div>
      ) : null}
    </div>
  )
}

function AboutSection(): React.JSX.Element {
  return (
    <div>
      <SectionHeading>About</SectionHeading>

      <div className="space-y-4">
        <div>
          <div style={{ fontSize: '15px' }} className="font-semibold text-foreground/88">
            Superplan
          </div>
          <div style={{ fontSize: '11.5px' }} className="mt-0.5 text-muted-foreground/60">
            AI-powered workspace planning
          </div>
        </div>

        <Row label="Source code" description="View the project on GitHub">
          <a
            href={GITHUB_REPO}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: '11.5px' }}
            className="flex items-center gap-1 text-sky-400 hover:text-sky-300 hover:underline"
          >
            <IconBrandGithub style={{ width: 13, height: 13 }} stroke={1.8} />
            GitHub
            <IconExternalLink style={{ width: 11, height: 11 }} stroke={2} />
          </a>
        </Row>

        <div className="rounded-md border border-yellow-400/20 bg-yellow-400/5 px-3 py-2.5">
          <div className="flex items-start gap-2">
            <IconStar
              style={{ width: 14, height: 14, marginTop: 1 }}
              stroke={1.8}
              className="shrink-0 text-yellow-400/70"
            />
            <div>
              <div style={{ fontSize: '12px' }} className="font-medium text-foreground/80">
                Enjoying Superplan? Give us a star!
              </div>
              <div style={{ fontSize: '11px' }} className="mt-0.5 text-muted-foreground/55">
                It helps others discover the project and keeps us motivated.{' '}
                <a
                  href={GITHUB_REPO}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sky-400 hover:underline"
                >
                  Star on GitHub →
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const SECTION_COMPONENTS: Record<SettingsSection, () => React.JSX.Element> = {
  general: GeneralSection,
  preferences: PreferencesSection,
  about: AboutSection
}

interface SettingsDialogProps {
  trigger: React.ReactNode
}

export function SettingsDialog({ trigger }: SettingsDialogProps): React.JSX.Element {
  const [activeSection, setActiveSection] = useState<SettingsSection>('general')
  const ActivePanel = SECTION_COMPONENTS[activeSection]

  return (
    <DialogRoot>
      <DialogTrigger render={trigger as React.ReactElement}></DialogTrigger>

      <DialogPortal>
        <DialogBackdrop />
        <DialogPopup style={{ width: 560, minHeight: 340 }}>
          {/* Left nav */}
          <nav className="flex w-40 shrink-0 flex-col gap-px border-r border-foreground/[0.07] bg-foreground/[0.02] px-2 py-4">
            <div
              style={{ fontSize: '10px', letterSpacing: '0.08em' }}
              className="mb-2 px-2 font-semibold uppercase text-muted-foreground/40"
            >
              Settings
            </div>
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveSection(item.id)}
                style={{ fontSize: '12.5px' }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-left font-medium transition-colors',
                  activeSection === item.id
                    ? 'bg-foreground/[0.08] text-foreground/90'
                    : 'text-foreground/45 hover:bg-foreground/[0.04] hover:text-foreground/70'
                )}
              >
                <span className="shrink-0 text-current">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </nav>

          {/* Right panel */}
          <div className="relative flex min-w-0 flex-1 flex-col">
            <DialogClose />
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <ActivePanel />
            </div>
          </div>
        </DialogPopup>
      </DialogPortal>
    </DialogRoot>
  )
}
