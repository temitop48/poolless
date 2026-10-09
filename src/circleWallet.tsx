/**
 * Circle User-Controlled Wallet integration for POOLLESS
 *
 * Architecture:
 * - W3SSdk (browser) handles the challenge-response UI (PIN setup / confirmation)
 * - All API calls go to /api/* (proxied to the Bun backend at port 3001)
 * - CIRCLE_API_KEY stays server-side — never in the browser
 *
 * Session storage: sessionStorage only (cleared on tab close).
 * Production apps should use httpOnly cookies per the Circle security guide.
 */

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from 'react'
import { W3SSdk } from '@circle-fin/w3s-pw-web-sdk'
import { toast } from 'sonner'
import { isTerminalTransactionState } from '@/onchain-wait'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CircleWallet {
  id: string
  address: string
  blockchain: string
  accountType: string
  state: string
}

export interface CircleSession {
  userId: string
  userToken: string
  encryptionKey: string
  wallet: CircleWallet | null
  usdcBalance: string | null // human-readable, e.g. "12.50"
}

export type CircleWalletState =
  | 'idle'
  | 'connecting'
  | 'awaiting-challenge'
  | 'loading-wallet'
  | 'connected'
  | 'error'

interface CircleWalletContextValue {
  state: CircleWalletState
  session: CircleSession | null
  error: string
  /** Start the full connect flow: create user → token → initialize → execute challenge */
  connect: (userId: string) => Promise<void>
  disconnect: () => void
  /** Refresh USDC balance */
  refreshBalance: () => Promise<void>
  /**
   * Execute a backend-created challenge (approve / contribute / settle / etc.)
   * Returns the Circle transaction ID (for contract-execution challenges) which
   * can be polled with pollTransaction. Returns undefined for wallet-creation.
   */
  executeChallenge: (challengeId: string) => Promise<string | undefined>
  /** Poll Circle for transaction state until terminal */
  pollTransaction: (transactionId: string, onUpdate?: (state: string) => void) => Promise<string>
  isConfigured: boolean
}

const CircleWalletContext = createContext<CircleWalletContextValue | null>(null)

// ─── Session helpers (sessionStorage, not localStorage) ───────────────────────

const SESSION_KEY = 'poolless_circle_session'

function loadSession(): CircleSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as CircleSession) : null
  } catch {
    return null
  }
}

function saveSession(s: CircleSession) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(s))
  } catch {
    /* ignore */
  }
}

function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY)
  } catch {
    /* ignore */
  }
}

// ─── API helpers ─────────────────────────────────────────────────────────────

