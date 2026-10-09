/**
 * POOLLESS backend — Circle User-Controlled Wallets API routes
 *
 * Keeps CIRCLE_API_KEY server-side. Never exposes it to the browser.
 * Run with: bun run server/index.ts
 */

import { initiateUserControlledWalletsClient, Blockchain } from '@circle-fin/user-controlled-wallets'

const PORT = 3001

const apiKey = process.env.CIRCLE_API_KEY
if (!apiKey) {
  console.warn('[poolless-server] CIRCLE_API_KEY is not set — Circle Wallet routes will return 503')
}

function makeClient() {
  if (!apiKey) return null
  return initiateUserControlledWalletsClient({ apiKey })
}

// ─── Simple CORS + JSON middleware ──────────────────────────────────────────
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  }
}

async function parseBody<T>(req: Request): Promise<T> {
  return req.json() as Promise<T>
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders() })
}

function missing() {
  return json({ error: 'CIRCLE_API_KEY not configured', code: 503 }, 503)
}

// ─── Routes ─────────────────────────────────────────────────────────────────

async function handleCreateUser(req: Request) {
  const client = makeClient()
  if (!client) return missing()
  const { userId } = await parseBody<{ userId: string }>(req)
  if (!userId || userId.length < 5) return json({ error: 'userId must be at least 5 characters' }, 400)
  try {
    const res = await client.createUser({ userId })
    return json(res.data ?? {})
  } catch (err: unknown) {
    const e = err as { response?: { data?: unknown }; message?: string }
    return json(e.response?.data ?? { error: e.message }, 400)
  }
}

async function handleGetToken(req: Request) {
  const client = makeClient()
  if (!client) return missing()
  const { userId } = await parseBody<{ userId: string }>(req)
  if (!userId) return json({ error: 'userId required' }, 400)
  try {
    const res = await client.createUserToken({ userId })
    return json(res.data ?? {})
  } catch (err: unknown) {
    const e = err as { response?: { data?: unknown }; message?: string }
    return json(e.response?.data ?? { error: e.message }, 400)
  }
}

async function handleInitialize(req: Request) {
  const client = makeClient()
  if (!client) return missing()
  const { userToken } = await parseBody<{ userToken: string }>(req)
  if (!userToken) return json({ error: 'userToken required' }, 400)
  try {
    const res = await client.createUserPinWithWallets({
      userToken,
      blockchains: [Blockchain.ArcTestnet],
      accountType: 'EOA',
    })
    return json(res.data ?? {})
  } catch (err: unknown) {
    const e = err as { response?: { data?: unknown; code?: number }; message?: string }
    const body = e.response?.data as { code?: number } | undefined
    // 155106 = already initialized — caller should list wallets
    if (body?.code === 155106) return json({ code: 155106 })
    return json(body ?? { error: e.message }, 400)
  }
}

async function handleListWallets(req: Request) {
  const client = makeClient()
  if (!client) return missing()
  const { userToken } = await parseBody<{ userToken: string }>(req)
  if (!userToken) return json({ error: 'userToken required' }, 400)
  try {
    const res = await client.listWallets({ userToken })
    return json(res.data ?? {})
  } catch (err: unknown) {
    const e = err as { response?: { data?: unknown }; message?: string }
    return json(e.response?.data ?? { error: e.message }, 400)
  }
}

async function handleGetBalance(req: Request) {
  const client = makeClient()
  if (!client) return missing()
  const { userToken, walletId } = await parseBody<{ userToken: string; walletId: string }>(req)
  if (!userToken || !walletId) return json({ error: 'userToken and walletId required' }, 400)
  try {
    const res = await client.getWalletTokenBalance({ walletId, userToken })
    return json(res.data ?? {})
  } catch (err: unknown) {
    const e = err as { response?: { data?: unknown }; message?: string }
    return json(e.response?.data ?? { error: e.message }, 400)
  }
}

/**
 * Create an ERC-20 approve challenge (USDC allowance for Poolless contract).
 * Called before contribute() so the contract can pull USDC.
 */
