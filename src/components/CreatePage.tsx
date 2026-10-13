import { useState, useCallback } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useSwitchChain } from 'wagmi'
import { ConnectKitButton } from 'connectkit'
import { Plus, Trash2, ArrowLeft, Loader2, ExternalLink, AlertCircle } from 'lucide-react'
import { parseAbi, decodeEventLog } from 'viem'
import { POOLLESS_ADDRESS, POOLLESS_ABI, ARC_MAINNET_CHAIN_ID } from '../contract'
import { parseUsdc, parseOnchainError, getTxUrl, formatAddress, formatUsdc } from '../utils'
import ShareButton from './ShareButton'

// Computed once at module load — stable across re-renders
const MIN_DEADLINE = new Date(Date.now() + 60000).toISOString().slice(0, 16)

interface Contributor {
  id: string
  name: string
  address: string
  amount: string
}

interface CreatePageProps {
  onBack: () => void
  onCreated: (id: bigint) => void
}

export default function CreatePage({ onBack, onCreated }: CreatePageProps) {
  const { address, isConnected, chainId } = useAccount()
  const { switchChain } = useSwitchChain()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [recipient, setRecipient] = useState('')
  const [deadline, setDeadline] = useState('')
  const [contributors, setContributors] = useState<Contributor[]>([
    { id: '1', name: '', address: '', amount: '' },
    { id: '2', name: '', address: '', amount: '' },
  ])
  const [error, setError] = useState('')

  const { writeContract, data: hash, isPending, isError, error: writeError, reset } = useWriteContract()
  const { isLoading: isConfirming, isSuccess, data: receipt } = useWaitForTransactionReceipt({ hash })

  const isWrongChain = isConnected && chainId !== ARC_MAINNET_CHAIN_ID

  // Compute totals
  const totalAmount = contributors.reduce((sum, c) => {
    const n = parseFloat(c.amount.replace(/,/g, ''))
    return sum + (isNaN(n) ? 0 : n)
  }, 0)

  const allAmountsValid = contributors.every((c) => {
    try {
      return parseUsdc(c.amount) > 0n
    } catch {
      return false
    }
  })

  const addContributor = () => {
    setContributors((prev) => [
      ...prev,
      { id: Date.now().toString(), name: '', address: '', amount: '' },
    ])
  }

  const removeContributor = (id: string) => {
    if (contributors.length <= 2) return
    setContributors((prev) => prev.filter((c) => c.id !== id))
  }

  const updateContributor = useCallback(
    (id: string, field: keyof Contributor, value: string) => {
      setContributors((prev) =>
        prev.map((c) => (c.id === id ? { ...c, [field]: value } : c))
      )
    },
    []
  )

  const validate = (): string => {
    if (!title.trim()) return 'Title is required.'
    if (title.length > 100) return 'Title must be 100 characters or fewer.'
    if (description.length > 500) return 'Description must be 500 characters or fewer.'
    if (!recipient.trim() || !/^0x[0-9a-fA-F]{40}$/.test(recipient.trim())) return 'Enter a valid recipient address.'
    if (!deadline) return 'Deadline is required.'
    if (new Date(deadline).getTime() <= Date.now()) return 'Deadline must be in the future.'
    for (const c of contributors) {
      if (!c.address.trim() || !/^0x[0-9a-fA-F]{40}$/.test(c.address.trim())) return `Enter a valid wallet address for each contributor.`
      try {
        parseUsdc(c.amount)
      } catch {
        return 'Each contributor must have a valid USDC amount with at most 6 decimal places.'
      }
    }
    const addrs = contributors.map((c) => c.address.trim().toLowerCase())
    if (new Set(addrs).size !== addrs.length) return 'Each contributor must have a unique wallet address.'
    return ''
  }

  const handleSubmit = () => {
    setError('')
    const err = validate()
    if (err) { setError(err); return }

    const deadlineTs = BigInt(Math.floor(new Date(deadline).getTime() / 1000))
    const contributorAddresses = contributors.map((c) => c.address.trim() as `0x${string}`)
    const amounts = contributors.map((c) => parseUsdc(c.amount.replace(/,/g, '')))
    const totalAmountRaw = amounts.reduce((a, b) => a + b, 0n)

    writeContract({
      address: POOLLESS_ADDRESS,
      abi: POOLLESS_ABI,
      functionName: 'createObligation',
      chainId: ARC_MAINNET_CHAIN_ID,
      args: [
        title.trim(),
        description.trim(),
        totalAmountRaw,
        recipient.trim() as `0x${string}`,
        deadlineTs,
        contributorAddresses,
        amounts,
      ],
    })
  }

  // After confirmed, extract obligation id from receipt
  if (isSuccess && receipt) {
    let obligationId: bigint | null = null
    try {
      const createdAbi = parseAbi([
        'event ObligationCreated(uint256 indexed obligationId, string title, uint256 totalAmount, address indexed recipient, uint256 deadline, address[] contributors, uint256[] amounts)',
      ])
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({ abi: createdAbi, data: log.data, topics: log.topics })
          if (decoded.eventName === 'ObligationCreated') {
            obligationId = decoded.args.obligationId
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }

    return (
      <SuccessState
        hash={hash!}
        obligationId={obligationId}
        obligationTitle={title}
        contributors={contributors.map((c) => ({
          address: c.address.trim(),
          amount: (() => {
            try { return String(parseUsdc(c.amount.replace(/,/g, ''))) } catch { return '0' }
          })(),
        }))}
        onView={() => obligationId && onCreated(obligationId)}
        onBack={onBack}
      />
    )
  }

  const submitDisabled = !isConnected || isWrongChain || isPending || isConfirming

  return (
    <div className="min-h-dvh" style={{ background: 'var(--bg-gradient)' }}>
      {/* Header */}
      <header className="sticky top-0 z-10 px-4 py-4 flex items-center gap-3" style={{ background: 'rgba(249,249,252,0.9)', backdropFilter: 'blur(12px)', borderBottom: '1px solid var(--border)' }}>
        <button
          onClick={onBack}
          className="flex items-center justify-center size-9 rounded-xl transition-colors hover:bg-black/5"
          style={{ color: 'var(--ink)' }}
        >
          <ArrowLeft size={18} />
        </button>
        <img
          src="/poolless-logo.png"
          alt=""
          aria-hidden="true"
          className="size-7 rounded-lg object-contain shrink-0"
        />
        <span className="display font-bold text-base" style={{ color: 'var(--ink)', letterSpacing: '-0.02em' }}>
          New obligation
        </span>
        <div className="ml-auto">
          <ConnectKitButton />
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-6 pb-24">
        {/* Obligation details */}
        <Section label="Obligation details">
          <Field label="Title" hint={`${title.length}/100`}>
            <input
              className="w-full bg-transparent text-sm outline-none placeholder:text-slate-300"
              style={{ color: 'var(--ink)' }}
              placeholder="Hospital Bill, Shared Office Rent..."
              maxLength={100}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <Field label="Description (optional)" hint={`${description.length}/500`}>
            <textarea
              className="w-full bg-transparent text-sm outline-none resize-none placeholder:text-slate-300"
              style={{ color: 'var(--ink)', minHeight: '60px' }}
              placeholder="Brief context about this obligation..."
              maxLength={500}
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <Field label="Recipient wallet address">
            <input
              className="w-full bg-transparent text-sm outline-none placeholder:text-slate-300 mono"
              style={{ color: 'var(--ink)' }}
              placeholder="0x..."
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
            />
          </Field>
          <Field label="Deadline">
            <input
              type="datetime-local"
              className="w-full bg-transparent text-sm outline-none"
              style={{ color: 'var(--ink)' }}
              value={deadline}
              min={MIN_DEADLINE}
              onChange={(e) => setDeadline(e.target.value)}
            />
          </Field>
        </Section>

        {/* Contributors */}
        <Section label="Contributors & shares" className="mt-5">
          <div className="flex flex-col gap-3">
            {contributors.map((c, i) => (
              <ContributorRow
                key={c.id}
                index={i}
                contributor={c}
                canRemove={contributors.length > 2}
                onChange={(field, val) => updateContributor(c.id, field, val)}
                onRemove={() => removeContributor(c.id)}
              />
            ))}
          </div>
          <button
            onClick={addContributor}
            className="mt-3 flex items-center gap-1.5 text-sm font-semibold transition-opacity hover:opacity-70"
            style={{ color: 'var(--accent-hover)' }}
          >
            <Plus size={14} />
            Add contributor
          </button>
        </Section>

        {/* Total validation */}
        <div
          className="mt-4 rounded-2xl p-4 flex items-center justify-between"
          style={{
            background: allAmountsValid ? 'rgba(26,128,71,0.06)' : 'var(--surface-muted)',
            border: `1px solid ${allAmountsValid ? 'rgba(26,128,71,0.2)' : 'var(--border)'}`,
          }}
        >
          <span className="text-sm font-medium" style={{ color: 'var(--muted)' }}>
            Total obligation
          </span>
          <span
            className="display text-xl font-bold tabular-nums"
            style={{ color: allAmountsValid ? 'var(--success)' : 'var(--ink)' }}
          >
            {totalAmount.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 6 })} USDC
          </span>
        </div>

        {/* Error */}
        {(error || isError) && (
          <div
            className="mt-4 rounded-2xl p-4 flex items-start gap-2"
            style={{ background: 'rgba(186,43,76,0.06)', border: '1px solid rgba(186,43,76,0.2)' }}
          >
            <AlertCircle size={15} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--danger)' }} />
            <p className="text-sm" style={{ color: 'var(--danger)' }}>
              {error || parseOnchainError(writeError)}
            </p>
          </div>
        )}

        {/* Submit */}
        <div className="mt-5">
          {!isConnected ? (
            <div className="flex justify-center">
              <ConnectKitButton label="Connect wallet to continue" />
            </div>
          ) : isWrongChain ? (
            <button
              onClick={() => switchChain({ chainId: ARC_MAINNET_CHAIN_ID })}
              className="w-full py-4 rounded-2xl text-sm font-semibold text-white"
              style={{ background: 'var(--danger)' }}
            >
              Switch to Arc Mainnet
            </button>
          ) : (
            <button
              disabled={submitDisabled}
              onClick={() => { reset(); handleSubmit() }}
              className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl text-sm font-semibold text-white transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
              style={{ background: 'var(--accent)' }}
            >
              {isPending ? (
                <><Loader2 size={16} className="animate-spin" /> Confirm in wallet...</>
              ) : isConfirming ? (
                <><Loader2 size={16} className="animate-spin" /> Creating obligation...</>
              ) : (
                'Create obligation'
              )}
            </button>
          )}
          {isConnected && address && (
            <p className="text-center text-xs mt-2" style={{ color: 'var(--subtle)' }}>
              Connected: {address.slice(0, 6)}...{address.slice(-4)}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────

function Section({
  label,
  children,
  className = '',
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <p
        className="text-xs font-semibold uppercase mb-3"
        style={{ color: 'var(--subtle)', letterSpacing: '0.07em' }}
      >
        {label}
      </p>
      <div
        className="rounded-2xl overflow-hidden"
        style={{ border: '1px solid var(--border)', background: 'var(--surface-strong)' }}
      >
        {children}
      </div>
    </div>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="px-4 py-3 border-b last:border-b-0" style={{ borderColor: 'var(--border)' }}>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>
          {label}
        </label>
        {hint && (
          <span className="text-xs" style={{ color: 'var(--subtle)' }}>
            {hint}
          </span>
        )}
      </div>
      {children}
    </div>
  )
}

function ContributorRow({
  index,
  contributor,
  canRemove,
  onChange,
  onRemove,
}: {
  index: number
  contributor: { name: string; address: string; amount: string }
  canRemove: boolean
  onChange: (field: 'name' | 'address' | 'amount', val: string) => void
  onRemove: () => void
}) {
  return (
    <div
      className="rounded-2xl p-4"
      style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>
          Contributor {index + 1}
        </span>
        {canRemove && (
          <button
            onClick={onRemove}
            className="flex items-center justify-center size-6 rounded-lg transition-colors hover:bg-red-50"
            style={{ color: 'var(--subtle)' }}
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <input
          className="w-full bg-transparent text-sm outline-none placeholder:text-slate-300 py-1"
          style={{ color: 'var(--ink)', borderBottom: '1px solid var(--border)' }}
          placeholder="Name (optional, for display)"
          value={contributor.name}
          onChange={(e) => onChange('name', e.target.value)}
        />
        <input
          className="w-full bg-transparent text-sm outline-none placeholder:text-slate-300 py-1 mono"
          style={{ color: 'var(--ink)', borderBottom: '1px solid var(--border)' }}
          placeholder="0x... wallet address"
          value={contributor.address}
          onChange={(e) => onChange('address', e.target.value)}
        />
        <div className="flex items-center gap-2 pt-1">
          <input
            inputMode="decimal"
            className="flex-1 bg-transparent text-sm font-semibold outline-none placeholder:text-slate-300 tabular-nums"
            style={{ color: 'var(--ink)' }}
            placeholder="0.00"
            value={contributor.amount}
            onChange={(e) => {
              const v = e.target.value.replace(/[^0-9.]/g, '')
              if (v === '' || /^\d*\.?\d*$/.test(v)) onChange('amount', v)
            }}
          />
          <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>USDC</span>
        </div>
      </div>
    </div>
  )
}

function SuccessState({
  hash,
  obligationId,
  obligationTitle,
  contributors,
  onView,
  onBack,
}: {
  hash: string
  obligationId: bigint | null
  obligationTitle: string
  contributors: { address: string; amount: string }[]
  onView: () => void
  onBack: () => void
}) {
  const txUrl = getTxUrl(hash)
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-6 py-12" style={{ background: 'var(--bg-gradient)' }}>
      <div className="max-w-md w-full">

        {/* Success badge */}
        <div className="flex items-center gap-3 mb-6">
          <div
            className="flex items-center justify-center size-10 rounded-full flex-shrink-0"
            style={{ background: 'rgba(26,128,71,0.1)' }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--success)' }}>
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <div>
            <h2 className="display text-xl font-bold" style={{ color: 'var(--ink)', letterSpacing: '-0.03em' }}>
              Obligation created
            </h2>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              Share the invitation link with all contributors
            </p>
          </div>
        </div>

        {/* Obligation summary card */}
        <div
          className="rounded-3xl p-5 mb-4"
          style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
        >
          <p className="text-xs font-semibold uppercase mb-1" style={{ color: 'var(--subtle)', letterSpacing: '0.07em' }}>
            {obligationId != null ? `Obligation #${obligationId.toString()}` : 'Obligation'}
          </p>
          <p className="display text-2xl font-bold mb-4" style={{ color: 'var(--ink)', letterSpacing: '-0.03em' }}>
            {obligationTitle}
          </p>

          {/* Contributors list */}
          {contributors.length > 0 && (
            <div className="flex flex-col gap-2 mb-4">
              <p className="text-xs font-semibold uppercase" style={{ color: 'var(--subtle)', letterSpacing: '0.07em' }}>
                Contributors
              </p>
              {contributors.map((c, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5"
                  style={{ background: 'var(--surface-muted)' }}
                >
                  <span className="mono text-xs" style={{ color: 'var(--ink-2)' }}>
                    {c.address.length >= 10 ? formatAddress(c.address) : c.address}
                  </span>
                  <span className="text-xs font-semibold tabular-nums" style={{ color: 'var(--ink)' }}>
                    {(() => {
                      try { return `${formatUsdc(BigInt(c.amount))} USDC` } catch { return `${c.amount} USDC` }
                    })()}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Tx hash */}
          <div className="pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
            <p className="text-xs font-semibold mb-1" style={{ color: 'var(--subtle)' }}>Transaction</p>
            <a
              href={txUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs mono"
              style={{ color: 'var(--accent-hover)' }}
            >
              {hash.slice(0, 12)}...{hash.slice(-8)}
              <ExternalLink size={11} />
            </a>
          </div>
        </div>

        {/* Share buttons */}
        {obligationId != null && (
          <div className="mb-3">
            <ShareButton obligationId={obligationId} title={obligationTitle} variant="primary" fullWidth />
          </div>
        )}

        {/* Navigation */}
        <div className="flex flex-col gap-2">
          {obligationId != null && (
            <button
              onClick={onView}
              className="w-full py-3.5 rounded-2xl text-sm font-semibold transition-all hover:scale-[1.01] active:scale-[0.99]"
              style={{ background: 'var(--surface-muted)', color: 'var(--ink)', border: '1px solid var(--border)' }}
            >
              Open obligation page
            </button>
          )}
          <button
            onClick={onBack}
            className="w-full py-3 rounded-2xl text-sm font-medium"
            style={{ color: 'var(--muted)' }}
          >
            Back to home
          </button>
        </div>
      </div>
    </div>
  )
}
