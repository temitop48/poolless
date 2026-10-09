# POOLLESS V2 — Security & Completeness Review

**Scope:** `contracts/PoollessV2.sol` + `src/components/ObligationPage.tsx` + `src/hooks/useObligationDiscovery.ts`
**Date:** 2026-10-07
**Method:** Read-only source analysis. No transactions executed, no new obligations created, no redeployment.

---

## Item-by-Item Findings

### 1. Can an assigned contributor contribute twice?

**PASS — guaranteed by contract code.**

`contribute()` line 118: `require(!info.hasPaid, "Poolless: already contributed")`. The `hasPaid` flag is set to `true` on line 122 (effects-before-interactions). A second call from the same address reverts unconditionally regardless of who sends it or how the transaction is constructed.

---

### 2. Can an unassigned wallet contribute?

**PASS — guaranteed by contract code.**

`contribute()` line 117: `require(info.amount > 0, "Poolless: not a contributor")`. The `contributorInfo` mapping is keyed by address and is only populated by `createObligation`. Any address not in the original contributor list has `amount == 0` and reverts immediately.

---

### 3. Can someone contribute after settlement?

**PASS — guaranteed by contract code.**

`contribute()` line 113: `require(ob.status == ObligationStatus.OPEN, "Poolless: not open")`. Once the obligation is SETTLED, all contribute calls revert on this guard. Because settlement is atomic within the final contribution, there is no window between "fully funded" and "settled" where a second call could slip in.

---

### 4. Can someone contribute after the deadline?

**PASS — guaranteed by contract code.**

`contribute()` line 114: `require(block.timestamp < ob.deadline, "Poolless: obligation expired")`. The check uses strict less-than, so a transaction landing at exactly `ob.deadline` also reverts. Block timestamps on Arc Testnet are reliably within a 15-second drift window; for deadlines set in days or weeks, this is not an exploitable edge.

---

### 5. Can someone underpay or overpay their assigned share?

**PASS — guaranteed by contract code.**

The contract does not accept a caller-supplied amount. `contribute()` reads `amount = info.amount` from storage (line 120) — the exact share assigned at creation. The ERC-20 `safeTransferFrom` is called with that storage value. The caller cannot pass a different amount. An overfund guard (line 124) is also present as belt-and-suspenders.

---

### 6. Can one contributor fund another contributor's share?

**PASS — guaranteed by contract code.**

`contribute()` always uses `msg.sender` to look up `contributorInfo`. There is no `onBehalfOf` parameter. Contributor A cannot call `contribute()` and pay for Contributor B's share. The USDC debit and the `hasPaid` flag both apply to `msg.sender`.

---

### 7. Can the creator change the recipient after creation?

**PASS — guaranteed by contract code.**

There is no setter for `ob.recipient`. The field is written once in `createObligation()` and is never touched again. No admin role, no owner variable, no proxy.

---

### 8. Can the creator change contributor addresses or shares after creation?

**PASS — guaranteed by contract code.**

Same reasoning as #7. `ob.contributors`, `ob.totalAmount`, and `ob.contributorInfo` are populated in `createObligation()` and have no setter. The obligation struct is in a `private` mapping; no external function modifies these fields after creation.

---

### 9. Can the recipient be changed after any contribution?

**PASS — guaranteed by contract code.**

Same as #7 and #8. No setter exists for any obligation field post-creation.

---

### 10. Can automatic settlement execute twice?

**PASS — guaranteed by contract code.**

The settlement branch (`if (ob.totalFunded == ob.totalAmount)`) is inside `contribute()`, which itself is behind `require(ob.status == ObligationStatus.OPEN)`. The first time the branch runs, it sets `ob.status = ObligationStatus.SETTLED` before the USDC transfer (line 131). Any subsequent `contribute()` call (even within the same block) hits the OPEN guard and reverts. `nonReentrant` prevents re-entry mid-execution. There is no path to call the settlement branch twice.

---

### 11. What happens if the final USDC transfer to the recipient fails?

**CONTRACT — requires real-world test to fully characterise, but the code behaviour is defined.**