const API = '/api'

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json()) as T & { error?: string }
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
  return data
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function CircleWalletProvider({ children }: { children: ReactNode }) {
  const sdkRef = useRef<W3SSdk | null>(null)
  const [sdkReady, setSdkReady] = useState(false)
  // Derive initial state from persisted session so we never need setState in an effect
  // Circle Sandbox is disabled while POOLLESS operates on Arc Mainnet.
  // Preserve the implementation for future Circle Production activation.
  const [session, setSession] = useState<CircleSession | null>(null)
  const derivedInitialState: CircleWalletState = session?.wallet ? 'connected' : 'idle'
  const [state, setState] = useState<CircleWalletState>(derivedInitialState)
  const [error, setError] = useState('')

  const appId = import.meta.env.VITE_CIRCLE_APP_ID as string | undefined
  const isConfigured = false // Temporarily frozen pending Circle Production

  // ── Init W3SSdk on mount ──────────────────────────────────────────────
  useEffect(() => {
    if (!isConfigured || !appId) return

    const sdk = new W3SSdk({ appSettings: { appId } })
    sdkRef.current = sdk

    // getDeviceId() MUST be called — without it, sdk.execute() silently fails
    sdk.getDeviceId()
      .then(() => setSdkReady(true))
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : 'SDK init failed'
        console.error('[CircleWallet] W3SSdk init failed:', msg)
        setSdkReady(false)
      })
  }, [appId])

  // ── refreshBalance ────────────────────────────────────────────────────
  const refreshBalance = useCallback(async () => {
    if (!session?.wallet) return
    try {
      const res = await apiPost<{ tokenBalances?: Array<{ amount: string; token: { symbol: string } }> }>(
        '/get-balance',
        { userToken: session.userToken, walletId: session.wallet.id },
      )
      const usdc = res.tokenBalances?.find((b) => b.token.symbol === 'USDC')
      const balance = usdc?.amount ?? '0'
      const updated = { ...session, usdcBalance: balance }
      setSession(updated)
      saveSession(updated)
    } catch {
      /* balance fetch failure is non-fatal */
    }
  }, [session])

  // ── executeChallenge ──────────────────────────────────────────────────
  /**
   * Execute a Circle challenge via the W3SSdk PIN UI.
   * Returns the first transaction ID in the SDK result (for contract-execution
   * challenges), which can then be passed to pollTransaction.
   * Returns undefined for wallet-creation challenges (no transaction ID).
   */
  const executeChallenge = useCallback(
    (challengeId: string): Promise<string | undefined> => {
      return new Promise((resolve, reject) => {
        const sdk = sdkRef.current
        if (!sdk || !session) {
          reject(new Error('SDK not ready or no session'))
          return
        }
        sdk.setAuthentication({
          userToken: session.userToken,
          encryptionKey: session.encryptionKey,
        })
        sdk.execute(challengeId, (err, result) => {
          if (err) {
            reject(new Error((err as Error).message ?? 'Challenge failed'))
          } else {
            // Contract-execution challenges return transaction IDs in the result
            type SdkResult = { data?: { transactions?: Array<{ id?: string }> } }
            const r = result as SdkResult | undefined
            const txId = r?.data?.transactions?.[0]?.id
            resolve(txId)
          }
        })
      })
    },
    [session],
  )

  // ── pollTransaction ───────────────────────────────────────────────────
  const pollTransaction = useCallback(
    async (transactionId: string, onUpdate?: (state: string) => void): Promise<string> => {
      if (!session) throw new Error('No session')

      const MAX_POLLS = 90
      const INTERVAL_MS = 2000

      for (let i = 0; i < MAX_POLLS; i++) {
        await new Promise((r) => setTimeout(r, INTERVAL_MS))

        const res = await apiPost<{ transaction?: { state: string; txHash?: string } }>(
          '/get-transaction',
          { userToken: session.userToken, transactionId },
        )

        const txState = res.transaction?.state ?? 'UNKNOWN'
        const txHash = res.transaction?.txHash ?? ''
        onUpdate?.(txState)

        if (isTerminalTransactionState(txState)) {
          return txHash
        }
      }

      throw new Error('Transaction polling timed out')
    },
    [session],
  )

  // ── connect ────────────────────────────────────────────────────────────
  const connect = useCallback(
    async (userId: string) => {
      // Circle Sandbox must not connect to the Mainnet application.
      if (!isConfigured) {
        setError('Circle Wallet is coming soon on Arc Mainnet.')
        setState('error')
        return
      }
      const sdk = sdkRef.current
      if (!sdk) {
        setError('Circle Wallet SDK not initialized. Check VITE_CIRCLE_APP_ID.')
        setState('error')
        return
      }
      if (!sdkReady) {
        setError('Circle Wallet SDK is still loading, please wait a moment.')
        setState('error')
        return
      }

      setError('')
      setState('connecting')

      try {
        // 1. Create or find user
        type CreateUserResp = { code?: number; id?: string }
        const createResult = await apiPost<CreateUserResp>('/create-user', { userId })
        const alreadyExists = createResult.code === 155106

        // 2. Get session token
        type TokenResp = { userToken: string; encryptionKey: string }
        const { userToken, encryptionKey } = await apiPost<TokenResp>('/get-token', { userId })

        let wallet: CircleWallet | null = null

        if (alreadyExists) {
          // 3a. User exists — list their wallets
          setState('loading-wallet')
          type WalletsResp = { wallets?: CircleWallet[] }
          const walletsRes = await apiPost<WalletsResp>('/list-wallets', { userToken })
          const arcWallet = walletsRes.wallets?.find(
            (w) => w.blockchain === 'ARC-TESTNET' && w.state === 'LIVE',
          )
          wallet = arcWallet ?? null
        } else {
          // 3b. New user — initialize (create PIN challenge)
          type InitResp = { code?: number; challengeId?: string }
          const initRes = await apiPost<InitResp>('/initialize', { userToken })

          if (initRes.code === 155106) {
            // Race: became existing in the meantime
            setState('loading-wallet')
            type WalletsResp = { wallets?: CircleWallet[] }
            const walletsRes = await apiPost<WalletsResp>('/list-wallets', { userToken })
            wallet = walletsRes.wallets?.find((w) => w.blockchain === 'ARC-TESTNET' && w.state === 'LIVE') ?? null
          } else if (initRes.challengeId) {
            setState('awaiting-challenge')
            // 4. Execute PIN-setup challenge — Circle's hosted UI
            await new Promise<void>((resolve, reject) => {
              sdk.setAuthentication({ userToken, encryptionKey })
              sdk.execute(initRes.challengeId!, (err) => {
                if (err) reject(new Error((err as Error).message ?? 'PIN setup failed'))
                else resolve()
              })
            })

            // 5. Wait briefly then fetch the new wallet
            setState('loading-wallet')
            await new Promise((r) => setTimeout(r, 3000))
            type WalletsResp = { wallets?: CircleWallet[] }
            const walletsRes = await apiPost<WalletsResp>('/list-wallets', { userToken })
            wallet = walletsRes.wallets?.find((w) => w.blockchain === 'ARC-TESTNET' && w.state === 'LIVE') ?? null
          }
        }

        if (!wallet) {
          throw new Error('No Arc Testnet wallet found. Please try again.')
        }

        const newSession: CircleSession = {
          userId,
          userToken,
          encryptionKey,
          wallet,
          usdcBalance: null,
        }
        setSession(newSession)
        saveSession(newSession)
        setState('connected')

        // Fetch balance in background
        try {
          const res = await apiPost<{ tokenBalances?: Array<{ amount: string; token: { symbol: string } }> }>(
            '/get-balance',
            { userToken, walletId: wallet.id },
          )
          const usdc = res.tokenBalances?.find((b) => b.token.symbol === 'USDC')
          const balance = usdc?.amount ?? '0'
          const withBalance = { ...newSession, usdcBalance: balance }
          setSession(withBalance)
          saveSession(withBalance)
        } catch {
          /* non-fatal */
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Connection failed'
        setError(msg)
        setState('error')
        toast.error(msg)
      }
    },
    [sdkReady],
  )

  // ── disconnect ────────────────────────────────────────────────────────
  const disconnect = useCallback(() => {
    clearSession()
    setSession(null)
    setState('idle')
    setError('')
  }, [])

  return (
    <CircleWalletContext.Provider
      value={{
        state,
        session,
        error,
        connect,
        disconnect,
        refreshBalance,
        executeChallenge,
        pollTransaction,
        isConfigured,
      }}
    >
      {children}
    </CircleWalletContext.Provider>
  )
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useCircleWallet() {
  const ctx = useContext(CircleWalletContext)
  if (!ctx) throw new Error('useCircleWallet must be used inside CircleWalletProvider')
  return ctx
}
