// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, Vm} from "forge-std/Test.sol";
import {Poolless} from "../Poolless.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

/// @dev Handler used exclusively by the invariant suite.
contract PoollessHandler is Test {
    Poolless internal poolless;
    MockERC20 internal usdc;

    address internal alice;
    address internal bob;
    address internal recipient;

    uint256 public currentObligationId;
    bool public obligationCreated;
    bool public obligationFunded;

    constructor(Poolless _poolless, MockERC20 _usdc, address _alice, address _bob, address _recipient) {
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
        if (!obligationCreated || obligationFunded) return;
        address who = whoSeed % 2 == 0 ? alice : bob;

        (, , , , , , Poolless.ObligationStatus status, ) = poolless.getObligation(currentObligationId);
        if (status != Poolless.ObligationStatus.OPEN) return;

        (, bool hasPaid) = poolless.getContributorInfo(currentObligationId, who);
        if (hasPaid) return;

        (uint256 amt, ) = poolless.getContributorInfo(currentObligationId, who);
        usdc.mint(who, amt);
        vm.prank(who);
        usdc.approve(address(poolless), amt);
        vm.prank(who);
        poolless.contribute(currentObligationId);

        (, , , , , , Poolless.ObligationStatus newStatus, ) = poolless.getObligation(currentObligationId);
        if (newStatus == Poolless.ObligationStatus.FUNDED) {
            obligationFunded = true;
        }
    }
}