`usdc.safeTransfer(ob.recipient, ob.totalAmount)` uses OpenZeppelin's `SafeERC20`, which wraps the transfer call and reverts if the return value is `false` or if the call itself reverts. If the transfer fails:

- The entire transaction reverts (EVM atomicity).
- `ob.status` is NOT written to SETTLED (the write on line 131 is before the transfer, but the revert unwinds it).
- All three emitted events are rolled back.
- `info.hasPaid` is rolled back to `false`.
- `ob.totalFunded` is rolled back.
- The USDC `safeTransferFrom` from the final contributor is also rolled back — they do not lose funds.

**In practice on Arc Testnet:** The USDC contract at `0x3600000000000000000000000000000000000000` is Circle's canonical contract and does not revert on transfer to an EOA recipient. The only scenario where this transfer could fail is if the recipient is a contract with a reverting fallback or a gas-limited receive. For the current test obligations with EOA recipients, this is not a live risk.

**This is the one scenario that remains a NEEDS REAL-WORLD TEST item for any production use with contract recipients.**

---

### 12. Can reentrancy affect contribute, automatic settlement, or refunds?

**PASS — guaranteed by contract code.**

`contribute()`, `refundExpired()`, and `claimRefund()` all carry the `nonReentrant` modifier from OpenZeppelin's `ReentrancyGuard`. The guard uses a `_status` storage flag that is set to ENTERED before any external call and reset to NOT_ENTERED after. Any re-entrant call to any of those three functions from any path (including a malicious USDC contract or a contract recipient) will revert with `ReentrancyGuardReentrantCall`.

The checks-effects-interactions ordering is also maintained independently of the guard: `hasPaid = true` and `totalFunded` increment happen before the ERC-20 calls.

---

### 13. What happens when an obligation expires partially funded?

**PASS — guaranteed by contract code.**

If deadline passes and not all contributors have paid:

1. Anyone can call `refundExpired()`, which sets `ob.status = EXPIRED` and emits `ObligationExpired`.
2. Each contributor who already paid (`info.hasPaid == true`) can call `claimRefund()`, which clears their `hasPaid` flag, decrements `totalFunded`, and transfers their exact share back.
3. Contributors who never paid have nothing to claim (`require(info.hasPaid, "Poolless: no refund available")`).

The USDC held in the contract for this obligation equals the sum of paid contributors' shares. After all paid contributors claim, `totalFunded` returns to 0 and the contract holds 0 USDC for this obligation. No funds are trapped.

---

### 14. Who can mark/recognize an obligation as expired?

**PASS — guaranteed by contract code.**

`refundExpired()` has no access control. Any Ethereum address (contributor, creator, recipient, or unrelated wallet) can call it once `block.timestamp >= ob.deadline` and `ob.status == OPEN`. This is the correct design: if the creator/contributors are unresponsive, anyone can unstick the obligation.

**Frontend note:** The "Mark as expired" button is shown to any connected wallet when `deadlinePassed && status === OPEN`. This correctly surfaces the permissionless nature of the call.

---

### 15. Can every funded contributor recover exactly their own contribution after expiry?

**PASS — guaranteed by contract code.**

`claimRefund()` calls `usdc.safeTransfer(msg.sender, amount)` where `amount = info.amount` — the same value that was recorded at creation and deducted from the contributor's wallet. No fee, no haircut, no rounding. Each contributor recovers their exact assigned share, not a proportional slice of a pool.

---

### 16. Can a contributor claim a refund twice?

**PASS — guaranteed by contract code.**

`claimRefund()` line 156: `require(info.hasPaid, "Poolless: no refund available")`. The first claim sets `info.hasPaid = false` (line 160). A second call from the same address reverts on this guard.

---

### 17. Can an unassigned wallet claim a refund?

**PASS — guaranteed by contract code.**

`claimRefund()` line 155: `require(info.amount > 0, "Poolless: not a contributor")`. An address not in the contributor list has `amount == 0` and reverts before the `hasPaid` check.

---

### 18. Can the recipient claim contributors' funds?

**PASS — guaranteed by contract code.**

