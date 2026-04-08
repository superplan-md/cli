import { useEffect, useLayoutEffect, useState, useRef, useCallback } from 'react'
import {
  IconCheck,
  IconArrowsMaximize,
  IconChevronRight,
  IconCircleFilled,
  IconExclamationCircle,
  IconLoader2,
  IconArrowsMinimize,
  IconX,
  IconGripVertical
} from '@tabler/icons-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useDesktopBootstrap } from '@/hooks/use-desktop-bootstrap'
import { useDesktopOverlayStore } from '@/stores/use-desktop-overlay-store'
import { cn } from '@/lib/utils'
import type { DesktopOverlayItem } from '../../../shared/desktop-contract'

const SHOW_OVERLAY_DEBUG = false

// How long the "done" outro progress bar runs before the item disappears
const DONE_OUTRO_MS = 3500
const SOUND_COOLDOWN_MS = 1200
let lastDoneSoundAt = 0
let lastFeedbackSoundAt = 0

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function formatDebugTimestamp(isoString: string | undefined): string {
  if (!isoString) return 'missing'
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) return 'invalid'
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function statusMeta(status: DesktopOverlayItem['status']): {
  badge: React.ComponentProps<typeof Badge>['variant']
  dotClass: string
  dotAnimClass: string
  chipBg: string
  chipText: string
  chipLabel: string
} {
  switch (status) {
    case 'needs_feedback':
      return {
        badge: 'default',
        dotClass: 'text-amber-700 dark:text-amber-300/75',
        dotAnimClass: 'animate-status-dot-feedback',
        chipBg: 'bg-amber-200 border-amber-400 dark:bg-amber-400/10 dark:border-amber-400/20',
        chipText: 'text-amber-900 dark:text-amber-200/90',
        chipLabel: 'Needs feedback'
      }
    case 'blocked':
      return {
        badge: 'default',
        dotClass: 'text-red-700 dark:text-red-300/75',
        dotAnimClass: 'animate-status-dot-blocked',
        chipBg: 'bg-red-200 border-red-400 dark:bg-red-400/10 dark:border-red-400/20',
        chipText: 'text-red-900 dark:text-red-200/90',
        chipLabel: 'Blocked'
      }
    case 'change_done':
      return {
        badge: 'success',
        dotClass: 'text-emerald-700 dark:text-emerald-300/75',
        dotAnimClass: '',
        chipBg:
          'bg-emerald-200 border-emerald-400 dark:bg-emerald-400/10 dark:border-emerald-400/20',
        chipText: 'text-emerald-900 dark:text-emerald-200/90',
        chipLabel: 'Change done'
      }
    case 'running':
      return {
        badge: 'active',
        dotClass: 'text-sky-700 dark:text-sky-300/75',
        dotAnimClass: 'animate-status-dot-running',
        chipBg: 'bg-sky-200 border-sky-400 dark:bg-sky-400/10 dark:border-sky-400/20',
        chipText: 'text-sky-900 dark:text-sky-200/90',
        chipLabel: 'In progress'
      }
  }
}

function itemInitials(item: DesktopOverlayItem): string {
  const words = item.workspaceName.trim().split(/\s+/)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return item.workspaceName.slice(0, 2).toUpperCase()
}

function workspaceColor(name: string): { bg: string; border: string; text: string } {
  // Murmur-inspired finalizer for uniform hue distribution.
  // path.basename names like "cli", "api", "web" were clustering near 50-80° (amber)
  // with simpler hashes. This maps the full uint32 range linearly to [0, 360).
  let h = 0
  for (let i = 0; i < name.length; i++) {
    h = Math.imul(h ^ name.charCodeAt(i), 2654435761)
    h ^= h >>> 17
  }
  h = Math.imul(h ^ (h >>> 15), 2246822519)
  h ^= h >>> 13
  h = Math.imul(h ^ (h >>> 16), 3266489917)
  h = h >>> 0 // unsigned 32-bit
  const hue = Math.floor((h / 0x100000000) * 360)
  return {
    bg: `hsla(${hue}, 50%, 50%, 0.18)`,
    border: `hsla(${hue}, 60%, 45%, 0.35)`,
    text: `hsla(${hue}, 70%, 35%, 0.95)`
  }
}

function withAudioContext(play: (ctx: AudioContext) => void): void {
  try {
    const ctx = new AudioContext()
    play(ctx)
    setTimeout(() => void ctx.close(), 2000)
  } catch {
    // AudioContext unavailable — silent fallback
  }
}

/**
 * Soft major arpeggio for "change done".
 */