contract PoollessTest is Test {
    // ─────────────────────────────────────────────────────────────────────────
    //  Constants & actors
    // ─────────────────────────────────────────────────────────────────────────
    uint256 internal constant USDC_DECIMALS = 6;
    uint256 internal constant UNIT = 10 ** USDC_DECIMALS;

    address internal alice   = makeAddr("alice");
    address internal bob     = makeAddr("bob");
    address internal carol   = makeAddr("carol");
    address internal recipient = makeAddr("recipient");

    MockERC20 internal usdc;
    Poolless  internal poolless;

    // ─────────────────────────────────────────────────────────────────────────
    //  setUp — fresh state before every test
    // ─────────────────────────────────────────────────────────────────────────
    function setUp() public {
        usdc    = new MockERC20("Mock USDC", "mUSDC", 6);
        poolless = new Poolless(address(usdc));

        // Give contributors enough tokens and blanket approvals.
        usdc.mint(alice, 10_000 * UNIT);
        usdc.mint(bob,   10_000 * UNIT);
        usdc.mint(carol,  10_000 * UNIT);

        vm.prank(alice); usdc.approve(address(poolless), type(uint256).max);
        vm.prank(bob);   usdc.approve(address(poolless), type(uint256).max);
        vm.prank(carol); usdc.approve(address(poolless), type(uint256).max);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Helpers
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev Build a default single-contributor obligation params.
    function _defaultSingleParams()
        internal
        view
        returns (
            string memory title,
            string memory desc,
            uint256 total,
            address recip,
            uint256 deadline,
            address[] memory addrs,
            uint256[] memory amts
        )
    {
        title    = "Pay Alice";
        desc     = "Simple obligation";
        total    = 100 * UNIT;
        recip    = recipient;
        deadline = block.timestamp + 7 days;
        addrs    = new address[](1);
        addrs[0] = alice;
        amts     = new uint256[](1);
        amts[0]  = 100 * UNIT;
    }

    /// @dev Build a two-contributor obligation.
    function _defaultTwoParams()
        internal
        view
        returns (
            string memory title,
            string memory desc,
            uint256 total,
            address recip,
            uint256 deadline,
            address[] memory addrs,
            uint256[] memory amts
        )
    {
        title    = "Two contributors";
        desc     = "";
        total    = 300 * UNIT;
        recip    = recipient;
        deadline = block.timestamp + 7 days;
        addrs    = new address[](2);
        addrs[0] = alice;
        addrs[1] = bob;
        amts     = new uint256[](2);
        amts[0]  = 100 * UNIT;
        amts[1]  = 200 * UNIT;
    }

    /// @dev Creates the default single-contributor obligation and returns its id.
    function _createSingle() internal returns (uint256 id) {
        (
            string memory title,
            string memory desc,
            uint256 total,
            address recip,
            uint256 deadline,
            address[] memory addrs,
            uint256[] memory amts
        ) = _defaultSingleParams();
        id = poolless.createObligation(title, desc, total, recip, deadline, addrs, amts);
    }

    /// @dev Creates the default two-contributor obligation and returns its id.
    function _createTwo() internal returns (uint256 id) {
        (
            string memory title,
            string memory desc,
            uint256 total,
            address recip,
            uint256 deadline,
            address[] memory addrs,
            uint256[] memory amts
        ) = _defaultTwoParams();
        id = poolless.createObligation(title, desc, total, recip, deadline, addrs, amts);
    }

    /// @dev Fully funds a single-contributor obligation.
    function _fundSingle(uint256 id) internal {
        vm.prank(alice);
        poolless.contribute(id);
    }

    /// @dev Fully funds a two-contributor obligation.
    function _fundTwo(uint256 id) internal {
        vm.prank(alice);
        poolless.contribute(id);
        vm.prank(bob);
        poolless.contribute(id);
    }

    // =========================================================================
    //  1. CONSTRUCTOR
    // =========================================================================

    function test_Constructor_SetsUSDC() public view {
        assertEq(address(poolless.usdc()), address(usdc));
    }

    function test_Constructor_RevertZeroAddress() public {
        vm.expectRevert(bytes("Poolless: USDC is zero address"));
        new Poolless(address(0));
    }

    // =========================================================================
    //  2. createObligation — happy path
    // =========================================================================

    function test_CreateObligation_SingleContributor_StoredCorrectly() public {
        (
            string memory title,
            string memory desc,
            uint256 total,
            address recip,
            uint256 deadline,
            address[] memory addrs,
            uint256[] memory amts
        ) = _defaultSingleParams();

        uint256 id = poolless.createObligation(title, desc, total, recip, deadline, addrs, amts);

        assertEq(id, 1);
        assertEq(poolless.obligationCount(), 1);

        (
            string memory storedTitle,
            string memory storedDesc,
            uint256 storedTotal,
            uint256 storedFunded,
            address storedRecip,
            uint256 storedDeadline,
            Poolless.ObligationStatus status,
            address[] memory storedContribs
        ) = poolless.getObligation(id);

        assertEq(storedTitle,      title);
        assertEq(storedDesc,       desc);
        assertEq(storedTotal,      total);
        assertEq(storedFunded,     0);
        assertEq(storedRecip,      recip);
        assertEq(storedDeadline,   deadline);
        assertEq(uint8(status),    uint8(Poolless.ObligationStatus.OPEN));
        assertEq(storedContribs.length, 1);
        assertEq(storedContribs[0], alice);

        (uint256 amt, bool hasPaid) = poolless.getContributorInfo(id, alice);
        assertEq(amt,     total);
        assertFalse(hasPaid);
    }

    function test_CreateObligation_TwoContributors_StoredCorrectly() public {
        (
            string memory title,
            string memory desc,
            uint256 total,
            address recip,
            uint256 deadline,
            address[] memory addrs,
            uint256[] memory amts
        ) = _defaultTwoParams();

        uint256 id = poolless.createObligation(title, desc, total, recip, deadline, addrs, amts);

        (,,,,,, Poolless.ObligationStatus status, address[] memory storedContribs) = poolless.getObligation(id);
        assertEq(uint8(status), uint8(Poolless.ObligationStatus.OPEN));
        assertEq(storedContribs.length, 2);

        (uint256 amtA, ) = poolless.getContributorInfo(id, alice);
        (uint256 amtB, ) = poolless.getContributorInfo(id, bob);
        assertEq(amtA, 100 * UNIT);
        assertEq(amtB, 200 * UNIT);
    }

    function test_CreateObligation_EmitsObligationCreated() public {
        (
            string memory title,
            string memory desc,
            uint256 total,
            address recip,
            uint256 deadline,
            address[] memory addrs,
            uint256[] memory amts
        ) = _defaultSingleParams();

        vm.expectEmit(true, true, false, true, address(poolless));
        emit Poolless.ObligationCreated(1, title, total, recip, deadline, addrs, amts);

        poolless.createObligation(title, desc, total, recip, deadline, addrs, amts);
    }

    function test_CreateObligation_IncrementCount() public {
        _createSingle();
        _createSingle();
        assertEq(poolless.obligationCount(), 2);
    }

    // =========================================================================
    //  3. createObligation — revert paths
    // =========================================================================

    function test_CreateObligation_RevertEmptyTitle() public {
        (, string memory desc, uint256 total, address recip, uint256 deadline,
            address[] memory addrs, uint256[] memory amts) = _defaultSingleParams();

        vm.expectRevert(bytes("Poolless: title empty"));
        poolless.createObligation("", desc, total, recip, deadline, addrs, amts);
    }

    function test_CreateObligation_RevertTitleTooLong() public {
        (, string memory desc, uint256 total, address recip, uint256 deadline,
            address[] memory addrs, uint256[] memory amts) = _defaultSingleParams();

        // 101 'a' characters
        string memory longTitle = new string(101);
        bytes memory buf = bytes(longTitle);
        for (uint256 i = 0; i < 101; i++) buf[i] = "a";
        longTitle = string(buf);

        vm.expectRevert(bytes("Poolless: title too long"));
        poolless.createObligation(longTitle, desc, total, recip, deadline, addrs, amts);
    }

    function test_CreateObligation_RevertDescriptionTooLong() public {
        (string memory title,, uint256 total, address recip, uint256 deadline,
            address[] memory addrs, uint256[] memory amts) = _defaultSingleParams();

        // 501 'x' characters
        string memory longDesc = new string(501);
        bytes memory buf = bytes(longDesc);
        for (uint256 i = 0; i < 501; i++) buf[i] = "x";
        longDesc = string(buf);

        vm.expectRevert(bytes("Poolless: description too long"));
        poolless.createObligation(title, longDesc, total, recip, deadline, addrs, amts);
    }

    function test_CreateObligation_RevertZeroTotalAmount() public {
        (string memory title, string memory desc,, address recip, uint256 deadline,
            address[] memory addrs, uint256[] memory amts) = _defaultSingleParams();

        // keep addresses but set amount to 0 — totalAmount=0 is checked first
        amts[0] = 0;

        vm.expectRevert(bytes("Poolless: total amount is zero"));
        poolless.createObligation(title, desc, 0, recip, deadline, addrs, amts);
    }

    function test_CreateObligation_RevertZeroRecipient() public {
        (string memory title, string memory desc, uint256 total,, uint256 deadline,
            address[] memory addrs, uint256[] memory amts) = _defaultSingleParams();

        vm.expectRevert(bytes("Poolless: recipient is zero address"));
        poolless.createObligation(title, desc, total, address(0), deadline, addrs, amts);
    }

    function test_CreateObligation_RevertPastDeadline() public {
        (string memory title, string memory desc, uint256 total, address recip,,
            address[] memory addrs, uint256[] memory amts) = _defaultSingleParams();

        vm.expectRevert(bytes("Poolless: deadline not in future"));
        poolless.createObligation(title, desc, total, recip, block.timestamp, addrs, amts);
    }

    function test_CreateObligation_RevertEmptyContributors() public {
        (string memory title, string memory desc, uint256 total, address recip, uint256 deadline,,)
            = _defaultSingleParams();

        address[] memory empty = new address[](0);
        uint256[] memory emptyAmts = new uint256[](0);

        vm.expectRevert(bytes("Poolless: no contributors"));
        poolless.createObligation(title, desc, total, recip, deadline, empty, emptyAmts);
    }

    function test_CreateObligation_RevertArrayLengthMismatch() public {
        (string memory title, string memory desc, uint256 total, address recip, uint256 deadline,
            address[] memory addrs,) = _defaultSingleParams();

        uint256[] memory twoAmts = new uint256[](2);
        twoAmts[0] = 50 * UNIT;
        twoAmts[1] = 50 * UNIT;

        vm.expectRevert(bytes("Poolless: array length mismatch"));
        poolless.createObligation(title, desc, total, recip, deadline, addrs, twoAmts);
    }

    function test_CreateObligation_RevertZeroContributorAddress() public {
        (string memory title, string memory desc, uint256 total, address recip, uint256 deadline,,)
            = _defaultSingleParams();

        address[] memory addrs = new address[](1);
        addrs[0] = address(0);
        uint256[] memory amts = new uint256[](1);
        amts[0] = total;

        vm.expectRevert(bytes("Poolless: contributor is zero address"));
        poolless.createObligation(title, desc, total, recip, deadline, addrs, amts);
    }

    function test_CreateObligation_RevertZeroContributorAmount() public {
        (string memory title, string memory desc, uint256 total, address recip, uint256 deadline,,)
            = _defaultSingleParams();

        address[] memory addrs = new address[](1);
        addrs[0] = alice;
        uint256[] memory amts = new uint256[](1);
        amts[0] = 0;

        vm.expectRevert(bytes("Poolless: contributor amount is zero"));
        poolless.createObligation(title, desc, total, recip, deadline, addrs, amts);
    }

    function test_CreateObligation_RevertDuplicateContributor() public {
        (string memory title, string memory desc,, address recip, uint256 deadline,,)
            = _defaultSingleParams();

        address[] memory addrs = new address[](2);
        addrs[0] = alice;
        addrs[1] = alice; // duplicate
        uint256[] memory amts = new uint256[](2);
        amts[0] = 50 * UNIT;
        amts[1] = 50 * UNIT;

        vm.expectRevert(bytes("Poolless: duplicate contributor"));
        poolless.createObligation(title, desc, 100 * UNIT, recip, deadline, addrs, amts);
    }

    function test_CreateObligation_RevertSumMismatch() public {
        (string memory title, string memory desc, uint256 total, address recip, uint256 deadline,,)
            = _defaultSingleParams();

        address[] memory addrs = new address[](1);
        addrs[0] = alice;
        uint256[] memory amts = new uint256[](1);
        amts[0] = total - 1; // one short

        vm.expectRevert(bytes("Poolless: total mismatch"));
        poolless.createObligation(title, desc, total, recip, deadline, addrs, amts);
    }

    // =========================================================================
    //  4. contribute — happy paths
    // =========================================================================

    function test_Contribute_SingleContributor_UpdatesState() public {
        uint256 id = _createSingle();
        uint256 recipBefore = usdc.balanceOf(recipient);

        vm.prank(alice);
        poolless.contribute(id);

        (, , uint256 storedTotal, uint256 storedFunded, , , Poolless.ObligationStatus status, ) =
            poolless.getObligation(id);

        assertEq(storedFunded, storedTotal);
        assertEq(uint8(status), uint8(Poolless.ObligationStatus.FUNDED));
        // Funds are held by the contract, not sent to recipient yet.
        assertEq(usdc.balanceOf(address(poolless)), storedTotal);
        assertEq(usdc.balanceOf(recipient), recipBefore);

        (, bool hasPaid) = poolless.getContributorInfo(id, alice);
        assertTrue(hasPaid);
    }

    function test_Contribute_EmitsContributionReceived() public {
        uint256 id = _createSingle();

        vm.expectEmit(true, true, false, true, address(poolless));
        emit Poolless.ContributionReceived(id, alice, 100 * UNIT);

        vm.prank(alice);
        poolless.contribute(id);
    }

    function test_Contribute_EmitsObligationFundedWhenFullyFunded() public {
        uint256 id = _createSingle();

        vm.expectEmit(true, true, false, true, address(poolless));
        emit Poolless.ObligationFunded(id, 100 * UNIT, recipient);

        vm.prank(alice);
        poolless.contribute(id);
    }

    function test_Contribute_MultiContributor_PartialThenFull() public {
        uint256 id = _createTwo();

        // Alice contributes first — still OPEN
        vm.prank(alice);
        poolless.contribute(id);

        (, , , uint256 funded1, , , Poolless.ObligationStatus status1, ) = poolless.getObligation(id);
        assertEq(funded1, 100 * UNIT);
        assertEq(uint8(status1), uint8(Poolless.ObligationStatus.OPEN));

        // Bob contributes — now FUNDED
        vm.prank(bob);
        poolless.contribute(id);

        (, , , uint256 funded2, , , Poolless.ObligationStatus status2, ) = poolless.getObligation(id);
        assertEq(funded2, 300 * UNIT);
        assertEq(uint8(status2), uint8(Poolless.ObligationStatus.FUNDED));
        assertEq(usdc.balanceOf(address(poolless)), 300 * UNIT);
    }

    function test_Contribute_ObligationFunded_NotEmittedOnPartialContribution() public {
        uint256 id = _createTwo();

        // Record logs — ObligationFunded must NOT appear after partial contribution.
        vm.recordLogs();
        vm.prank(alice);
        poolless.contribute(id);

        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 fundedSig = keccak256("ObligationFunded(uint256,uint256,address)");
        for (uint256 i = 0; i < logs.length; i++) {
            assertFalse(logs[i].topics[0] == fundedSig, "ObligationFunded emitted too early");
        }
    }

    // =========================================================================
    //  5. contribute — revert paths
    // =========================================================================

    function test_Contribute_RevertInvalidObligation() public {
        vm.prank(alice);
        vm.expectRevert(bytes("Poolless: invalid obligation"));
        poolless.contribute(999);
    }

    function test_Contribute_RevertExpiredDeadline() public {
        uint256 id = _createSingle();
        vm.warp(block.timestamp + 8 days); // past deadline

        vm.prank(alice);
        vm.expectRevert(bytes("Poolless: obligation expired"));
        poolless.contribute(id);
    }

    function test_Contribute_RevertNotAContributor() public {
        uint256 id = _createSingle();

        vm.prank(carol); // carol is not in the obligation
        vm.expectRevert(bytes("Poolless: not a contributor"));
        poolless.contribute(id);
    }

    function test_Contribute_RevertAlreadyPaid() public {
        uint256 id = _createSingle();

        vm.prank(alice);
        poolless.contribute(id);

        vm.prank(alice);
        vm.expectRevert(bytes("Poolless: not open")); // status is FUNDED after full pay
        poolless.contribute(id);
    }

    function test_Contribute_RevertAlreadyPaid_Partial() public {
        uint256 id = _createTwo();

        vm.prank(alice);
        poolless.contribute(id);

        vm.prank(alice);
        vm.expectRevert(bytes("Poolless: already contributed"));
        poolless.contribute(id);
    }

    function test_Contribute_RevertWrongObligationId() public {
        _createSingle();

        vm.prank(alice);
        vm.expectRevert(bytes("Poolless: invalid obligation"));
        poolless.contribute(2); // id=2 doesn't exist
    }

    // =========================================================================
    //  6. settle — happy path
    // =========================================================================

    function test_Settle_TransfersToRecipient() public {
        uint256 id = _createSingle();
        _fundSingle(id);

        uint256 recipBefore = usdc.balanceOf(recipient);
        uint256 contractBefore = usdc.balanceOf(address(poolless));

        poolless.settle(id);

        assertEq(usdc.balanceOf(recipient),        recipBefore + 100 * UNIT);
        assertEq(usdc.balanceOf(address(poolless)), contractBefore - 100 * UNIT);
    }

    function test_Settle_SetsStatusToSettled() public {
        uint256 id = _createSingle();
        _fundSingle(id);

        poolless.settle(id);

        (,,,,,, Poolless.ObligationStatus status, ) = poolless.getObligation(id);
        assertEq(uint8(status), uint8(Poolless.ObligationStatus.SETTLED));
    }

    function test_Settle_EmitsObligationSettled() public {
        uint256 id = _createSingle();
        _fundSingle(id);

        vm.expectEmit(true, true, false, true, address(poolless));
        emit Poolless.ObligationSettled(id, recipient, 100 * UNIT);

        poolless.settle(id);
    }

    function test_Settle_TwoContributors() public {
        uint256 id = _createTwo();
        _fundTwo(id);

        uint256 recipBefore = usdc.balanceOf(recipient);
        poolless.settle(id);
        assertEq(usdc.balanceOf(recipient), recipBefore + 300 * UNIT);
    }

    // =========================================================================
    //  7. settle — revert paths
    // =========================================================================

    function test_Settle_RevertInvalidObligation() public {
        vm.expectRevert(bytes("Poolless: invalid obligation"));
        poolless.settle(0);
    }

    function test_Settle_RevertIfOpen() public {
        uint256 id = _createSingle();

        vm.expectRevert(bytes("Poolless: not funded"));
        poolless.settle(id);
    }

    function test_Settle_RevertIfExpired() public {
        uint256 id = _createSingle();

        // expire it
        vm.warp(block.timestamp + 8 days);
        poolless.refundExpired(id);

        vm.expectRevert(bytes("Poolless: not funded"));
        poolless.settle(id);
    }

    function test_Settle_RevertIfAlreadySettled() public {
        uint256 id = _createSingle();
        _fundSingle(id);
        poolless.settle(id);

        vm.expectRevert(bytes("Poolless: not funded"));
        poolless.settle(id);
    }

    // =========================================================================
    //  8. refundExpired — happy path
    // =========================================================================

    function test_RefundExpired_SetsStatusExpired() public {
        uint256 id = _createSingle();
        vm.warp(block.timestamp + 7 days);

        poolless.refundExpired(id);

        (,,,,,, Poolless.ObligationStatus status, ) = poolless.getObligation(id);
        assertEq(uint8(status), uint8(Poolless.ObligationStatus.EXPIRED));
    }

    function test_RefundExpired_EmitsObligationExpired() public {
        uint256 id = _createSingle();
        vm.warp(block.timestamp + 7 days);

        vm.expectEmit(true, false, false, false, address(poolless));
        emit Poolless.ObligationExpired(id);

        poolless.refundExpired(id);
    }

    function test_RefundExpired_AtExactDeadline() public {
        uint256 id = _createSingle();
        (, , , , , uint256 deadline, , ) = poolless.getObligation(id);
        vm.warp(deadline);

        poolless.refundExpired(id); // should succeed at exactly deadline
        (,,,,,, Poolless.ObligationStatus status, ) = poolless.getObligation(id);
        assertEq(uint8(status), uint8(Poolless.ObligationStatus.EXPIRED));
    }

    function test_RefundExpired_ThenClaimRefund_Works() public {
        uint256 id = _createTwo();

        // Alice contributes before expiry
        vm.prank(alice);
        poolless.contribute(id);

        vm.warp(block.timestamp + 8 days);
        poolless.refundExpired(id);

        // Alice can reclaim her funds
        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        poolless.claimRefund(id);
        assertEq(usdc.balanceOf(alice), aliceBefore + 100 * UNIT);
    }

    // =========================================================================
    //  9. refundExpired — revert paths
    // =========================================================================

    function test_RefundExpired_RevertInvalidObligation() public {
        vm.expectRevert(bytes("Poolless: invalid obligation"));
        poolless.refundExpired(99);
    }

    function test_RefundExpired_RevertIfNotOpen_Funded() public {
        uint256 id = _createSingle();
        _fundSingle(id);

        vm.warp(block.timestamp + 8 days);
        vm.expectRevert(bytes("Poolless: not open"));
        poolless.refundExpired(id);
    }

    function test_RefundExpired_RevertIfDeadlineNotReached() public {
        uint256 id = _createSingle();

        vm.expectRevert(bytes("Poolless: deadline not reached"));
        poolless.refundExpired(id); // still in the future
    }

    function test_RefundExpired_RevertIfAlreadyExpired() public {
        uint256 id = _createSingle();
        vm.warp(block.timestamp + 8 days);
        poolless.refundExpired(id);

        vm.expectRevert(bytes("Poolless: not open"));
        poolless.refundExpired(id); // already expired
    }

    // =========================================================================
    //  10. claimRefund — happy paths
    // =========================================================================

    // Uses a two-contributor obligation where only alice pays → status stays OPEN
    // → deadline passes → refundExpired succeeds → alice can claim back her share.
    function test_ClaimRefund_AfterExpiry_ReturnsFunds() public {
        uint256 id = _createTwo(); // alice=100, bob=200, total=300

        vm.prank(alice);
        poolless.contribute(id); // partially funded, still OPEN

        vm.warp(block.timestamp + 8 days);
        poolless.refundExpired(id); // OPEN → EXPIRED

        uint256 balBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        poolless.claimRefund(id);
        assertEq(usdc.balanceOf(alice), balBefore + 100 * UNIT);
    }

    function test_ClaimRefund_UpdatesHasPaidFalse() public {
        uint256 id = _createTwo();
        vm.prank(alice);
        poolless.contribute(id); // partial — still OPEN

        vm.warp(block.timestamp + 8 days);
        poolless.refundExpired(id);

        vm.prank(alice);
        poolless.claimRefund(id);

        (, bool hasPaid) = poolless.getContributorInfo(id, alice);
        assertFalse(hasPaid);
    }

    function test_ClaimRefund_EmitsRefundClaimed() public {
        uint256 id = _createTwo();
        vm.prank(alice);
        poolless.contribute(id); // partial — still OPEN

        vm.warp(block.timestamp + 8 days);
        poolless.refundExpired(id);

        vm.expectEmit(true, true, false, true, address(poolless));
        emit Poolless.RefundClaimed(id, alice, 100 * UNIT);

        vm.prank(alice);
        poolless.claimRefund(id);
    }

    function test_ClaimRefund_MultipleContributors_EachGetsOwn() public {
        uint256 id = _createTwo();

        vm.prank(alice);
        poolless.contribute(id);
        vm.prank(bob);
        poolless.contribute(id);

        // Expire via settleFailureRefund after grace period (funded)
        vm.warp(block.timestamp + 30 days + 1);
        poolless.settleFailureRefund(id);

        uint256 aliceBefore = usdc.balanceOf(alice);
        uint256 bobBefore   = usdc.balanceOf(bob);

        vm.prank(alice);
        poolless.claimRefund(id);
        vm.prank(bob);
        poolless.claimRefund(id);

        assertEq(usdc.balanceOf(alice), aliceBefore + 100 * UNIT);
        assertEq(usdc.balanceOf(bob),   bobBefore   + 200 * UNIT);
    }

    // =========================================================================
    //  11. claimRefund — revert paths
    // =========================================================================

    function test_ClaimRefund_RevertInvalidObligation() public {
        vm.prank(alice);
        vm.expectRevert(bytes("Poolless: invalid obligation"));
        poolless.claimRefund(0);
    }

    function test_ClaimRefund_RevertIfOpen() public {
        uint256 id = _createSingle();
        // Never contribute — status stays OPEN
        vm.prank(alice);
        vm.expectRevert(bytes("Poolless: not expired"));
        poolless.claimRefund(id);
    }

    function test_ClaimRefund_RevertIfFunded() public {
        uint256 id = _createSingle();
        _fundSingle(id);

        vm.prank(alice);
        vm.expectRevert(bytes("Poolless: not expired"));
        poolless.claimRefund(id);
    }

    function test_ClaimRefund_RevertIfSettled() public {
        uint256 id = _createSingle();
        _fundSingle(id);
        poolless.settle(id);

        vm.prank(alice);
        vm.expectRevert(bytes("Poolless: not expired"));
        poolless.claimRefund(id);
    }

    function test_ClaimRefund_RevertIfNotAContributor() public {
        // Use two-contributor: alice pays → partial, status stays OPEN → expire
        uint256 id = _createTwo();
        vm.prank(alice);
        poolless.contribute(id); // partial → still OPEN

        vm.warp(block.timestamp + 8 days);
        poolless.refundExpired(id);

        vm.prank(carol); // carol was never in this obligation
        vm.expectRevert(bytes("Poolless: not a contributor"));
        poolless.claimRefund(id);
    }

    function test_ClaimRefund_RevertIfNotPaid() public {
        uint256 id = _createTwo();

        // Only alice contributes, bob does not — then expire
        vm.prank(alice);
        poolless.contribute(id);

        vm.warp(block.timestamp + 8 days);
        poolless.refundExpired(id);

        // Bob has amount>0 but hasPaid==false
        vm.prank(bob);
        vm.expectRevert(bytes("Poolless: no refund available"));
        poolless.claimRefund(id);
    }

    function test_ClaimRefund_RevertDoubleClaim() public {
        // Two-contributor: alice pays → partial → expire → alice claims → second claim reverts
        uint256 id = _createTwo();
        vm.prank(alice);
        poolless.contribute(id); // partial → still OPEN

        vm.warp(block.timestamp + 8 days);
        poolless.refundExpired(id);

        vm.prank(alice);
        poolless.claimRefund(id); // first claim succeeds

        vm.prank(alice);
        vm.expectRevert(bytes("Poolless: no refund available"));
        poolless.claimRefund(id); // second claim reverts
    }

    // =========================================================================
    //  12. settleFailureRefund — happy path
    // =========================================================================

    function test_SettleFailureRefund_AfterGracePeriod_SetsExpired() public {
        uint256 id = _createSingle();
        _fundSingle(id);

        vm.warp(block.timestamp + 30 days + 1);
        poolless.settleFailureRefund(id);

        (,,,,,, Poolless.ObligationStatus status, ) = poolless.getObligation(id);
        assertEq(uint8(status), uint8(Poolless.ObligationStatus.EXPIRED));
    }

    function test_SettleFailureRefund_EmitsSettlementFailed() public {
        uint256 id = _createSingle();
        _fundSingle(id);

        vm.warp(block.timestamp + 30 days + 1);

        vm.expectEmit(true, false, false, false, address(poolless));
        emit Poolless.SettlementFailed(id);

        poolless.settleFailureRefund(id);
    }

    function test_SettleFailureRefund_ClaimRefundWorks() public {
        uint256 id = _createSingle();
        _fundSingle(id);

        vm.warp(block.timestamp + 30 days + 1);
        poolless.settleFailureRefund(id);

        uint256 balBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        poolless.claimRefund(id);
        assertEq(usdc.balanceOf(alice), balBefore + 100 * UNIT);
    }

    function test_SettleFailureRefund_AtExactGracePeriod() public {
        uint256 id = _createSingle();
        _fundSingle(id);

        // fundedAt == block.timestamp of contribution
        uint256 fundedAt = block.timestamp;
        vm.warp(fundedAt + 30 days);
        poolless.settleFailureRefund(id);

        (,,,,,, Poolless.ObligationStatus statusSFR, ) = poolless.getObligation(id);
        assertEq(uint8(statusSFR), uint8(Poolless.ObligationStatus.EXPIRED));
    }

    // =========================================================================
    //  13. settleFailureRefund — revert paths
    // =========================================================================

    function test_SettleFailureRefund_RevertInvalidObligation() public {
        vm.expectRevert(bytes("Poolless: invalid obligation"));
        poolless.settleFailureRefund(0);
    }

    function test_SettleFailureRefund_RevertIfOpen() public {
        uint256 id = _createSingle();

        vm.warp(block.timestamp + 30 days + 1);
        vm.expectRevert(bytes("Poolless: not funded"));
        poolless.settleFailureRefund(id);
    }

    function test_SettleFailureRefund_RevertIfSettled() public {
        uint256 id = _createSingle();
        _fundSingle(id);
        poolless.settle(id);

        vm.warp(block.timestamp + 30 days + 1);
        vm.expectRevert(bytes("Poolless: not funded"));
        poolless.settleFailureRefund(id);
    }

    function test_SettleFailureRefund_RevertIfExpired() public {
        uint256 id = _createSingle();

        vm.warp(block.timestamp + 8 days);
        poolless.refundExpired(id);

        vm.warp(block.timestamp + 30 days + 1);
        vm.expectRevert(bytes("Poolless: not funded"));
        poolless.settleFailureRefund(id);
    }

    function test_SettleFailureRefund_RevertBeforeGracePeriod() public {
        uint256 id = _createSingle();
        _fundSingle(id);

        vm.warp(block.timestamp + 29 days);
        vm.expectRevert(bytes("Poolless: grace period not reached"));
        poolless.settleFailureRefund(id);
    }

    // =========================================================================
    //  14. getObligation / getContributorInfo / isContributor — view helpers
    // =========================================================================

    function test_GetObligation_RevertInvalidId() public {
        vm.expectRevert(bytes("Poolless: invalid obligation"));
        poolless.getObligation(0);
    }

    function test_GetContributorInfo_RevertInvalidObligation() public {
        vm.expectRevert(bytes("Poolless: invalid obligation"));
        poolless.getContributorInfo(99, alice);
    }

    function test_IsContributor_TrueForContributor() public {
        uint256 id = _createSingle();
        assertTrue(poolless.isContributor(id, alice));
    }

    function test_IsContributor_FalseForNonContributor() public {
        uint256 id = _createSingle();
        assertFalse(poolless.isContributor(id, carol));
    }

    // =========================================================================
    //  15. FUZZ — createObligation arithmetic (amounts sum to totalAmount)
    // =========================================================================

    function testFuzz_CreateObligation_TwoContributors_VariousAmounts(
        uint128 a,
        uint128 b
    ) public {
        vm.assume(a > 0 && b > 0);
        uint256 total = uint256(a) + uint256(b);

        address[] memory addrs = new address[](2);
        addrs[0] = alice;
        addrs[1] = bob;
        uint256[] memory amts = new uint256[](2);
        amts[0] = a;
        amts[1] = b;

        // Must not revert
        uint256 id = poolless.createObligation(
            "Fuzz",
            "",
            total,
            recipient,
            block.timestamp + 1 days,
            addrs,
            amts
        );

        (, , uint256 storedTotal, , , , , ) = poolless.getObligation(id);
        assertEq(storedTotal, total);
    }

    function testFuzz_CreateObligation_SumMismatch_AlwaysReverts(
        uint128 a,
        uint128 b,
        uint128 declared
    ) public {
        uint256 actualSum = uint256(a) + uint256(b);
        vm.assume(a > 0 && b > 0);
        vm.assume(uint256(declared) != actualSum && declared > 0);

        address[] memory addrs = new address[](2);
        addrs[0] = alice;
        addrs[1] = bob;
        uint256[] memory amts = new uint256[](2);
        amts[0] = a;
        amts[1] = b;

        vm.expectRevert(bytes("Poolless: total mismatch"));
        poolless.createObligation(
            "FuzzMismatch",
            "",
            declared,
            recipient,
            block.timestamp + 1 days,
            addrs,
            amts
        );
    }

    function testFuzz_Contribute_FundsAccumulate(uint96 a1, uint96 a2) public {
        vm.assume(a1 > 0 && a2 > 0);
        // Keep total under mint cap
        uint256 t1 = bound(a1, 1, 5_000 * UNIT);
        uint256 t2 = bound(a2, 1, 5_000 * UNIT);
        uint256 total = t1 + t2;

        usdc.mint(alice, total); // extra supply on top of setUp
        usdc.mint(bob, total);

        address[] memory addrs = new address[](2);
        addrs[0] = alice;
        addrs[1] = bob;
        uint256[] memory amts = new uint256[](2);
        amts[0] = t1;
        amts[1] = t2;

        uint256 id = poolless.createObligation(
            "FuzzContrib",
            "",
            total,
            recipient,
            block.timestamp + 7 days,
            addrs,
            amts
        );

        vm.prank(alice);
        poolless.contribute(id);
        vm.prank(bob);
        poolless.contribute(id);

        (, , uint256 storedTotal, uint256 storedFunded, , , Poolless.ObligationStatus status, ) =
            poolless.getObligation(id);

        assertEq(storedFunded,  total);
        assertEq(storedTotal,   total);
        assertEq(uint8(status), uint8(Poolless.ObligationStatus.FUNDED));
        assertEq(usdc.balanceOf(address(poolless)), total);
    }

}

/// @dev Separate contract so forge targets only the handler for invariant calls,
///      but the invariant assertion still lives here.
contract PoollessInvariantTest is Test {
    uint256 internal constant UNIT = 10 ** 6;

    address internal alice     = makeAddr("alice");
    address internal bob       = makeAddr("bob");
    address internal recipient = makeAddr("recipient");

    MockERC20       internal usdc;
    Poolless        internal poolless;
    PoollessHandler internal handler;

    function setUp() public {
        usdc     = new MockERC20("Mock USDC", "mUSDC", 6);
        poolless = new Poolless(address(usdc));

        usdc.mint(alice, 100_000 * UNIT);
        usdc.mint(bob,   100_000 * UNIT);

        vm.prank(alice); usdc.approve(address(poolless), type(uint256).max);
        vm.prank(bob);   usdc.approve(address(poolless), type(uint256).max);

        handler = new PoollessHandler(poolless, usdc, alice, bob, recipient);
        targetContract(address(handler));
    }

    /// @dev At all times, the contract's USDC balance >= totalFunded stored on-chain.
    function invariant_BalanceGeTotalFunded() public view {
        if (!handler.obligationCreated()) return;

        uint256 id = handler.currentObligationId();
        (, , , uint256 funded, , , Poolless.ObligationStatus status, ) = poolless.getObligation(id);
        uint256 contractBal = usdc.balanceOf(address(poolless));

        // If settled, balance may be 0; otherwise balance >= funded at all times.
        if (status != Poolless.ObligationStatus.SETTLED) {
            assertGe(contractBal, funded, "balance < totalFunded: funds leaked");
        }
    }

    /// @dev totalFunded can never exceed totalAmount.
    function invariant_FundedLeTotal() public view {
        if (!handler.obligationCreated()) return;

        uint256 id = handler.currentObligationId();
        (, , uint256 total, uint256 funded, , , , ) = poolless.getObligation(id);
        assertLe(funded, total, "totalFunded > totalAmount: overfunded");
    }
}
