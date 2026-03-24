import { ethers } from "ethers";
import { CONTRACT_ADDRESS, ABI } from "../contractConfig.js";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "../../.env") });

const provider = new ethers.JsonRpcProvider(
  process.env.SHARDEUM_TESTNET_RPC || "https://api-mezame.shardeum.org"
);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);

export { provider, wallet, contract };

/**
 * Logs a decision to the Shardeum blockchain.
 */
export async function logDecisionOnChain(inputHash, moduleEnum, verdictEnum, confidence, advocateHash, skepticHash) {
  const tx = await contract.logDecision(
    inputHash,
    moduleEnum,
    verdictEnum,
    confidence,
    advocateHash,
    skepticHash
  );
  return await tx.wait();
}

/**
 * Fulfills an existing SLA commitment.
 */
export async function fulfillSLAOnChain(slaId) {
  const tx = await contract.fulfillSLA(slaId);
  return await tx.wait();
}

/**
 * Retrieves the profile of an operator.
 */
export async function getOperatorProfile(address) {
  const profile = await contract.getProfile(address);
  return {
    opsScore: profile[0].toString(),
    totalSLAs: profile[1].toString(),
    fulfilled: profile[2].toString(),
    fulfillRate: (Number(profile[3]) / 100).toFixed(1) + "%",
  };
}

/**
 * Retrieves past decisions for a specific address.
 */
export async function getAddressDecisions(address, limit = 50) {
  const total = await contract.totalDecisions();
  const count = Number(total);
  const results = [];
  const start = Math.max(0, count - limit);
  
  for (let i = start; i < count; i++) {
    const d = await contract.getDecision(i);
    if (d.operator.toLowerCase() === address.toLowerCase()) {
      results.push({
        id: i,
        module: ["Lead", "Support", "Task"][Number(d.module)],
        verdict: ["Accepted", "Rejected", "Escalated"][Number(d.verdict)],
        confidence: Number(d.confidence),
        timestamp: Number(d.timestamp),
        slaCreated: d.slaCreated,
      });
    }
  }
  return results;
}

/**
 * Gets global system stats.
 */
export async function getSystemStats() {
  const totalDec = await contract.totalDecisions();
  const totalSLA = await contract.totalSLACommitments();
  return {
    totalDecisions: totalDec.toString(),
    totalSLAs: totalSLA.toString(),
    walletAddress: wallet.address,
  };
}
