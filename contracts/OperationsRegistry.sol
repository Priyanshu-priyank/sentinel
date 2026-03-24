// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract OperationsRegistry {

    // ── Data structures ──────────────────────────────────────────

    enum ModuleType { LEAD, SUPPORT, TASK }
    enum Verdict    { ACCEPTED, REJECTED, ESCALATED }

    struct Decision {
        bytes32     inputHash;       // keccak256 of sanitized input
        ModuleType  module;
        Verdict     verdict;
        uint8       confidence;      // 0-100 from AI
        bytes32     advocateHash;    // keccak256 of advocate argument
        bytes32     skepticHash;     // keccak256 of skeptic argument
        bytes32     judgeHash;       // keccak256 of judge's final verdict/action
        uint256     timestamp;
        address     operator;
        bool        slaCreated;
    }

    struct SLACommitment {
        uint256   decisionId;
        uint256   deadline;          // block.timestamp + 86400 (24h)
        bool      fulfilled;
        uint256   fulfilledAt;
    }

    // ── State ────────────────────────────────────────────────────

    Decision[]       public decisions;
    SLACommitment[]  public slaCommitments;
    mapping(address => uint256) public opsScore;    // 0-1000 reputation
    mapping(address => uint256) public totalSLAs;
    mapping(address => uint256) public fulfilledSLAs;

    // ── Events ───────────────────────────────────────────────────

    event DecisionLogged(
        uint256 indexed id,
        ModuleType module,
        Verdict verdict,
        uint8 confidence,
        uint256 timestamp
    );

    event SLAMinted(
        uint256 indexed slaId,
        uint256 indexed decisionId,
        uint256 deadline,
        address operator
    );

    event SLAFulfilled(
        uint256 indexed slaId,
        address fulfiller,
        uint256 hoursRemaining   // how ahead of deadline (reward multiplier)
    );

    event ReputationUpdated(
        address indexed operator,
        uint256 newScore,
        bool increased
    );

    // ── Write functions ──────────────────────────────────────────

    function logDecision(
        bytes32    _inputHash,
        ModuleType _module,
        Verdict    _verdict,
        uint8      _confidence,
        bytes32    _advocateHash,
        bytes32    _skepticHash,
        bytes32    _judgeHash
    ) external returns (uint256 decisionId) {
        decisions.push(Decision({
            inputHash:     _inputHash,
            module:        _module,
            verdict:       _verdict,
            confidence:    _confidence,
            advocateHash:  _advocateHash,
            skepticHash:   _skepticHash,
            judgeHash:     _judgeHash,
            timestamp:     block.timestamp,
            operator:      msg.sender,
            slaCreated:    false
        }));

        decisionId = decisions.length - 1;

        emit DecisionLogged(decisionId, _module, _verdict, _confidence, block.timestamp);

        // Auto-mint SLA if accepted
        if (_verdict == Verdict.ACCEPTED) {
            _mintSLA(decisionId);
            decisions[decisionId].slaCreated = true;
        }
    }

    function _mintSLA(uint256 _decisionId) internal {
        uint256 deadline = block.timestamp + 86400; // 24 hours
        slaCommitments.push(SLACommitment({
            decisionId:  _decisionId,
            deadline:    deadline,
            fulfilled:   false,
            fulfilledAt: 0
        }));

        uint256 slaId = slaCommitments.length - 1;
        totalSLAs[msg.sender]++;

        emit SLAMinted(slaId, _decisionId, deadline, msg.sender);
    }

    function fulfillSLA(uint256 _slaId) external {
        SLACommitment storage sla = slaCommitments[_slaId];
        require(!sla.fulfilled, "Already fulfilled");

        sla.fulfilled   = true;
        sla.fulfilledAt = block.timestamp;
        fulfilledSLAs[msg.sender]++;

        // Reputation: +10 base, +5 bonus if fulfilled with >12h remaining
        uint256 points = 10;
        uint256 hoursLeft = 0;
        if (block.timestamp < sla.deadline) {
            hoursLeft = (sla.deadline - block.timestamp) / 3600;
            if (hoursLeft > 12) points += 5;
        }

        uint256 newScore = opsScore[msg.sender] + points;
        if (newScore > 100) newScore = 100;
        opsScore[msg.sender] = newScore;

        emit SLAFulfilled(_slaId, msg.sender, hoursLeft);
        emit ReputationUpdated(msg.sender, newScore, true);
    }

    // ── View functions ───────────────────────────────────────────

    function getDecision(uint256 id) external view returns (Decision memory) {
        return decisions[id];
    }

    function getSLA(uint256 id) external view returns (SLACommitment memory) {
        return slaCommitments[id];
    }

    function getProfile(address operator) external view returns (
        uint256 score,
        uint256 total,
        uint256 fulfilled,
        uint256 fulfillRate   // in basis points, 10000 = 100%
    ) {
        score     = opsScore[operator];
        total     = totalSLAs[operator];
        fulfilled = fulfilledSLAs[operator];
        fulfillRate = total > 0 ? (fulfilled * 10000) / total : 0;
    }

    function totalDecisions() external view returns (uint256) {
        return decisions.length;
    }

    function totalSLACommitments() external view returns (uint256) {
        return slaCommitments.length;
    }
}