The recipient address has no privileged role in the contract. Unless the recipient also happens to be an assigned contributor (which is not prevented at creation and is an unusual but legal configuration), the recipient has no way to call any function that moves USDC. Settlement transfers to the recipient automatically; the recipient does not call any function to collect. A recipient who is also a contributor could call `claimRefund()` after expiry for their contributor share, but that is correct behaviour.

---

### 19. Can funds become permanently trapped in the contract?

**PASS — guaranteed by contract code, with one edge case noted.**

The only USDC held by the contract is the sum of `hasPaid == true` contributors on OPEN obligations. Every such USDC has an exit path:

- **OPEN + fully funded before deadline:** auto-settles; USDC forwarded to recipient in the same transaction.
- **OPEN + partially funded + deadline not passed:** still in progress; normal contribute path available.
- **OPEN + deadline passed:** anyone calls `refundExpired()`; then each paid contributor calls `claimRefund()`.

**Edge case — recipient is a contract that permanently reverts on USDC receipt:** The auto-settlement reverts entirely (see #11), which means the final contributor's transaction reverts and no funds move. The obligation remains OPEN with `totalFunded` equal to all contributions except the final one. The final contributor cannot retry because their portion was rolled back — they can try again, but settlement will revert again each time. Eventually the deadline passes, `refundExpired()` can be called, and all paid contributors (excluding the final one, whose contribution was always rolled back) can claim refunds.

**Conclusion:** Funds are not permanently trapped for EOA recipients. For a contract recipient with a reverting receive, the obligation would be stuck in OPEN until expiry, at which point funds are recoverable via refund. This is the correct fail-safe.

---

### 20. Does sum(contributor shares) have to equal totalAmount at creation?

**PASS — guaranteed by contract code.**

`createObligation()` line 105: `require(runningSum == totalAmount, "Poolless: total mismatch")`. The loop accumulates all `amounts[i]` values into `runningSum`. The check is exact equality — not ≤ or ≥. An obligation where shares sum to a different value than `totalAmount` reverts at creation.

---

### 21. Are zero addresses rejected for recipient and contributors?

**PASS — guaranteed by contract code.**

- Recipient: line 73: `require(recipient != address(0), "Poolless: recipient is zero address")`.
- Each contributor: line 96 inside the loop: `require(contributor != address(0), "Poolless: contributor is zero address")`.

Both checks are present.

---

### 22. Are zero-value shares rejected?

**PASS — guaranteed by contract code.**

Line 97: `require(amount > 0, "Poolless: contributor amount is zero")`. Zero-amount shares cannot be created.

---

### 23. Are duplicate contributor addresses rejected?

**PASS — guaranteed by contract code.**

Line 98: `require(ob.contributorInfo[contributor].amount == 0, "Poolless: duplicate contributor")`. Since zero-value shares are rejected first (line 97), a previously seen contributor will have `amount > 0` in storage, and the duplicate check will catch it.

---

### 24. Is a deadline in the past rejected?

**PASS — guaranteed by contract code.**

Line 74: `require(deadline > block.timestamp, "Poolless: deadline not in future")`. Strict greater-than: deadline == block.timestamp also reverts.

---

### 25. Is the contributor count bounded against excessive gas usage?

**PASS — guaranteed by contract code.**

Line 76: `require(contributorAddresses.length <= MAX_CONTRIBUTORS, "Poolless: too many contributors")` where `MAX_CONTRIBUTORS = 50`. This was added as a fix during the pre-deploy security review.

---

### 26. Does the contract correctly handle USDC's 6 decimals?

**PASS — guaranteed by contract code, with frontend note.**

The contract is denomination-agnostic. It stores and transfers `uint256` amounts exactly as passed and as stored. The responsibility for decimal handling lies entirely at the callsite. The frontend uses `parseUsdc` (which calls `parseUnits(value, 6)`) for display→wei and `formatUsdc` for wei→display. The USDC contract at `0x3600000000000000000000000000000000000000` uses 6 decimals. The frontend's `USDC_DECIMALS` is sourced from `getUsdc(ARC_TESTNET_CHAIN_ID)` via `@/onchain-facts`, not hardcoded.

**Frontend note — one minor risk:** If the `@/onchain-facts` registry were ever updated with incorrect decimals, the displayed amounts would be wrong but the contract amounts would be unaffected (the contract never calls `decimals()`). This is a theoretical registry risk, not a live issue.

---

### 27. Does obligation discovery continue working after SETTLED and EXPIRED states?

**PASS — confirmed by frontend code.**

`useObligationDiscovery` calls `getObligation(id)` for every ID from 1 to `obligationCount`. It reads `status` as a raw number and casts to `ObligationStatus`. The status values SETTLED (1) and EXPIRED (2) are valid enum members in both the contract and `src/contract.ts`. The discovery hook handles all three states: it assigns SETTLED/EXPIRED obligations to the `completed` bucket. The `getObligation` view function is a pure read on storage and does not revert based on status.

---

### 28. Is the settlement transaction hash correctly surfaced as the permanent receipt?

**PARTIAL PASS — frontend-only behavior, with a known limitation.**

When the final contributor uses a **browser wallet (wagmi path)**: `useWaitForTransactionReceipt` sets `isSuccess = true` and `pendingHash` is the contribute transaction hash. The `successHash` state is set to this hash. The "View transaction on Arc" link in the SETTLED card uses this hash. This is the correct permanent receipt: the settlement, the final contribution, and the USDC transfer to the recipient are all in the same transaction.

When the final contributor uses **Circle Wallet (UCW path)**: `pollTransaction` returns the transaction hash from the Circle Wallets API. This hash is also set as `successHash`. **However**, `successHash` is React state — it only persists for the current browser session. If a second visitor opens the obligation after settlement, `successHash` will be empty and the "View transaction on Arc" link will not appear.

**This is a minor UX gap, not a security issue.** The transaction is permanently on-chain; only the frontend link is session-scoped.

---

### 29. Does V2 retain any USDC after a successful obligation settlement?

**PASS — guaranteed by contract code.**

When settlement fires, `usdc.safeTransfer(ob.recipient, ob.totalAmount)` transfers exactly `totalAmount` out. The contract accumulated exactly `totalAmount` from contributors (the overfund guard on line 124 ensures `totalFunded` never exceeds `totalAmount`, and the sum-equality check at creation ensures the sum of shares equals `totalAmount`). After a successful settlement, the contract's USDC balance for that obligation is zero. There is no fee, no residual, no retained amount.

---

### 30. Any other security or state-machine problems?

The following items were evaluated independently:

**a. `_obligationExists` boundary check:** `obligationId > 0 && obligationId <= obligationCount` correctly rejects ID 0 (mapping default) and any ID above the current count. No off-by-one.

**b. Integer overflow:** Solidity 0.8.x has built-in overflow protection. `runningSum += amount` and `ob.totalFunded += amount` both revert on overflow. No `unchecked` blocks are used.

**c. Recipient-is-contributor:** The contract does not prevent the recipient from also being listed as a contributor. This is an unusual but valid configuration (e.g. partially self-funded obligation). The contract handles it correctly: the recipient-contributor would call `contribute()` like any other contributor, and the auto-settlement would still fire when the total is reached.

**d. Single-contributor obligation:** Works correctly. One contributor calling `contribute()` triggers immediate settlement (the `totalFunded == totalAmount` branch fires on the first and only call). This was covered by the unit tests.

**e. `createObligation` does not require the caller to be a contributor:** The creator can create an obligation listing other addresses without being included themselves. This is by design — the creator is a coordinator, not necessarily a payer.

**f. No `pause`, no emergency withdrawal, no admin key:** Correct. The contract has no privileged functions whatsoever. This is a deliberate design choice and has been confirmed as intentional. The tradeoff is that there is no circuit breaker if a bug is found post-deployment; the mitigation is that V1 and V2 are small, immutable, separately deployed contracts rather than a single upgradeable proxy.

**g. `MAX_CONTRIBUTORS = 50` is a constant, not a governance parameter:** Cannot be changed without redeployment. This is appropriate for an immutable contract.

**h. ABI event compatibility with V1:** `ObligationCreated`, `ContributionReceived`, `ObligationSettled`, `RefundClaimed`, `ObligationExpired` — all five events have identical signatures to V1. `ObligationFunded` is also emitted (V1 also had this). The only removed event is `SettlementFailed`, which no longer applies. The discovery hook only uses `ObligationCreated` for log scanning; it is not affected.

---

## Summary Tables

### A. Critical Issues

None.

---

### B. Medium Issues

None.

---

### C. Minor Issues

| # | Location | Description |
|---|---|---|
| C-1 | `ObligationPage.tsx` — settlement receipt | `successHash` is React session state. A visitor who did not execute the final contribute tx sees the SETTLED card without the "View transaction" link. The hash is on-chain; only the frontend link is missing for non-final-contributor visitors. |
| C-2 | `useObligationDiscovery.ts` line 149 | `fromBlock: 0n` scans all blocks from genesis for `ObligationCreated` events. On mainnet with many obligations this will eventually exceed RPC range limits. Acceptable for testnet now; should be indexed (subgraph or block-range pagination) before mainnet. |
| C-3 | `useObligationDiscovery.ts` — funded-by-you bucket | Line 216: `if (isContributor && myHasPaid && status !== ObligationStatus.SETTLED)` — after auto-settlement, `myHasPaid` is `true` in storage but the bucket check excludes SETTLED. A fully-settled obligation where you were a contributor lands only in `completed`, not `funded-by-you`. This is correct behavior for the dashboard but worth noting: the contributor list card still shows the checkmark for paid contributors, sourced independently from `getContributorInfo`. |

---

### D. Real-World Tests Still Required

| # | Scenario | Why |
|---|---|---|
| D-1 | **Recipient is a smart contract** | If the recipient has a `receive()` or fallback that reverts or consumes excessive gas, auto-settlement reverts. The obligation remains OPEN until expiry. Needs to be tested with a contract recipient before mainnet if contract recipients are a supported use case. |
| D-2 | **Race condition: two final contributors submit simultaneously** | If contributors A and B are both the last needed contributor (e.g. they both funded at the exact same time from different clients), one tx will succeed and settle; the other will revert with "already contributed" (if same address) or "not open" (if the first tx settled first). This is correct behavior by the state machine but should be confirmed under realistic mempool conditions. |
| D-3 | **refundExpired + claimRefund multi-contributor expiry flow** | Three or more contributors, some paid and some not, obligation expires. All paid contributors claim refunds. Verify final contract USDC balance is zero and each contributor receives exactly their share. This was unit-tested but not yet real-transaction tested. |
| D-4 | **Circle Wallet as final contributor** | The Circle Wallet UCW path triggers settlement via the `/contribute` backend route. The settlement transaction hash returned by `pollTransaction` should be stored as `successHash`. This path was not exercised in the confirmed multi-wallet test (confirm which wallet type was used as the final contributor). |
| D-5 | **Obligation with N=50 contributors** | Gas cost of `createObligation` at the maximum contributor count. This was not tested with a real transaction. Should be benchmarked before mainnet to confirm it fits within block gas limits. |

---

### E. Recommendation for Mainnet

**Do not deploy to mainnet yet.**

The contract code is correct and passes all security checks for the tested scenarios. The two items that must be resolved first:

1. **C-2 (event scanning):** The `fromBlock: 0n` discovery pattern will break on mainnet once block count grows. A block-range pagination strategy or an indexed event source is needed before mainnet launch.

2. **D-1 (contract recipients):** If the protocol intends to support contract recipients (multisig wallets, protocol treasuries, smart accounts), the recipient-reverts-on-receipt scenario must be tested and a documented stance must be taken (either "contract recipients are unsupported" with a frontend warning, or a pull-payment model for recipients must be considered for a future V3).

3. **D-5 (50-contributor gas):** Confirm the max contributor count does not approach block gas limits on Arc Mainnet before advertising the 50-contributor cap.

None of these are contract security vulnerabilities. The state machine, access control, arithmetic, reentrancy protection, and settlement mechanics are all sound. The contract is ready for continued testnet use and for the specific 2–5 contributor use case that has been tested.