async function handleApprove(req: Request) {
  const client = makeClient()
  if (!client) return missing()
  const { userToken, walletId, amount } = await parseBody<{
    userToken: string
    walletId: string
    amount: string // in USDC smallest units (6-dec), as decimal string
  }>(req)
  if (!userToken || !walletId || !amount) return json({ error: 'userToken, walletId, amount required' }, 400)
  const POOLLESS_ADDRESS = process.env.VITE_POOLLESS_ADDRESS
  const USDC_ADDRESS = process.env.VITE_USDC_ADDRESS
  if (!POOLLESS_ADDRESS || !USDC_ADDRESS) {
    return json({ error: 'VITE_POOLLESS_ADDRESS or VITE_USDC_ADDRESS not set in .env' }, 503)
  }
  try {
    const res = await client.createContractExecutionTransaction({
      userToken,
      walletId,
      contractAddress: USDC_ADDRESS,
      abiFunctionSignature: 'approve(address,uint256)',
      abiParameters: [POOLLESS_ADDRESS, amount],
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
    })
    return json(res.data ?? {})
  } catch (err: unknown) {
    const e = err as { response?: { data?: unknown }; message?: string }
    return json(e.response?.data ?? { error: e.message }, 400)
  }
}

/**
 * Create a contribute() challenge — calls the Poolless contract.
 */
async function handleContribute(req: Request) {
  const client = makeClient()
  if (!client) return missing()
  const { userToken, walletId, obligationId } = await parseBody<{
    userToken: string
    walletId: string
    obligationId: string // uint256 as decimal string
  }>(req)
  if (!userToken || !walletId || !obligationId) {
    return json({ error: 'userToken, walletId, obligationId required' }, 400)
  }
  const POOLLESS_ADDRESS = process.env.VITE_POOLLESS_ADDRESS
  if (!POOLLESS_ADDRESS) return json({ error: 'VITE_POOLLESS_ADDRESS not set in .env' }, 503)
  try {
    const res = await client.createContractExecutionTransaction({
      userToken,
      walletId,
      contractAddress: POOLLESS_ADDRESS,
      abiFunctionSignature: 'contribute(uint256)',
      abiParameters: [obligationId],
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
    })
    return json(res.data ?? {})
  } catch (err: unknown) {
    const e = err as { response?: { data?: unknown }; message?: string }
    return json(e.response?.data ?? { error: e.message }, 400)
  }
}

/**
 * Create a settle() challenge.
 */
async function handleSettle(req: Request) {
  const client = makeClient()
  if (!client) return missing()
  const { userToken, walletId, obligationId } = await parseBody<{
    userToken: string
    walletId: string
    obligationId: string
  }>(req)
  if (!userToken || !walletId || !obligationId) {
    return json({ error: 'userToken, walletId, obligationId required' }, 400)
  }
  const POOLLESS_ADDRESS = process.env.VITE_POOLLESS_ADDRESS
  if (!POOLLESS_ADDRESS) return json({ error: 'VITE_POOLLESS_ADDRESS not set in .env' }, 503)
  try {
    const res = await client.createContractExecutionTransaction({
      userToken,
      walletId,
      contractAddress: POOLLESS_ADDRESS,
      abiFunctionSignature: 'settle(uint256)',
      abiParameters: [obligationId],
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
    })
    return json(res.data ?? {})
  } catch (err: unknown) {
    const e = err as { response?: { data?: unknown }; message?: string }
    return json(e.response?.data ?? { error: e.message }, 400)
  }
}

/**
 * Create a refundExpired() challenge.
 */
