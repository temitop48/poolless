import { USDC_DECIMALS } from './contract'
import { buildTxExplorerUrl, buildAddressExplorerUrl } from '@/onchain-facts'
import { ARC_MAINNET_CHAIN_ID } from './contract'

export function formatAddress(addr: string): string {
  if (!addr || addr.length < 10) return addr
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

export function formatUsdc(raw: bigint): string {
  const divisor = BigInt(10 ** USDC_DECIMALS)
  const whole = raw / divisor
  const frac = raw % divisor
  const fracStr = frac.toString().padStart(USDC_DECIMALS, '0').replace(/0+$/, '')
  if (fracStr === '') return whole.toLocaleString('en-US')
  return `${whole.toLocaleString('en-US')}.${fracStr}`
}

export function parseUsdc(value: string): bigint {
  const cleaned = value.trim().replace(/,/g, '')

  if (!/^\d+(\.\d{1,6})?$/.test(cleaned)) {
    throw new Error('Enter a valid USDC amount with at most 6 decimal places.')
  }

  const [whole, frac = ''] = cleaned.split('.')
  const decimals = BigInt(10 ** USDC_DECIMALS)

  const amount =
    BigInt(whole) * decimals +
    BigInt(frac.padEnd(USDC_DECIMALS, '0'))

  if (amount <= 0n) {
    throw new Error('USDC amount must be greater than zero.')
  }

  return amount
}

export function formatDeadline(unix: bigint): string {
  const date = new Date(Number(unix) * 1000)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function isDeadlinePassed(unix: bigint): boolean {
  return Date.now() / 1000 >= Number(unix)
}

export function getTxUrl(hash: string): string {
  return buildTxExplorerUrl(ARC_MAINNET_CHAIN_ID, hash)
}

export function getAddressUrl(addr: string): string {
  return buildAddressExplorerUrl(ARC_MAINNET_CHAIN_ID, addr)
}

export function parseOnchainError(error: unknown): string {
  const msg = (error as { message?: string })?.message?.toLowerCase() ?? ''
  if (msg.includes('user rejected') || msg.includes('user denied')) return 'Transaction cancelled.'
  if (msg.includes('insufficient funds') || msg.includes('exceeds balance')) return 'Insufficient USDC balance.'
  if (msg.includes('already contributed')) return 'You have already funded your share.'
  if (msg.includes('not a contributor')) return 'Your wallet is not a contributor to this obligation.'
  if (msg.includes('not funded')) return 'This obligation is not fully funded yet.'
  if (msg.includes('not open')) return 'This obligation is no longer open.'
  if (msg.includes('deadline not reached')) return 'The deadline has not passed yet.'
  if (msg.includes('not expired')) return 'This obligation has not expired.'
  if (msg.includes('no refund available')) return 'No refund available — you have not contributed.'
  if (msg.includes('total mismatch')) return 'Contribution shares must sum to the total amount.'
  if (msg.includes('reverted')) {
    const match = msg.match(/reason="([^"]+)"/)
    return match ? `Transaction failed: ${match[1]}` : 'Transaction failed. Please try again.'
  }
  if (msg.includes('network') || msg.includes('timeout')) return 'Network issue. Please try again.'
  return 'Something went wrong. Please try again.'
}
