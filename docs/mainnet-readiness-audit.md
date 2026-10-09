# POOLLESS V2 — Arc Mainnet Readiness Audit

Date: 2026-10-08
Contract: PoollessV2.sol (deployed Arc Testnet 0x9ee4eef66b60937e6ec697c7904fcc2475ce9e03)
Auditor: Arc Studio read-only pass
Scope: contract + frontend + backend + deployment mechanism

---

## A. MAINNET READINESS VERDICT

**CONDITIONAL**

The contract itself is ready for mainnet without modification. All frontend/backend
changes are configuration updates only — no logic changes. Four files require
targeted edits; no architectural changes are needed.

---

## B. CRITICAL ISSUES

None.

The contract has no critical issues. The frontend changes are configuration-only.
No finding here would cause loss of real USDC if the migration procedure is
followed correctly.

---

## C. MEDIUM ISSUES

**M1 — `server/index.ts` hardcodes `Blockchain.ArcTestnet`**

Location: `server/index.ts` line 82 (`handleInitialize`).

```ts
blockchains: [Blockchain.ArcTestnet],
```

On mainnet this must be `Blockchain.Arc`. If left as `Blockchain.ArcTestnet`,
Circle's UCW API will create wallets on the testnet network regardless of which
chain the frontend is targeting. Contributions via Circle Wallet would be sent
from a testnet wallet against a mainnet contract — the transaction would fail or,
if the mainnet wallet is separately used through the browser wallet path, the
Circle Wallet path would be non-functional.

**Required change:** `Blockchain.ArcTestnet` → `Blockchain.Arc` in `handleInitialize`.

---

**M2 — `server/index.ts` contains a dead `/settle` route**

Location: `server/index.ts` lines 192–219 (`handleSettle`).

The `settle()` function was removed from PoollessV2. The `/settle` backend route
calls `settle(uint256)` which does not exist in the V2 ABI. If any client calls
this route against the mainnet V2 contract, it will result in a transaction that
reverts — but no funds are at risk because the call requires a wallet challenge
and Circle will not sign a transaction for a non-existent function (it will fail
at the ABI encoding or simulation stage). This is dead code, not a security risk,
but it is misleading and should be removed before mainnet launch.

---

## D. MINOR ISSUES

**D1 — `utils.ts` hardcodes `ARC_TESTNET_CHAIN_ID` for explorer URLs**

`getTxUrl` and `getAddressUrl` both call `buildTxExplorerUrl(ARC_TESTNET_CHAIN_ID, ...)`.
On mainnet, these will generate testnet explorer links for mainnet transactions.
Links will be broken from a user perspective. Not a fund-loss risk; a UX defect.

**D2 — `useObligationDiscovery.ts` hardcodes a `defineChain` for Arc Testnet**

Lines 72–83 define a local `arcTestnet` chain with:
- `id: 5042002`
- `rpcUrls: { default: { http: ['https://rpc.testnet.arc.io'] } }`
- `blockExplorers: { default: { url: 'https://explorer.testnet.arc.io' } }`
- `testnet: true`

This is used to construct the `publicClient`. On mainnet these values are wrong.

**D3 — `contract.ts` comment says "Arc Testnet" in the file header**

Documentation only; no runtime effect. Should be updated for clarity.

**D4 — `POOLLESS_V2_DEPLOYMENT_BLOCK` will be wrong on mainnet**

The deployment block `65988438n` is the Arc Testnet V2 block. Using it as
`fromBlock` on mainnet would result in querying a block range that may not
exist (mainnet may have fewer blocks if launched later) or querying the wrong
history. Event discovery would silently return no results. No fund-loss risk;
all obligations would appear missing to the frontend.

---

## E. INFORMATIONAL FINDINGS

**E1 — `config.ts` uses `arcTestnet` from `viem/chains`**

`viem/chains` exports `arcTestnet` (chain ID 5042002). For mainnet, viem exports
`arc` (chain ID 5042). The wagmi config must be updated. This is a configuration
change, not a security issue.

