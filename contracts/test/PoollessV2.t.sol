// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, Vm} from "forge-std/Test.sol";
import {PoollessV2} from "../PoollessV2.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

// ─────────────────────────────────────────────────────────────────────────────
//  Handler for invariant suite
// ─────────────────────────────────────────────────────────────────────────────
contract PoollessV2Handler is Test {
    PoollessV2 internal poolless;
    MockERC20 internal usdc;

    address internal alice;
    address internal bob;
    address internal recipient;

    uint256 public currentObligationId;
    bool public obligationCreated;
    bool public obligationSettled;

    // Track cumulative contributions for the invariant assertions
    uint256 public aliceAmount;
    uint256 public bobAmount;

    constructor(PoollessV2 _poolless, MockERC20 _usdc, address _alice, address _bob, address _recipient) {
        poolless = _poolless;
        usdc = _usdc;
        alice = _alice;
        bob = _bob;
        recipient = _recipient;
    }

    function createObligation(uint256 amount1Seed, uint256 amount2Seed) external {
        if (obligationCreated) return;

        uint256 a1 = bound(amount1Seed, 1, 500e6);
        uint256 a2 = bound(amount2Seed, 1, 500e6);
        uint256 total = a1 + a2;

        aliceAmount = a1;
        bobAmount = a2;

        // Fund wallets
        usdc.mint(alice, a1);
        usdc.mint(bob, a2);
        vm.prank(alice);
        usdc.approve(address(poolless), a1);
        vm.prank(bob);
        usdc.approve(address(poolless), a2);

        address[] memory contribs = new address[](2);
        contribs[0] = alice;
        contribs[1] = bob;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = a1;
        amounts[1] = a2;

        currentObligationId = poolless.createObligation(
            "Invariant Obligation",
            "desc",
            total,
            recipient,
            block.timestamp + 7 days,
            contribs,
            amounts
        );
        obligationCreated = true;
    }

    function contribute(uint8 whoSeed) external {
        if (!obligationCreated || obligationSettled) return;

        address who = whoSeed % 2 == 0 ? alice : bob;

        (, , , , , , PoollessV2.ObligationStatus status, ) = poolless.getObligation(currentObligationId);
        if (status != PoollessV2.ObligationStatus.OPEN) return;

        (uint256 amt, bool hasPaid) = poolless.getContributorInfo(currentObligationId, who);
        if (hasPaid || amt == 0) return;

        vm.prank(who);
        poolless.contribute(currentObligationId);

        (, , , , , , PoollessV2.ObligationStatus newStatus, ) = poolless.getObligation(currentObligationId);
        if (newStatus == PoollessV2.ObligationStatus.SETTLED) {
            obligationSettled = true;
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Main test contract
// ─────────────────────────────────────────────────────────────────────────────
contract PoollessV2Test is Test {
    PoollessV2 internal poolless;
    MockERC20 internal usdc;

    address internal alice   = makeAddr("alice");
    address internal bob     = makeAddr("bob");
    address internal carol   = makeAddr("carol");
    address internal dave    = makeAddr("dave");   // not a contributor
    address internal recipient = makeAddr("recipient");
    address internal stranger  = makeAddr("stranger");

    uint256 internal constant DEADLINE_OFFSET = 7 days;

    // ── helpers ──────────────────────────────────────────────────────────────

    /// Create a 2-contributor obligation (alice=100e6, bob=50e6) with a 7-day deadline.
    function _createTwoContrib() internal returns (uint256 id) {
        address[] memory contribs = new address[](2);
        contribs[0] = alice;
        contribs[1] = bob;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 100e6;
        amounts[1] = 50e6;

        id = poolless.createObligation(
            "Test Obligation",
            "desc",
            150e6,
            recipient,
            block.timestamp + DEADLINE_OFFSET,
            contribs,
            amounts
        );
    }

    /// Create a single-contributor obligation (alice = totalAmount).
    function _createSingleContrib(uint256 amount) internal returns (uint256 id) {
        address[] memory contribs = new address[](1);
        contribs[0] = alice;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = amount;

        id = poolless.createObligation(
            "Single Obligation",
            "solo",
            amount,
            recipient,
            block.timestamp + DEADLINE_OFFSET,
            contribs,
            amounts
        );
    }

    /// Seed token balance + unlimited approval for an address.
    function _fund(address who, uint256 amount) internal {
        usdc.mint(who, amount);
        vm.prank(who);
        usdc.approve(address(poolless), type(uint256).max);
    }

    // ── setUp ─────────────────────────────────────────────────────────────────

    function setUp() public {
        usdc    = new MockERC20("Mock USDC", "mUSDC", 6);
        poolless = new PoollessV2(address(usdc));

        // Default balances for test participants
        _fund(alice,  1_000e6);
        _fund(bob,    1_000e6);
        _fund(carol,  1_000e6);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  1. Deployment / initialisation
    // ═════════════════════════════════════════════════════════════════════════

    function test_Constructor_SetsUsdc() public view {
        assertEq(address(poolless.usdc()), address(usdc));
    }

    function test_Constructor_ObligationCountZero() public view {
        assertEq(poolless.obligationCount(), 0);
    }

    function test_Constructor_RevertsOnZeroUsdc() public {
        vm.expectRevert(bytes("Poolless: USDC is zero address"));
        new PoollessV2(address(0));
    }

    function test_MaxContributors_Is50() public view {
        assertEq(poolless.MAX_CONTRIBUTORS(), 50);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  2. createObligation – happy path
    // ═════════════════════════════════════════════════════════════════════════

    function test_CreateObligation_ReturnsIncrementedId() public {
        uint256 id1 = _createTwoContrib();
        uint256 id2 = _createTwoContrib();
        assertEq(id1, 1);
        assertEq(id2, 2);
        assertEq(poolless.obligationCount(), 2);
    }

    function test_CreateObligation_StoresCorrectState() public {
        uint256 id = _createTwoContrib();

        (
            string memory title,
            string memory description,
            uint256 totalAmount,
            uint256 totalFunded,
            address recip,
            uint256 deadline,
            PoollessV2.ObligationStatus status,
            address[] memory contributors
        ) = poolless.getObligation(id);

        assertEq(title,           "Test Obligation");
        assertEq(description,     "desc");
        assertEq(totalAmount,     150e6);
        assertEq(totalFunded,     0);
        assertEq(recip,           recipient);
        assertEq(deadline,        block.timestamp + DEADLINE_OFFSET);
        assertEq(uint8(status),   uint8(PoollessV2.ObligationStatus.OPEN));
        assertEq(contributors.length, 2);
        assertEq(contributors[0], alice);
        assertEq(contributors[1], bob);
    }

    function test_CreateObligation_StoresContributorInfo() public {
        uint256 id = _createTwoContrib();
        (uint256 aliceAmt, bool alicePaid) = poolless.getContributorInfo(id, alice);
        (uint256 bobAmt,   bool bobPaid)   = poolless.getContributorInfo(id, bob);

        assertEq(aliceAmt, 100e6);
        assertFalse(alicePaid);
        assertEq(bobAmt,   50e6);
        assertFalse(bobPaid);
    }

    function test_CreateObligation_IsContributor() public {
        uint256 id = _createTwoContrib();
        assertTrue(poolless.isContributor(id, alice));
        assertTrue(poolless.isContributor(id, bob));
        assertFalse(poolless.isContributor(id, dave));
    }

    function test_CreateObligation_EmitsObligationCreated() public {
        address[] memory contribs = new address[](2);
        contribs[0] = alice;
        contribs[1] = bob;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 100e6;
        amounts[1] = 50e6;

        uint256 expectedDeadline = block.timestamp + DEADLINE_OFFSET;

        vm.expectEmit(true, true, false, true, address(poolless));
        emit PoollessV2.ObligationCreated(
            1,
            "Test Obligation",
            150e6,
            recipient,
            expectedDeadline,
            contribs,
            amounts
        );

        poolless.createObligation(
            "Test Obligation",
            "desc",
            150e6,
            recipient,
            expectedDeadline,
            contribs,
            amounts
        );
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  3. createObligation – revert paths
    // ═════════════════════════════════════════════════════════════════════════

    function test_CreateObligation_RevertsEmptyTitle() public {
        address[] memory contribs = new address[](1);
        contribs[0] = alice;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1e6;
        vm.expectRevert(bytes("Poolless: title empty"));
        poolless.createObligation("", "d", 1e6, recipient, block.timestamp + 1 days, contribs, amounts);
    }

    function test_CreateObligation_RevertsTitleTooLong() public {
        // 101-char title
        string memory longTitle = "aaaaaaaaaabbbbbbbbbbccccccccccddddddddddeeeeeeeeeeaaaaaaaaaabbbbbbbbbbccccccccccddddddddddeeeeeeeeee1";
        address[] memory contribs = new address[](1);
        contribs[0] = alice;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1e6;
        vm.expectRevert(bytes("Poolless: title too long"));
        poolless.createObligation(longTitle, "d", 1e6, recipient, block.timestamp + 1 days, contribs, amounts);
    }

    function test_CreateObligation_RevertsZeroTotalAmount() public {
        address[] memory contribs = new address[](1);
        contribs[0] = alice;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 0;
        vm.expectRevert(bytes("Poolless: total amount is zero"));
        poolless.createObligation("T", "d", 0, recipient, block.timestamp + 1 days, contribs, amounts);
    }

    function test_CreateObligation_RevertsZeroRecipient() public {
        address[] memory contribs = new address[](1);
        contribs[0] = alice;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1e6;
        vm.expectRevert(bytes("Poolless: recipient is zero address"));
        poolless.createObligation("T", "d", 1e6, address(0), block.timestamp + 1 days, contribs, amounts);
    }

    function test_CreateObligation_RevertsDeadlineNotFuture() public {
        address[] memory contribs = new address[](1);
        contribs[0] = alice;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1e6;
        vm.expectRevert(bytes("Poolless: deadline not in future"));
        poolless.createObligation("T", "d", 1e6, recipient, block.timestamp, contribs, amounts);
    }

    function test_CreateObligation_RevertsNoContributors() public {
        address[] memory contribs = new address[](0);
        uint256[] memory amounts = new uint256[](0);
        vm.expectRevert(bytes("Poolless: no contributors"));
        poolless.createObligation("T", "d", 1e6, recipient, block.timestamp + 1 days, contribs, amounts);
    }

    function test_CreateObligation_RevertsTooManyContributors_51() public {
        // 51 contributors — exceeds MAX_CONTRIBUTORS (50)
        uint256 n = 51;
        address[] memory contribs = new address[](n);
        uint256[] memory amounts  = new uint256[](n);
        uint256 total;
        for (uint256 i = 0; i < n; i++) {
            contribs[i] = address(uint160(0x1000 + i));
            amounts[i]  = 1e6;
            total += 1e6;
        }
        vm.expectRevert(bytes("Poolless: too many contributors"));
        poolless.createObligation("T", "d", total, recipient, block.timestamp + 1 days, contribs, amounts);
    }

    function test_CreateObligation_RevertsAmountMismatch() public {
        // amounts sum = 120e6, but totalAmount = 150e6
        address[] memory contribs = new address[](2);
        contribs[0] = alice;
        contribs[1] = bob;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 80e6;
        amounts[1] = 40e6; // 80+40 = 120 ≠ 150
        vm.expectRevert(bytes("Poolless: total mismatch"));
        poolless.createObligation("T", "d", 150e6, recipient, block.timestamp + 1 days, contribs, amounts);
    }

    function test_CreateObligation_RevertsDuplicateContributor() public {
        address[] memory contribs = new address[](2);
        contribs[0] = alice;
        contribs[1] = alice; // duplicate
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 75e6;
        amounts[1] = 75e6;
        vm.expectRevert(bytes("Poolless: duplicate contributor"));
        poolless.createObligation("T", "d", 150e6, recipient, block.timestamp + 1 days, contribs, amounts);
    }

    function test_CreateObligation_RevertsArrayLengthMismatch() public {
        address[] memory contribs = new address[](2);
        contribs[0] = alice;
        contribs[1] = bob;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 150e6;
        vm.expectRevert(bytes("Poolless: array length mismatch"));
        poolless.createObligation("T", "d", 150e6, recipient, block.timestamp + 1 days, contribs, amounts);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  4. contribute – happy path: two contributors, final auto-settles
    // ═════════════════════════════════════════════════════════════════════════

    function test_Contribute_FirstContribution_UpdatesTotalFunded_StaysOpen() public {
        uint256 id = _createTwoContrib();

        vm.prank(alice);
        poolless.contribute(id);

        (, , , uint256 totalFunded, , , PoollessV2.ObligationStatus status, ) = poolless.getObligation(id);

        assertEq(totalFunded, 100e6, "totalFunded should reflect alice's share");
        assertEq(uint8(status), uint8(PoollessV2.ObligationStatus.OPEN), "should still be OPEN after first contribution");
    }

    function test_Contribute_AliceSetsPaidFlag() public {
        uint256 id = _createTwoContrib();
        vm.prank(alice);
        poolless.contribute(id);

        (, bool paid) = poolless.getContributorInfo(id, alice);
        assertTrue(paid, "alice's hasPaid should be true");
    }

    function test_Contribute_FinalContribution_AutoSettles() public {
        uint256 id = _createTwoContrib();

        vm.prank(alice);
        poolless.contribute(id);

        uint256 recipientBalanceBefore = usdc.balanceOf(recipient);

        vm.prank(bob);
        poolless.contribute(id);

        (, , , uint256 totalFunded, , , PoollessV2.ObligationStatus status, ) = poolless.getObligation(id);

        assertEq(uint8(status), uint8(PoollessV2.ObligationStatus.SETTLED), "should be SETTLED after final contribution");
        assertEq(totalFunded, 150e6, "totalFunded should equal totalAmount");
        assertEq(usdc.balanceOf(recipient), recipientBalanceBefore + 150e6, "recipient should receive totalAmount");
        assertEq(usdc.balanceOf(address(poolless)), 0, "contract balance should be 0 after settlement");
    }

    function test_Contribute_FinalContribution_EmitsAllThreeEvents() public {
        uint256 id = _createTwoContrib();

        vm.prank(alice);
        poolless.contribute(id);

        // Record all logs during bob's final contribution
        vm.recordLogs();
        vm.prank(bob);
        poolless.contribute(id);

        Vm.Log[] memory logs = vm.getRecordedLogs();

        // Expect at least 3 events: ContributionReceived, ObligationFunded, ObligationSettled
        // (plus possible ERC-20 Transfer events)
        // Identify by topic[0] == keccak256(sig)
        bytes32 sigContribution = keccak256("ContributionReceived(uint256,address,uint256)");
        bytes32 sigFunded       = keccak256("ObligationFunded(uint256,uint256,address)");
        bytes32 sigSettled      = keccak256("ObligationSettled(uint256,address,uint256)");

        bool sawContribution;
        bool sawFunded;
        bool sawSettled;

        int256 contributionIdx = -1;
        int256 fundedIdx       = -1;
        int256 settledIdx      = -1;

        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == sigContribution) { sawContribution = true; contributionIdx = int256(i); }
            if (logs[i].topics[0] == sigFunded)       { sawFunded = true;       fundedIdx       = int256(i); }
            if (logs[i].topics[0] == sigSettled)      { sawSettled = true;      settledIdx      = int256(i); }
        }

        assertTrue(sawContribution, "ContributionReceived not emitted");
        assertTrue(sawFunded,       "ObligationFunded not emitted");
        assertTrue(sawSettled,      "ObligationSettled not emitted");

        // Order check: ContributionReceived < ObligationFunded < ObligationSettled
        assertLt(contributionIdx, fundedIdx,   "ContributionReceived must come before ObligationFunded");
        assertLt(fundedIdx,       settledIdx,  "ObligationFunded must come before ObligationSettled");
    }

    function test_Contribute_FinalContribution_EmitsContributionReceived() public {
        uint256 id = _createTwoContrib();
        vm.prank(alice);
        poolless.contribute(id);

        vm.expectEmit(true, true, false, true, address(poolless));
        emit PoollessV2.ContributionReceived(id, bob, 50e6);
        vm.prank(bob);
        poolless.contribute(id);
    }

    function test_Contribute_FinalContribution_EmitsObligationFunded() public {
        uint256 id = _createTwoContrib();
        vm.prank(alice);
        poolless.contribute(id);

        vm.expectEmit(true, false, true, true, address(poolless));
        emit PoollessV2.ObligationFunded(id, 150e6, recipient);
        vm.prank(bob);
        poolless.contribute(id);
    }

    function test_Contribute_FinalContribution_EmitsObligationSettled() public {
        uint256 id = _createTwoContrib();
        vm.prank(alice);
        poolless.contribute(id);

        vm.expectEmit(true, true, false, true, address(poolless));
        emit PoollessV2.ObligationSettled(id, recipient, 150e6);
        vm.prank(bob);
        poolless.contribute(id);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  5. Single-contributor obligation: one call settles immediately
    // ═════════════════════════════════════════════════════════════════════════

    function test_Contribute_SingleContributor_ImmediateSettlement() public {
        uint256 id = _createSingleContrib(200e6);

        uint256 recipientBefore = usdc.balanceOf(recipient);

        vm.prank(alice);
        poolless.contribute(id);

        (, , , uint256 totalFunded, , , PoollessV2.ObligationStatus status, ) = poolless.getObligation(id);

        assertEq(uint8(status), uint8(PoollessV2.ObligationStatus.SETTLED));
        assertEq(totalFunded, 200e6);
        assertEq(usdc.balanceOf(recipient), recipientBefore + 200e6);
        assertEq(usdc.balanceOf(address(poolless)), 0);
    }

    function test_Contribute_SingleContributor_EmitsAllThreeEvents() public {
        uint256 id = _createSingleContrib(200e6);

        vm.expectEmit(true, true, false, true, address(poolless));
        emit PoollessV2.ContributionReceived(id, alice, 200e6);

        // expectEmit only checks the NEXT matching event; chain all three before the call
        vm.expectEmit(true, false, true, true, address(poolless));
        emit PoollessV2.ObligationFunded(id, 200e6, recipient);

        vm.expectEmit(true, true, false, true, address(poolless));
        emit PoollessV2.ObligationSettled(id, recipient, 200e6);

        vm.prank(alice);
        poolless.contribute(id);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  6. contribute – revert paths
    // ═════════════════════════════════════════════════════════════════════════

    function test_Contribute_RevertsIfAlreadySettled() public {
        uint256 id = _createSingleContrib(100e6);
        vm.prank(alice);
        poolless.contribute(id);

        // Obligation is now SETTLED; any contribute should revert
        vm.expectRevert(bytes("Poolless: not open"));
        vm.prank(alice);
        poolless.contribute(id);
    }

    function test_Contribute_RevertsIfExpired() public {
        uint256 id = _createTwoContrib();

        // Expire the obligation
        vm.warp(block.timestamp + DEADLINE_OFFSET + 1);
        poolless.refundExpired(id);

        vm.expectRevert(bytes("Poolless: not open"));
        vm.prank(alice);
        poolless.contribute(id);
    }

    function test_Contribute_RevertsIfNotContributor() public {
        uint256 id = _createTwoContrib();

        vm.prank(dave); // dave is not a contributor
        vm.expectRevert(bytes("Poolless: not a contributor"));
        poolless.contribute(id);
    }

    function test_Contribute_RevertsDoubleFund() public {
        uint256 id = _createTwoContrib();

        vm.prank(alice);
        poolless.contribute(id);

        vm.prank(alice);
        vm.expectRevert(bytes("Poolless: already contributed"));
        poolless.contribute(id);
    }

    function test_Contribute_RevertsAfterDeadline() public {
        uint256 id = _createTwoContrib();

        // Warp past deadline WITHOUT calling refundExpired (status still OPEN)
        vm.warp(block.timestamp + DEADLINE_OFFSET + 1);

        vm.prank(alice);
        vm.expectRevert(bytes("Poolless: obligation expired"));
        poolless.contribute(id);
    }

    function test_Contribute_RevertsInvalidObligationId() public {
        vm.prank(alice);
        vm.expectRevert(bytes("Poolless: invalid obligation"));
        poolless.contribute(999);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  7. refundExpired – happy path
    // ═════════════════════════════════════════════════════════════════════════

    function test_RefundExpired_MarksObligationExpired() public {
        uint256 id = _createTwoContrib();
        vm.warp(block.timestamp + DEADLINE_OFFSET + 1);
        poolless.refundExpired(id);

        (, , , , , , PoollessV2.ObligationStatus status, ) = poolless.getObligation(id);
        assertEq(uint8(status), uint8(PoollessV2.ObligationStatus.EXPIRED));
    }

    function test_RefundExpired_EmitsObligationExpired() public {
        uint256 id = _createTwoContrib();
        vm.warp(block.timestamp + DEADLINE_OFFSET + 1);

        vm.expectEmit(true, false, false, false, address(poolless));
        emit PoollessV2.ObligationExpired(id);
        poolless.refundExpired(id);
    }

    function test_RefundExpired_AnyCallerCanTrigger() public {
        uint256 id = _createTwoContrib();
        vm.warp(block.timestamp + DEADLINE_OFFSET + 1);

        // stranger (not creator, not contributor) calls refundExpired
        vm.prank(stranger);
        poolless.refundExpired(id);

        (, , , , , , PoollessV2.ObligationStatus status, ) = poolless.getObligation(id);
        assertEq(uint8(status), uint8(PoollessV2.ObligationStatus.EXPIRED));
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  8. refundExpired – revert paths
    // ═════════════════════════════════════════════════════════════════════════

    function test_RefundExpired_RevertsBeforeDeadline() public {
        uint256 id = _createTwoContrib();
        // Still within the deadline
        vm.expectRevert(bytes("Poolless: deadline not reached"));
        poolless.refundExpired(id);
    }

    function test_RefundExpired_RevertsIfAlreadySettled() public {
        uint256 id = _createSingleContrib(100e6);
        vm.prank(alice);
        poolless.contribute(id); // settles immediately

        vm.warp(block.timestamp + DEADLINE_OFFSET + 1);
        vm.expectRevert(bytes("Poolless: not open"));
        poolless.refundExpired(id);
    }

    function test_RefundExpired_RevertsIfAlreadyExpired() public {
        uint256 id = _createTwoContrib();
        vm.warp(block.timestamp + DEADLINE_OFFSET + 1);
        poolless.refundExpired(id); // first call succeeds

        // Second call must revert because status is no longer OPEN
        vm.expectRevert(bytes("Poolless: not open"));
        poolless.refundExpired(id);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  9. claimRefund – happy path
    // ═════════════════════════════════════════════════════════════════════════

    function test_ClaimRefund_ReturnsTokensToContributor() public {
        uint256 id = _createTwoContrib();

        vm.prank(alice);
        poolless.contribute(id);

        vm.warp(block.timestamp + DEADLINE_OFFSET + 1);
        poolless.refundExpired(id);

        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        poolless.claimRefund(id);

        assertEq(usdc.balanceOf(alice), aliceBefore + 100e6, "alice should get her tokens back");
    }

    function test_ClaimRefund_ClearsHasPaid() public {
        uint256 id = _createTwoContrib();

        vm.prank(alice);
        poolless.contribute(id);

        vm.warp(block.timestamp + DEADLINE_OFFSET + 1);
        poolless.refundExpired(id);

        vm.prank(alice);
        poolless.claimRefund(id);

        (, bool paid) = poolless.getContributorInfo(id, alice);
        assertFalse(paid, "hasPaid should be cleared after refund");
    }

    function test_ClaimRefund_EmitsRefundClaimed() public {
        uint256 id = _createTwoContrib();

        vm.prank(alice);
        poolless.contribute(id);

        vm.warp(block.timestamp + DEADLINE_OFFSET + 1);
        poolless.refundExpired(id);

        vm.expectEmit(true, true, false, true, address(poolless));
        emit PoollessV2.RefundClaimed(id, alice, 100e6);
        vm.prank(alice);
        poolless.claimRefund(id);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  10. claimRefund – revert paths
    // ═════════════════════════════════════════════════════════════════════════

    function test_ClaimRefund_RevertsOnOpenObligation() public {
        uint256 id = _createTwoContrib();
        vm.prank(alice);
        poolless.contribute(id);

        // Obligation is still OPEN (bob hasn't paid)
        vm.prank(alice);
        vm.expectRevert(bytes("Poolless: not expired"));
        poolless.claimRefund(id);
    }

    function test_ClaimRefund_RevertsOnSettledObligation() public {
        uint256 id = _createSingleContrib(100e6);
        vm.prank(alice);
        poolless.contribute(id); // settles

        vm.prank(alice);
        vm.expectRevert(bytes("Poolless: not expired"));
        poolless.claimRefund(id);
    }

    function test_ClaimRefund_RevertsIfNotPaid() public {
        uint256 id = _createTwoContrib();

        vm.warp(block.timestamp + DEADLINE_OFFSET + 1);
        poolless.refundExpired(id);

        // alice never contributed, hasPaid == false
        vm.prank(alice);
        vm.expectRevert(bytes("Poolless: no refund available"));
        poolless.claimRefund(id);
    }

    function test_ClaimRefund_RevertsDoubleClaim() public {
        uint256 id = _createTwoContrib();

        vm.prank(alice);
        poolless.contribute(id);

        vm.warp(block.timestamp + DEADLINE_OFFSET + 1);
        poolless.refundExpired(id);

        vm.prank(alice);
        poolless.claimRefund(id); // first claim succeeds

        vm.prank(alice);
        vm.expectRevert(bytes("Poolless: no refund available"));
        poolless.claimRefund(id); // second claim must revert
    }

    function test_ClaimRefund_RevertsIfNotContributor() public {
        uint256 id = _createTwoContrib();

        vm.warp(block.timestamp + DEADLINE_OFFSET + 1);
        poolless.refundExpired(id);

        vm.prank(dave); // dave is not a contributor
        vm.expectRevert(bytes("Poolless: not a contributor"));
        poolless.claimRefund(id);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  11. State machine
    // ═════════════════════════════════════════════════════════════════════════

    function test_StateMachine_AfterSettlement_StatusIsSETTLED_NotFUNDED() public {
        uint256 id = _createTwoContrib();
        vm.prank(alice); poolless.contribute(id);
        vm.prank(bob);   poolless.contribute(id);

        (, , , , , , PoollessV2.ObligationStatus status, ) = poolless.getObligation(id);
        assertEq(uint8(status), uint8(PoollessV2.ObligationStatus.SETTLED));
        // SETTLED == 1; there is no FUNDED (which was 2 in V1). Confirm value.
        assertEq(uint8(PoollessV2.ObligationStatus.SETTLED), 1);
    }

    function test_StateMachine_EnumValues_OPEN0_SETTLED1_EXPIRED2() public pure {
        assertEq(uint8(PoollessV2.ObligationStatus.OPEN),    0);
        assertEq(uint8(PoollessV2.ObligationStatus.SETTLED), 1);
        assertEq(uint8(PoollessV2.ObligationStatus.EXPIRED), 2);
    }

    function test_StateMachine_AfterRefundExpiredAndClaimRefund_ContractBalanceZero() public {
        uint256 id = _createTwoContrib();

        // Both contributors pay in
        vm.prank(alice); poolless.contribute(id);
        vm.prank(bob);   poolless.contribute(id);

        // Obligation settled — contract already holds 0
        assertEq(usdc.balanceOf(address(poolless)), 0);

        // Now test the expire-then-refund path with a fresh obligation
        uint256 id2 = _createTwoContrib();

        vm.prank(alice); poolless.contribute(id2);
        // bob does NOT pay; expire it
        vm.warp(block.timestamp + DEADLINE_OFFSET + 1);
        poolless.refundExpired(id2);

        uint256 contractBefore = usdc.balanceOf(address(poolless));
        assertEq(contractBefore, 100e6, "contract should hold alice's unredeemed contribution");

        vm.prank(alice);
        poolless.claimRefund(id2);

        assertEq(usdc.balanceOf(address(poolless)), 0, "contract should hold 0 after all refunds claimed");
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  12. Access control
    // ═════════════════════════════════════════════════════════════════════════

    function test_AccessControl_DaveCannotContribute() public {
        uint256 id = _createTwoContrib();
        // dave is funded but not a contributor
        _fund(dave, 100e6);
        vm.prank(dave);
        vm.expectRevert(bytes("Poolless: not a contributor"));
        poolless.contribute(id);
    }

    function test_AccessControl_StrangerCanCallRefundExpired() public {
        uint256 id = _createTwoContrib();
        vm.warp(block.timestamp + DEADLINE_OFFSET + 1);

        vm.prank(stranger);
        poolless.refundExpired(id); // should NOT revert

        (, , , , , , PoollessV2.ObligationStatus status, ) = poolless.getObligation(id);
        assertEq(uint8(status), uint8(PoollessV2.ObligationStatus.EXPIRED));
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  13. Fuzz: totalFunded never exceeds totalAmount
    // ═════════════════════════════════════════════════════════════════════════

    function testFuzz_TotalFundedNeverExceedsTotalAmount(
        uint256 aliceAmt,
        uint256 bobAmt
    ) public {
        aliceAmt = bound(aliceAmt, 1, 500e6);
        bobAmt   = bound(bobAmt,   1, 500e6);
        uint256 total = aliceAmt + bobAmt;

        _fund(alice, aliceAmt);
        _fund(bob,   bobAmt);

        address[] memory contribs = new address[](2);
        contribs[0] = alice;
        contribs[1] = bob;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = aliceAmt;
        amounts[1] = bobAmt;

        uint256 id = poolless.createObligation(
            "Fuzz", "f", total, recipient, block.timestamp + DEADLINE_OFFSET, contribs, amounts
        );

        // After alice contributes
        vm.prank(alice);
        poolless.contribute(id);
        (, , , uint256 tf1, , , , ) = poolless.getObligation(id);
        assertLe(tf1, total, "totalFunded must not exceed totalAmount after alice");

        // After bob contributes (settles)
        vm.prank(bob);
        poolless.contribute(id);
        (, , , uint256 tf2, , , , ) = poolless.getObligation(id);
        assertLe(tf2, total, "totalFunded must not exceed totalAmount after bob");
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  14. Fuzz: recipient receives exactly totalAmount when settled
    // ═════════════════════════════════════════════════════════════════════════

    function testFuzz_RecipientReceivesExactlyTotalAmount(
        uint256 aliceAmt,
        uint256 bobAmt
    ) public {
        aliceAmt = bound(aliceAmt, 1, 500e6);
        bobAmt   = bound(bobAmt,   1, 500e6);
        uint256 total = aliceAmt + bobAmt;

        _fund(alice, aliceAmt);
        _fund(bob,   bobAmt);

        address[] memory contribs = new address[](2);
        contribs[0] = alice;
        contribs[1] = bob;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = aliceAmt;
        amounts[1] = bobAmt;

        uint256 id = poolless.createObligation(
            "FuzzRecipient", "r", total, recipient, block.timestamp + DEADLINE_OFFSET, contribs, amounts
        );

        uint256 recipientBefore = usdc.balanceOf(recipient);

        vm.prank(alice); poolless.contribute(id);
        vm.prank(bob);   poolless.contribute(id);

        uint256 recipientAfter = usdc.balanceOf(recipient);
        assertEq(recipientAfter - recipientBefore, total, "recipient must receive exactly totalAmount");
        assertEq(usdc.balanceOf(address(poolless)), 0, "contract must hold 0 after settlement");
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  15. Fuzz: single-contributor settlement correctness
    // ═════════════════════════════════════════════════════════════════════════

    function testFuzz_SingleContributor_RecipientReceivesExactAmount(uint256 amount) public {
        amount = bound(amount, 1, 1_000_000e6);
        _fund(alice, amount);

        uint256 id = _createSingleContrib(amount);

        uint256 recipientBefore = usdc.balanceOf(recipient);
        vm.prank(alice);
        poolless.contribute(id);

        assertEq(usdc.balanceOf(recipient) - recipientBefore, amount);
        assertEq(usdc.balanceOf(address(poolless)), 0);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Invariant test contract
// ─────────────────────────────────────────────────────────────────────────────
contract PoollessV2Invariants is Test {
    PoollessV2 internal poolless;
    MockERC20 internal usdc;
    PoollessV2Handler internal handler;

    address internal alice     = makeAddr("alice");
    address internal bob       = makeAddr("bob");
    address internal recipient = makeAddr("recipient");

    function setUp() public {
        usdc     = new MockERC20("Mock USDC", "mUSDC", 6);
        poolless  = new PoollessV2(address(usdc));
        handler   = new PoollessV2Handler(poolless, usdc, alice, bob, recipient);

        targetContract(address(handler));
    }

    /// totalFunded must never exceed totalAmount for the active obligation.
    function invariant_TotalFundedNeverExceedsTotalAmount() public view {
        if (!handler.obligationCreated()) return;

        uint256 id = handler.currentObligationId();
        (, , uint256 totalAmount, uint256 totalFunded, , , , ) = poolless.getObligation(id);
        assertLe(totalFunded, totalAmount, "invariant: totalFunded > totalAmount");
    }

    /// When settled, recipient received exactly totalAmount and contract holds 0.
    function invariant_SettledObligationContractBalanceZero() public view {
        if (!handler.obligationSettled()) return;

        assertEq(usdc.balanceOf(address(poolless)), 0, "invariant: contract holds tokens after settlement");
    }

    /// USDC balance of the contract must equal the sum of hasPaid contributor amounts.
    function invariant_ContractBalanceEqualsHeldContributions() public view {
        if (!handler.obligationCreated()) return;

        uint256 id = handler.currentObligationId();
        (, , , , , , PoollessV2.ObligationStatus status, address[] memory contributors) =
            poolless.getObligation(id);

        if (status == PoollessV2.ObligationStatus.SETTLED) return; // contract already drained
        if (status == PoollessV2.ObligationStatus.EXPIRED) return; // may have been partially refunded

        // For OPEN obligations the contract's actual balance must match totalFunded
        uint256 contractBalance = usdc.balanceOf(address(poolless));
        // Only count hasPaid contributors
        uint256 expectedBalance;
        for (uint256 i = 0; i < contributors.length; i++) {
            (, bool paid) = poolless.getContributorInfo(id, contributors[i]);
            if (paid) {
                (uint256 amt, ) = poolless.getContributorInfo(id, contributors[i]);
                expectedBalance += amt;
            }
        }
        assertEq(contractBalance, expectedBalance, "invariant: contract balance != sum of paid contributions");
    }
}
