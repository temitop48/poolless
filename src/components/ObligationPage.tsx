import { useEffect, useState, useCallback } from 'react'
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  useSwitchChain,
} from 'wagmi'
import { ArrowLeft, ExternalLink, Loader2, CheckCircle, Clock, AlertCircle, LogOut } from 'lucide-react'
import { erc20Abi } from 'viem'
import { NetworkArc } from '@web3icons/react'
import {
  POOLLESS_ADDRESS,
  POOLLESS_ABI,
  USDC_ADDRESS,
  ARC_MAINNET_CHAIN_ID,
  ObligationStatus,
  STATUS_LABELS,
} from '../contract'
import {
  formatUsdc,
  formatDeadline,
  isDeadlinePassed,
  formatAddress,
  getTxUrl,
  getAddressUrl,
  parseOnchainError,
} from '../utils'
import { useCircleWallet } from '../circleWallet'
import { useSettlementTxHash, useRefundClaimed } from '../hooks/useObligationDiscovery'
import ConnectModal from './ConnectModal'
import ShareButton from './ShareButton'

interface ObligationPageProps {
  obligationId: bigint
  onBack: () => void
}

export default function ObligationPage({ obligationId, onBack }: ObligationPageProps) {
  // ─── Wallet connections ───────────────────────────────────────────
  // We support two wallet paths: Circle Wallet (UCW) and browser wallets (wagmi).
  // Circle Wallet is preferred; both can be used simultaneously by different contributors.
  const { address: wagmiAddress, isConnected: wagmiConnected, chainId } = useAccount()
  const { switchChain } = useSwitchChain()
  const {
    state: circleState,
    session: circleSession,
    executeChallenge,
    pollTransaction,
    refreshBalance,
    disconnect: circleDisconnect,
  } = useCircleWallet()

  const isCircleConnected = circleState === 'connected' && !!circleSession?.wallet

  // Effective address: Circle wallet address takes priority when connected
  const address = isCircleConnected
    ? (circleSession.wallet!.address as `0x${string}`)
    : wagmiAddress

  const isConnected = isCircleConnected || wagmiConnected
  const isWrongChain = wagmiConnected && !isCircleConnected && chainId !== ARC_MAINNET_CHAIN_ID

  // Connect modal
  const [connectModalOpen, setConnectModalOpen] = useState(false)

  // ─── Read obligation ─────────────────────────────────────────────
  const {
    data: obligationData,
    isLoading: loadingObligation,
    error: obligationError,
    refetch: refetchObligation,
  } = useReadContract({
    address: POOLLESS_ADDRESS,
    abi: POOLLESS_ABI,
    functionName: 'getObligation',
    args: [obligationId],
    chainId: ARC_MAINNET_CHAIN_ID,
  })

  // ─── Read contributor info for connected wallet ───────────────────
  const {
    data: myContributorInfo,
    refetch: refetchMyInfo,
  } = useReadContract({
    address: POOLLESS_ADDRESS,
    abi: POOLLESS_ABI,
    functionName: 'getContributorInfo',
    args: [obligationId, address ?? '0x0000000000000000000000000000000000000000'],
    chainId: ARC_MAINNET_CHAIN_ID,
    query: { enabled: !!address },
  })

  // ─── Read all contributor infos ──────────────────────────────────
  type ObligationTuple = [string, string, bigint, bigint, `0x${string}`, bigint, number, `0x${string}`[]]
  const obData = obligationData as ObligationTuple | undefined
  const contributors: `0x${string}`[] = obData ? obData[7] : []

  // ─── USDC balance ─────────────────────────────────────────────────
  const { data: usdcBalance } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [address ?? '0x0000000000000000000000000000000000000000'],
    chainId: ARC_MAINNET_CHAIN_ID,
    query: { enabled: !!address },
  })

  // ─── USDC allowance ───────────────────────────────────────────────
  const { data: currentAllowance, refetch: refetchAllowance } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [
      address ?? '0x0000000000000000000000000000000000000000',
      POOLLESS_ADDRESS,
    ],
    chainId: ARC_MAINNET_CHAIN_ID,
    query: { enabled: !!address },
  })

  // ─── Permanent settlement receipt (onchain ObligationSettled event) ─────────
  // Derives settled/expired flags from raw obligation data; must be called
  // unconditionally before any early returns (React hooks rules).
  const obStatusRawForHook = obData ? (obData[6] as unknown as ObligationStatus) : ObligationStatus.OPEN
  const settlementTxHash = useSettlementTxHash(
    obligationId,
    obStatusRawForHook === ObligationStatus.SETTLED
  )

  // ─── Refund-claimed detection (onchain RefundClaimed event) ──────────────────
  // After claimRefund() the contract sets hasPaid = false, making a claimed
  // contributor indistinguishable from one who never paid. We detect the claim
  // by scanning the RefundClaimed event so the UI can show the right message.
  const hasClaimedRefund = useRefundClaimed(
    obligationId,
    obStatusRawForHook === ObligationStatus.EXPIRED,
    address
  )

  // ─── Tx hooks ──────────────────────────────────────────────────────────
  // txPhase tracks which action button is active (used for button labels)
  const [txPhase, setTxPhase] = useState<'idle' | 'approving' | 'contributing' | 'expiring' | 'claiming'>('idle')
  const [txError, setTxError] = useState('')

  const { writeContract, data: pendingHash, isPending, reset: resetWrite } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: pendingHash })

  const busy = isPending || isConfirming

  useEffect(() => {
    if (isSuccess) {
      void refetchObligation()
      void refetchMyInfo()
      void refetchAllowance()
      setTxPhase('idle')
      resetWrite()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess])

  // ─── Circle Wallet handlers ───────────────────────────────────────
  // Hooks must be called unconditionally (before any early returns).
  // The guard `if (!isCircleConnected || !circleSession) return` is inside the callback, not outside.
  const circleAction = useCallback(async (
    phase: typeof txPhase,
    endpoint: string,
    extraBody: Record<string, string> = {},
  ) => {
    if (!isCircleConnected || !circleSession) return
    setTxError('')
    setTxPhase(phase)
    try {
      const res = await fetch(`/api${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userToken: circleSession.userToken,
          walletId: circleSession.wallet!.id,
          ...extraBody,
        }),
      })
      const data = await res.json() as { challengeId?: string; error?: string }
      if (!res.ok || !data.challengeId) {
        throw new Error(data.error ?? 'Failed to create challenge')
      }
      const transactionId = await executeChallenge(data.challengeId)
      if (transactionId) {
        await pollTransaction(transactionId, (txState) => {
          console.log('[Circle Tx]', txState)
        })
      }
      void refetchObligation()
      void refetchMyInfo()
      void refetchAllowance()
      void refreshBalance()
      setTxPhase('idle')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Transaction failed'
      setTxError(msg)
      setTxPhase('idle')
    }
  }, [isCircleConnected, circleSession, executeChallenge, pollTransaction, refreshBalance,
      refetchObligation, refetchMyInfo, refetchAllowance])

  const handleCircleApprove = useCallback((amount: bigint) => {
    void circleAction('approving', '/approve', { amount: amount.toString() })
  }, [circleAction])

  const handleCircleContribute = useCallback(() => {
    void circleAction('contributing', '/contribute', { obligationId: obligationId.toString() })
  }, [circleAction, obligationId])

  const handleCircleMarkExpired = useCallback(() => {
    void circleAction('expiring', '/refund-expired', { obligationId: obligationId.toString() })
  }, [circleAction, obligationId])

  const handleCircleClaimRefund = useCallback(() => {
    void circleAction('claiming', '/claim-refund', { obligationId: obligationId.toString() })
  }, [circleAction, obligationId])

  if (loadingObligation) {
    return <LoadingState onBack={onBack} />
  }

  if (obligationError || !obligationData) {
    return <ErrorState obligationId={obligationId} onBack={onBack} />
  }

  const [
    obTitle,
    obDescription,
    obTotalAmount,
    obTotalFunded,
    obRecipient,
    obDeadline,
    obStatusRaw,
  ] = obData!

  const status = obStatusRaw as unknown as ObligationStatus
  const progress = obTotalAmount > 0n ? Number((obTotalFunded * 100n) / obTotalAmount) : 0
  const deadlinePassed = isDeadlinePassed(obDeadline)
  type ContributorTuple = [bigint, boolean]
  const myInfo = myContributorInfo as ContributorTuple | undefined
  const myAmount = myInfo ? myInfo[0] : 0n
  const myHasPaid = myInfo ? myInfo[1] : false
  const isMyContribution = myAmount > 0n
  const needsSufficientUsdc = usdcBalance !== undefined && myAmount > 0n && (usdcBalance) < myAmount
  const needsApproval = currentAllowance !== undefined && myAmount > 0n && (currentAllowance) < myAmount

  // ─── Action handlers ──────────────────────────────────────────────
  const handleApprove = () => {
    setTxError('')
    setTxPhase('approving')
    writeContract(
      {
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: 'approve',
        args: [POOLLESS_ADDRESS, myAmount],
        chainId: ARC_MAINNET_CHAIN_ID,
      },
      {
        onError: (e) => { setTxError(parseOnchainError(e)); setTxPhase('idle') },
      }
    )
  }

  const handleContribute = () => {
    setTxError('')
    setTxPhase('contributing')
    writeContract(
      {
        address: POOLLESS_ADDRESS,
        abi: POOLLESS_ABI,
        functionName: 'contribute',
        args: [obligationId],
        chainId: ARC_MAINNET_CHAIN_ID,
      },
      {
        onError: (e) => { setTxError(parseOnchainError(e)); setTxPhase('idle') },
      }
    )
  }

  const handleMarkExpired = () => {
    setTxError('')
    setTxPhase('expiring')
    writeContract(
      {
        address: POOLLESS_ADDRESS,
        abi: POOLLESS_ABI,
        functionName: 'refundExpired',
        args: [obligationId],
        chainId: ARC_MAINNET_CHAIN_ID,
      },
      {
        onError: (e) => { setTxError(parseOnchainError(e)); setTxPhase('idle') },
      }
    )
  }

  const handleClaimRefund = () => {
    setTxError('')
    setTxPhase('claiming')
    writeContract(
      {
        address: POOLLESS_ADDRESS,
        abi: POOLLESS_ABI,
        functionName: 'claimRefund',
        args: [obligationId],
        chainId: ARC_MAINNET_CHAIN_ID,
      },
      {
        onError: (e) => { setTxError(parseOnchainError(e)); setTxPhase('idle') },
      }
    )
  }

  // ─── Choose effective handlers (variable assignments — safe here) ────
  const effectiveApprove = isCircleConnected
    ? () => handleCircleApprove(myAmount)
    : handleApprove
  const effectiveContribute = isCircleConnected ? handleCircleContribute : handleContribute
  const effectiveMarkExpired = isCircleConnected ? handleCircleMarkExpired : handleMarkExpired
  const effectiveClaimRefund = isCircleConnected ? handleCircleClaimRefund : handleClaimRefund

  return (
    <div className="min-h-dvh" style={{ background: 'var(--bg-gradient)' }}>
      {/* Header */}
      <header
        className="sticky top-0 z-10 px-4 py-4 flex items-center gap-3"
        style={{ background: 'rgba(249,249,252,0.9)', backdropFilter: 'blur(12px)', borderBottom: '1px solid var(--border)' }}
      >
        <button
          onClick={onBack}
          className="flex items-center justify-center size-9 rounded-xl transition-colors hover:bg-black/5"
          style={{ color: 'var(--ink)' }}
        >
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold uppercase" style={{ color: 'var(--subtle)', letterSpacing: '0.07em' }}>
            Obligation #{obligationId.toString()}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {isCircleConnected && (
            <>
              <div
                className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full"
                style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)', border: '1px solid var(--border)' }}
              >
                <span className="size-1.5 rounded-full bg-green-500 inline-block" />
                {formatAddress(circleSession.wallet!.address)}
              </div>
              <button
                onClick={circleDisconnect}
                className="flex items-center justify-center size-8 rounded-full hover:bg-black/5 transition-colors"
                title="Disconnect"
              >
                <LogOut className="size-3.5" style={{ color: 'var(--muted)' }} />
              </button>
            </>
          )}
          {!isCircleConnected && !wagmiConnected && (
            <button
              onClick={() => setConnectModalOpen(true)}
              className="text-xs font-semibold px-3 py-1.5 rounded-full transition-colors"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              Connect
            </button>
          )}
          {!isCircleConnected && wagmiConnected && wagmiAddress && (
            <div
              className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full"
              style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)', border: '1px solid var(--border)' }}
            >
              <span className="size-1.5 rounded-full bg-green-500 inline-block" />
              {formatAddress(wagmiAddress)}
            </div>
          )}
          <div
            className="flex items-center gap-1 text-xs px-2 py-1 rounded-full"
            style={{ background: 'var(--surface-muted)', color: 'var(--muted)', border: '1px solid var(--border)' }}
          >
            <NetworkArc variant="branded" size={11} />
          </div>
        </div>
      </header>

      <ConnectModal open={connectModalOpen} onClose={() => setConnectModalOpen(false)} />

      <div className="max-w-2xl mx-auto px-4 py-6 pb-28 flex flex-col gap-4">

        {/* Hero card */}
        <div
          className="rounded-3xl p-6"
          style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)', boxShadow: '0 1px 16px rgba(18,45,69,0.06)' }}
        >
          {/* Status badge */}
          <StatusBadge status={status} />

          {/* Title */}
          <h1
            className="display text-3xl font-bold mt-3 mb-1"
            style={{ color: 'var(--ink)', letterSpacing: '-0.03em' }}
          >
            {obTitle}
          </h1>
          {obDescription && (
            <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>
              {obDescription}
            </p>
          )}

          {/* Progress */}
          <div className="mt-4">
            <div className="flex items-end justify-between mb-2">
              <div>
                <span className="display text-2xl font-bold tabular-nums" style={{ color: 'var(--ink)' }}>
                  {formatUsdc(obTotalFunded)}
                </span>
                <span className="text-sm ml-1" style={{ color: 'var(--muted)' }}>
                  / {formatUsdc(obTotalAmount)} USDC
                </span>
              </div>
              <span className="text-sm font-semibold tabular-nums" style={{ color: progress === 100 ? 'var(--success)' : 'var(--muted)' }}>
                {progress}%
              </span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--surface-muted)' }}>
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${progress}%`,
                  background: progress === 100 ? 'var(--success)' : 'var(--accent)',
                }}
              />
            </div>
          </div>

          {/* Meta row */}
          <div className="mt-4 flex flex-col gap-2">
            <MetaRow label="Recipient">
              <a
                href={getAddressUrl(obRecipient)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 mono text-xs hover:opacity-70 transition-opacity"
                style={{ color: 'var(--accent-hover)' }}
              >
                {formatAddress(obRecipient)}
                <ExternalLink size={10} />
              </a>
            </MetaRow>
            <MetaRow label="Deadline">
              <span className="text-sm tabular-nums" style={{ color: deadlinePassed && status === ObligationStatus.OPEN ? 'var(--danger)' : 'var(--ink)' }}>
                {formatDeadline(obDeadline)}
                {deadlinePassed && status === ObligationStatus.OPEN && ' (passed)'}
              </span>
            </MetaRow>
            <MetaRow label="Network">
              <span className="flex items-center gap-1 text-sm" style={{ color: 'var(--ink)' }}>
                <NetworkArc variant="branded" size={14} />
                Arc Mainnet
              </span>
            </MetaRow>
          </div>

          {/* Share */}
          <div className="mt-5 pt-4 border-t" style={{ borderColor: 'var(--border)' }}>
            <ShareButton obligationId={obligationId} title={obTitle} fullWidth />
          </div>
        </div>

        {/* Contributors */}
        <div>
          <p
            className="text-xs font-semibold uppercase mb-3 px-1"
            style={{ color: 'var(--subtle)', letterSpacing: '0.07em' }}
          >
            Contributors
          </p>
          <ContributorList
            obligationId={obligationId}
            contributors={contributors}
            connectedAddress={address}
          />
        </div>

        {/* Settlement success */}
        {status === ObligationStatus.SETTLED && (
          <div
            className="rounded-3xl p-6 text-center"
            style={{ background: 'rgba(26,128,71,0.07)', border: '1px solid rgba(26,128,71,0.2)' }}
          >
            <CheckCircle size={32} className="mx-auto mb-3" style={{ color: 'var(--success)' }} />
            <p className="display text-xl font-bold mb-1" style={{ color: 'var(--success)', letterSpacing: '-0.02em' }}>
              OBLIGATION SETTLED
            </p>
            <p className="text-sm mb-4" style={{ color: 'var(--success)' }}>
              {formatUsdc(obTotalAmount)} USDC paid directly to recipient
            </p>
            {settlementTxHash && (
              <a
                href={getTxUrl(settlementTxHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-xl"
                style={{ background: 'rgba(26,128,71,0.12)', color: 'var(--success)' }}
              >
                View transaction on Arc
                <ExternalLink size={11} />
              </a>
            )}
          </div>
        )}

        {/* Error display */}
        {txError && (
          <div
            className="rounded-2xl p-4 flex items-start gap-2"
            style={{ background: 'rgba(186,43,76,0.06)', border: '1px solid rgba(186,43,76,0.2)' }}
          >
            <AlertCircle size={15} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--danger)' }} />
            <p className="text-sm" style={{ color: 'var(--danger)' }}>{txError}</p>
          </div>
        )}

        {/* Action zone */}
        <ActionZone
          isConnected={isConnected}
          isWrongChain={isWrongChain}
          status={status}
          deadlinePassed={deadlinePassed}
          isMyContribution={isMyContribution}
          myAmount={myAmount}
          obTotalAmount={obTotalAmount}
          obTotalFunded={obTotalFunded}
          myHasPaid={myHasPaid}
          hasClaimedRefund={hasClaimedRefund}
          needsApproval={needsApproval}
          needsSufficientUsdc={needsSufficientUsdc}
          usdcBalance={usdcBalance}
          busy={busy}
          txPhase={txPhase}
          onSwitchChain={() => switchChain({ chainId: ARC_MAINNET_CHAIN_ID })}
          onApprove={effectiveApprove}
          onContribute={effectiveContribute}
          onMarkExpired={effectiveMarkExpired}
          onClaimRefund={effectiveClaimRefund}
          onOpenConnectModal={() => setConnectModalOpen(true)}
        />
      </div>
    </div>
  )
}

// ─── Sub-components ────────────────────────────────────────────────

function StatusBadge({ status }: { status: ObligationStatus }) {
  const configs: Record<ObligationStatus, { bg: string; color: string; dot: string }> = {
    [ObligationStatus.OPEN]: { bg: 'rgba(18,45,69,0.07)', color: 'var(--ink-2)', dot: '#122d45' },
    [ObligationStatus.SETTLED]: { bg: 'rgba(26,128,71,0.1)', color: 'var(--success)', dot: 'var(--success)' },
    [ObligationStatus.EXPIRED]: { bg: 'rgba(186,43,76,0.08)', color: 'var(--danger)', dot: 'var(--danger)' },
  }
  const c = configs[status] ?? configs[ObligationStatus.OPEN]
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full"
      style={{ background: c.bg, color: c.color }}
    >
      <span className="size-1.5 rounded-full inline-block" style={{ background: c.dot }} />
      {STATUS_LABELS[status]}
    </span>
  )
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>{label}</span>
      {children}
    </div>
  )
}

function ContributorList({
  obligationId,
  contributors,
  connectedAddress,
}: {
  obligationId: bigint
  contributors: `0x${string}`[]
  connectedAddress?: `0x${string}`
}) {
  return (
    <div className="flex flex-col gap-2">
      {contributors.map((addr) => (
        <ContributorCard
          key={addr}
          obligationId={obligationId}
          contributorAddress={addr}
          isMe={connectedAddress?.toLowerCase() === addr.toLowerCase()}
        />
      ))}
    </div>
  )
}

function ContributorCard({
  obligationId,
  contributorAddress,
  isMe,
}: {
  obligationId: bigint
  contributorAddress: `0x${string}`
  isMe: boolean
}) {
  const { data } = useReadContract({
    address: POOLLESS_ADDRESS,
    abi: POOLLESS_ABI,
    functionName: 'getContributorInfo',
    args: [obligationId, contributorAddress],
    chainId: ARC_MAINNET_CHAIN_ID,
  })

  type CInfoTuple = [bigint, boolean]
  const cInfo = data as CInfoTuple | undefined
  const amount = cInfo ? cInfo[0] : undefined
  const hasPaid = cInfo ? cInfo[1] : undefined

  return (
    <div
      className="rounded-2xl px-4 py-3.5 flex items-center justify-between"
      style={{
        background: isMe ? 'rgba(18,45,69,0.04)' : 'var(--surface-strong)',
        border: `1px solid ${isMe ? 'rgba(18,45,69,0.18)' : 'var(--border)'}`,
      }}
    >
      <div className="flex items-center gap-3">
        {/* Avatar */}
        <div
          className="size-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
          style={{ background: 'var(--surface-muted)', color: 'var(--ink)' }}
        >
          {contributorAddress.slice(2, 4).toUpperCase()}
        </div>
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
            {isMe ? 'You' : formatAddress(contributorAddress)}
          </p>
          <p className="mono text-xs" style={{ color: 'var(--subtle)' }}>
            {formatAddress(contributorAddress)}
          </p>
        </div>
      </div>
      <div className="text-right flex items-center gap-3">
        <div>
          <p className="text-sm font-semibold tabular-nums" style={{ color: 'var(--ink)' }}>
            {amount !== undefined ? formatUsdc(amount) : '—'} USDC
          </p>
        </div>
        <FundedIndicator hasPaid={hasPaid} />
      </div>
    </div>
  )
}

function FundedIndicator({ hasPaid }: { hasPaid?: boolean }) {
  if (hasPaid === undefined) return <div className="size-5" />
  if (hasPaid) {
    return (
      <div
        className="flex items-center justify-center size-6 rounded-full flex-shrink-0"
        style={{ background: 'rgba(26,128,71,0.12)' }}
      >
        <CheckCircle size={13} style={{ color: 'var(--success)' }} />
      </div>
    )
  }
  return (
    <div
      className="flex items-center justify-center size-6 rounded-full flex-shrink-0"
      style={{ background: 'var(--surface-muted)' }}
    >
      <Clock size={13} style={{ color: 'var(--subtle)' }} />
    </div>
  )
}

function ActionZone({
  isConnected,
  isWrongChain,
  status,
  deadlinePassed,
  isMyContribution,
  myAmount,
  obTotalAmount,
  obTotalFunded,
  myHasPaid,
  hasClaimedRefund,
  needsApproval,
  needsSufficientUsdc,
  usdcBalance,
  busy,
  txPhase,
  onSwitchChain,
  onApprove,
  onContribute,
  onMarkExpired,
  onClaimRefund,
  onOpenConnectModal,
}: {
  isConnected: boolean
  isWrongChain: boolean
  status: ObligationStatus
  deadlinePassed: boolean
  isMyContribution: boolean
  myAmount: bigint
  obTotalAmount: bigint
  obTotalFunded: bigint
  myHasPaid: boolean
  hasClaimedRefund: boolean
  needsApproval: boolean
  needsSufficientUsdc: boolean
  usdcBalance?: bigint
  busy: boolean
  txPhase: string
  onSwitchChain: () => void
  onApprove: () => void
  onContribute: () => void
  onMarkExpired: () => void
  onClaimRefund: () => void
  onOpenConnectModal: () => void
}) {
  if (!isConnected) {
    return (
      <button
        onClick={onOpenConnectModal}
        className="w-full py-4 rounded-2xl text-sm font-semibold text-white transition-all hover:scale-[1.01] active:scale-[0.99]"
        style={{ background: 'var(--accent)' }}
      >
        Connect wallet to participate
      </button>
    )
  }

  if (isWrongChain) {
    return (
      <button
        onClick={onSwitchChain}
        className="w-full py-4 rounded-2xl text-sm font-semibold text-white"
        style={{ background: 'var(--danger)' }}
      >
        Switch to Arc Mainnet
      </button>
    )
  }

  // Settled — nothing to do
  if (status === ObligationStatus.SETTLED) {
    return null
  }

  // Expired — four distinct cases
  if (status === ObligationStatus.EXPIRED) {
    // Case 1: wallet is not an assigned contributor at all
    if (!isMyContribution) {
      return (
        <div
          className="rounded-2xl p-4 text-center"
          style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}
        >
          <p className="text-sm font-semibold mb-1" style={{ color: 'var(--ink)' }}>
            Your wallet is not assigned to this obligation.
          </p>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            No refund is available.
          </p>
        </div>
      )
    }

    // Case 2: assigned contributor who already claimed (hasPaid reset to false by contract)
    if (!myHasPaid && hasClaimedRefund) {
      return (
        <div
          className="rounded-2xl p-4 flex items-center gap-3"
          style={{ background: 'rgba(26,128,71,0.07)', border: '1px solid rgba(26,128,71,0.2)' }}
        >
          <CheckCircle size={18} style={{ color: 'var(--success)' }} />
          <div>
            <p className="text-sm font-semibold" style={{ color: 'var(--success)' }}>
              Refund claimed
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
              Your contribution has been returned.
            </p>
          </div>
        </div>
      )
    }

    // Case 3: assigned contributor who never funded
    if (!myHasPaid) {
      return (
        <div
          className="rounded-2xl p-4 text-center"
          style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}
        >
          <p className="text-sm font-semibold mb-1" style={{ color: 'var(--ink)' }}>
            This obligation has expired.
          </p>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            You did not fund your share, so there is nothing to refund.
          </p>
        </div>
      )
    }

    // Case 4: assigned contributor who funded and has not yet claimed
    return (
      <div className="flex flex-col gap-3">
        <div
          className="rounded-2xl p-5"
          style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
        >
          <p className="text-xs font-semibold uppercase mb-1" style={{ color: 'var(--subtle)', letterSpacing: '0.07em' }}>
            Your refund
          </p>
          <p className="display text-3xl font-bold tabular-nums" style={{ color: 'var(--ink)', letterSpacing: '-0.02em' }}>
            {formatUsdc(myAmount)} <span className="text-lg font-medium" style={{ color: 'var(--subtle)' }}>USDC</span>
          </p>
        </div>
        <button
          disabled={busy}
          onClick={onClaimRefund}
          className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl text-sm font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:scale-[1.01] active:scale-[0.99]"
          style={{ background: 'var(--danger)' }}
        >
          {busy && txPhase === 'claiming' ? (
            <><Loader2 size={16} className="animate-spin" /> Claiming refund...</>
          ) : (
            `Claim refund — ${formatUsdc(myAmount)} USDC`
          )}
        </button>
      </div>
    )
  }

  // Open — contribute or expire
  if (status === ObligationStatus.OPEN) {
    // Deadline passed but not expired yet
    if (deadlinePassed) {
      return (
        <div className="flex flex-col gap-3">
          <div
            className="rounded-2xl p-4"
            style={{ background: 'rgba(186,43,76,0.06)', border: '1px solid rgba(186,43,76,0.18)' }}
          >
            <p className="text-sm font-semibold" style={{ color: 'var(--danger)' }}>Deadline has passed</p>
            <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
              The obligation was not fully funded. Mark it expired to allow contributors to reclaim their shares.
            </p>
          </div>
          <button
            disabled={busy}
            onClick={onMarkExpired}
            className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl text-sm font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'var(--danger)' }}
          >
            {busy && txPhase === 'expiring' ? (
              <><Loader2 size={16} className="animate-spin" /> Marking expired...</>
            ) : (
              'Mark as expired'
            )}
          </button>
        </div>
      )
    }

    // Not a contributor
    if (!isMyContribution) {
      return (
        <div
          className="rounded-2xl p-4 text-center"
          style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}
        >
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Your wallet is not a contributor to this obligation. Share the link with the listed contributors.
          </p>
        </div>
      )
    }

    // Already paid
    if (myHasPaid) {
      return (
        <div
          className="rounded-2xl p-4 flex items-center gap-3"
          style={{ background: 'rgba(26,128,71,0.07)', border: '1px solid rgba(26,128,71,0.2)' }}
        >
          <CheckCircle size={18} style={{ color: 'var(--success)' }} />
          <div>
            <p className="text-sm font-semibold" style={{ color: 'var(--success)' }}>
              Your share is funded
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
              {formatUsdc(myAmount)} USDC committed. Waiting for others.
            </p>
          </div>
        </div>
      )
    }

    // Need more USDC
    if (needsSufficientUsdc) {
      return (
        <div className="flex flex-col gap-3">
          <div
            className="rounded-2xl p-4"
            style={{ background: 'rgba(186,43,76,0.06)', border: '1px solid rgba(186,43,76,0.18)' }}
          >
            <p className="text-sm font-semibold" style={{ color: 'var(--danger)' }}>Insufficient USDC balance</p>
            <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
              You need {formatUsdc(myAmount)} USDC but have{' '}
              {usdcBalance !== undefined ? formatUsdc(usdcBalance) : '—'} USDC.
              Use the "Get test USDC" button in the sidebar to top up.
            </p>
          </div>
          <button
            disabled
            className="w-full py-4 rounded-2xl text-sm font-semibold text-white opacity-40 cursor-not-allowed"
            style={{ background: 'var(--accent)' }}
          >
            Fund my {formatUsdc(myAmount)} USDC share
          </button>
        </div>
      )
    }

    // Need approval
    if (needsApproval) {
      return (
        <div className="flex flex-col gap-3">
          <div
            className="rounded-2xl p-5"
            style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
          >
            <p className="text-xs font-semibold uppercase mb-1" style={{ color: 'var(--subtle)', letterSpacing: '0.07em' }}>
              Your share
            </p>
            <p className="display text-3xl font-bold tabular-nums" style={{ color: 'var(--ink)', letterSpacing: '-0.02em' }}>
              {formatUsdc(myAmount)} <span className="text-lg font-medium" style={{ color: 'var(--subtle)' }}>USDC</span>
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
              First allow POOLLESS to spend your USDC, then confirm your contribution.
            </p>
          </div>
          <button
            disabled={busy}
            onClick={onApprove}
            className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl text-sm font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:scale-[1.01] active:scale-[0.99]"
            style={{ background: 'var(--accent)' }}
          >
            {busy && txPhase === 'approving' ? (
              <><Loader2 size={16} className="animate-spin" /> Approving...</>
            ) : (
              `Approve ${formatUsdc(myAmount)} USDC`
            )}
          </button>
        </div>
      )
    }

    // Ready to contribute
    const isFinalContribution = obTotalFunded + myAmount >= obTotalAmount
    return (
      <div className="flex flex-col gap-3">
        <div
          className="rounded-2xl p-5"
          style={{ background: 'var(--surface-strong)', border: '1px solid var(--border)' }}
        >
          <p className="text-xs font-semibold uppercase mb-1" style={{ color: 'var(--subtle)', letterSpacing: '0.07em' }}>
            Your share
          </p>
          <p className="display text-3xl font-bold tabular-nums" style={{ color: 'var(--ink)', letterSpacing: '-0.02em' }}>
            {formatUsdc(myAmount)} <span className="text-lg font-medium" style={{ color: 'var(--subtle)' }}>USDC</span>
          </p>
        </div>
        {isFinalContribution && (
          <div
            className="rounded-2xl px-4 py-3 flex items-start gap-2"
            style={{ background: 'rgba(16,97,166,0.07)', border: '1px solid rgba(16,97,166,0.2)' }}
          >
            <CheckCircle size={15} className="mt-0.5 flex-shrink-0" style={{ color: '#1061a6' }} />
            <p className="text-xs" style={{ color: '#1061a6' }}>
              Your contribution completes this obligation. Once confirmed,{' '}
              <span className="font-semibold">{formatUsdc(obTotalAmount)} USDC</span> will be sent
              automatically to the recipient in the same transaction.
            </p>
          </div>
        )}
        <button
          disabled={busy}
          onClick={onContribute}
          className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl text-sm font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all hover:scale-[1.01] active:scale-[0.99]"
          style={{ background: 'var(--accent)' }}
        >
          {busy && txPhase === 'contributing' ? (
            <><Loader2 size={16} className="animate-spin" /> Funding share{isFinalContribution ? ' & settling...' : '...'}</>
          ) : (
            `Fund my ${formatUsdc(myAmount)} USDC share`
          )}
        </button>
      </div>
    )
  }

  return null
}