**E2 — `contract.ts` exports `ARC_TESTNET_CHAIN_ID` as a named const**

Any component importing `ARC_TESTNET_CHAIN_ID` and using it directly will
reference the wrong chain after migration. The const should be renamed
`ARC_CHAIN_ID` or the import updated — or a single `ACTIVE_CHAIN_ID` export
should exist that points at the correct chain.

**E3 — CORS in `server/index.ts` is `*`**

`Access-Control-Allow-Origin: *` is acceptable for a public read-only API but
is permissive for a backend that handles wallet operations. On mainnet, consider
restricting to the deployed app domain. Not a contract-level risk.

**E4 — `LOG_CHUNK_SIZE = 100_000n` is unvalidated against Arc mainnet RPC limits**

Arc mainnet RPC range limits are not publicly documented. If the mainnet RPC
enforces a lower limit (e.g. 10_000 blocks), chunked queries will fail silently.
The chunking code handles this gracefully (continues, returns partial results),
but the chunk size should be verified post-deploy.

**E5 — Dead `settle()` route in server/index.ts**

Covered under M2 above. Informational here for completeness.

---

## F. VERIFIED ARC MAINNET CONFIGURATION

Source: `src/onchain-facts.ts` (Arc Studio canonical registry, read directly
from the file). All values below are from that registry.

### ARC TESTNET (current deployment target)

| Property | Value |
|---|---|
| Network name | Arc Testnet |
| Chain ID | 5042002 |
| RPC endpoint | https://rpc.testnet.arc.io |
| Block explorer | https://explorer.testnet.arc.io |
| USDC ERC-20 address | `0x3600000000000000000000000000000000000000` |
| USDC decimals | 6 |
| Native gas currency | USDC (isUsdc: true) |
| Native gas decimals | 18 |
| CCTP domain | 26 |
| isTestnet | true |

### ARC MAINNET (migration target)

| Property | Value |
|---|---|
| Network name | Arc |
| Chain ID | 5042 |
| RPC endpoint | https://rpc.mainnet.arc.io |
| Block explorer | https://explorer.arc.io |
| USDC ERC-20 address | `0x3600000000000000000000000000000000000000` |
| USDC decimals | 6 |
| Native gas currency | USDC (isUsdc: true) |
| Native gas decimals | 18 |
| CCTP domain | 26 |
| isTestnet | false |

**Key observation:** The USDC ERC-20 contract address is identical on both
testnet and mainnet (`0x3600000000000000000000000000000000000000`). This is
correct and consistent with Arc's design. No USDC address change is required in
the POOLLESS contract constructor argument.

The constructor will receive the same address. The contract's USDC token
integration is chain-agnostic — it uses whatever address was passed at deploy
time. Deploying with `0x3600000000000000000000000000000000000000` on mainnet
is correct.

---

## G. TESTNET-SPECIFIC FILES AND VALUES

Every file containing a testnet-specific assumption, with the required mainnet value:

### `src/contract.ts`

| Location | Current testnet value | Required mainnet value |
|---|---|---|
| `ARC_TESTNET_CHAIN_ID = 5042002` | 5042002 | 5042 (rename to `ARC_CHAIN_ID`) |
| `requireChain(ARC_TESTNET_CHAIN_ID)` | Arc Testnet | `requireChain(5042)` |
| `getUsdc(ARC_TESTNET_CHAIN_ID)` | Arc Testnet USDC | `getUsdc(5042)` (same address) |
| `POOLLESS_ADDRESS` | `0x9ee4eef66b60937e6ec697c7904fcc2475ce9e03` | new mainnet deploy address |
| `POOLLESS_V1_ADDRESS` | `0x0245f9ba01ee36f8de5b038b3957d621ca6a05da` | (keep as historical V1 testnet ref) |
| `POOLLESS_V2_DEPLOYMENT_BLOCK = 65988438n` | Arc Testnet block | mainnet deploy block (TBD post-deploy) |
| `POOLLESS_CONTRACT.chainId` | 5042002 | 5042 |
| file header comment | "Arc Testnet" | "Arc Mainnet" |

