// Contract configuration — update CONTRACT_ADDRESS after deploying
// Run: npm run deploy
// Then paste the deployed address below

export const CONTRACT_ADDRESS = "0x95010D8BC6a230cbA0aF81ba3FE75DACC6De07c0";

export const ABI = [
  // ── Write functions ──
  "function logDecision(bytes32 _inputHash, uint8 _module, uint8 _verdict, uint8 _confidence, bytes32 _advocateHash, bytes32 _skepticHash, bytes32 _judgeHash) external returns (uint256 decisionId)",
  "function fulfillSLA(uint256 _slaId) external",

  // ── View functions ──
  "function getDecision(uint256 id) external view returns (tuple(bytes32 inputHash, uint8 module, uint8 verdict, uint8 confidence, bytes32 advocateHash, bytes32 skepticHash, bytes32 judgeHash, uint256 timestamp, address operator, bool slaCreated))",
  "function getSLA(uint256 id) external view returns (tuple(uint256 decisionId, uint256 deadline, bool fulfilled, uint256 fulfilledAt))",
  "function getProfile(address operator) external view returns (uint256 score, uint256 total, uint256 fulfilled, uint256 fulfillRate)",
  "function totalDecisions() external view returns (uint256)",
  "function totalSLACommitments() external view returns (uint256)",
  "function opsScore(address) external view returns (uint256)",
  "function totalSLAs(address) external view returns (uint256)",
  "function fulfilledSLAs(address) external view returns (uint256)",
  "function decisions(uint256) external view returns (bytes32, uint8, uint8, uint8, bytes32, bytes32, uint256, address, bool)",
  "function slaCommitments(uint256) external view returns (uint256, uint256, bool, uint256)",

  // ── Events ──
  "event DecisionLogged(uint256 indexed id, uint8 module, uint8 verdict, uint8 confidence, uint256 timestamp)",
  "event SLAMinted(uint256 indexed slaId, uint256 indexed decisionId, uint256 deadline, address operator)",
  "event SLAFulfilled(uint256 indexed slaId, address fulfiller, uint256 hoursRemaining)",
  "event ReputationUpdated(address indexed operator, uint256 newScore, bool increased)"
];
