/**
 * useObligationDiscovery
 *
 * Discovers all obligations relevant to a connected wallet by:
 * 1. Reading obligationCount (public state) — no events needed for the count
 * 2. Calling getObligation(id) for every ID in [1..N] in parallel
 * 3. For the connected address: getContributorInfo(id, address) to find their role
 * 4. Scanning ObligationCreated events to identify "created by" role (tx.from check)
 * 5. Scanning ObligationSettled events to resolve permanent settlement tx hashes
 *
 * Event scanning starts from POOLLESS_V2_DEPLOYMENT_BLOCK (not block 0) and
 * proceeds in bounded chunks (LOG_CHUNK_SIZE blocks) to respect RPC range limits.
 *
 * Source of truth: Arc Mainnet contract state. No localStorage, no DB.
 */

import { useEffect, useState } from 'react'
import { createPublicClient, http, parseAbiItem, defineChain } from 'viem'
import {
  POOLLESS_ADDRESS,
  POOLLESS_ABI,
  POOLLESS_V2_DEPLOYMENT_BLOCK,
  ObligationStatus,
} from '../contract'
import { formatUsdc, formatDeadline, isDeadlinePassed } from '../utils'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ObligationBucket = 'needs-action' | 'created-by-you' | 'funded-by-you' | 'completed'

export interface DiscoveredObligation {
  id: bigint
  title: string
  totalAmount: bigint
  totalFunded: bigint
  status: ObligationStatus
  deadline: bigint
  recipient: `0x${string}`
  contributors: `0x${string}`[]
  /** Your assigned share (0n if not a contributor) */
  myAmount: bigint
  /** Whether you have paid your share */
  myHasPaid: boolean
  /**
   * Settlement transaction hash, sourced from the ObligationSettled onchain event.
   * Populated for SETTLED obligations. Empty string if not yet settled or event not found.
   * Survives page refresh, wallet switch, and cross-device access — Arc is the source of truth.
   */
  settlementTxHash: string
  /** Buckets this obligation belongs to for the connected wallet */
  buckets: ObligationBucket[]
  /** Formatted helpers (pre-computed to avoid re-formatting in render) */
  fmt: {
    totalAmount: string
    totalFunded: string
    deadline: string
    deadlinePassed: boolean
    progress: number
  }
}

export interface DiscoveryState {
  obligations: DiscoveredObligation[]
  loading: boolean
  error: string
  totalCount: number
  refetch: () => void
}

// ─── Arc Testnet viem Chain definition ───────────────────────────────────────

const arcMainnet = defineChain({
  id: 5042,
  name: 'Arc Mainnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.mainnet.arc.io'] },
  },
  blockExplorers: {
    default: { name: 'Arc Explorer', url: 'https://explorer.arc.io' },
  },
  testnet: false,
})

// ─── Public viem client (read-only, no wallet needed) ────────────────────────

const publicClient = createPublicClient({
  chain: arcMainnet,
  transport: http('https://rpc.mainnet.arc.io'),
})

// ─── ABI fragments for event scanning ────────────────────────────────────────

const OBLIGATION_CREATED_ABI = parseAbiItem(
  'event ObligationCreated(uint256 indexed obligationId, string title, uint256 totalAmount, address indexed recipient, uint256 deadline, address[] contributors, uint256[] amounts)'
)

const OBLIGATION_SETTLED_ABI = parseAbiItem(
  'event ObligationSettled(uint256 indexed obligationId, address indexed recipient, uint256 amount)'
)

const REFUND_CLAIMED_ABI = parseAbiItem(
  'event RefundClaimed(uint256 indexed obligationId, address indexed contributor, uint256 amount)'
)

/**
 * Maximum block range per getLogs call.
 * Arc Testnet has no published hard limit, but chunking prevents timeouts
 * and future-proofs against range restrictions at mainnet scale.
 * At ~2 blocks/second Arc produces ~172800 blocks/day; 100k covers ~14 hours.
 */
const LOG_CHUNK_SIZE = 100_000n

// ─── Chunked log fetcher ──────────────────────────────────────────────────────

/**
 * Fetch ObligationCreated logs across the full V2 history in bounded chunks.
 */
async function fetchCreatedLogsChunked(toBlock: bigint) {
  type CreatedLog = Awaited<ReturnType<typeof publicClient.getLogs<typeof OBLIGATION_CREATED_ABI>>>[number]
  const results: CreatedLog[] = []
  let from = POOLLESS_V2_DEPLOYMENT_BLOCK
  while (from <= toBlock) {
    const to = from + LOG_CHUNK_SIZE - 1n < toBlock ? from + LOG_CHUNK_SIZE - 1n : toBlock
    const chunk = await publicClient.getLogs({
      address: POOLLESS_ADDRESS,
      event: OBLIGATION_CREATED_ABI,
      fromBlock: from,
      toBlock: to,
    })
    for (const log of chunk) results.push(log)
    from = to + 1n
  }
  return results
}