### `src/config.ts`

| Location | Current testnet value | Required mainnet value |
|---|---|---|
| `import { arcTestnet } from 'viem/chains'` | viem arcTestnet (5042002) | `import { arc } from 'viem/chains'` (5042) |
| `chains: [arcTestnet, mainnet]` | Arc Testnet | `[arc, mainnet]` |
| `registerChain(arcTestnet.id, ...)` | 5042002 | `arc.id` (5042) |
| `transports: { [arcTestnet.id]: http() }` | 5042002 | `{ [arc.id]: http() }` |

### `src/hooks/useObligationDiscovery.ts`

| Location | Current testnet value | Required mainnet value |
|---|---|---|
| `defineChain({ id: 5042002 ... })` (lines 72-83) | Arc Testnet chain definition | Arc mainnet: id 5042, rpc https://rpc.mainnet.arc.io, explorer https://explorer.arc.io, testnet: false |
| `http('https://rpc.testnet.arc.io')` (line 89) | testnet RPC | `http('https://rpc.mainnet.arc.io')` |
| `POOLLESS_V2_DEPLOYMENT_BLOCK` (used as fromBlock) | 65988438n (testnet) | new mainnet deploy block |
| comment "Arc Testnet" (line 15) | documentation | "Arc Mainnet" |

### `src/utils.ts`

| Location | Current testnet value | Required mainnet value |
|---|---|---|
| `getTxUrl` → `buildTxExplorerUrl(ARC_TESTNET_CHAIN_ID, ...)` | testnet explorer | `buildTxExplorerUrl(5042, ...)` |
| `getAddressUrl` → `buildAddressExplorerUrl(ARC_TESTNET_CHAIN_ID, ...)` | testnet explorer | `buildAddressExplorerUrl(5042, ...)` |

### `server/index.ts`

| Location | Current testnet value | Required mainnet value |
|---|---|---|
| `Blockchain.ArcTestnet` (line 82) | UCW testnet wallet creation | `Blockchain.Arc` |

### `.env` (VITE_ variables, baked into build)

| Variable | Current testnet value | Required mainnet value |
|---|---|---|
| `VITE_POOLLESS_ADDRESS` | `0x9ee4eef66b60937e6ec697c7904fcc2475ce9e03` | new mainnet contract address |
| `VITE_USDC_ADDRESS` | `0x3600000000000000000000000000000000000000` | `0x3600000000000000000000000000000000000000` (unchanged) |

---

## H. CIRCLE WALLET MAINNET COMPATIBILITY

### A. Confirmed from current implementation

- Circle UCW SDK (`@circle-fin/user-controlled-wallets`) supports `Blockchain.Arc` as a named enum value in the SDK — the Arc mainnet enum exists alongside `Blockchain.ArcTestnet`.
- The wallet creation, token approval, contract execution, and refund routes in `server/index.ts` are all blockchain-agnostic except for the single `Blockchain.ArcTestnet` enum reference in `handleInitialize`. All other routes use addresses and function signatures that work identically on mainnet once the correct contract address is in `.env`.
- The `getWalletTokenBalance` call has no chain-specific parameters — it works against whatever blockchain the wallet was created on.
- USDC approval (`approve(address,uint256)`) is a standard ERC-20 call. The USDC address is identical on mainnet.

### B. Depends on Circle configuration

- A Circle UCW app configured for Arc Testnet may need its blockchain support extended to include Arc mainnet. This is a Circle Console setting, not a code change.
- The `VITE_CIRCLE_APP_ID` may need to reference a production Circle app (separate from the testnet app) once on mainnet. The production domain must be added to that app's Allowed Domains.
- Circle's UCW API must support `Blockchain.Arc` (mainnet) wallet creation under the same API key, or a separate mainnet API key may be required.

### C. Requires real mainnet testing