function playDoneSound(): void {
  const now = Date.now()
  if (now - lastDoneSoundAt < SOUND_COOLDOWN_MS) return
  lastDoneSoundAt = now

  withAudioContext((ctx) => {
    const master = ctx.createGain()
    master.gain.setValueAtTime(0.18, ctx.currentTime)
    master.connect(ctx.destination)

    const notes = [523.25, 659.25, 783.99] // C5, E5, G5
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const env = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, ctx.currentTime)
      env.gain.setValueAtTime(0, ctx.currentTime + i * 0.1)
      env.gain.linearRampToValueAtTime(1, ctx.currentTime + i * 0.1 + 0.02)
      env.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.1 + 0.5)
      osc.connect(env)
      env.connect(master)
      osc.start(ctx.currentTime + i * 0.1)
      osc.stop(ctx.currentTime + i * 0.1 + 0.55)
    })
  })
}

/**
 * Brighter two-note ping for "needs feedback".
 */
function playFeedbackSound(): void {
  const now = Date.now()
  if (now - lastFeedbackSoundAt < SOUND_COOLDOWN_MS) return
  lastFeedbackSoundAt = now

  withAudioContext((ctx) => {
    const master = ctx.createGain()
    master.gain.setValueAtTime(0.16, ctx.currentTime)
    master.connect(ctx.destination)

    const notes = [698.46, 932.33] // F5, A#5
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const env = ctx.createGain()
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(freq, ctx.currentTime)
      env.gain.setValueAtTime(0, ctx.currentTime + i * 0.12)
      env.gain.linearRampToValueAtTime(1, ctx.currentTime + i * 0.12 + 0.015)
      env.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.12 + 0.35)
      osc.connect(env)
      env.connect(master)
      osc.start(ctx.currentTime + i * 0.12)
      osc.stop(ctx.currentTime + i * 0.12 + 0.4)
    })
  })
}

function useOverlayAutoResize(
  containerRef: React.RefObject<HTMLDivElement | null>,
  triggerKey: string
): void {
  const setOverlayState = useDesktopOverlayStore((state) => state.setOverlayState)
  const lastSentHeight = useRef<number | null>(null)

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return

    let cancelled = false
    let frameId: number | null = null

    function sync(): void {
      if (cancelled || !el) return

      const nextHeight = Math.max(88, Math.ceil(el.getBoundingClientRect().height) + 20)
      if (lastSentHeight.current === nextHeight) {
        return
      }

      lastSentHeight.current = nextHeight
      void window.desktop.resizeOverlay(nextHeight).then((nextState) => {
        if (!cancelled) {
          setOverlayState(nextState)
        }
      })
    }

    function scheduleSync(): void {
      if (cancelled || frameId !== null) {
        return
      }

      frameId = window.requestAnimationFrame(() => {
        frameId = null
        sync()
      })
    }

    scheduleSync()
    const observer = new ResizeObserver(() => {
      scheduleSync()
    })
    observer.observe(el)

    return () => {
      cancelled = true
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId)
      }
      observer.disconnect()
    }
  }, [containerRef, setOverlayState, triggerKey])
}

// ---------------------------------------------------------------------------
// OverlayDebugStrip
// ---------------------------------------------------------------------------

function OverlayDebugStrip(): React.JSX.Element {
  const overlaySummary = useDesktopOverlayStore((state) => state.overlaySummary)
  const overlaySummaryError = useDesktopOverlayStore((state) => state.overlaySummaryError)
  return (
    <div className="no-drag mb-3 rounded-lg border border-border/60 bg-foreground/3 px-2 py-1.5 text-[10px] uppercase tracking-[0.08em] text-muted-foreground/65">
      ws {overlaySummary?.activeWorkspaceCount ?? 0} · changes{' '}
      {overlaySummary?.activeChangeCount ?? 0} · gen{' '}
      {formatDebugTimestamp(overlaySummary?.generatedAt)}
      {overlaySummaryError ? ` · err ${overlaySummaryError}` : ''}
    </div>
  )
}

// ---------------------------------------------------------------------------
// WorkspaceAvatar — shared between Primary and Secondary cards
// ---------------------------------------------------------------------------