async function handleRefundExpired(req: Request) {
  const client = makeClient()
  if (!client) return missing()
  const { userToken, walletId, obligationId } = await parseBody<{
    userToken: string
    walletId: string
    obligationId: string
  }>(req)
  if (!userToken || !walletId || !obligationId) {
    return json({ error: 'userToken, walletId, obligationId required' }, 400)
  }
  const POOLLESS_ADDRESS = process.env.VITE_POOLLESS_ADDRESS
  if (!POOLLESS_ADDRESS) return json({ error: 'VITE_POOLLESS_ADDRESS not set in .env' }, 503)
  try {
    const res = await client.createContractExecutionTransaction({
      userToken,
      walletId,
      contractAddress: POOLLESS_ADDRESS,
      abiFunctionSignature: 'refundExpired(uint256)',
      abiParameters: [obligationId],
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
    })
    return json(res.data ?? {})
  } catch (err: unknown) {
    const e = err as { response?: { data?: unknown }; message?: string }
    return json(e.response?.data ?? { error: e.message }, 400)
  }
}

/**
 * Create a claimRefund() challenge.
 */
async function handleClaimRefund(req: Request) {
  const client = makeClient()
  if (!client) return missing()
  const { userToken, walletId, obligationId } = await parseBody<{
    userToken: string
    walletId: string
    obligationId: string
  }>(req)
  if (!userToken || !walletId || !obligationId) {
    return json({ error: 'userToken, walletId, obligationId required' }, 400)
  }
  const POOLLESS_ADDRESS = process.env.VITE_POOLLESS_ADDRESS
  if (!POOLLESS_ADDRESS) return json({ error: 'VITE_POOLLESS_ADDRESS not set in .env' }, 503)
  try {
    const res = await client.createContractExecutionTransaction({
      userToken,
      walletId,
      contractAddress: POOLLESS_ADDRESS,
      abiFunctionSignature: 'claimRefund(uint256)',
      abiParameters: [obligationId],
      fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
    })
    return json(res.data ?? {})
  } catch (err: unknown) {
    const e = err as { response?: { data?: unknown }; message?: string }
    return json(e.response?.data ?? { error: e.message }, 400)
  }
}

/**
 * Poll Circle for a transaction's state.
 */
async function handleGetTransaction(req: Request) {
  const client = makeClient()
  if (!client) return missing()
  const { userToken, transactionId } = await parseBody<{ userToken: string; transactionId: string }>(req)
  if (!userToken || !transactionId) return json({ error: 'userToken and transactionId required' }, 400)
  try {
    const res = await client.getTransaction({ userToken, id: transactionId })
    return json(res.data ?? {})
  } catch (err: unknown) {
    const e = err as { response?: { data?: unknown }; message?: string }
    return json(e.response?.data ?? { error: e.message }, 400)
  }
}

// ─── Route map (exported so prod.ts can reuse without duplicating logic) ─────

export const ROUTES: Record<string, (req: Request) => Promise<Response>> = {
  '/create-user': handleCreateUser,
  '/get-token': handleGetToken,
  '/initialize': handleInitialize,
  '/list-wallets': handleListWallets,
  '/get-balance': handleGetBalance,
  '/approve': handleApprove,
  '/contribute': handleContribute,
  '/settle': handleSettle,
  '/refund-expired': handleRefundExpired,
  '/claim-refund': handleClaimRefund,
  '/get-transaction': handleGetTransaction,
}

/** Shared fetch handler — call from any Bun.serve() */
export async function handleApiRequest(req: Request): Promise<Response | null> {
  const url = new URL(req.url)

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() })
  }

  const handler = ROUTES[url.pathname]
  if (!handler) return null // let caller decide (404 in dev, SPA fallback check in prod)
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  try {
    return await handler(req)
  } catch (err: unknown) {
    const e = err as { message?: string }
    console.error(`[poolless-server] Unhandled error on ${url.pathname}:`, e)
    return json({ error: 'Internal server error' }, 500)
  }
}

// ─── Dev entrypoint (bun run server) ─────────────────────────────────────────
// Only start the standalone dev server when this file is the entry point,
// not when it is imported by prod.ts.

if (import.meta.main) {
  Bun.serve({
    port: PORT,
    async fetch(req) {
      const res = await handleApiRequest(req)
      if (res) return res
      return json({ error: 'Not found' }, 404)
    },
  })
  console.log(`[poolless-server] Listening on http://localhost:${PORT}`)
}