/**
 * Fetch ObligationSettled logs across the full V2 history in bounded chunks.
 */
async function fetchSettledLogsChunked(toBlock: bigint) {
  type SettledLog = Awaited<ReturnType<typeof publicClient.getLogs<typeof OBLIGATION_SETTLED_ABI>>>[number]
  const results: SettledLog[] = []
  let from = POOLLESS_V2_DEPLOYMENT_BLOCK
  while (from <= toBlock) {
    const to = from + LOG_CHUNK_SIZE - 1n < toBlock ? from + LOG_CHUNK_SIZE - 1n : toBlock
    const chunk = await publicClient.getLogs({
      address: POOLLESS_ADDRESS,
      event: OBLIGATION_SETTLED_ABI,
      fromBlock: from,
      toBlock: to,
    })
    for (const log of chunk) results.push(log)
    from = to + 1n
  }
  return results
}

// ─── Core discovery function (not a hook — called from the hook below) ────────

async function discoverObligations(
  connectedAddress: `0x${string}` | undefined,
  signal: { cancelled: boolean }
): Promise<{
  obligations: DiscoveredObligation[]
  totalCount: number
}> {
  // 1. Current block + obligationCount
  const [count, latestBlock] = await Promise.all([
    publicClient.readContract({
      address: POOLLESS_ADDRESS,
      abi: POOLLESS_ABI,
      functionName: 'obligationCount',
    }) as Promise<bigint>,
    publicClient.getBlockNumber(),
  ])

  if (signal.cancelled) return { obligations: [], totalCount: 0 }

  const n = Number(count)
  if (n === 0) return { obligations: [], totalCount: 0 }

  const ids = Array.from({ length: n }, (_, i) => BigInt(i + 1))

  // 2. Fetch all obligations in parallel
  const results = await Promise.allSettled(
    ids.map((id) =>
      publicClient.readContract({
        address: POOLLESS_ADDRESS,
        abi: POOLLESS_ABI,
        functionName: 'getObligation',
        args: [id],
      })
    )
  )

  if (signal.cancelled) return { obligations: [], totalCount: n }

  // 3. Fetch contributor info for the connected wallet
  const contributorInfoResults = connectedAddress
    ? await Promise.allSettled(
        ids.map((id) =>
          publicClient.readContract({
            address: POOLLESS_ADDRESS,
            abi: POOLLESS_ABI,
            functionName: 'getContributorInfo',
            args: [id, connectedAddress],
          })
        )
      )
    : null

  if (signal.cancelled) return { obligations: [], totalCount: n }

  // 4. Scan ObligationCreated events (chunked, from deployment block) to find "created by"
  const creatorIds = new Set<bigint>()
  if (connectedAddress) {
    try {
      const createdLogs = await fetchCreatedLogsChunked(latestBlock)
      const txChecks = await Promise.allSettled(
        createdLogs.map(async (log) => {
          if (!log.transactionHash) return null
          const tx = await publicClient.getTransaction({ hash: log.transactionHash })
          if (tx.from.toLowerCase() === connectedAddress.toLowerCase()) {
            return log.args.obligationId as bigint
          }
          return null
        })
      )
      for (const r of txChecks) {
        if (r.status === 'fulfilled' && r.value !== null) {
          creatorIds.add(r.value)
        }
      }
    } catch {
      // Event scanning failed — skip "created by you" bucket; obligation data still loads
    }
  }

  if (signal.cancelled) return { obligations: [], totalCount: n }

  // 5. Scan ObligationSettled events (chunked, from deployment block) to build
  //    a permanent map of obligationId → settlement tx hash.
  //    This is the authoritative source that survives page refresh and wallet switches.
  const settlementTxByObligationId = new Map<bigint, string>()
  try {
    const settledLogs = await fetchSettledLogsChunked(latestBlock)
    for (const log of settledLogs) {
      const obId = log.args.obligationId
      if (obId !== undefined && log.transactionHash) {
        // Last log wins (in practice there is exactly one per obligation)
        settlementTxByObligationId.set(obId, log.transactionHash)
      }
    }
  } catch {
    // Settlement event scan failed — hashes will be empty strings; links won't show
  }

  if (signal.cancelled) return { obligations: [], totalCount: n }

  // 6. Build the discovered obligations list
  const discovered: DiscoveredObligation[] = []

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]
    const result = results[i]
    if (result.status === 'rejected') continue

    type ObTuple = [string, string, bigint, bigint, `0x${string}`, bigint, number, `0x${string}`[]]
    const ob = result.value as ObTuple
    const [title, , totalAmount, totalFunded, recipient, deadline, statusRaw, contributors] = ob
    const status = statusRaw as unknown as ObligationStatus

    let myAmount = 0n
    let myHasPaid = false
    if (connectedAddress && contributorInfoResults) {
      const infoResult = contributorInfoResults[i]
      if (infoResult.status === 'fulfilled') {
        type CInfoTuple = [bigint, boolean]
        const cInfo = infoResult.value as CInfoTuple
        myAmount = cInfo[0]
        myHasPaid = cInfo[1]
      }
    }

    const isContributor = myAmount > 0n
    const isRecipient = connectedAddress
      ? recipient.toLowerCase() === connectedAddress.toLowerCase()
      : false
    const isCreator = creatorIds.has(id)

    // Include if relevant to the connected wallet; always include all for no-wallet sessions
    const isRelevant = !connectedAddress || isContributor || isRecipient || isCreator
    if (!isRelevant) continue

    const deadlinePassed = isDeadlinePassed(deadline)
    const isSettled = status === ObligationStatus.SETTLED
    const isExpired = status === ObligationStatus.EXPIRED

    // Settlement tx hash sourced from onchain event — permanent across sessions/devices
    const settlementTxHash = isSettled ? (settlementTxByObligationId.get(id) ?? '') : ''

    // ─── Bucket assignment ───────────────────────────────────────────────────
    // Rules:
    //   needs-action  — contributor, not yet paid, OPEN, before deadline
    //   completed     — SETTLED or EXPIRED, for any associated wallet role
    //                   (creator, contributor, or recipient)
    //   funded-by-you — contributor, paid, obligation still OPEN (waiting on others)
    //   created-by-you — creator, not otherwise bucketed
    //
    // An obligation may appear in multiple buckets if the wallet holds multiple roles.
    // De-duplication in the dashboard is by obligationId, so visual duplicates are prevented.
    const buckets = new Set<ObligationBucket>()

    if (isContributor && !myHasPaid && status === ObligationStatus.OPEN && !deadlinePassed) {
      buckets.add('needs-action')
    }

    // Completed: any associated role (creator / contributor / recipient) once terminal
    if (isSettled || isExpired) {
      buckets.add('completed')
    }

    // Funded-by-you: contributed and paid, but obligation not yet settled/expired
    if (isContributor && myHasPaid && !isSettled && !isExpired) {
      buckets.add('funded-by-you')
    }

    // Created-by-you: always tag if creator (secondary label, not exclusive)
    if (isCreator) {
      buckets.add('created-by-you')
    }

    // Fallback: nothing matched — place in created-by-you for the creator,
    // funded-by-you for contributors, otherwise created-by-you as last resort
    if (buckets.size === 0) {
      if (isCreator) buckets.add('created-by-you')
      else if (isContributor) buckets.add('funded-by-you')
      else buckets.add('created-by-you')
    }

    const progress = totalAmount > 0n ? Number((totalFunded * 100n) / totalAmount) : 0

    discovered.push({
      id,
      title,
      totalAmount,
      totalFunded,
      status,
      deadline,
      recipient,
      contributors,
      myAmount,
      myHasPaid,
      settlementTxHash,
      buckets: Array.from(buckets),
      fmt: {
        totalAmount: formatUsdc(totalAmount),
        totalFunded: formatUsdc(totalFunded),
        deadline: formatDeadline(deadline),
        deadlinePassed,
        progress,
      },
    })
  }

  // Sort: needs-action first, then by descending id
  discovered.sort((a, b) => {
    const aNeedsAction = a.buckets.includes('needs-action') ? 0 : 1
    const bNeedsAction = b.buckets.includes('needs-action') ? 0 : 1
    if (aNeedsAction !== bNeedsAction) return aNeedsAction - bNeedsAction
    return Number(b.id - a.id)
  })

  return { obligations: discovered, totalCount: n }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useObligationDiscovery(
  connectedAddress: `0x${string}` | undefined
): DiscoveryState {
  const [obligations, setObligations] = useState<DiscoveredObligation[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [totalCount, setTotalCount] = useState(0)
  const [refetchTrigger, setRefetchTrigger] = useState(0)

  useEffect(() => {
    const signal = { cancelled: false }
    setLoading(true)
    setError('')

    discoverObligations(connectedAddress, signal)
      .then(({ obligations: obs, totalCount: nc }) => {
        if (signal.cancelled) return
        setObligations(obs)
        setTotalCount(nc)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (signal.cancelled) return
        const msg = err instanceof Error ? err.message : 'Failed to load obligations'
        setError(msg)
        setLoading(false)
      })

    return () => { signal.cancelled = true }
  // refetchTrigger is intentionally listed to allow manual refetch
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedAddress, refetchTrigger])

  const refetch = () => setRefetchTrigger((t) => t + 1)

  return { obligations, loading, error, totalCount, refetch }
}

// ─── Single-obligation settlement receipt ─────────────────────────────────────

/**
 * Resolves the permanent settlement transaction hash for a single obligation
 * by scanning the ObligationSettled event onchain.
 *
 * Called from ObligationPage so the receipt is available even on first load
 * without a full discovery pass. Returns '' until resolved or if not settled.
 */
export function useSettlementTxHash(
  obligationId: bigint,
  isSettled: boolean
): string {
  const [txHash, setTxHash] = useState('')

  useEffect(() => {
    if (!isSettled) {
      return
    }
    let cancelled = false

    const resolve = async () => {
      try {
        const latestBlock = await publicClient.getBlockNumber()
        const logs = await fetchSettledLogsChunked(latestBlock)
        if (cancelled) return
        for (const log of logs) {
          const logObId = log.args.obligationId
          if (logObId === obligationId && log.transactionHash) {
            setTxHash(log.transactionHash)
            return
          }
        }
      } catch {
        // Scan failed — no tx hash; non-fatal
      }
    }

    void resolve()
    return () => { cancelled = true }
  }, [obligationId, isSettled])

  return txHash
}

// ─── Single-contributor refund-claimed receipt ────────────────────────────────

/**
 * Fetch RefundClaimed logs across the full V2 history in bounded chunks.
 */
async function fetchRefundClaimedLogsChunked(toBlock: bigint) {
  type RefundLog = Awaited<ReturnType<typeof publicClient.getLogs<typeof REFUND_CLAIMED_ABI>>>[number]
  const results: RefundLog[] = []
  let from = POOLLESS_V2_DEPLOYMENT_BLOCK
  while (from <= toBlock) {
    const to = from + LOG_CHUNK_SIZE - 1n < toBlock ? from + LOG_CHUNK_SIZE - 1n : toBlock
    const chunk = await publicClient.getLogs({
      address: POOLLESS_ADDRESS,
      event: REFUND_CLAIMED_ABI,
      fromBlock: from,
      toBlock: to,
    })
    for (const log of chunk) results.push(log)
    from = to + 1n
  }
  return results
}

/**
 * Returns true when the connected address has a confirmed RefundClaimed event
 * for the given obligation. Used to distinguish "never paid" from "paid and
 * already claimed" — both leave hasPaid === false in contract storage.
 *
 * Only runs when isExpired is true and contributorAddress is set.
 */
export function useRefundClaimed(
  obligationId: bigint,
  isExpired: boolean,
  contributorAddress: string | undefined
): boolean {
  const [hasClaimed, setHasClaimed] = useState(false)

  useEffect(() => {
    if (!isExpired || !contributorAddress) return
    let cancelled = false

    const resolve = async () => {
      try {
        const latestBlock = await publicClient.getBlockNumber()
        const logs = await fetchRefundClaimedLogsChunked(latestBlock)
        if (cancelled) return
        for (const log of logs) {
          if (
            log.args.obligationId === obligationId &&
            log.args.contributor?.toLowerCase() === contributorAddress.toLowerCase()
          ) {
            setHasClaimed(true)
            return
          }
        }
      } catch {
        // Non-fatal — show the claim button as a safe fallback
      }
    }

    void resolve()
    return () => { cancelled = true }
  }, [obligationId, isExpired, contributorAddress])

  return hasClaimed
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * Build the shareable invitation URL for an obligation.
 */
export function buildObligationUrl(id: bigint | number): string {
  return `${window.location.origin}${window.location.pathname}#/obligation/${id.toString()}`
}

/**
 * Copy a string to clipboard, falling back to execCommand for Safari.
 */
export async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
  } else {
    const el = document.createElement('textarea')
    el.value = text
    el.style.position = 'fixed'
    el.style.opacity = '0'
    document.body.appendChild(el)
    el.select()
    document.execCommand('copy')
    document.body.removeChild(el)
  }
}

/**
 * Share an obligation link using the Web Share API (mobile), falling back to clipboard.
 * Returns true if Web Share was used, false if clipboard fallback was used.
 */
export async function shareObligation(
  id: bigint | number,
  title: string
): Promise<boolean> {
  const url = buildObligationUrl(id)
  if (navigator.share) {
    try {
      await navigator.share({
        title: `POOLLESS — ${title}`,
        text: `You've been invited to contribute to "${title}" on POOLLESS.`,
        url,
      })
      return true
    } catch {
      // User cancelled or share failed — fall through to clipboard
    }
  }
  await copyToClipboard(url)
  return false
}