function WorkspaceAvatar({
  item,
  size = 'md'
}: {
  item: DesktopOverlayItem
  size?: 'sm' | 'md'
}): React.JSX.Element {
  const color = workspaceColor(item.workspaceName)
  const initials = itemInitials(item)
  return (
    <div
      className={cn(
        'shrink-0 flex items-center justify-center rounded-lg border font-bold uppercase tracking-wide',
        size === 'md' ? 'size-9 text-[0.6875rem]' : 'size-6 text-[0.55rem]'
      )}
      style={{ backgroundColor: color.bg, borderColor: color.border, color: color.text }}
    >
      {initials}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ProgressRing — animated SVG arc
// ---------------------------------------------------------------------------

function animateArc(el: SVGCircleElement, from: number, to: number, duration = 600): () => void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.style.strokeDashoffset = String(to)
    return () => {}
  }
  const anim = el.animate([{ strokeDashoffset: from }, { strokeDashoffset: to }], {
    duration,
    easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
    fill: 'forwards'
  })
  return () => anim.cancel()
}

function ProgressRing({ item }: { item: DesktopOverlayItem }): React.JSX.Element {
  const { status, taskDone, taskTotal } = item
  const percent = taskTotal > 0 ? Math.round((taskDone / taskTotal) * 100) : 0

  const size = 40
  const strokeWidth = 3
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius

  const arcRef = useRef<SVGCircleElement | null>(null)
  const prevPercent = useRef<number | null>(null)

  useEffect(() => {
    const el = arcRef.current
    if (!el) return
    const targetDashoffset = circumference - (percent / 100) * circumference
    const fromPercent = prevPercent.current ?? 0
    const fromDashoffset = circumference - (fromPercent / 100) * circumference
    const cleanup = animateArc(
      el,
      fromDashoffset,
      targetDashoffset,
      prevPercent.current === null ? 700 : 500
    )
    prevPercent.current = percent
    return cleanup
  }, [percent, circumference])

  const trackColor = 'rgba(100,116,139,0.15)'
  const fillColor =
    status === 'change_done'
      ? 'rgb(52 211 153 / 0.85)'
      : status === 'needs_feedback'
        ? 'rgb(251 191 36 / 0.85)'
        : status === 'blocked'
          ? 'rgb(252 165 165 / 0.75)'
          : 'rgb(56 189 248 / 0.85)'

  const isRunning = status === 'running'

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        // When running, spin the whole SVG so the arc orbits
        className={isRunning ? 'animate-ring-spin' : undefined}
        style={
          isRunning
            ? { transformOrigin: `${size / 2}px ${size / 2}px` }
            : { transform: 'rotate(-90deg)' }
        }
        aria-hidden
      >
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={trackColor}
          strokeWidth={strokeWidth}
        />
        {/* Animated progress arc */}
        <circle
          ref={arcRef}
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={fillColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference}
        />
      </svg>

      {/* Fraction label — task done / total */}
      <div className="absolute inset-0 flex items-center justify-center">
        {taskTotal > 0 ? (
          <span className="text-[0.5rem] font-semibold leading-none tabular-nums text-foreground/70">
            {taskDone}/{taskTotal}
          </span>
        ) : (
          <span className="text-[0.6rem] font-semibold leading-none tabular-nums text-foreground/70">
            {percent}
          </span>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// DoneOutroRow — wraps a SecondaryCard with completion outro animation
// ---------------------------------------------------------------------------

function DoneOutroRow({
  item,
  index,
  onDone
}: {
  item: DesktopOverlayItem
  index: number
  onDone: (key: string) => void
}): React.JSX.Element {
  const itemKey = `${item.workspaceId}:${item.changeId}`
  const [phase, setPhase] = useState<'bar' | 'exit' | 'gone'>('bar')

  useEffect(() => {
    // After the progress bar depletes, play exit animation
    const exitTimer = setTimeout(() => setPhase('exit'), DONE_OUTRO_MS)
    // After exit animation completes, remove from DOM
    const goneTimer = setTimeout(() => {
      setPhase('gone')
      onDone(itemKey)
    }, DONE_OUTRO_MS + 650)
    return () => {
      clearTimeout(exitTimer)
      clearTimeout(goneTimer)
    }
  }, [itemKey, onDone])

  if (phase === 'gone') return <></>

  return (
    <div className={cn('relative overflow-hidden', phase === 'exit' && 'animate-overlay-row-exit')}>
      <SecondaryCard item={item} index={index} isDoneOutro />
      {/* Progress bar depletes over DONE_OUTRO_MS */}
      {phase === 'bar' && (
        <div
          className="animate-done-progress-bar absolute bottom-0 left-0 h-px w-full bg-emerald-400/50"
          style={{ animationDuration: `${DONE_OUTRO_MS}ms` }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// PrimaryCard — avatar tile | middle column | progress ring
// ---------------------------------------------------------------------------

function PrimaryCard({ item }: { item: DesktopOverlayItem }): React.JSX.Element {
  const meta = statusMeta(item.status)
  const primaryInlineChipLabel =
    item.status === 'change_done'
      ? 'All done'
      : item.status === 'needs_feedback'
        ? 'Needs feedback'
        : null

  const itemKey = `${item.workspaceId}:${item.changeId}`
  const prevKey = useRef<string | null>(null)
  const [animKey, setAnimKey] = useState(0)

  useEffect(() => {
    if (prevKey.current !== null && prevKey.current !== itemKey) {
      setAnimKey((k) => k + 1)
    }
    prevKey.current = itemKey
  }, [itemKey])

  return (
    <div key={animKey} className="animate-overlay-content-in flex items-center gap-2.5 py-0">
      <WorkspaceAvatar item={item} size="md" />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="min-w-0 truncate text-[0.6rem] font-medium uppercase tracking-[0.08em] text-foreground/50">
            {item.workspaceName}
          </span>
          {primaryInlineChipLabel ? (
            <span
              className={cn(
                'inline-flex shrink-0 items-center rounded-full border px-1.5 py-px text-[0.55rem] font-medium leading-none',
                meta.chipBg,
                meta.chipText
              )}
            >
              {primaryInlineChipLabel}
            </span>
          ) : (
            <div className="flex items-center gap-1">
              <IconCircleFilled
                className={cn('size-1.5 shrink-0', meta.dotClass, meta.dotAnimClass)}
              />
              <span
                className={cn(
                  'text-[0.55rem] font-medium uppercase tracking-[0.08em]',
                  meta.chipText
                )}
              >
                {meta.chipLabel}
              </span>
            </div>
          )}
        </div>

        <div className="mt-1 line-clamp-2 text-[0.875rem] font-semibold leading-[1.1] text-foreground">
          {item.changeTitle}
        </div>

        <div className="mt-0.5 line-clamp-1 text-[0.6875rem] leading-[1.35] text-foreground/60">
          {item.preview}
        </div>
      </div>

      <ProgressRing item={item} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// SecondaryCard — compact row with drag handle, avatar, status chip
// ---------------------------------------------------------------------------

function SecondaryCard({
  item,
  index,
  isDoneOutro = false,
  dragHandleProps
}: {
  item: DesktopOverlayItem
  index: number
  isDoneOutro?: boolean
  dragHandleProps?: {
    handleProps: React.HTMLAttributes<HTMLDivElement>
    rowProps: React.HTMLAttributes<HTMLDivElement>
  }
}): React.JSX.Element {
  const meta = statusMeta(item.status)
  const isRunning = item.status === 'running'

  function handleClick(): void {
    // needs_feedback: ideally routes to the agent window that called request-feedback.
    // agentId is now on DesktopOverlayItem but the agent-window IPC is not yet wired —
    // overlay.json doesn't emit agent_id yet from the Superplan runtime.
    // TODO: when agent_id is populated, invoke a separate openAgentWindow(item.agentId) IPC.
    // For now, fall back to opening the board at the specific change for all statuses.
    void window.desktop.openBoardAtChange(item.workspacePath, item.changeId)
  }

  return (
    <div
      {...(dragHandleProps?.rowProps ?? {})}
      className={cn(
        'group animate-overlay-row-enter flex items-center gap-2 rounded-md px-2 py-1 transition-colors',
        isDoneOutro
          ? 'bg-emerald-400/[0.04]'
          : 'cursor-pointer hover:bg-foreground/[0.04] active:bg-foreground/[0.07]'
      )}
      onClick={isDoneOutro ? undefined : handleClick}
      role={isDoneOutro ? undefined : 'button'}
      style={{ animationDelay: `${index * 55}ms` }}
      tabIndex={isDoneOutro ? undefined : 0}
      onKeyDown={
        isDoneOutro
          ? undefined
          : (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                handleClick()
              }
            }
      }
    >
      {/* Workspace avatar */}
      <WorkspaceAvatar item={item} size="sm" />

      {/* Text */}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[0.6875rem] font-medium leading-snug text-foreground">
          {item.changeTitle}
        </div>
        <div className="mt-0.5 truncate text-[0.6rem] font-medium uppercase tracking-[0.06em] text-foreground/50">
          {item.workspaceName}
        </div>
      </div>

      {/* Status chip — running state gets a soft pulse to signal activity */}
      <span
        className={cn(
          'relative shrink-0 overflow-hidden rounded-full border px-1.5 py-px text-[0.55rem] font-medium leading-none',
          meta.chipBg,
          meta.chipText,
          isRunning && 'animate-secondary-running-pulse'
        )}
      >
        {isRunning && (
          <span className="absolute inset-0 animate-chip-shimmer pointer-events-none">
            <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent" />
          </span>
        )}
        {meta.chipLabel}
      </span>

      {/* Drag handle — right side, in-flow but opacity-0 at rest so no layout shift */}
      {!isDoneOutro && (
        <div
          {...(dragHandleProps?.handleProps ?? {})}
          className="no-drag shrink-0 cursor-grab opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
          onClick={(e) => e.stopPropagation()}
          title="Drag to reorder"
        >
          <IconGripVertical className="size-3 text-foreground/35" stroke={2} />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// useDoneOutro — detects when an item transitions to change_done while visible
// ---------------------------------------------------------------------------

function useDoneOutro(items: DesktopOverlayItem[]): {
  outroItems: DesktopOverlayItem[]
  visibleItems: DesktopOverlayItem[]
  dismissOutro: (key: string) => void
} {
  const knownDoneKeys = useDesktopOverlayStore((state) => state.knownDoneKeys)
  const overlaySummaryPrimed = useDesktopOverlayStore((state) => state.overlaySummaryPrimed)
  const addKnownDoneKeys = useDesktopOverlayStore((state) => state.addKnownDoneKeys)
  const [outroMap, setOutroMap] = useState<Map<string, DesktopOverlayItem>>(new Map())

  useEffect(() => {
    if (!overlaySummaryPrimed) {
      return
    }

    const newOutros: DesktopOverlayItem[] = []
    const newDoneKeys: string[] = []

    items.forEach((item) => {
      const key = `${item.workspaceId}:${item.changeId}`
      if (item.status === 'change_done' && !knownDoneKeys.has(key)) {
        newOutros.push(item)
        newDoneKeys.push(key)
      }
    })

    if (newDoneKeys.length > 0) {
      addKnownDoneKeys(newDoneKeys)
    }

    if (newOutros.length > 0) {
      playDoneSound()
      setOutroMap((m) => {
        const next = new Map(m)
        newOutros.forEach((item) => {
          next.set(`${item.workspaceId}:${item.changeId}`, item)
        })
        return next
      })
    }
  }, [items, knownDoneKeys, overlaySummaryPrimed, addKnownDoneKeys])

  const dismissOutro = useCallback((key: string) => {
    setOutroMap((m) => {
      const next = new Map(m)
      next.delete(key)
      return next
    })
  }, [])

  const visibleItems = items.filter((item) => item.status !== 'change_done')
  const outroItems = Array.from(outroMap.values())

  return { outroItems, visibleItems, dismissOutro }
}

// ---------------------------------------------------------------------------
// EmptyOverlayCard
// ---------------------------------------------------------------------------

function EmptyOverlayCard({
  onCollapse,
  onClose,
  onOpenBoard
}: {
  onCollapse: () => void
  onClose: () => void
  onOpenBoard: () => void
}): React.JSX.Element {
  const cardRef = useRef<HTMLDivElement | null>(null)
  useOverlayAutoResize(cardRef, 'empty')

  return (
    <div
      ref={cardRef}
      className="animate-overlay-island-enter overlay-surface drag-region flex h-full flex-col overflow-hidden p-3 text-foreground shadow-xl"
    >
      {SHOW_OVERLAY_DEBUG ? <OverlayDebugStrip /> : null}

      <div className="flex items-center gap-0.5">
        <Button
          aria-label="Close overlay"
          className="no-drag text-red-600 dark:text-red-300/90 hover:bg-red-500/15 dark:hover:bg-red-400/12 hover:text-red-700 dark:hover:text-red-200"
          onClick={onClose}
          size="icon-sm"
          variant="ghost"
        >
          <IconX className="size-3.5" stroke={2} />
        </Button>
        <Button
          aria-label="Collapse to chip"
          className="no-drag text-foreground/50 hover:bg-foreground/10 hover:text-foreground/80"
          onClick={onCollapse}
          size="icon-sm"
          variant="ghost"
        >
          <IconArrowsMinimize className="size-3.5" stroke={1.5} />
        </Button>

        <div className="flex-1" />

        <button
          className="no-drag inline-flex items-center gap-1 text-[0.6875rem] font-medium text-foreground/72 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          onClick={onOpenBoard}
          type="button"
        >
          View board
          <IconChevronRight className="size-3" stroke={2} />
        </button>
      </div>

      <div className="mt-2">
        <div className="text-[0.875rem] font-semibold leading-tight text-foreground">
          Nothing needs attention
        </div>
        <p className="mt-1 text-[0.75rem] leading-relaxed text-muted-foreground/70">
          Open the board for the full workspace view.
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// OverlayCard — main card
// ---------------------------------------------------------------------------

function OverlayCard(): React.JSX.Element {
  const overlaySummary = useDesktopOverlayStore((state) => state.overlaySummary)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const [expanded, setExpanded] = useState(false)

  // Drag-to-reorder state for secondary items
  const [order, setOrder] = useState<string[]>([])
  const dragIndexRef = useRef<number | null>(null)
  const dragOverIndexRef = useRef<number | null>(null)

  const allItems = overlaySummary?.allItems ?? []
  const { outroItems, visibleItems, dismissOutro } = useDoneOutro(allItems)
  const primaryItem = visibleItems[0] ?? null
  const allSecondary = visibleItems.slice(1)
  const secondaryOrderSignature = allSecondary
    .map((i) => `${i.workspaceId}:${i.changeId}`)
    .join('|')

  // Sync order array when visible secondary items change.
  useEffect(() => {
    setOrder((prev) => {
      const keys = allSecondary.map((i) => `${i.workspaceId}:${i.changeId}`)
      // Add new keys at end, remove gone keys
      const filtered = prev.filter((k) => keys.includes(k))
      const added = keys.filter((k) => !filtered.includes(k))
      return [...filtered, ...added]
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondaryOrderSignature])

  const orderedSecondary = order
    .map((key) => allSecondary.find((i) => `${i.workspaceId}:${i.changeId}` === key))
    .filter((i): i is DesktopOverlayItem => i !== undefined)

  const filteredSecondary = orderedSecondary
  const visibleSecondary = expanded ? filteredSecondary : []
  const hiddenSecondaryCount = filteredSecondary.length
  const resizeTriggerKey = [
    primaryItem ? `${primaryItem.workspaceId}:${primaryItem.changeId}:${primaryItem.status}:${primaryItem.taskDone}/${primaryItem.taskTotal}` : 'no-primary',
    filteredSecondary
      .map((item) => `${item.workspaceId}:${item.changeId}:${item.status}:${item.taskDone}/${item.taskTotal}`)
      .join('|'),
    outroItems
      .map((item) => `${item.workspaceId}:${item.changeId}:${item.status}:${item.taskDone}/${item.taskTotal}`)
      .join('|'),
    hiddenSecondaryCount,
    expanded ? 'expanded' : 'collapsed',
    overlaySummary?.activeChangeCount ?? 0,
    overlaySummary?.needsFeedbackCount ?? 0,
    overlaySummary?.runningCount ?? 0,
    overlaySummary?.blockedCount ?? 0,
    overlaySummary?.completedCount ?? 0
  ].join('::')
  useOverlayAutoResize(cardRef, resizeTriggerKey)

  const handleCollapseToChip = useCallback(async (): Promise<void> => {
    useDesktopOverlayStore.getState().setOverlayMode('chip')
    const nextState = await window.desktop.setOverlayMode('chip')
    useDesktopOverlayStore.getState().setOverlayState(nextState)
  }, [])

  const handleOpenBoard = useCallback(async (): Promise<void> => {
    await window.desktop.openBoard()
  }, [])

  const handleCloseOverlay = useCallback(async (): Promise<void> => {
    await window.desktop.closeOverlay()
  }, [])

  // Drag handlers for reordering — split between handle (drag source) and row (drop target)
  function makeDragHandleProps(index: number): {
    handleProps: React.HTMLAttributes<HTMLDivElement>
    rowProps: React.HTMLAttributes<HTMLDivElement>
  } {
    return {
      handleProps: {
        draggable: true,
        onDragStart: (e: React.DragEvent) => {
          dragIndexRef.current = index
          e.dataTransfer.effectAllowed = 'move'
          // Required for Firefox
          e.dataTransfer.setData('text/plain', String(index))
        }
      },
      rowProps: {
        onDragOver: (e: React.DragEvent) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          dragOverIndexRef.current = index
        },
        onDrop: (e: React.DragEvent) => {
          e.preventDefault()
          const from = dragIndexRef.current
          const to = dragOverIndexRef.current
          if (from === null || to === null || from === to) return
          setOrder((prev) => {
            const next = [...prev]
            const [moved] = next.splice(from, 1)
            next.splice(to, 0, moved)
            return next
          })
          dragIndexRef.current = null
          dragOverIndexRef.current = null
        },
        onDragEnd: () => {
          dragIndexRef.current = null
          dragOverIndexRef.current = null
        }
      }
    }
  }

  if (!overlaySummary || (!primaryItem && outroItems.length === 0)) {
    return (
      <EmptyOverlayCard
        onCollapse={() => void handleCollapseToChip()}
        onClose={() => void handleCloseOverlay()}
        onOpenBoard={() => void handleOpenBoard()}
      />
    )
  }

  const hasOpenWork =
    overlaySummary.runningCount > 0 ||
    overlaySummary.needsFeedbackCount > 0 ||
    overlaySummary.blockedCount > 0

  return (
    <div
      ref={cardRef}
      className="animate-overlay-island-enter overlay-surface drag-region relative flex flex-col overflow-hidden px-3 pb-2 pt-1 text-foreground shadow-xl"
    >
      {SHOW_OVERLAY_DEBUG ? <OverlayDebugStrip /> : null}

      {/* Top bar */}
      <div className="mb-1 flex items-center gap-0.5">
        <Button
          aria-label="Close overlay"
          className="no-drag text-red-600 dark:text-red-300/90 hover:bg-red-500/15 dark:hover:bg-red-400/12 hover:text-red-700 dark:hover:text-red-200"
          onClick={() => void handleCloseOverlay()}
          size="icon-xs"
          variant="ghost"
        >
          <IconX className="size-3.5" stroke={2} />
        </Button>
        {hasOpenWork ? (
          <Button
            aria-label="Collapse to chip"
            className="no-drag text-foreground/50 hover:bg-foreground/10 hover:text-foreground/80"
            onClick={() => void handleCollapseToChip()}
            size="icon-xs"
            variant="ghost"
          >
            <IconArrowsMinimize className="size-3.5" stroke={1.5} />
          </Button>
        ) : null}

        <div className="flex-1" />

        <button
          className="no-drag inline-flex items-center gap-1 text-[0.6875rem] font-medium text-foreground/74 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          onClick={() => void handleOpenBoard()}
          type="button"
        >
          View board
          {!expanded && hiddenSecondaryCount > 0 ? (
            <span className="inline-flex items-center rounded-full border border-foreground/14 bg-foreground/[0.05] px-1.5 py-0 text-[0.6rem] font-medium text-foreground/70">
              {hiddenSecondaryCount}
            </span>
          ) : null}
          <IconChevronRight className="-ml-1 size-3" stroke={2} />
        </button>
      </div>

      {/* Primary item */}
      {primaryItem ? <PrimaryCard item={primaryItem} /> : null}

      {/* Outro rows for newly-completed items */}
      {outroItems.length > 0 ? (
        <div className="mt-2 flex flex-col divide-y divide-border/35 border-t border-border/45 pt-1">
          {outroItems.map((item, i) => (
            <DoneOutroRow
              key={`${item.workspaceId}:${item.changeId}`}
              item={item}
              index={i}
              onDone={dismissOutro}
            />
          ))}
        </div>
      ) : null}

      {/* Secondary items */}
      {visibleSecondary.length > 0 || (!expanded && filteredSecondary.length > 0) ? (
        <div
          className={cn(
            'mt-2',
            expanded
              ? 'flex flex-col divide-y divide-border/35 border-t border-border/45 pt-1'
              : 'flex justify-end'
          )}
        >
          {visibleSecondary.map((item, i) => (
            <SecondaryCard
              key={`${item.workspaceId}:${item.changeId}`}
              item={item}
              index={i}
              dragHandleProps={makeDragHandleProps(i)}
            />
          ))}
          {hiddenSecondaryCount > 0 ? (
            <div className={cn('flex', expanded ? 'justify-end pt-1' : 'justify-end')}>
              <button
                className="no-drag text-[0.6rem] text-foreground/40 transition-colors hover:text-foreground/70 focus-visible:outline-none"
                onClick={() => setExpanded((v) => !v)}
                type="button"
              >
                {expanded ? 'show less' : `+${hiddenSecondaryCount} more`}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// OverlayChip — compact chip with animated activity icon
// ---------------------------------------------------------------------------

function OverlayChip(): React.JSX.Element {
  const overlaySummary = useDesktopOverlayStore((state) => state.overlaySummary)
  const setOverlayState = useDesktopOverlayStore((state) => state.setOverlayState)

  const isWorking = (overlaySummary?.runningCount ?? 0) > 0
  const [debouncedWorking, setDebouncedWorking] = useState(isWorking)

  useEffect(() => {
    if (isWorking) {
      setDebouncedWorking(true)
      return undefined
    } else {
      const timeout = setTimeout(() => setDebouncedWorking(false), 3000)
      return () => clearTimeout(timeout)
    }
  }, [isWorking])

  const needsAttention =
    (overlaySummary?.needsFeedbackCount ?? 0) > 0 ||
    (overlaySummary?.blockedCount ?? 0) > 0 ||
    overlaySummary?.primary?.status === 'needs_feedback' ||
    overlaySummary?.primary?.status === 'blocked'

  const prevFeedbackCount = useRef(overlaySummary?.needsFeedbackCount ?? 0)
  const prevCompletedCount = useRef(overlaySummary?.completedCount ?? 0)

  useEffect(() => {
    const currentFeedback = overlaySummary?.needsFeedbackCount ?? 0
    const currentCompleted = overlaySummary?.completedCount ?? 0
    const feedbackIncreased = currentFeedback > prevFeedbackCount.current
    const completedIncreased = currentCompleted > prevCompletedCount.current

    if (feedbackIncreased || completedIncreased) {
      if (feedbackIncreased) {
        playFeedbackSound()
      } else if (completedIncreased) {
        playDoneSound()
      }
      useDesktopOverlayStore.getState().setOverlayMode('card')
      window.desktop.setOverlayMode('card').then(setOverlayState)
    }
    prevFeedbackCount.current = currentFeedback
    prevCompletedCount.current = currentCompleted
  }, [overlaySummary?.needsFeedbackCount, overlaySummary?.completedCount, setOverlayState])

  const handleExpand = useCallback(async (): Promise<void> => {
    useDesktopOverlayStore.getState().setOverlayMode('card')
    const nextState = await window.desktop.setOverlayMode('card')
    setOverlayState(nextState)
  }, [setOverlayState])

  const hasCompleted =
    (overlaySummary?.activeChangeCount ?? 0) > 0 &&
    (overlaySummary?.completedCount ?? 0) === (overlaySummary?.activeChangeCount ?? 0)
  const isGlowing = needsAttention
  const message = isGlowing
    ? 'Needs attention'
    : debouncedWorking
      ? 'In progress'
      : hasCompleted
        ? 'All done'
        : 'All done'

  return (
    <div
      className={cn(
        'animate-overlay-island-enter overlay-surface drag-region group flex w-fit items-center justify-center gap-1.5 overflow-hidden rounded-lg px-2.5 py-1.5 text-foreground transition-all duration-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 focus-visible:ring-offset-0'
      )}
      onClick={() => void handleExpand()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          void handleExpand()
        }
      }}
    >
      <div className="relative flex h-4 w-4 shrink-0 items-center justify-center text-foreground/70">
        {isGlowing ? (
          <IconExclamationCircle
            className="size-3 text-amber-600 dark:text-amber-300"
            stroke={1.8}
          />
        ) : debouncedWorking ? (
          <IconLoader2
            className="size-3 animate-ring-spin text-sky-600 dark:text-sky-200"
            stroke={1.8}
          />
        ) : (
          <IconCheck className="size-3 text-emerald-600 dark:text-emerald-200" stroke={1.8} />
        )}
      </div>

      <div className="min-w-0 shrink-0 whitespace-nowrap">
        <div
          className={cn(
            'truncate text-[0.5625rem] font-semibold leading-none tracking-[0.005em]',
            isGlowing
              ? 'text-amber-700 dark:text-amber-50'
              : hasCompleted
                ? 'text-emerald-700 dark:text-emerald-50'
                : 'text-foreground/80'
          )}
        >
          {message}
        </div>
      </div>

      <Button
        aria-label="Expand overlay"
        className="no-drag ml-1 h-5 w-5 shrink-0 rounded-[10px] px-0 text-foreground/50 transition-all hover:bg-foreground/[0.08] hover:text-foreground/80"
        onClick={(e) => {
          e.stopPropagation()
          void handleExpand()
        }}
        size="icon-sm"
        title="Expand overlay"
        variant="ghost"
      >
        <IconArrowsMaximize className="size-3" stroke={1.5} />
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// OverlayWindow — root
// ---------------------------------------------------------------------------

export function OverlayWindow(): React.JSX.Element {
  useDesktopBootstrap()
  const overlayMode = useDesktopOverlayStore((state) => state.overlayState.mode)

  return (
    <main className="h-screen w-screen">
      <div
        className={cn(
          'flex h-full w-full justify-center',
          overlayMode === 'chip' ? 'items-center' : 'items-start'
        )}
      >
        {overlayMode === 'chip' ? (
          <OverlayChip />
        ) : (
          <div className="w-screen overflow-hidden bg-transparent text-foreground">
            <div className="w-full">
              <OverlayCard />
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
