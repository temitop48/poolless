# POOLLESS

### Many people. One obligation. No treasurer.

**POOLLESS is a USDC payment-coordination protocol built on Arc Mainnet.**

It allows multiple contributors to independently fund a predefined financial obligation. Once everyone has paid their assigned share, the smart contract automatically transfers the complete payment to the designated recipient.

No group treasurer. No manual collection. Onchain settlement.

> **Status:** Working Arc Mainnet prototype with a successful real-USDC settlement. The contract has not undergone an independent security audit.

## The Problem

Shared financial obligations often involve several people but only one recipient.

Consider three businesses jointly purchasing equipment for 300 USDC. Each business owes 100 USDC, but the supplier expects one complete payment.

Traditionally, one participant collects everyone's contributions and forwards the money.

This creates coordination overhead, trust requirements, and potential disputes.

## The Solution

POOLLESS replaces the group treasurer with a smart contract.

1. **Create an obligation:** Define the recipient, total amount, deadline, contributors, and their individual shares.
2. **Fund independently:** Each contributor transfers their assigned USDC amount into the contract.
3. **Settle automatically:** When the final contribution arrives, the contract transfers the full amount to the recipient.
4. **Recover funds if incomplete:** After the deadline, an unfinished obligation can be marked expired, allowing funded contributors to claim refunds.

Contributions are temporarily held in smart-contract escrow. POOLLESS removes the need for a human treasurer, not escrow itself.

## Live Arc Mainnet Demonstration

POOLLESS has successfully completed an end-to-end settlement using real USDC on Arc Mainnet.

| Metric | Verified result |
|---|---|
| Obligation | #1 |
| Contributors | 2 |
| Contribution per wallet | 0.001 USDC |
| Total settled | 0.002 USDC |
| Network | Arc Mainnet |
| Final status | SETTLED |

The public demonstration allows visitors to inspect the completed obligation without connecting a wallet.

**Live application:** [Launch POOLLESS](https://poolless-neon.vercel.app/)

**Live settlement proof:** [Explore Obligation #1](https://poolless-neon.vercel.app/#/obligation/1)

## Smart Contract Deployment

| Property | Value |
|---|---|
| Contract | PoollessV2 |
| Network | Arc Mainnet |
| Chain ID | 5042 |
| Contract address | `0x8eaCFad7296659e377c303Cc1A280c02Aaf00018` |
| USDC address | `0x3600000000000000000000000000000000000000` |
| USDC decimals | 6 |
| Deployment block | 24970948 |

**Deployment transaction:**

`0xd1d991c5e1443be64cca6e40293ab3568b3f4d6e68df320a9949916f69dda533`

The active contract source is located at:

`contracts/PoollessV2.sol`

The frontend's contract configuration is located at:

`src/contract.ts`

## Core Features

- Arc Mainnet integration
- Browser-wallet connection
- Fixed-share USDC obligations
- Up to 50 contributors per obligation
- Individual USDC contributions
- Automatic settlement after full funding
- Deadline-based expiration
- Individual refund claims
- Onchain obligation tracking
- Shareable obligation links
- Public settlement demonstration
- Arc Explorer transaction evidence

## Smart Contract Lifecycle

```text
             CREATE OBLIGATION
                    |
                    v
                   OPEN
                    |
          +---------+---------+
          |                   |
    Fully funded        Deadline passes
          |                   |
          v                   v
        SETTLED             EXPIRED
          |                   |
          v                   v
   Recipient receives    Contributors claim
   full USDC payment     eligible refunds
```

Settlement occurs automatically within the transaction that completes the funding requirement.

Expiry requires an onchain transaction, and contributors must individually claim available refunds.

## Technology Stack

| Layer | Technology |
|---|---|
| Blockchain | Arc Mainnet |
| Payment token | USDC |
| Smart contracts | Solidity |
| Contract libraries | OpenZeppelin |
| Smart contract testing | Foundry |
| Frontend | React, TypeScript |
| Build tool | Vite |
| Styling | Tailwind CSS |
| Wallet integration | wagmi, viem, ConnectKit |
| Package manager | Bun |
| Hosting | Vercel |

## Getting Started

### Requirements

- Bun
- Node-compatible development environment
- Browser wallet compatible with Arc Mainnet

Foundry is required for running the smart contract tests.

### Installation

```bash
git clone https://github.com/temitop48/poolless.git

cd poolless

bun install --frozen-lockfile
```

### Start the development server

```bash
bun run dev
```

Open the local address displayed by Vite.

### Production build

```bash
bun run build
```

### Smart contract tests

```bash
forge test
```

During development, the Foundry test suite completed with **133 passing tests**.

These tests do not replace an independent security audit.

## Project Structure

```text
poolless/
├── contracts/
│   ├── PoollessV2.sol
│   └── contract-metadata/
│       └── PoollessV2.json
├── src/
│   ├── components/
│   │   ├── LandingPage.tsx
│   │   ├── CreatePage.tsx
│   │   └── ObligationPage.tsx
│   ├── hooks/
│   │   └── useObligationDiscovery.ts
│   ├── contract.ts
│   └── App.tsx
├── package.json
└── README.md
```

This shows the main project files rather than every directory.

## Why Arc?

POOLLESS uses Arc Mainnet as its payment and settlement infrastructure.

Arc enables the application to coordinate USDC contributions and execute programmable settlement through smart contracts.

The blockchain provides:

- Transparent obligation states
- Verifiable contributions
- Deterministic settlement conditions
- Onchain transaction receipts
- Contract-enforced refund eligibility

POOLLESS demonstrates how stablecoin payments can support shared financial obligations without requiring a trusted human collector.

## Current Limitations

POOLLESS is an early-stage prototype.

- The smart contract has not been independently audited.
- Circle embedded-wallet onboarding is not currently enabled in production.
- Browser wallets are required for active participation.
- Contributors, shares, recipients, and deadlines cannot be changed after creation.
- Blockchain transaction information is publicly accessible.
- Refunds require explicit onchain actions.
- The application has not undergone formal concurrent-user load testing.

Users should avoid committing significant funds until additional security reviews are completed.

## Roadmap

Potential future improvements include:

1. Production embedded-wallet onboarding.
2. Improved obligation discovery and indexing.
3. Expanded performance and integration testing.
4. Independent security assessment.
5. Payment reminders and notifications.
6. Additional coordination features for recurring business workflows.

These features are planned possibilities, not currently shipped functionality.


---

**POOLLESS**

*Many people. One obligation. No treasurer.*

Built on Arc Mainnet.