/**
 * ObligationDashboard — shows obligations discovered from Arc Mainnet for the connected wallet.
 * Organized into buckets: needs action, created by you, funded by you, completed.
 * Source of truth: onchain state via useObligationDiscovery.
 */

import { Loader2, RefreshCw, AlertCircle, ArrowRight, Clock, CheckCircle, Users, ExternalLink } from 'lucide-react'
import type { DiscoveredObligation } from '../hooks/useObligationDiscovery'
import { ObligationStatus } from '../contract'
import { getTxUrl, formatAddress } from '../utils'

interface Props {
  obligations: DiscoveredObligation[]
  loading: boolean
  error: string
  totalCount: number
  onOpen: (id: bigint) => void
  onRefetch: () => void
}

const BUCKET_ORDER: Array<{
  key: DiscoveredObligation['buckets'][number]
  label: string
}> = [
  { key: 'needs-action', label: 'Needs your contribution' },
  { key: 'created-by-you', label: 'Created by you' },
  { key: 'funded-by-you', label: 'Funded by you' },
  { key: 'completed', label: 'Completed' },
]

export default function ObligationDashboard({
  obligations,
  loading,
  error,
  totalCount,
  onOpen,
  onRefetch,
}: Props) {
  if (loading) {
    return (
      <div className="flex items-center gap-3 py-6" style={{ color: 'var(--muted)' }}>
        <Loader2 className="size-4 animate-spin" />
        <span className="text-sm">Scanning Arc Mainnet for your obligations…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-start gap-3 py-4">
        <AlertCircle className="size-4 mt-0.5 shrink-0" style={{ color: 'var(--danger)' }} />
        <div className="flex-1">
          <p className="text-sm" style={{ color: 'var(--danger)' }}>
            Could not load obligations from Arc Mainnet.
          </p>
          <button
            onClick={onRefetch}
            className="mt-1 flex items-center gap-1 text-xs font-medium hover:opacity-70 transition-opacity"
            style={{ color: 'var(--muted)' }}
          >
            <RefreshCw className="size-3" /> Try again
          </button>
        </div>
      </div>
    )
  }

  if (obligations.length === 0 && totalCount === 0) {
    return (
      <div className="py-4">
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          No obligations on Arc Mainnet yet.
        </p>
      </div>
    )
  }

  if (obligations.length === 0) {
    return (
      <div className="py-4">
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          No obligations linked to your wallet yet.{' '}
          <span style={{ color: 'var(--subtle)' }}>
            ({totalCount} total on Arc)
          </span>
        </p>
      </div>
    )
  }

  // Group by bucket
  const grouped = new Map<string, DiscoveredObligation[]>()
  for (const bucket of BUCKET_ORDER) {
    const items = obligations.filter((o) => o.buckets.includes(bucket.key))
    if (items.length > 0) grouped.set(bucket.key, items)
  }

  return (
    <div className="flex flex-col gap-6">
      {BUCKET_ORDER.map(({ key, label }) => {
        const items = grouped.get(key)
        if (!items) return null
        return (
          <div key={key}>
            <p
              className="text-xs font-semibold uppercase mb-3"
              style={{ color: 'var(--subtle)', letterSpacing: '0.08em' }}
            >
              {label}
            </p>
            <div className="flex flex-col gap-2">
              {items.map((ob) => (
                <ObligationCard
                  key={ob.id.toString()}
                  ob={ob}
                  bucket={key}
                  onOpen={() => onOpen(ob.id)}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ObligationCard({
  ob,
  bucket,
  onOpen,
}: {
  ob: DiscoveredObligation
  bucket: string
  onOpen: () => void
}) {
  const isNeedsAction = bucket === 'needs-action'
  const isCompleted = ob.status === ObligationStatus.SETTLED || ob.status === ObligationStatus.EXPIRED
  const isSettled = ob.status === ObligationStatus.SETTLED

  return (
    <button
      onClick={onOpen}
      className="w-full text-left rounded-2xl px-4 py-4 transition-all hover:scale-[1.005] active:scale-[0.998] group"
      style={{
        background: isNeedsAction
          ? 'rgba(18,45,69,0.04)'
          : 'var(--surface-strong)',
        border: `1px solid ${isNeedsAction ? 'rgba(18,45,69,0.18)' : 'var(--border)'}`,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {/* Title */}
          <p
            className="text-sm font-semibold truncate mb-0.5"
            style={{ color: 'var(--ink)' }}
          >
            {ob.title}
          </p>

          {/* Amount line */}
          {isNeedsAction && ob.myAmount > 0n ? (
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              <span className="font-semibold tabular-nums" style={{ color: 'var(--ink)' }}>
                {ob.fmt.totalAmount} USDC
              </span>
              {' '}— {ob.fmt.totalFunded} / {ob.fmt.totalAmount} USDC funded
            </p>
          ) : isSettled ? (
            <div>
              <p className="text-xs tabular-nums" style={{ color: 'var(--success)' }}>
                {ob.fmt.totalAmount} USDC settled
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                To {formatAddress(ob.recipient)}
              </p>
            </div>
          ) : (
            <p className="text-xs tabular-nums" style={{ color: 'var(--muted)' }}>
              {ob.fmt.totalFunded} / {ob.fmt.totalAmount} USDC funded
            </p>
          )}

          {/* Meta chips */}
          <div className="flex flex-wrap items-center gap-2 mt-2">
            {isNeedsAction && ob.myAmount > 0n && (
              <Chip accent>
                Your share: {ob.fmt.totalAmount !== ob.fmt.totalAmount
                  ? `${ob.fmt.totalFunded} USDC`
                  : `${ob.fmt.totalAmount} USDC`}
              </Chip>
            )}
            {!isCompleted && (
              <Chip icon={<Clock className="size-2.5" />}>
                {ob.fmt.deadlinePassed ? 'Deadline passed' : `Deadline ${ob.fmt.deadline}`}
              </Chip>
            )}
            {ob.contributors.length > 0 && (
              <Chip icon={<Users className="size-2.5" />}>
                {ob.contributors.length} contributor{ob.contributors.length !== 1 ? 's' : ''}
              </Chip>
            )}
            {isSettled && (
              <Chip success icon={<CheckCircle className="size-2.5" />}>
                Settled
              </Chip>
            )}
            {isSettled && ob.settlementTxHash && (
              <a
                href={getTxUrl(ob.settlementTxHash)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(26,128,71,0.08)', color: 'var(--success)' }}
              >
                <ExternalLink className="size-2.5" />
                View on Arc
              </a>
            )}
          </div>

          {/* Progress bar */}
          {!isCompleted && ob.fmt.progress < 100 && (
            <div className="mt-3 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--surface-muted)' }}>
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${ob.fmt.progress}%`,
                  background: 'var(--accent)',
                }}
              />
            </div>
          )}
        </div>

        {/* Arrow */}
        <div
          className="flex-shrink-0 flex items-center justify-center size-7 rounded-xl mt-0.5 transition-transform group-hover:translate-x-0.5"
          style={{ background: 'var(--surface-muted)', color: 'var(--muted)' }}
        >
          <ArrowRight className="size-3.5" />
        </div>
      </div>
    </button>
  )
}

function Chip({
  children,
  icon,
  accent,
  success,
}: {
  children: React.ReactNode
  icon?: React.ReactNode
  accent?: boolean
  success?: boolean
}) {
  const color = success ? 'var(--success)' : accent ? 'var(--ink)' : 'var(--subtle)'
  const bg = success
    ? 'rgba(26,128,71,0.08)'
    : accent
    ? 'rgba(18,45,69,0.08)'
    : 'var(--surface-muted)'

  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full"
      style={{ background: bg, color }}
    >
      {icon}
      {children}
    </span>
  )
}
