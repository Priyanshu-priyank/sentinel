import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { ethers } from "ethers";
import { deliberate } from "./lib/ai.js";
import { 
  logDecisionOnChain, 
  fulfillSLAOnChain, 
  getOperatorProfile, 
  getAddressDecisions, 
  getSystemStats,
  contract
} from "./lib/blockchain.js";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const app = express();
app.use(cors());
app.use(express.json());

// Serve the frontend
app.use(express.static(path.join(__dirname, "..", "frontend")));

// ── API ROUTES ───────────────────────────────────────────────────

/**
 * Endpoint for processing a decision.
 * Triggers dual-agent AI deliberation and logs the result on-chain.
 */
app.post("/api/process", async (req, res) => {
  const { module: mod, data } = req.body;
  const isMock = process.env.MOCK_MODE === "true";

  if (!mod || !data) {
    return res.status(400).json({ success: false, error: "Missing module or data" });
  }

  try {
    console.log(`\n[${new Date().toISOString()}] Processing ${mod} decision...${isMock ? " (MOCK MODE)" : ""}`);
    
    let advocate, skeptic, judge, txHash, decisionId, slaId;

    if (isMock) {
      // 🧪 Mock Deliberation
      advocate = { argument: `This ${mod} seems promising based on the input.`, confidence: 85 };
      skeptic = { argument: `We need to verify if the budget matches our tiers.`, concern: 30 };
      judge = { verdict: "ACCEPTED", confidence: 85, summary: "High value lead with clear intent.", actionItem: "Contact immediate" };
      txHash = "0x" + "a".repeat(64);
      decisionId = "mock-123";
      slaId = "mock-sla-456";
    } else {
      // 🎭 AI Deliberation
      const aiResult = await deliberate(mod, data);
      advocate = aiResult.advocate;
      skeptic = aiResult.skeptic;
      judge = aiResult.judge;

      // 🔒 Hash everything for blockchain logging (privacy-preserving)
      const inputHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(data)));
      const advocateHash = ethers.keccak256(ethers.toUtf8Bytes(advocate.argument));
      const skepticHash = ethers.keccak256(ethers.toUtf8Bytes(skeptic.argument));
      const judgeHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(judge)));

      // Map to solidity enums
      const moduleEnum = { LEAD: 0, SUPPORT: 1, TASK: 2 }[mod];
      const verdictEnum = { ACCEPTED: 0, REJECTED: 1, ESCALATED: 2 }[judge.verdict.toUpperCase()];

      // ⛓️ Write to Shardeum
      console.log("  Submitting to Shardeum... (includes all agent logs)");
      const receipt = await logDecisionOnChain(
        inputHash,
        moduleEnum,
        verdictEnum,
        judge.confidence,
        advocateHash,
        skepticHash,
        judgeHash
      );
      txHash = receipt.hash;

      // Parse events from receipt
      const decisionLoggedEvent = receipt.logs
        .map(log => { try { return contract.interface.parseLog(log); } catch { return null; } })
        .find(e => e?.name === "DecisionLogged");

      const slaMintedEvent = receipt.logs
        .map(log => { try { return contract.interface.parseLog(log); } catch { return null; } })
        .find(e => e?.name === "SLAMinted");

      decisionId = decisionLoggedEvent?.args?.[0]?.toString() ?? "0";
      slaId = slaMintedEvent?.args?.[0]?.toString() ?? null;
      console.log(`  TX confirmed: ${txHash}`);
    }

    res.json({
      success: true,
      verdict: judge.verdict,
      confidence: judge.confidence,
      summary: judge.summary,
      actionItem: judge.actionItem,
      advocate: advocate.argument,
      skeptic: skeptic.argument,
      txHash: txHash,
      decisionId,
      slaId,
      slaDeadline: slaId ? new Date(Date.now() + 86400000).toISOString() : null,
      explorerUrl: isMock ? "#" : `https://explorer-mezame.shardeum.org/tx/${txHash}`,
    });

  } catch (err) {
    console.error("Process error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Endpoint to fulfill an SLA commitment.
 */
app.post("/api/fulfill-sla", async (req, res) => {
  const { slaId } = req.body;
  if (process.env.MOCK_MODE === "true") {
    return res.json({ success: true, txHash: "0x" + "b".repeat(64) });
  }
  try {
    const receipt = await fulfillSLAOnChain(slaId);
    res.json({ success: true, txHash: receipt.hash });
  } catch (err) {
    console.error("Fulfill error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Endpoint to get operator profiles.
 */
app.get("/api/profile/:address", async (req, res) => {
  if (process.env.MOCK_MODE === "true") {
    return res.json({ opsScore: "750", totalSLAs: "10", fulfilled: "8", fulfillRate: "80.0%" });
  }
  try {
    const profile = await getOperatorProfile(req.params.address);
    res.json(profile);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Endpoint to get decision history for an address.
 */
app.get("/api/decisions/:address", async (req, res) => {
  if (process.env.MOCK_MODE === "true") {
     return res.json([{ id: 0, module: "Lead", verdict: "Accepted", confidence: 85, timestamp: Date.now()/1000, slaCreated: true }]);
  }
  try {
    const decisions = await getAddressDecisions(req.params.address);
    res.json(decisions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Endpoint for global system stats.
 */
app.get("/api/stats", async (req, res) => {
  if (process.env.MOCK_MODE === "true") {
    return res.json({ totalDecisions: "1", totalSLAs: "1", walletAddress: "0xMOCK_WALLET" });
  }
  try {
    const stats = await getSystemStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SPA fallback
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "frontend", "index.html"));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🚀 StartChain OS Backend running on http://localhost:${PORT}`);
  console.log(`   Frontend:  http://localhost:${PORT}`);
  console.log(`   API:       http://localhost:${PORT}/api/stats\n`);
});