function LoadingState({ onBack }: { onBack: () => void }) {
  return (
    <div className="min-h-dvh flex flex-col" style={{ background: 'var(--bg-gradient)' }}>
      <header className="sticky top-0 z-10 px-4 py-4 flex items-center gap-3" style={{ background: 'rgba(249,249,252,0.9)', backdropFilter: 'blur(12px)', borderBottom: '1px solid var(--border)' }}>
        <button onClick={onBack} className="flex items-center justify-center size-9 rounded-xl hover:bg-black/5" style={{ color: 'var(--ink)' }}>
          <ArrowLeft size={18} />
        </button>
      </header>
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={24} className="animate-spin" style={{ color: 'var(--muted)' }} />
      </div>
    </div>
  )
}

function ErrorState({ obligationId, onBack }: { obligationId: bigint; onBack: () => void }) {
  return (
    <div className="min-h-dvh flex flex-col" style={{ background: 'var(--bg-gradient)' }}>
      <header className="sticky top-0 z-10 px-4 py-4 flex items-center gap-3" style={{ background: 'rgba(249,249,252,0.9)', backdropFilter: 'blur(12px)', borderBottom: '1px solid var(--border)' }}>
        <button onClick={onBack} className="flex items-center justify-center size-9 rounded-xl hover:bg-black/5" style={{ color: 'var(--ink)' }}>
          <ArrowLeft size={18} />
        </button>
      </header>
      <div className="flex-1 flex flex-col items-center justify-center px-6 gap-3">
        <AlertCircle size={32} style={{ color: 'var(--danger)' }} />
        <p className="text-base font-semibold text-center" style={{ color: 'var(--ink)' }}>
          Obligation #{obligationId.toString()} not found
        </p>
        <p className="text-sm text-center" style={{ color: 'var(--muted)' }}>
          This obligation ID does not exist on Arc Mainnet.
        </p>
        <button onClick={onBack} className="mt-2 py-3 px-6 rounded-2xl text-sm font-semibold" style={{ background: 'var(--surface-muted)', color: 'var(--ink)', border: '1px solid var(--border)' }}>
          Back to home
        </button>
      </div>
    </div>
  )
}
