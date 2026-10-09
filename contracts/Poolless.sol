// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract Poolless is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum ObligationStatus {
        OPEN,
        FUNDED,
        SETTLED,
        EXPIRED
    }

    struct ContributorInfo {
        uint256 amount;
        bool hasPaid;
    }

    struct Obligation {
        string title;
        string description;
        uint256 totalAmount;
        uint256 totalFunded;
        address recipient;
        uint256 deadline;
        uint256 fundedAt;
        ObligationStatus status;
        address[] contributors;
        mapping(address => ContributorInfo) contributorInfo;
    }

    IERC20 public immutable usdc;
    uint256 public constant SETTLE_GRACE_PERIOD = 30 days;

    uint256 public obligationCount;
    mapping(uint256 => Obligation) private obligations;

    event ObligationCreated(
        uint256 indexed obligationId,
        string title,
        uint256 totalAmount,
        address indexed recipient,
        uint256 deadline,
        address[] contributors,
        uint256[] amounts
    );
    event ContributionReceived(uint256 indexed obligationId, address indexed contributor, uint256 amount);
    event ObligationFunded(uint256 indexed obligationId, uint256 totalAmount, address indexed recipient);
    event ObligationSettled(uint256 indexed obligationId, address indexed recipient, uint256 amount);
    event RefundClaimed(uint256 indexed obligationId, address indexed contributor, uint256 amount);
    event ObligationExpired(uint256 indexed obligationId);
    event SettlementFailed(uint256 indexed obligationId);

    constructor(address _usdc) {
        require(_usdc != address(0), "Poolless: USDC is zero address");
        usdc = IERC20(_usdc);
    }

    function createObligation(
        string calldata title,
        string calldata description,
        uint256 totalAmount,
        address recipient,
        uint256 deadline,
        address[] calldata contributorAddresses,
        uint256[] calldata amounts
    ) external returns (uint256 obligationId) {
        require(bytes(title).length > 0, "Poolless: title empty");
        require(bytes(title).length <= 100, "Poolless: title too long");
        require(bytes(description).length <= 500, "Poolless: description too long");
        require(totalAmount > 0, "Poolless: total amount is zero");
        require(recipient != address(0), "Poolless: recipient is zero address");
        require(deadline > block.timestamp, "Poolless: deadline not in future");
        require(contributorAddresses.length > 0, "Poolless: no contributors");
        require(contributorAddresses.length == amounts.length, "Poolless: array length mismatch");

        uint256 runningSum;
        uint256 length = contributorAddresses.length;

        obligationId = ++obligationCount;
        Obligation storage ob = obligations[obligationId];

        ob.title = title;
        ob.description = description;
        ob.totalAmount = totalAmount;
        ob.recipient = recipient;
        ob.deadline = deadline;
        ob.status = ObligationStatus.OPEN;

        for (uint256 i = 0; i < length; ++i) {
            address contributor = contributorAddresses[i];
            uint256 amount = amounts[i];

            require(contributor != address(0), "Poolless: contributor is zero address");
            require(amount > 0, "Poolless: contributor amount is zero");
            require(ob.contributorInfo[contributor].amount == 0, "Poolless: duplicate contributor");

            ob.contributors.push(contributor);
            ob.contributorInfo[contributor] = ContributorInfo({amount: amount, hasPaid: false});
            runningSum += amount;
        }

        require(runningSum == totalAmount, "Poolless: total mismatch");

        emit ObligationCreated(obligationId, title, totalAmount, recipient, deadline, contributorAddresses, amounts);
    }

    function contribute(uint256 obligationId) external nonReentrant {
        Obligation storage ob = _getOpenObligation(obligationId);
        require(block.timestamp < ob.deadline, "Poolless: obligation expired");

        ContributorInfo storage info = ob.contributorInfo[msg.sender];
        require(info.amount > 0, "Poolless: not a contributor");
        require(!info.hasPaid, "Poolless: already contributed");

        uint256 amount = info.amount;

        info.hasPaid = true;
        ob.totalFunded += amount;
        require(ob.totalFunded <= ob.totalAmount, "Poolless: overfunded");

        if (ob.totalFunded == ob.totalAmount) {
            ob.status = ObligationStatus.FUNDED;
            ob.fundedAt = block.timestamp;
        }

        usdc.safeTransferFrom(msg.sender, address(this), amount);

        emit ContributionReceived(obligationId, msg.sender, amount);
        if (ob.status == ObligationStatus.FUNDED) {
            emit ObligationFunded(obligationId, ob.totalAmount, ob.recipient);
        }
    }

    function settle(uint256 obligationId) external nonReentrant {
        require(_obligationExists(obligationId), "Poolless: invalid obligation");
        Obligation storage ob = obligations[obligationId];
        require(ob.status == ObligationStatus.FUNDED, "Poolless: not funded");

        ob.status = ObligationStatus.SETTLED;

        usdc.safeTransfer(ob.recipient, ob.totalAmount);

        emit ObligationSettled(obligationId, ob.recipient, ob.totalAmount);
    }

    function refundExpired(uint256 obligationId) external nonReentrant {
        require(_obligationExists(obligationId), "Poolless: invalid obligation");
        Obligation storage ob = obligations[obligationId];
        require(ob.status == ObligationStatus.OPEN, "Poolless: not open");
        require(block.timestamp >= ob.deadline, "Poolless: deadline not reached");

        ob.status = ObligationStatus.EXPIRED;

        emit ObligationExpired(obligationId);
    }

    function settleFailureRefund(uint256 obligationId) external nonReentrant {
        require(_obligationExists(obligationId), "Poolless: invalid obligation");
        Obligation storage ob = obligations[obligationId];
        require(ob.status == ObligationStatus.FUNDED, "Poolless: not funded");
        require(block.timestamp >= ob.fundedAt + SETTLE_GRACE_PERIOD, "Poolless: grace period not reached");

        ob.status = ObligationStatus.EXPIRED;
        ob.fundedAt = 0;

        emit SettlementFailed(obligationId);
    }

    function claimRefund(uint256 obligationId) external nonReentrant {
        require(_obligationExists(obligationId), "Poolless: invalid obligation");
        Obligation storage ob = obligations[obligationId];
        require(ob.status == ObligationStatus.EXPIRED, "Poolless: not expired");

        ContributorInfo storage info = ob.contributorInfo[msg.sender];
        require(info.amount > 0, "Poolless: not a contributor");
        require(info.hasPaid, "Poolless: no refund available");

        uint256 amount = info.amount;

        info.hasPaid = false;
        ob.totalFunded -= amount;
        usdc.safeTransfer(msg.sender, amount);

        emit RefundClaimed(obligationId, msg.sender, amount);
    }

    function getObligation(uint256 id)
        external
        view
        returns (
            string memory title,
            string memory description,
            uint256 totalAmount,
            uint256 totalFunded,
            address recipient,
            uint256 deadline,
            ObligationStatus status,
            address[] memory contributors
        )
    {
        require(_obligationExists(id), "Poolless: invalid obligation");
        Obligation storage ob = obligations[id];

        return (
            ob.title,
            ob.description,
            ob.totalAmount,
            ob.totalFunded,
            ob.recipient,
            ob.deadline,
            ob.status,
            ob.contributors
        );
    }

    function getContributorInfo(uint256 obligationId, address contributor)
        external
        view
        returns (uint256 amount, bool hasPaid)
    {
        require(_obligationExists(obligationId), "Poolless: invalid obligation");
        ContributorInfo storage info = obligations[obligationId].contributorInfo[contributor];
        return (info.amount, info.hasPaid);
    }

    function isContributor(uint256 obligationId, address addr) external view returns (bool) {
        require(_obligationExists(obligationId), "Poolless: invalid obligation");
        return obligations[obligationId].contributorInfo[addr].amount > 0;
    }

    function _obligationExists(uint256 obligationId) internal view returns (bool) {
        return obligationId > 0 && obligationId <= obligationCount;
    }

    function _getOpenObligation(uint256 obligationId) internal view returns (Obligation storage ob) {
        require(_obligationExists(obligationId), "Poolless: invalid obligation");
        ob = obligations[obligationId];
        require(ob.status == ObligationStatus.OPEN, "Poolless: not open");
    }
}
