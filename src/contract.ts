/**
 * POOLLESS V2 contract configuration.
 *
 * Active network: Arc Mainnet (5042)
 *
 * Mainnet deployment:
 * 0x8eaCFad7296659e377c303Cc1A280c02Aaf00018
 *
 * Deployment transaction:
 * 0xd1d991c5e1443be64cca6e40293ab3568b3f4d6e68df320a9949916f69dda533
 *
 * Historical Arc Testnet deployments:
 * V1: 0x0245f9ba01ee36f8de5b038b3957d621ca6a05da
 * V2: 0x9ee4eef66b60937e6ec697c7904fcc2475ce9e03
 */

import v2Artifact from '../contracts/out/PoollessV2.sol/PoollessV2.json'
import { getUsdc, requireChain } from '@/onchain-facts'

// Active network
export const ARC_MAINNET_CHAIN_ID = 5042

// Historical network identifier
export const ARC_TESTNET_CHAIN_ID = 5042002

export const arcMainnetChain = requireChain(ARC_MAINNET_CHAIN_ID)
export const usdcFact = getUsdc(ARC_MAINNET_CHAIN_ID)

if (!usdcFact) {
  throw new Error('USDC not configured for Arc Mainnet')
}

export const USDC_ADDRESS = usdcFact.address as `0x${string}`
export const USDC_DECIMALS = usdcFact.decimals

// Historical V1 deployment
export const POOLLESS_V1_ADDRESS =
  '0x0245f9ba01ee36f8de5b038b3957d621ca6a05da' as const

// Active V2 Mainnet deployment
export const POOLLESS_ADDRESS =
  '0x8eaCFad7296659e377c303Cc1A280c02Aaf00018' as const

export const POOLLESS_V2_DEPLOYMENT_BLOCK = 24970948n

export const POOLLESS_ABI = v2Artifact.abi

export const POOLLESS_CONTRACT = {
  address: POOLLESS_ADDRESS,
  abi: POOLLESS_ABI,
  chainId: ARC_MAINNET_CHAIN_ID,
} as const

/**
 * V2 ObligationStatus:
 * OPEN = 0
 * SETTLED = 1
 * EXPIRED = 2
 */
export enum ObligationStatus {
  OPEN = 0,
  SETTLED = 1,
  EXPIRED = 2,
}

export const STATUS_LABELS: Record<ObligationStatus, string> = {
  [ObligationStatus.OPEN]: 'Open',
  [ObligationStatus.SETTLED]: 'Settled',
  [ObligationStatus.EXPIRED]: 'Expired',
}