- End-to-end Circle Wallet flow on mainnet: create wallet → approve USDC → contribute() → auto-settle.
- Gas estimation for Circle Wallet transactions on Arc mainnet (gas is USDC; Circle's fee estimator must support Arc mainnet fee levels).
- Circle Wallet USDC balance read on mainnet.
- Whether `Blockchain.Arc` wallets created via UCW can receive mainnet USDC and sign mainnet transactions.

---

## I. POOLLESSV2.SOL VERDICT

**UNCHANGED**

No contract modifications are required for mainnet deployment.

The contract:
- has no hardcoded chain IDs
- has no hardcoded RPC endpoints
- has no hardcoded addresses except the immutable `usdc` set by the constructor
- receives the USDC address as a constructor argument — the same address (`0x3600...`) is correct on both testnet and mainnet
- has no `block.chainid` checks
- has no testnet-specific logic

Deploy the identical bytecode to mainnet with the same constructor argument.

---

## J. EXACT FILES THAT WOULD REQUIRE CHANGES

Five files require targeted changes. No new files need to be created.

1. `src/contract.ts` — chain ID, contract address, deployment block, comments
2. `src/config.ts` — chain import, wagmi chain list, transport key
3. `src/hooks/useObligationDiscovery.ts` — `defineChain` definition, RPC URL, comment
4. `src/utils.ts` — chain ID in `getTxUrl` and `getAddressUrl`
5. `server/index.ts` — `Blockchain.ArcTestnet` → `Blockchain.Arc`

Optional (recommended cleanup before mainnet):
6. `server/index.ts` — remove dead `/settle` route (`handleSettle`)

`.env` values that change:
- `VITE_POOLLESS_ADDRESS` → new mainnet contract address (set after deploy)
- `VITE_USDC_ADDRESS` → unchanged

---

## K. MAINNET DEPLOYMENT REQUIREMENTS

- **Contract:** PoollessV2.sol (identical bytecode, no changes)
- **Constructor argument:** `0x3600000000000000000000000000000000000000` (Arc mainnet USDC address)
- **Deployer wallet:** must hold Arc mainnet USDC for gas (USDC = native gas on Arc)
- **Required gas:** Arc Studio's `deploy_contract` tool uses a Circle-managed deployer wallet (funded for testnet). That wallet is testnet-only. Mainnet deployment requires the user's own wallet with real USDC for gas.
- **Does deployment require holding real USDC as collateral?** No. The contract holds no initial USDC. It only receives USDC from contributors at runtime.
- **Contract verification:** Arc Studio does not currently verify contract source on the Arc mainnet explorer. Manual Blockscout verification is possible using the same Solidity source, compiler version (0.8.28), optimizer settings (runs: 200, via_ir: true), and constructor argument.

---

## L. MAINNET DEPLOYMENT PROCEDURE

**Warning:** Transactions on mainnet involve real funds and are irreversible.
Complete independent review before proceeding. Only proceed after confirming
you want to use real USDC for gas.

1. Ensure your deployer wallet holds Arc mainnet USDC (for gas).
2. Deploy PoollessV2.sol with constructor argument `0x3600000000000000000000000000000000000000` using your own tooling (e.g. `forge create` targeting Arc mainnet RPC `https://rpc.mainnet.arc.io`).
3. Record the deployment transaction hash and block number from the receipt.
4. Verify the deployed contract address by calling `obligationCount()` — should return 0.
5. Optionally verify source on the Arc mainnet explorer via Blockscout.

Forge command (reference only — do not run from Arc Studio):
```bash
forge create contracts/PoollessV2.sol:PoollessV2 \
  --rpc-url https://rpc.mainnet.arc.io \
  --private-key <YOUR_DEPLOYER_KEY> \
  --constructor-args 0x3600000000000000000000000000000000000000
```

---

## M. POST-DEPLOYMENT CHANGES REQUIRED

After the mainnet contract is deployed and the transaction hash + block are confirmed:

1. **`src/contract.ts`:**
   - `ARC_TESTNET_CHAIN_ID` → `ARC_CHAIN_ID = 5042`
   - `POOLLESS_ADDRESS` → new mainnet address
   - `POOLLESS_V2_DEPLOYMENT_BLOCK` → mainnet deploy block
   - `POOLLESS_CONTRACT.chainId` → 5042

2. **`src/config.ts`:**
   - `arcTestnet` import → `arc` from `viem/chains`
   - `chains`, `registerChain`, `transports` updated to `arc`

3. **`src/hooks/useObligationDiscovery.ts`:**
   - `defineChain` → Arc mainnet values (id: 5042, RPC, explorer, testnet: false)

4. **`src/utils.ts`:**
   - `getTxUrl` and `getAddressUrl` → chain ID 5042

5. **`server/index.ts`:**
   - `Blockchain.ArcTestnet` → `Blockchain.Arc`

6. **`.env`:**
   - `VITE_POOLLESS_ADDRESS` → new mainnet address

7. **Circle Console:**
   - Add the production domain to Allowed Domains for the UCW app.
   - Confirm `Blockchain.Arc` is enabled for the app.

8. **Rebuild and redeploy the frontend** (Vite bakes env values at build time).

---

## N. REAL-USDC TEST PLAN

Perform in order on mainnet, starting with the smallest possible amounts:

1. Deploy contract; verify `obligationCount() == 0`.
2. Create a 1-obligation test with two contributors (0.01 USDC each, total 0.02 USDC), short deadline, a controlled recipient.
3. Both contributors fund. Verify auto-settlement transfers exactly 0.02 USDC to recipient. Verify contract balance is 0.
4. Create a second test obligation; let it expire without full funding; verify refund claims work.
5. Verify Circle Wallet path: wallet creation on `Blockchain.Arc`, USDC approval, contribute(), auto-settle, settlement tx hash visible in UI.
6. Only after all above pass: open to real users.

---

## O. ESTIMATED MAINNET COSTS

All cost estimates are labeled as estimates; actual gas depends on Arc mainnet
fee conditions at execution time.

**Contract deployment:**
- POOLLESS is a moderately complex contract (~200 lines, no complex libraries beyond OZ). Estimated deployment gas: 1.5M–2.5M gas units. On Arc, gas is paid in USDC at a stable rate. At Arc's published stable fee structure, deployment is expected to cost less than 1 USDC. Exact amount: UNVERIFIED until a deployment is attempted.

**Per-transaction gas (once deployed):**
- `createObligation` (2 contributors): ~150K–250K gas. Cost: fraction of a cent in USDC. UNVERIFIED.
- `contribute` (non-final): ~80K–120K gas. UNVERIFIED.
- `contribute` (final — auto-settles, two transfers): ~120K–180K gas. UNVERIFIED.
- `refundExpired`: ~50K–80K gas. UNVERIFIED.
- `claimRefund`: ~80K–120K gas. UNVERIFIED.

On Arc, gas predictability is one of the network's design goals. All costs should
be stable and denominated in USDC fractions.

**USDC required to hold:** Zero. The contract holds USDC in escrow only during an obligation's active window. No permanent USDC reserve is needed.

---

## P. SAFEST NEXT ACTION

**Before any mainnet work:**

1. Add the mainnet disclaimer acknowledgment.

2. Deploy PoollessV2.sol to Arc mainnet from your own wallet using `forge create` against `https://rpc.mainnet.arc.io`. Record the contract address and deployment block.

3. Update the five frontend/backend files with mainnet values (contract.ts, config.ts, useObligationDiscovery.ts, utils.ts, server/index.ts).

4. Build locally and run the production server against the mainnet contract with a read-only smoke test (`getObligation` on a known ID).

5. Run the real-USDC test plan (section N) with the minimum amounts before opening to users.

6. Do NOT modify PoollessV2.sol at any point.

---

*End of audit. PoollessV2.sol verdict: UNCHANGED. Mainnet readiness: CONDITIONAL on five targeted file edits and a mainnet deployment.*
